/**
 * GM-executed write relay, carried on the requesting user's own document.
 *
 * Players are deliberately not given ownership of the shared date entries, so
 * they cannot create or edit journal pages directly. A player's write is
 * therefore performed on their behalf by a GM, which only works if the GM can
 * tell who actually asked.
 *
 * ## Why this is not a socket
 *
 * The module socket relayed a message whose `userId` field the sending client
 * filled in. Foundry attaches no authenticated sender to a module socket
 * message, so that field was a claim, not an identity: any client could emit a
 * request naming any other user — including a GM — and the executing GM would
 * re-validate the request against the permissions of whoever was named. A
 * player could edit or delete any note in the world by claiming a GM's id.
 *
 * Nothing inside a socket message can fix that, because the whole message is
 * written by the sender. The identity has to come from somewhere the server
 * stamps, so the request is written as a flag on the requesting user's own
 * User document instead:
 *
 *   1. The player writes the request into `flags.<module>.requests.<id>` on
 *      their own user. Foundry's server permits a non-GM to update only their
 *      own User document, so this write is itself the authentication.
 *   2. Every client sees `updateUser`. On the primary GM's client the hook
 *      hands over the User *document* that changed, and the request is executed
 *      against that document rather than against anything in the payload.
 *   3. The GM writes the outcome to `flags.<module>.responses.<id>` on the same
 *      user and clears the request; the requesting client resolves its promise
 *      from its own `updateUser` and clears the response.
 *
 * The payload is still entirely attacker-controlled and is still validated by
 * each handler. What changed is that "who is asking" no longer is.
 *
 * ## Requires
 *
 * That a non-GM may update their own User document's flags. This is Foundry's
 * documented ownership rule for User documents — a user is the owner of
 * themselves, and only `role` and `permissions` are withheld — but it is the
 * load-bearing assumption of this file, so `verifyRelayAvailable` checks it at
 * startup and says so plainly in the log rather than failing at the first note
 * a player tries to write.
 */

import { log, t } from "../compat.js";
import { FLAGS, MODULE_ID, RELAY_OPS, RELAY_LIMITS } from "../constants.js";

const pending = new Map();
const handlers = new Map();

/** Requests this GM client has already run, so a re-render cannot repeat one. */
const executed = new Set();

/** Per-user timestamps of recently executed requests, for the rate limit. */
const recent = new Map();

const REQUEST_TIMEOUT_MS = 15000;

/** True when this client is the single GM responsible for executing requests. */
export function isPrimaryGM() {
  const activeGMs = game.users
    .filter(user => user.isGM && user.active)
    .sort((a, b) => a.id.localeCompare(b.id));
  return activeGMs[0]?.id === game.user.id;
}

/** True when at least one GM is connected and able to service requests. */
export function hasActiveGM() {
  return game.users.some(user => user.isGM && user.active);
}

/**
 * Register the executor for one operation. Handlers run on the primary GM
 * client and receive `(payload, requestingUser)`, where the user is the
 * authenticated document whose flags carried the request.
 */
export function registerHandler(operation, handler) {
  handlers.set(operation, handler);
}

const requestPath = id => `flags.${MODULE_ID}.${FLAGS.REQUESTS}.${id}`;
const responsePath = id => `flags.${MODULE_ID}.${FLAGS.RESPONSES}.${id}`;

/** The `-=key` form Foundry uses to delete a flag rather than set it to null. */
const deleteRequestPath = id => `flags.${MODULE_ID}.${FLAGS.REQUESTS}.-=${id}`;
const deleteResponsePath = id => `flags.${MODULE_ID}.${FLAGS.RESPONSES}.-=${id}`;

/**
 * Ask a GM to perform an operation on this user's behalf.
 * @returns {Promise<any>} the handler's result
 */
export async function request(operation, payload) {
  if (!hasActiveGM()) throw new Error(t("TTA.Errors.NoActiveGM"));

  const requestId = foundry.utils.randomID();
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      // The request flag is this client's own to clean up, and a request no
      // one answered would otherwise sit on the user document indefinitely.
      clearRequest(requestId);
      reject(new Error(t("TTA.Errors.RequestTimedOut")));
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timeout });
  });

  try {
    await game.user.update({ [requestPath(requestId)]: { operation, payload, requestedAt: Date.now() } });
  } catch (error) {
    // The one failure worth naming: if this write is refused, no note a player
    // writes can ever reach a GM, and the reason is a permission rule rather
    // than anything about the note.
    log("error", "Could not write the relay request to this user's own document", error);
    const record = pending.get(requestId);
    if (record) {
      clearTimeout(record.timeout);
      pending.delete(requestId);
    }
    throw new Error(t("TTA.Errors.RelayUnavailable"));
  }

  log("debug", "Relay request written", operation, requestId);
  return promise;
}

/** Remove one of this user's own request flags, best effort. */
function clearRequest(requestId) {
  game.user.update({ [deleteRequestPath(requestId)]: null })
    .catch(error => log("debug", "Could not clear a relay request flag", requestId, error));
}

