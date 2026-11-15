/**
 * Timeline events and display modes.
 *
 * Events are small, ordered records held in several stores, chosen by
 * visibility and party: player-visible shared ones in a world setting, GM-only
 * ones in the GM-only journal entry, and player-visible party ones in that
 * party's journal entry. That split is not tidiness — a world setting is
 * delivered in full to every client, so a GM-only event kept in one was
 * readable by any player who looked, whatever the interface showed them, and
 * a party's event would be readable by the other party.
 *
 * Only GMs write. Every client reads whatever it is entitled to receive, and
 * then filters again on top.
 */

import { log, sanitizeHTML, t } from "../compat.js";
import {
  DEFAULT_COLOR,
  EVENT_SOURCE,
  MODULE_ID,
  SETTINGS,
  TIMELINE_MODE,
  VISIBILITY
} from "../constants.js";
import { containsYear, endYear, findListingAge } from "./age-service.js";
import { getAgeForYear, getCalendar, getParties, getParty } from "./calendar-service.js";
import { compareDateKeys, parseKey } from "./date-service.js";
import { linkNoteToEvent, unlinkNoteFromEvent, updateNotePage } from "./journal-service.js";
import { migrateEvents } from "./migration-service.js";
import { isMember, partyForUser } from "./party-service.js";
import { readAllParties, writeParty } from "./party-store-service.js";
import { canManageEvents, canSetTimelineMode, canViewEvent, isGM } from "./permission-service.js";
import { readPrivate, writePrivate } from "./private-store-service.js";
import { validateEvent } from "./validation-service.js";

/**
 * All stored events this client can see, normalised and chronologically ordered.
 *
 * Player-visible shared events live in the world setting, which Foundry
 * delivers to everyone. GM-only events live in the GM-only store and a party's
 * events in that party's store, which it does not deliver to anyone else: a
 * player's `readPrivate` returns null and `readAllParties` holds only their own
 * party, because the other documents never reach them. So the list they
 * assemble here simply lacks what they may not see. That is the difference
 * between this and the old arrangement, where every event was in the world
 * setting and `getVisibleEvents` filtered a list the player already had in full.
 */
export function getEvents() {
  const shared = game.settings.get(MODULE_ID, SETTINGS.TIMELINE_EVENTS);
  const privateEvents = readPrivate()?.events ?? [];
  const partyEvents = [...readAllParties().values()].flatMap(payload => payload.events);
  return migrateEvents([...(Array.isArray(shared) ? shared : []), ...privateEvents, ...partyEvents]);
}

/**
 * Whether a user may see an event, as a second layer over document delivery.
 * A party's event is for its members and the GMs.
 */
export function canSeeEvent(event, user = game.user) {
  if (!canViewEvent(event, user)) return false;
  if (!event.partyId || isGM(user)) return true;
  return isMember(getParty(event.partyId), user?.id);
}

/** Events the given user is entitled to see. */
export function getVisibleEvents(user = game.user) {
  return getEvents().filter(event => canSeeEvent(event, user));
}

/** One event by id, or null. */
export function getEvent(eventId) {
  return getEvents().find(event => event.id === eventId) ?? null;
}

/**
 * Persist the whole event list, routed by visibility and party. GM only.
 *
 * An event's visibility and party decide where it is stored, not merely how
 * it is drawn, so changing either moves it between stores. Every store is
 * written on every save because an event can cross between any two of them,
 * and writing only the one that looks changed would leave another holding a
 * stale copy. An event naming a party that no longer exists is shared: the
 * alternative is a record nobody can reach.
 */
async function writeEvents(events) {
  const parties = getParties();
  const known = new Set(parties.map(party => party.id));
  const normalized = migrateEvents(events).map(event =>
    event.partyId && !known.has(event.partyId) ? { ...event, partyId: null } : event);

  const hidden = normalized.filter(event => event.visibility !== VISIBILITY.PLAYERS);
  const visible = normalized.filter(event => event.visibility === VISIBILITY.PLAYERS);
  const shared = visible.filter(event => !event.partyId);

  const existing = readPrivate();
  await writePrivate({ ages: existing?.ages ?? [], events: hidden });
  await game.settings.set(MODULE_ID, SETTINGS.TIMELINE_EVENTS, shared);
  for (const party of parties) {
    await writeParty(party, { events: visible.filter(event => event.partyId === party.id) });
  }
  return normalized;
}

function assertValid(event) {
  const result = validateEvent(event, getCalendar());
  if (!result.valid) {
    const message = result.errors.map(error => t(`TTA.Validation.${error.code}`, error.data)).join(" ");
    throw new Error(message);
  }
}

