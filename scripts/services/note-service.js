/**
 * Calendar notes: the permission-aware layer between the UI and journal storage.
 *
 * A GM performs writes directly; a player's request is validated locally,
 * relayed to a GM through the requesting user's own document, re-validated
 * there against the authenticated requester, and only then written. Reads are
 * filtered so hidden note content never reaches a client that is not entitled
 * to it.
 *
 * The relay's identity guarantee is the whole reason the handlers below can
 * trust their `user` argument; see `relay-service.js` for what it rests on.
 */

import { log, sanitizeHTML, t } from "../compat.js";
import { MODULE_ID, RELAY_OPS, SCOPE, VISIBILITY } from "../constants.js";
import { getCalendar } from "./calendar-service.js";
import { compareDateKeys, dayKey, monthKey, parseKey } from "./date-service.js";
import * as journal from "./journal-service.js";
import {
  canCreateNote,
  canDeleteNote,
  canEditNote,
  canViewNote,
  isGM
} from "./permission-service.js";
import { registerHandler, request } from "./relay-service.js";
import { validateNote } from "./validation-service.js";

/** Default visibility for a note authored by the given user. */
export function defaultVisibilityFor(user = game.user) {
  return user.isGM ? VISIBILITY.GM_ONLY : VISIBILITY.AUTHOR_AND_GM;
}

/** Shape a note page into the plain record the templates consume. */
function toView(record, user = game.user) {
  const { page, flags } = record;
  const parsed = parseKey(flags.dateKey);
  return {
    uuid: page.uuid,
    id: page.id,
    title: page.name,
    dateKey: flags.dateKey,
    scope: flags.scope,
    year: parsed?.year ?? null,
    month: parsed?.month ?? null,
    day: parsed?.day ?? null,
    authorId: flags.authorId,
    authorName: flags.authorName || game.users.get(flags.authorId)?.name || t("TTA.Notes.UnknownAuthor"),
    isOwnNote: flags.authorId === user.id,
    isGMNote: !!game.users.get(flags.authorId)?.isGM,
    visibility: flags.visibility,
    visibilityLabel: t(`TTA.Visibility.${flags.visibility}`),
    promoted: !!flags.timelineEventId,
    timelineEventId: flags.timelineEventId,
    createdAt: flags.createdAt,
    updatedAt: flags.updatedAt,
    canEdit: canEditNote(flags, user),
    canDelete: canDeleteNote(flags, user),
    content: page.text?.content ?? ""
  };
}

/** Every note the user may see, newest date last. */
export function getVisibleNotes(user = game.user) {
  return journal.getAllNotePages()
    .filter(record => canViewNote(record.flags, user))
    .map(record => toView(record, user));
}

