/**
 * Storage for the parts of the calendar players are not meant to see.
 *
 * ## Why this exists
 *
 * The calendar, its Ages and the timeline events were all kept in world
 * settings, and Foundry delivers every world setting to every connected client.
 * Marking an event GM-only or an Age hidden therefore filtered it out of the
 * interface but not out of the data: a player could read the whole list from
 * the console. The visibility controls promised secrecy and only ever provided
 * tidiness.
 *
 * Document ownership is the mechanism Foundry does enforce, and this module
 * already relies on it for note privacy — a GM-only note page grants nothing by
 * default and never reaches a player's client. GM-only calendar content is
 * stored the same way: one JournalEntry in the managed folder, owned by nobody
 * by default, carrying the hidden records in its flags.
 *
 * ## Reading it
 *
 * `readPrivate` returns `null` when the entry is not there to read, which is a
 * different fact from an entry that is there and empty. For a player it is
 * always null, because the document is never delivered to them. For a GM it is
 * null only before the store has been created. Callers merge nothing in either
 * case, but `saveData` needs to tell the two apart before it splits a payload
 * back up, or a GM saving while the store was unreadable would write the hidden
 * half away.
 */

import { log, t } from "../compat.js";
import { FLAGS, MODULE_ID, PRIVATE_ENTRY_NAME } from "../constants.js";
import { ensureFolder, managedFirst, mergeRecords } from "./journal-service.js";
import { isGM } from "./permission-service.js";

/**
 * Every GM-only entry this client can read, the one in the managed folder first.
 *
 * There is meant to be one. It is looked for by its flag rather than by where
 * it sits, because it is an ordinary journal entry in the sidebar: it can be
 * dragged out of the folder, and it is left outside when the folder is deleted
 * and made again. Looking only inside the folder made the store vanish in
 * either case, hidden Ages and GM-only events with it, and the next save then
 * started a second, empty one. A world that has been through that has two, so
 * every entry carrying the flag is read.
 */
export function getPrivateEntries() {
  if (!game.journal) return [];
  return managedFirst(game.journal.filter(entry => !!entry.getFlag(MODULE_ID, FLAGS.PRIVATE_ENTRY)));
}

/** The GM-only entry that is written to, or null when none is readable here. */
export function getPrivateEntry() {
  return getPrivateEntries()[0] ?? null;
}

/** True when the GM-only store exists and this client may read it. */
export function isPrivateStoreReadable() {
  return !!getPrivateEntry();
}

function payloadOf(entry) {
  const payload = entry.getFlag(MODULE_ID, FLAGS.PRIVATE_DATA) ?? {};
  return {
    ages: Array.isArray(payload.ages) ? payload.ages : [],
    events: Array.isArray(payload.events) ? payload.events : []
  };
}

/**
 * The hidden records, or null when the store cannot be read.
 *
 * Should the store be in more than one entry, the records of all of them are
 * returned as one list.
 * @returns {{ages:Array, events:Array}|null}
 */
export function readPrivate() {
  const payloads = getPrivateEntries().map(payloadOf);
  if (!payloads.length) return null;
  return {
    ages: mergeRecords(payloads.map(payload => payload.ages)),
    events: mergeRecords(payloads.map(payload => payload.events))
  };
}

/**
 * Return the GM-only entry, creating it when necessary. GM only.
 *
 * `ownership: { default: NONE }` is the whole point: a document no one owns is
 * one the server does not send to a player's client.
 */
export async function ensurePrivateEntry() {
  const existing = getPrivateEntry();
  if (existing) return existing;
  if (!isGM()) return null;

  const folder = await ensureFolder();
  const entry = await JournalEntry.create({
    name: PRIVATE_ENTRY_NAME,
    folder: folder?.id ?? null,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: {
      [MODULE_ID]: {
        [FLAGS.PRIVATE_ENTRY]: true,
        [FLAGS.PRIVATE_DATA]: { ages: [], events: [] }
      }
    }
  });
  log("info", "Created the GM-only calendar store");
  return entry;
}

/**
 * Replace the hidden records. GM only.
 *
 * The whole payload is written at once because it is read at once: there is no
 * partial state worth the extra round trip.
 *
 * The payload a caller writes was assembled from every entry `readPrivate`
 * could see, so once it is in the first one the others are emptied. Left as
 * they were, a record deleted here would come straight back from its copy.
 */
export async function writePrivate({ ages = [], events = [] } = {}) {
  if (!isGM()) throw new Error(t("TTA.Errors.GMOnly"));
  const entry = await ensurePrivateEntry();
  if (!entry) throw new Error(t("TTA.Errors.NoFolder"));
  await entry.setFlag(MODULE_ID, FLAGS.PRIVATE_DATA, { ages, events });
  for (const other of getPrivateEntries()) {
    if (other.id === entry.id) continue;
    const held = payloadOf(other);
    if (held.ages.length || held.events.length) {
      await other.setFlag(MODULE_ID, FLAGS.PRIVATE_DATA, { ages: [], events: [] });
    }
  }
  return { ages, events };
}

/**
 * Bring a store that has ended up in several entries back to one. GM only.
 *
 * Everything the entries hold is written into the first and the rest, empty by
 * then, are deleted. Part of the repair a GM asks for by name; nothing else
 * deletes an entry.
 * @returns {number} how many extra entries were removed
 */
export async function consolidatePrivateStore() {
  if (!isGM()) return 0;
  const [keep, ...extras] = getPrivateEntries();
  if (!keep || !extras.length) return 0;
  await writePrivate(readPrivate());
  for (const extra of extras) await extra.delete();
  log("warn", `The GM-only calendar store was in ${extras.length + 1} entries; they were merged into one`);
  return extras.length;
}

/**
 * Re-apply the ownership that makes the store private.
 *
 * A GM can change any document's permissions from the sidebar, and this entry
 * looks like an ordinary journal entry when they do. The repair path resets it
 * rather than trusting that nobody has.
 */
export async function repairPrivateOwnership() {
  if (!isGM()) return false;
  let repaired = false;
  for (const entry of getPrivateEntries()) {
    const shared = Object.entries(entry.ownership ?? {})
      .some(([id, level]) => level > CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
        && (id === "default" || !game.users.get(id)?.isGM));
    if (!shared) continue;
    await entry.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
    repaired = true;
  }
  if (repaired) log("warn", "The GM-only calendar store had been shared; its ownership was reset");
  return repaired;
}
