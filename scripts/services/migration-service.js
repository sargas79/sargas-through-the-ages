/**
 * Idempotent, pure data migrations.
 *
 * Every migration takes stored data and returns a normalised copy at the
 * current `SCHEMA_VERSION`. Running a migration twice must produce the same
 * result as running it once, so upgrades never duplicate or corrupt content.
 */

import {
  DEFAULT_CALENDAR_DATA,
  DEFAULT_COLOR,
  DEFAULT_MONTH_NAMES,
  DEFAULT_WEEKDAY_NAMES,
  EVENT_SOURCE,
  LIMITS,
  SCHEMA_VERSION,
  VISIBILITY
} from "../constants.js";
import { normalizeAge, sortAges } from "./age-service.js";
import { compareDateKeys, daysInMonth, parseKey } from "./date-service.js";
import { normalizeMoon, sortMoons } from "./moon-service.js";
import { dedupeMembers, findParty, normalizeParty, sortParties } from "./party-service.js";

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Resize a name list to `count`, preserving existing entries and filling any
 * shortfall from the supplied defaults (then from a numbered fallback).
 */
export function resizeNames(names, count, defaults, prefix) {
  const source = Array.isArray(names) ? names : [];
  const result = [];
  for (let i = 0; i < count; i++) {
    const existing = String(source[i] ?? "").trim();
    result.push(existing || defaults[i] || `${prefix} ${i + 1}`);
  }
  return result;
}

/**
 * Resize a per-month length list to `count`, preserving stored values and
 * filling any shortfall with the calendar's uniform default. Calendars written
 * before variable lengths existed have no list at all, so every month falls
 * back to `daysPerMonth` and their dates are unchanged.
 */
export function resizeMonthLengths(lengths, count, uniform) {
  const source = Array.isArray(lengths) ? lengths : [];
  const fallback = clampInt(uniform, LIMITS.DAYS_MIN, LIMITS.DAYS_MAX, DEFAULT_CALENDAR_DATA.calendar.daysPerMonth);
  const result = [];
  for (let i = 0; i < count; i++) result.push(clampInt(source[i], LIMITS.DAYS_MIN, LIMITS.DAYS_MAX, fallback));
  return result;
}

/** Trim a year prefix or suffix to a short, storable label. */
export function normalizeYearAffix(value) {
  return String(value ?? "").trim().slice(0, LIMITS.YEAR_AFFIX_MAX);
}

/**
 * Normalise the stored moon list: drop unusable entries, fill defaults, cap the
 * list at the supported maximum, and re-index the sort order.
 */
export function migrateMoons(moons) {
  const source = Array.isArray(moons) ? moons : [];
  return sortMoons(source.filter(moon => moon && typeof moon === "object").map((moon, i) => normalizeMoon(moon, i)))
    .slice(0, LIMITS.MOONS_MAX)
    .map((moon, i) => ({ ...moon, sortOrder: i }));
}

/** True when stored data is missing or predates the current schema. */
export function needsMigration(data) {
  return !data || Number(data.schemaVersion) !== SCHEMA_VERSION;
}

/**
 * Normalise a stored calendar payload to the current schema.
 * Safe to run against `undefined`, partial, or already-current data.
 */
export function migrateCalendarData(data) {
  const source = data && typeof data === "object" ? data : {};
  const calendar = source.calendar && typeof source.calendar === "object" ? source.calendar : {};
  const defaults = DEFAULT_CALENDAR_DATA.calendar;

  const monthsPerYear = clampInt(calendar.monthsPerYear, LIMITS.MONTHS_MIN, LIMITS.MONTHS_MAX, defaults.monthsPerYear);
  const daysPerMonth = clampInt(calendar.daysPerMonth, LIMITS.DAYS_MIN, LIMITS.DAYS_MAX, defaults.daysPerMonth);

  const weekdayCount = clampInt(
    Array.isArray(calendar.weekdayNames) ? calendar.weekdayNames.length : defaults.weekdayNames.length,
    LIMITS.WEEKDAYS_MIN,
    LIMITS.WEEKDAYS_MAX,
    defaults.weekdayNames.length
  );

  const monthNames = resizeNames(calendar.monthNames, monthsPerYear, DEFAULT_MONTH_NAMES, "Month");
  const monthLengths = resizeMonthLengths(calendar.monthLengths, monthsPerYear, daysPerMonth);
  const weekdayNames = resizeNames(calendar.weekdayNames, weekdayCount, DEFAULT_WEEKDAY_NAMES, "Day");

  const rawDate = calendar.currentDate ?? defaults.currentDate;
  const month = clampInt(rawDate?.month, 1, monthsPerYear, 1);
  const currentDate = {
    year: Math.max(LIMITS.YEAR_MIN, clampInt(rawDate?.year, LIMITS.YEAR_MIN, Number.MAX_SAFE_INTEGER, 1)),
    month,
    day: clampInt(rawDate?.day, 1, daysInMonth(month, { monthLengths, daysPerMonth }), 1)
  };
  const rawTime = calendar.currentTime ?? defaults.currentTime;
  const currentTime = {
    hour: clampInt(rawTime?.hour, 0, 23, 0),
    minute: clampInt(rawTime?.minute, 0, 59, 0)
  };

  const weekdayOffset = clampInt(calendar.weekdayOffset, 0, weekdayCount - 1, 0);

  const moons = migrateMoons(calendar.moons);

  const ages = sortAges((Array.isArray(source.ages) ? source.ages : []).map((age, i) => normalizeAge(age, i)))
    .map((age, i) => ({ ...age, sortOrder: i }));

  const shape = { monthsPerYear, monthLengths, daysPerMonth };
  const parties = migrateParties(source.parties, shape);
  // An active id that names no party is a stale pointer, and a world with no
  // parties has nothing to be active: both read as "no active party".
  const activePartyId = findParty(parties, source.activePartyId)?.id ?? null;

  return {
    schemaVersion: SCHEMA_VERSION,
    calendar: {
      monthsPerYear,
      daysPerMonth,
      monthNames,
      monthLengths,
      weekdayNames,
      weekdayOffset,
      currentDate,
      currentTime,
      yearPrefix: normalizeYearAffix(calendar.yearPrefix),
      yearSuffix: normalizeYearAffix(calendar.yearSuffix),
      moons
    },
    ages,
    parties,
    activePartyId
  };
}