/** Remove one of this user's own response flags, best effort. */
function clearResponse(requestId) {
  game.user.update({ [deleteResponsePath(requestId)]: null })
    .catch(error => log("debug", "Could not clear a relay response flag", requestId, error));
}

/**
 * Whether this user has asked for too much too quickly.
 *
 * Every relayed request is a document write performed by the GM's client, so
 * without a bound one player can keep a GM's client busy and fill the world
 * database. The window is per user and deliberately generous: it is a ceiling
 * on automated abuse, not a limit anyone typing notes will reach.
 */
function withinRateLimit(userId) {
  const now = Date.now();
  const times = (recent.get(userId) ?? []).filter(time => now - time < RELAY_LIMITS.WINDOW_MS);
  if (times.length >= RELAY_LIMITS.MAX_PER_WINDOW) {
    recent.set(userId, times);
    return false;
  }
  times.push(now);
  recent.set(userId, times);
  return true;
}

/**
 * Execute the requests carried by one user document. Runs on the primary GM.
 *
 * @param {User} user      the document that changed; the authenticated requester
 * @param {string} byUserId who performed the update
 */
async function handleRequests(user, byUserId) {
  if (!isPrimaryGM()) return;

  // A request counts only when its own user made it. A GM may write to anyone's
  // document, and a request that appeared on a player's user without that
  // player asking is not that player asking.
  if (byUserId !== user.id) return;

  const requests = user.getFlag(MODULE_ID, FLAGS.REQUESTS) ?? {};
  for (const [requestId, entry] of Object.entries(requests)) {
    if (!entry || typeof entry !== "object") continue;
    if (executed.has(requestId)) continue;
    executed.add(requestId);

    const response = { ok: false };
    try {
      if (!withinRateLimit(user.id)) throw new Error(t("TTA.Errors.RelayRateLimited"));
      const handler = handlers.get(entry.operation);
      if (!handler) throw new Error(`Unsupported operation: ${entry.operation}`);
      response.result = await handler(entry.payload, user);
      response.ok = true;
    } catch (error) {
      log("warn", "Relay request failed", entry.operation, error);
      response.error = error.message ?? String(error);
    }

    try {
      await user.update({
        [responsePath(requestId)]: response,
        [deleteRequestPath(requestId)]: null
      });
    } catch (error) {
      log("error", "Could not return a relay result", requestId, error);
    }
  }
}

/** Resolve this client's own pending requests from the responses written back. */
function handleResponses(user) {
  if (user.id !== game.user.id) return;

  const responses = user.getFlag(MODULE_ID, FLAGS.RESPONSES) ?? {};
  for (const [requestId, response] of Object.entries(responses)) {
    const record = pending.get(requestId);
    if (!record) continue;
    pending.delete(requestId);
    clearTimeout(record.timeout);
    clearResponse(requestId);

    if (response?.ok) record.resolve(response.result);
    else record.reject(new Error(response?.error ?? t("TTA.Errors.RequestFailed")));
  }
}

/**
 * Clear relay flags left behind by a previous session.
 *
 * A client that disconnected mid-request leaves its request or response flag on
 * the user document, where it would otherwise accumulate. Each user clears
 * their own on startup, so no one needs rights over anyone else's document.
 */
export async function clearStaleRelayFlags() {
  const requests = game.user.getFlag(MODULE_ID, FLAGS.REQUESTS) ?? {};
  const responses = game.user.getFlag(MODULE_ID, FLAGS.RESPONSES) ?? {};
  const stale = {};
  for (const id of Object.keys(requests)) stale[deleteRequestPath(id)] = null;
  for (const id of Object.keys(responses)) stale[deleteResponsePath(id)] = null;
  if (!Object.keys(stale).length) return 0;

  try {
    await game.user.update(stale);
    log("debug", `Cleared ${Object.keys(stale).length} stale relay flags`);
  } catch (error) {
    log("debug", "Could not clear stale relay flags", error);
  }
  return Object.keys(stale).length;
}

/**
 * Confirm at startup that this client can write its own relay flags.
 *
 * The whole transport rests on a player being allowed to update their own User
 * document. If that is ever not true, every note a player writes fails at the
 * moment they write it with an error about their note; this turns that into one
 * clear line in the log at startup instead.
 */
export async function verifyRelayAvailable() {
  if (game.user.isGM) return true; // a GM never relays, so it does not matter
  try {
    await game.user.setFlag(MODULE_ID, FLAGS.RELAY_PROBE, Date.now());
    await game.user.unsetFlag(MODULE_ID, FLAGS.RELAY_PROBE);
    return true;
  } catch (error) {
    log("error",
      "This user cannot write flags to their own document, so note writes cannot be "
      + "relayed to a GM. Player notes will not work in this world.", error);
    return false;
  }
}

/** Wire up the relay. Called once during `ready`. */
export function registerRelay() {
  Hooks.on("updateUser", (user, changes, options, byUserId) => {
    // Only a change that touched this module's flags can carry relay traffic.
    if (!changes?.flags?.[MODULE_ID]) return;
    handleRequests(user, byUserId);
    handleResponses(user);
  });
  log("debug", `Relay registered on user flags for ${MODULE_ID}`);
}

export { RELAY_OPS };
