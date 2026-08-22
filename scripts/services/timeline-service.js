/**
 * Timeline events and display modes.
 *
 * Events are small, ordered, world-shared records, so they live in a world
 * setting rather than as documents. Only GMs write them; every client reads a
 * permission-filtered view.
 */

import { log, rerenderModuleApps, sanitizeHTML, t } from "../compat.js";
import {
  DEFAULT_COLOR,
  EVENT_SOURCE,
  MODULE_ID,
  SETTINGS,
  TIMELINE_MODE,
  VISIBILITY
} from "../constants.js";
import { containsYear, endYear } from "./age-service.js";
import { getAgeForYear, getCalendar } from "./calendar-service.js";
import { compareDateKeys, parseKey } from "./date-service.js";
import { linkNoteToEvent, updateNotePage } from "./journal-service.js";
import { migrateEvents } from "./migration-service.js";
import { canManageEvents, canSetTimelineMode, canViewEvent, isGM } from "./permission-service.js";
import { validateEvent } from "./validation-service.js";

/** All stored events, normalised and chronologically ordered. */
export function getEvents() {
  return migrateEvents(game.settings.get(MODULE_ID, SETTINGS.TIMELINE_EVENTS));
}

/** Events the given user is entitled to see. */
export function getVisibleEvents(user = game.user) {
  return getEvents().filter(event => canViewEvent(event, user));
}

/** One event by id, or null. */
export function getEvent(eventId) {
  return getEvents().find(event => event.id === eventId) ?? null;
}

async function writeEvents(events) {
  const normalized = migrateEvents(events);
  await game.settings.set(MODULE_ID, SETTINGS.TIMELINE_EVENTS, normalized);
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
  const remaining = events.filter(event => event.id !== eventId);
  if (remaining.length === events.length) return false;
  await writeEvents(remaining);
  return true;
}

/**
 * Promote a calendar note into a timeline event.
 *
 * The source note is never modified beyond recording the link, and is never
 * deleted. If the note later disappears the event keeps working; the GM-only
 * origin indicator simply reports the source as unavailable.
 */
export async function promoteNote(noteView, { dateKey, title, description, visibility, color, icon, shareNote } = {}) {
  if (!canManageEvents()) {
    ui.notifications.warn(t("TTA.Errors.PromoteGMOnly"));
    return null;
  }
  const event = await createEvent({
    dateKey: dateKey ?? noteView.dateKey,
    title: title ?? noteView.title,
    description: description ?? noteView.content ?? "",
    visibility: visibility ?? VISIBILITY.GM_ONLY,
    color,
    icon,
    source: { type: EVENT_SOURCE.PROMOTED, noteUuid: noteView.uuid }
  });
  if (!event) return null;

  await linkNoteToEvent(noteView.uuid, event.id);
  if (shareNote === true) await updateNotePage(noteView.uuid, { visibility: VISIBILITY.PLAYERS });
  return event;
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

/** Setting change handler: keep open timeline windows current. */
export function onEventsChanged() {
  rerenderModuleApps();
}

/** Whether the current user may act on timeline management controls. */
export function canManage() {
  return isGM();
}