/**
 * Normalise the stored party list: drop unusable entries, clamp each party's
 * date to the calendar it is stored with, keep every user in only one party,
 * and cap the list at the supported maximum.
 *
 * Worlds written before parties existed have no list, so this returns `[]`
 * for them and every party-aware code path takes its "no parties" branch.
 */
export function migrateParties(parties, shape) {
  const source = Array.isArray(parties) ? parties : [];
  const normalized = source
    .filter(party => party && typeof party === "object")
    .map((party, i) => normalizeParty(party, i))
    .map(party => {
      const month = clampInt(party.currentDate.month, 1, shape.monthsPerYear, 1);
      return {
        ...party,
        currentDate: {
          year: party.currentDate.year,
          month,
          day: clampInt(party.currentDate.day, 1, daysInMonth(month, shape), 1)
        }
      };
    });
  return sortParties(dedupeMembers(normalized))
    .slice(0, LIMITS.PARTIES_MAX)
    .map((party, i) => ({ ...party, sortOrder: i }));
}

/**
 * Normalise the stored timeline event list: drop unusable records, fill
 * defaults, and return the events in chronological order.
 */
export function migrateEvents(events) {
  const source = Array.isArray(events) ? events : [];
  return source
    .filter(event => event && parseKey(event.dateKey))
    .map((event, index) => ({
      id: event.id ?? `event-${index}`,
      dateKey: event.dateKey,
      title: String(event.title ?? "").trim() || "Untitled Event",
      description: event.description ?? "",
      visibility: event.visibility === VISIBILITY.PLAYERS ? VISIBILITY.PLAYERS : VISIBILITY.GM_ONLY,
      // Null is "shared": the event belongs to the world, not to one party.
      partyId: typeof event.partyId === "string" && event.partyId ? event.partyId : null,
      color: event.color || DEFAULT_COLOR,
      icon: event.icon || "fa-solid fa-scroll",
      source: {
        type: event.source?.type === EVENT_SOURCE.PROMOTED ? EVENT_SOURCE.PROMOTED : EVENT_SOURCE.MANUAL,
        noteUuid: event.source?.noteUuid ?? null
      },
      createdBy: event.createdBy ?? null,
      createdAt: event.createdAt ?? new Date(0).toISOString(),
      updatedAt: event.updatedAt ?? event.createdAt ?? new Date(0).toISOString()
    }))
    .sort((a, b) => compareDateKeys(a.dateKey, b.dateKey) || a.title.localeCompare(b.title));
}

/** Normalise the flag payload stored on a calendar note page. */
export function migrateNoteFlags(flags) {
  const source = flags && typeof flags === "object" ? flags : {};
  const parsed = parseKey(source.dateKey);
  if (!parsed) return null;
  const visibility = Object.values(VISIBILITY).includes(source.visibility)
    ? source.visibility
    : VISIBILITY.GM_ONLY;
  return {
    dateKey: source.dateKey,
    scope: parsed.scope,
    authorId: source.authorId ?? null,
    authorName: source.authorName ?? "",
    visibility,
    timelineEventId: source.timelineEventId ?? null,
    createdAt: source.createdAt ?? new Date(0).toISOString(),
    updatedAt: source.updatedAt ?? source.createdAt ?? new Date(0).toISOString()
  };
}