/** Create an event. GM only. */
export async function createEvent(data) {
  if (!canManageEvents()) {
    ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    return null;
  }
  const now = new Date().toISOString();
  const event = {
    id: foundry.utils.randomID(),
    dateKey: data.dateKey,
    title: String(data.title ?? "").trim(),
    // An event description is rendered as HTML on every client that may see the
    // event. It reaches here from an imported file or from a promoted note, so
    // it is filtered on the way in rather than trusted for having been typed.
    description: sanitizeHTML(data.description ?? ""),
    visibility: data.visibility === VISIBILITY.PLAYERS ? VISIBILITY.PLAYERS : VISIBILITY.GM_ONLY,
    partyId: getParty(data.partyId)?.id ?? null,
    color: data.color || DEFAULT_COLOR,
    icon: data.icon || "fa-solid fa-scroll",
    source: {
      type: data.source?.type ?? EVENT_SOURCE.MANUAL,
      noteUuid: data.source?.noteUuid ?? null
    },
    createdBy: game.user.id,
    createdAt: now,
    updatedAt: now
  };
  assertValid(event);

  await writeEvents([...getEvents(), event]);
  log("debug", "Created timeline event", event.id, event.dateKey);
  return event;
}

/**
 * Replace the whole event list. GM only.
 *
 * Used by the calendar import, which restores a self-contained event set;
 * every other caller should go through the single-event helpers.
 */
export async function replaceEvents(events) {
  if (!canManageEvents()) {
    ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    return null;
  }
  for (const event of events) assertValid(event);
  // The whole list is out of an imported file, so every description is filtered
  // before it is stored rather than only on its way to the screen.
  const written = await writeEvents(events.map(event => ({
    ...event,
    description: sanitizeHTML(event.description ?? "")
  })));
  log("debug", `Replaced timeline events with ${written.length} imported records`);
  return written;
}

/** Update an event. GM only. */
export async function updateEvent(eventId, changes) {
  if (!canManageEvents()) {
    ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    return null;
  }
  const events = getEvents();
  const index = events.findIndex(event => event.id === eventId);
  if (index < 0) {
    ui.notifications.warn(t("TTA.Errors.EventMissing"));
    return null;
  }
  const updated = {
    ...events[index],
    ...changes,
    description: changes.description === undefined
      ? events[index].description
      : sanitizeHTML(changes.description),
    source: changes.source ?? events[index].source,
    id: eventId,
    updatedAt: new Date().toISOString()
  };
  assertValid(updated);

  events[index] = updated;
  await writeEvents(events);
  return updated;
}

/** Delete an event. GM only; callers confirm with the user first. */
export async function deleteEvent(eventId) {
  if (!canManageEvents()) {
    ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    return false;
  }
  const events = getEvents();
  const removed = events.find(event => event.id === eventId);
  if (!removed) return false;
  await writeEvents(events.filter(event => event.id !== eventId));

  // The note it was promoted from still says it is on the timeline. Left that
  // way it could never be promoted again, so the link goes with the event. The
  // event is already gone by now, and a note that cannot be reached does not
  // make its deletion a failure.
  const noteUuid = removed.source?.noteUuid;
  if (noteUuid) {
    try {
      await unlinkNoteFromEvent(noteUuid, eventId);
    } catch (error) {
      log("warn", "Could not clear the timeline link on a deleted event's note", error);
    }
  }
  return true;
}

/**
 * Promote a calendar note into a timeline event.
 *
 * The source note is never modified beyond recording the link, and is never
 * deleted. If the note later disappears the event keeps working; the GM-only
 * origin indicator simply reports the source as unavailable.
 *
 * A note a player wrote becomes an event their party sees — every player, when
 * the world has no parties: the table's own record of what happened belongs
 * on that table's timeline, so the GM's choice of visibility and party applies
 * only to promoting their own notes.
 */
export async function promoteNote(noteView, { dateKey, title, description, visibility, partyId, color, icon, shareNote } = {}) {
  if (!canManageEvents()) {
    ui.notifications.warn(t("TTA.Errors.PromoteGMOnly"));
    return null;
  }
  const fromPlayer = isPlayerNote(noteView);
  const event = await createEvent({
    dateKey: dateKey ?? noteView.dateKey,
    title: title ?? noteView.title,
    description: description ?? noteView.content ?? "",
    visibility: fromPlayer ? VISIBILITY.PLAYERS : (visibility ?? VISIBILITY.GM_ONLY),
    partyId: fromPlayer ? partyOfAuthor(noteView) : (partyId ?? null),
    color,
    icon,
    source: { type: EVENT_SOURCE.PROMOTED, noteUuid: noteView.uuid }
  });
  if (!event) return null;

  await linkNoteToEvent(noteView.uuid, event.id);
  if (shareNote === true) await updateNotePage(noteView.uuid, { visibility: VISIBILITY.PLAYERS });
  return event;
}

