/**
 * Calendar notes: the permission-aware layer between the UI and journal storage.
 *
 * A GM performs writes directly; a player's request is validated locally, sent
 * to a GM over the socket, re-validated there against the requesting user, and
 * only then written. Reads are filtered so hidden note content never reaches a
 * client that is not entitled to it.
 */

import { log, t } from "../compat.js";
import { MODULE_ID, SCOPE, SOCKET_OPS, VISIBILITY } from "../constants.js";
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
import { registerHandler, request } from "./socket-service.js";
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
  return request(SOCKET_OPS.CREATE_NOTE, payload);
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
  return request(SOCKET_OPS.UPDATE_NOTE, payload);
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
  return request(SOCKET_OPS.DELETE_NOTE, { pageUuid });
}

/** Notes eligible for promotion into a timeline event: day notes, not yet promoted. */
export function getPromotableNotes() {
  if (!isGM()) return [];
  return getVisibleNotes()
    .filter(note => note.scope === SCOPE.DAY && !note.promoted)
    .sort((a, b) => compareDateKeys(a.dateKey, b.dateKey));
}

/**
 * GM-side socket handlers. Each one re-validates the request against the user
 * who sent it, so a crafted socket message cannot forge authorship or escalate
 * a note's visibility.
 */
/**
 * Refuse a relayed request that claims an identity it cannot have.
 *
 * The module socket carries no authenticated sender, so the `userId` on a
 * request is whatever the sending client wrote. That cannot be repaired here —
 * see the transport note in `socket-service.js` — but two claims are refusable
 * on their face, and both are the ones worth refusing:
 *
 * A GM never relays. `createNote`, `updateNote` and `deleteNote` all write
 * directly when the caller is a GM, so a request claiming to come from one is
 * forged by definition, and it is the claim that would otherwise grant the
 * sender every permission this module has.
 *
 * An absent or disconnected user cannot be at a keyboard asking for anything.
 */
function assertRelayable(user) {
  if (!user) throw new Error("Unknown requesting user");
  if (isGM(user)) throw new Error(t("TTA.Errors.RelayNotForGM"));
  if (!user.active) throw new Error(t("TTA.Errors.RelayUserInactive"));
}

export function registerSocketHandlers() {
  registerHandler(SOCKET_OPS.CREATE_NOTE, async (payload, user) => {
    assertRelayable(user);
    if (!canCreateNote(payload.scope, user)) throw new Error(t("TTA.Errors.NoteCreationDenied"));
    const safe = {
      dateKey: payload.dateKey,
      title: String(payload.title ?? "").trim(),
      content: payload.content ?? "",
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

  registerHandler(SOCKET_OPS.UPDATE_NOTE, async (payload, user) => {
    assertRelayable(user);
    const page = await fromUuid(payload.pageUuid);
    const flags = journal.readNoteFlags(page);
    if (!flags) throw new Error(t("TTA.Errors.NoteMissing"));
    if (!canEditNote(flags, user)) throw new Error(t("TTA.Errors.NoteEditDenied"));

    // The create handler has always validated its payload and this one never
    // did, so a relayed edit was the way round every bound the module sets.
    assertValid({
      dateKey: flags.dateKey,
      scope: flags.scope,
      title: payload.title ?? page.name,
      content: payload.content ?? "",
      visibility: flags.visibility
    });

    // A relayed request may never change visibility: only a GM acting directly can.
    await journal.updateNotePage(payload.pageUuid, {
      title: payload.title,
      content: payload.content
    });
    return true;
  });

  registerHandler(SOCKET_OPS.DELETE_NOTE, async (payload, user) => {
    assertRelayable(user);
    const page = await fromUuid(payload.pageUuid);
    const flags = journal.readNoteFlags(page);
    if (!flags) throw new Error(t("TTA.Errors.NoteMissing"));
    if (!canDeleteNote(flags, user)) throw new Error(t("TTA.Errors.NoteDeleteDenied"));
    return journal.deleteNotePage(payload.pageUuid);
  });

  log("debug", `${MODULE_ID} note socket handlers registered`);
}