/** Notes on one exact date key that the user may see. */
export function getNotesForKey(dateKey, user = game.user) {
  return journal.getNotePagesForKey(dateKey)
    .filter(record => canViewNote(record.flags, user))
    .map(record => toView(record, user))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Day notes for a specific day. */
export function getDayNotes(year, month, day, user = game.user) {
  return getNotesForKey(dayKey(year, month, day), user);
}

/** Month notes for a specific month. */
export function getMonthNotes(year, month, user = game.user) {
  return getNotesForKey(monthKey(year, month), user);
}

/**
 * Per-day note counts for one month, used to draw the calendar grid indicators.
 * @returns {Record<number, number>} day number -> visible note count
 */
export function getMonthNoteCounts(year, month, user = game.user) {
  const counts = {};
  for (const record of journal.getAllNotePages()) {
    const parsed = parseKey(record.flags.dateKey);
    if (!parsed || parsed.year !== year || parsed.month !== month) continue;
    if (parsed.scope !== SCOPE.DAY) continue;
    if (!canViewNote(record.flags, user)) continue;
    counts[parsed.day] = (counts[parsed.day] ?? 0) + 1;
  }
  return counts;
}

/**
 * Apply a GM note filter to a note list.
 * @param {string} filter one of all|gm|players|day|month|promoted|user:<id>
 */
export function filterNotes(notes, filter) {
  if (!filter || filter === "all") return notes;
  if (filter === "gm") return notes.filter(note => note.isGMNote);
  if (filter === "players") return notes.filter(note => !note.isGMNote);
  if (filter === "day") return notes.filter(note => note.scope === SCOPE.DAY);
  if (filter === "month") return notes.filter(note => note.scope === SCOPE.MONTH);
  if (filter === "promoted") return notes.filter(note => note.promoted);
  if (filter.startsWith("user:")) {
    const userId = filter.slice(5);
    return notes.filter(note => note.authorId === userId);
  }
  return notes;
}

/** The filter choices offered to a GM, including one entry per player. */
export function getFilterChoices() {
  const choices = [
    { value: "all", label: t("TTA.Filters.All") },
    { value: "gm", label: t("TTA.Filters.GM") },
    { value: "players", label: t("TTA.Filters.Players") },
    { value: "day", label: t("TTA.Filters.DayNotes") },
    { value: "month", label: t("TTA.Filters.MonthNotes") },
    { value: "promoted", label: t("TTA.Filters.Promoted") }
  ];
  for (const user of game.users.filter(u => !u.isGM)) {
    choices.push({ value: `user:${user.id}`, label: t("TTA.Filters.ByUser", { name: user.name }) });
  }
  return choices;
}

function assertValid(payload) {
  const result = validateNote(payload, getCalendar());
  if (!result.valid) {
    const message = result.errors.map(error => t(`TTA.Validation.${error.code}`, error.data)).join(" ");
    throw new Error(message);
  }
}

/**
 * Create a note. Players may only author notes attributed to themselves, and
 * only with a visibility a player is allowed to choose.
 */
export async function createNote({ dateKey, title, content = "", visibility } = {}) {
  const scope = parseKey(dateKey)?.scope;
  if (!canCreateNote(scope)) {
    ui.notifications.warn(t("TTA.Errors.NoteCreationDenied"));
    return null;
  }

  const resolvedVisibility = isGM()
    ? (visibility ?? VISIBILITY.GM_ONLY)
    : VISIBILITY.AUTHOR_AND_GM;

  const payload = {
    dateKey,
    title: String(title ?? "").trim(),
    content,
    scope,
    visibility: resolvedVisibility,
    authorId: game.user.id,
    authorName: game.user.name
  };
  assertValid(payload);

  if (isGM()) return journal.createNotePage(payload);
  return request(RELAY_OPS.CREATE_NOTE, payload);
}

/** Update a note. Players may only update their own, and never its visibility. */
export async function updateNote(pageUuid, { title, content, visibility } = {}) {
  const page = await fromUuid(pageUuid);
  const flags = journal.readNoteFlags(page);
  if (!flags) {
    ui.notifications.warn(t("TTA.Errors.NoteMissing"));
    return null;
  }
  if (!canEditNote(flags)) {
    ui.notifications.warn(t("TTA.Errors.NoteEditDenied"));
    return null;
  }

  const payload = {
    pageUuid,
    title: title === undefined ? undefined : String(title).trim(),
    content,
    visibility: isGM() ? visibility : undefined
  };

  assertValid({
    dateKey: flags.dateKey,
    scope: flags.scope,
    title: payload.title ?? page.name,
    visibility: payload.visibility ?? flags.visibility
  });

  if (isGM()) return journal.updateNotePage(pageUuid, payload);
  return request(RELAY_OPS.UPDATE_NOTE, payload);
}

/** Delete a note. Callers are expected to have confirmed with the user first. */
export async function deleteNote(pageUuid) {
  const page = await fromUuid(pageUuid);
  const flags = journal.readNoteFlags(page);
  if (!flags) {
    ui.notifications.warn(t("TTA.Errors.NoteMissing"));
    return false;
  }
  if (!canDeleteNote(flags)) {
    ui.notifications.warn(t("TTA.Errors.NoteDeleteDenied"));
    return false;
  }
  if (isGM()) return journal.deleteNotePage(pageUuid);
  return request(RELAY_OPS.DELETE_NOTE, { pageUuid });
}

/** Notes eligible for promotion into a timeline event: day notes, not yet promoted. */
export function getPromotableNotes() {
  if (!isGM()) return [];
  return getVisibleNotes()
    .filter(note => note.scope === SCOPE.DAY && !note.promoted)
    .sort((a, b) => compareDateKeys(a.dateKey, b.dateKey));
}

/**
 * Refuse a relayed request from a user who should not be making one.
 *
 * The relay authenticates who is asking — `user` is the document whose own
 * flags carried the request — so this is no longer the load-bearing check it
 * was when identity was a claim in a socket message. It stays because both
 * cases still describe a request that cannot be genuine: a GM writes directly
 * and never relays, and a disconnected user is not at a keyboard asking for
 * anything.
 */
function assertRelayable(user) {
  if (!user) throw new Error("Unknown requesting user");
  if (isGM(user)) throw new Error(t("TTA.Errors.RelayNotForGM"));
  if (!user.active) throw new Error(t("TTA.Errors.RelayUserInactive"));
}

/**
 * GM-side relay handlers.
 *
 * Each one re-validates the request against the authenticated requester and
 * sanitizes the body before it is stored. The payload is still written entirely
 * by the requesting client and is trusted for nothing; only the identity of the
 * user who sent it is now something the server vouched for.
 */

export function registerRelayHandlers() {
  registerHandler(RELAY_OPS.CREATE_NOTE, async (payload, user) => {
    assertRelayable(user);
    if (!canCreateNote(payload.scope, user)) throw new Error(t("TTA.Errors.NoteCreationDenied"));
    const safe = {
      dateKey: payload.dateKey,
      title: String(payload.title ?? "").trim(),
      // The body is stored as HTML and rendered back on every client, and this
      // one did not come from the editor: it is whatever string the requesting
      // client sent. It is filtered here, before it is written, so a world is
      // not carrying markup that only the render path knows to defuse.
      content: sanitizeHTML(payload.content ?? ""),
      scope: payload.scope,
      visibility: VISIBILITY.AUTHOR_AND_GM,
      authorId: user.id,
      authorName: user.name
    };
    assertValid(safe);
    const page = await journal.createNotePage(safe);
    log("debug", "Created note on behalf of", user.name);
    return page?.uuid ?? null;
  });

  registerHandler(RELAY_OPS.UPDATE_NOTE, async (payload, user) => {
    assertRelayable(user);
    const page = await fromUuid(payload.pageUuid);
    const flags = journal.readNoteFlags(page);
    if (!flags) throw new Error(t("TTA.Errors.NoteMissing"));
    if (!canEditNote(flags, user)) throw new Error(t("TTA.Errors.NoteEditDenied"));

    const content = payload.content === undefined ? undefined : sanitizeHTML(payload.content);

    // The create handler has always validated its payload and this one never
    // did, so a relayed edit was the way round every bound the module sets.
    assertValid({
      dateKey: flags.dateKey,
      scope: flags.scope,
      title: payload.title ?? page.name,
      content: content ?? "",
      visibility: flags.visibility
    });

    // A relayed request may never change visibility: only a GM acting directly can.
    await journal.updateNotePage(payload.pageUuid, { title: payload.title, content });
    return true;
  });

  registerHandler(RELAY_OPS.DELETE_NOTE, async (payload, user) => {
    assertRelayable(user);
    const page = await fromUuid(payload.pageUuid);
    const flags = journal.readNoteFlags(page);
    if (!flags) throw new Error(t("TTA.Errors.NoteMissing"));
    if (!canDeleteNote(flags, user)) throw new Error(t("TTA.Errors.NoteDeleteDenied"));
    return journal.deleteNotePage(payload.pageUuid);
  });

  log("debug", `${MODULE_ID} note relay handlers registered`);
}