/**
 * Whether a note is a player's own record, which promotion puts on the
 * players' timeline whatever the GM picks.
 *
 * That rule takes the choice of visibility away from the GM, so it applies
 * only where it is certain. A GM-only note is never one: no player can make a
 * note GM-only, so it is a GM's whoever the author is recorded as, including a
 * GM since demoted. Nor is a note whose author no longer exists, which may as
 * easily have been a GM's. In both cases the GM chooses, and the default they
 * are offered is GM-only.
 */
export function isPlayerNote(noteView) {
  if (!noteView || noteView.isGMNote) return false;
  return noteView.visibility !== VISIBILITY.GM_ONLY && noteView.authorKnown !== false;
}

/** The id of the party a note's author belongs to, or null. */
export function partyOfAuthor(noteView) {
  return partyForUser(getParties(), noteView?.authorId)?.id ?? null;
}

/** How many events belong to a party, in every store this client can read. */
export function countPartyEvents(partyId) {
  if (!partyId) return 0;
  return getEvents().filter(event => event.partyId === partyId).length;
}

/**
 * Move every event of one party to another party, or to shared. GM only.
 *
 * Used when a party is removed, before its store is deleted; the events are
 * still readable from the old store at that point and are rewritten into the
 * place they are going.
 */
export async function reassignPartyEvents(fromPartyId, toPartyId = null) {
  if (!canManageEvents() || !fromPartyId) return 0;
  const events = getEvents();
  const moving = events.filter(event => event.partyId === fromPartyId);
  if (!moving.length) return 0;
  const target = getParty(toPartyId)?.id ?? null;
  await writeEvents(events.map(event => event.partyId === fromPartyId ? { ...event, partyId: target } : event));
  log("info", `Moved ${moving.length} events from party ${fromPartyId} to ${target ?? "shared"}`);
  return moving.length;
}

/** The shared timeline display mode. */
export function getMode() {
  const mode = game.settings.get(MODULE_ID, SETTINGS.TIMELINE_MODE);
  return Object.values(TIMELINE_MODE).includes(mode) ? mode : TIMELINE_MODE.EXPANDED;
}

/** Change the shared display mode. GM only. */
export async function setMode(mode) {
  if (!canSetTimelineMode()) return null;
  if (!Object.values(TIMELINE_MODE).includes(mode)) return null;
  await game.settings.set(MODULE_ID, SETTINGS.TIMELINE_MODE, mode);
  return mode;
}

/** Events dated within a specific year, visible to the user. */
export function getEventsForYear(year, user = game.user) {
  return getVisibleEvents(user).filter(event => parseKey(event.dateKey)?.year === year);
}

/** Events dated within a specific month, visible to the user. */
export function getEventsForMonth(year, month, user = game.user) {
  return getEventsForYear(year, user).filter(event => parseKey(event.dateKey)?.month === month);
}

/** Events dated on a specific day, visible to the user. */
export function getEventsForDay(year, month, day, user = game.user) {
  return getEventsForMonth(year, month, user).filter(event => parseKey(event.dateKey)?.day === day);
}

/** Events falling inside an Age's year range, visible to the user. */
export function getEventsForAge(age, user = game.user) {
  if (!age) return [];
  return getVisibleEvents(user).filter(event => {
    const parsed = parseKey(event.dateKey);
    return parsed && containsYear(age, parsed.year);
  });
}

/**
 * The events listed when an Age is browsed, visible to the user: those inside
 * its range, and those in the uncovered years that are listed with it.
 *
 * `getEventsForAge` on its own left an event dated between two Ages, or before
 * the first, out of every Age's list, so it could not be reached by stepping
 * through them. `ages` is the set being stepped through — the Ages this user
 * can see, so a player's event in a year only a hidden Age covers is listed
 * with a neighbour they can browse.
 */
export function getEventsListedWithAge(age, ages = [], user = game.user) {
  if (!age) return [];
  return getVisibleEvents(user).filter(event => {
    const parsed = parseKey(event.dateKey);
    return parsed && findListingAge(ages, parsed.year)?.id === age.id;
  });
}

/**
 * Per-day event counts for a month, used for the calendar grid indicators.
 * @returns {Record<number, number>}
 */
export function getMonthEventCounts(year, month, user = game.user) {
  const counts = {};
  for (const event of getEventsForMonth(year, month, user)) {
    const day = parseKey(event.dateKey)?.day;
    if (day) counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

/**
 * Group events under their year for the expanded timeline mode.
 * @returns {Array<{year:number, isCurrent:boolean, events:Array}>}
 */
export function groupEventsByYear(events, years, currentYear) {
  const byYear = new Map(years.map(year => [year, []]));
  for (const event of events) {
    const year = parseKey(event.dateKey)?.year;
    if (year === undefined) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(event);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => ({
      year,
      isCurrent: year === currentYear,
      events: list.sort((a, b) => compareDateKeys(a.dateKey, b.dateKey))
    }));
}

/** Years between regular ticks on an Age's spine while the Age is short enough. */
const TICK_INTERVAL = 5;

/** The most regular ticks an Age's spine draws, however long the Age. */
const TICK_BUDGET = 40;

/** About how many of those regular ticks carry their year. */
const LABEL_BUDGET = 10;

/**
 * The smallest round number — 1, 2 or 5 times a power of ten — that divides
 * `span` into at most `budget` parts.
 */
export function roundStep(span, budget) {
  const wanted = Number(span) / Math.max(1, Number(budget));
  if (!Number.isFinite(wanted) || wanted <= 1) return 1;
  for (let scale = 1; ; scale *= 10) {
    for (const base of [1, 2, 5]) {
      if (base * scale >= wanted) return base * scale;
    }
  }
}

/**
 * The ticks along an Age's spine.
 *
 * A tick is drawn for the current year, for each year carrying an event, and
 * otherwise at a regular step, so a long Age stays legible; the number of
 * regular ticks is bounded however long the Age is.
 *
 * Regular ticks stand on multiples of the step, not at the step counted from
 * the Age's first year, and every few of them is labelled. Counted from the
 * first year they fell on 1, 6, 11 for an Age starting in year 1, and the
 * label rule — years divisible by twenty — then matched none of them, which
 * left such a spine without a single year on it.
 *
 * @param {object} span
 * @param {number} span.startYear    the Age's first year
 * @param {number} span.endYear      the Age's last year
 * @param {Iterable<number>} [span.eventYears] years carrying a listed event
 * @param {number|null} [span.currentYear]     the campaign's current year
 * @returns {Array<{year:number, position:string, label:number|string, hasEvent:boolean, isCurrent:boolean}>}
 */
export function buildAgeTicks({ startYear, endYear: lastYear, eventYears = [], currentYear = null }) {
  const start = Number(startYear);
  const last = Number(lastYear);
  if (!Number.isInteger(start) || !Number.isInteger(last) || last < start) return [];
  const span = last - start + 1;
  const inSpan = year => Number.isInteger(year) && year >= start && year <= last;

  const step = Math.max(TICK_INTERVAL, roundStep(span, TICK_BUDGET));
  const labelStep = step * roundStep(span / step, LABEL_BUDGET);

  const withEvent = new Set([...eventYears].filter(inSpan));
  const marked = new Set(withEvent);
  for (let year = Math.ceil(start / step) * step; year <= last; year += step) marked.add(year);
  if (inSpan(currentYear)) marked.add(currentYear);

  return [...marked].sort((a, b) => a - b).map(year => {
    const hasEvent = withEvent.has(year);
    const isCurrent = year === currentYear;
    return {
      year,
      position: (((year - start + 0.5) / span) * 100).toFixed(3),
      label: (isCurrent || hasEvent || year % labelStep === 0) ? year : "",
      hasEvent,
      isCurrent
    };
  });
}

/** Highest month and day numbers referenced by stored events. */
export function getDateUsage() {
  let maxMonth = 0;
  let maxDay = 0;
  let count = 0;
  for (const event of getEvents()) {
    const parsed = parseKey(event.dateKey);
    if (!parsed) continue;
    count += 1;
    maxMonth = Math.max(maxMonth, parsed.month);
    maxDay = Math.max(maxDay, parsed.day);
  }
  return { maxMonth, maxDay, count };
}

/** Events that would fall inside an Age's range, used for change warnings. */
export function countEventsInAgeRange(age) {
  if (!age) return 0;
  return getEvents().filter(event => {
    const parsed = parseKey(event.dateKey);
    return parsed && parsed.year >= Number(age.startYear) && parsed.year <= endYear(age);
  }).length;
}

/** The Age an event belongs to, or null. */
export function getAgeForEvent(event) {
  const parsed = parseKey(event?.dateKey);
  return parsed ? getAgeForYear(parsed.year) : null;
}
