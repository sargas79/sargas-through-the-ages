/**
 * Pure validation for calendar configuration, Ages and timeline events.
 *
 * Results are returned as localisation codes plus interpolation data so the
 * rules stay testable outside Foundry while the UI still renders localised text.
 * Codes resolve to `TTA.Validation.<code>` keys in `lang/en.json`.
 */

import { LIMITS, MOON_PHASE_COUNTS, SCOPE, VISIBILITY } from "../constants.js";
import { endYear, findGaps, findOverlaps } from "./age-service.js";
import { daysInMonth, isValidDate, maxDaysInMonth, monthLengths, parseKey } from "./date-service.js";

function issue(code, data = {}) {
  return { code, data };
}

function isIntegerInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

function isNumberInRange(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

function duplicates(list) {
  const seen = new Set();
  const dupes = new Set();
  for (const raw of list) {
    const key = String(raw ?? "").trim().toLowerCase();
    if (seen.has(key)) dupes.add(String(raw).trim());
    seen.add(key);
  }
  return [...dupes];
}

/**
 * Validate a full calendar payload.
 * @returns {{valid:boolean, errors:Array, warnings:Array}}
 */
export function validateCalendarData(data) {
  const errors = [];
  const warnings = [];
  const calendar = data?.calendar ?? {};

  if (!isIntegerInRange(calendar.monthsPerYear, LIMITS.MONTHS_MIN, LIMITS.MONTHS_MAX)) {
    errors.push(issue("monthsRange", { min: LIMITS.MONTHS_MIN, max: LIMITS.MONTHS_MAX }));
  }
  if (!isIntegerInRange(calendar.daysPerMonth, LIMITS.DAYS_MIN, LIMITS.DAYS_MAX)) {
    errors.push(issue("daysRange", { min: LIMITS.DAYS_MIN, max: LIMITS.DAYS_MAX }));
  }

  // A calendar may describe itself with `daysPerMonth` alone, which is how data
  // written before variable lengths reads. Once a list is given at all it has to
  // be complete: an empty one is no more a description of twelve months than a
  // short one is.
  const lengths = Array.isArray(calendar.monthLengths) ? calendar.monthLengths : [];
  if (calendar.monthLengths !== undefined && lengths.length !== Number(calendar.monthsPerYear)) {
    errors.push(issue("monthLengthCount", { expected: calendar.monthsPerYear, actual: lengths.length }));
  }
  const badLengths = lengths
    .map((length, index) => ({ length, name: calendar.monthNames?.[index] ?? index + 1 }))
    .filter(entry => !isIntegerInRange(entry.length, LIMITS.DAYS_MIN, LIMITS.DAYS_MAX));
  if (badLengths.length) {
    errors.push(issue("monthLengthRange", {
      names: badLengths.map(entry => entry.name).join(", "),
      min: LIMITS.DAYS_MIN,
      max: LIMITS.DAYS_MAX
    }));
  }

  const monthNames = Array.isArray(calendar.monthNames) ? calendar.monthNames : [];
  const weekdayNames = Array.isArray(calendar.weekdayNames) ? calendar.weekdayNames : [];

  if (!isIntegerInRange(weekdayNames.length, LIMITS.WEEKDAYS_MIN, LIMITS.WEEKDAYS_MAX)) {
    errors.push(issue("weekdayRange", { min: LIMITS.WEEKDAYS_MIN, max: LIMITS.WEEKDAYS_MAX }));
  }
  if (monthNames.length !== Number(calendar.monthsPerYear)) {
    errors.push(issue("monthNameCount", { expected: calendar.monthsPerYear, actual: monthNames.length }));
  }
  if (monthNames.some(name => !String(name ?? "").trim())) errors.push(issue("monthNameEmpty"));
  if (weekdayNames.some(name => !String(name ?? "").trim())) errors.push(issue("weekdayNameEmpty"));

  if (calendar.weekdayOffset !== undefined
    && !isIntegerInRange(calendar.weekdayOffset, 0, Math.max(weekdayNames.length - 1, 0))) {
    errors.push(issue("weekdayOffsetRange", { max: Math.max(weekdayNames.length - 1, 0) }));
  }

  const dupeMonths = duplicates(monthNames);
  if (dupeMonths.length) errors.push(issue("monthNameDuplicate", { names: dupeMonths.join(", ") }));
  const dupeWeekdays = duplicates(weekdayNames);
  if (dupeWeekdays.length) errors.push(issue("weekdayNameDuplicate", { names: dupeWeekdays.join(", ") }));

  const date = calendar.currentDate;
  if (!Number.isInteger(Number(date?.year)) || Number(date?.year) < LIMITS.YEAR_MIN) {
    errors.push(issue("yearMinimum", { min: LIMITS.YEAR_MIN }));
  } else {
    const probe = { year: Number(date.year), month: Number(date.month), day: Number(date.day) };
    const shape = {
      monthsPerYear: Number(calendar.monthsPerYear),
      daysPerMonth: Number(calendar.daysPerMonth),
      monthLengths: lengths
    };
    if (!isValidDate(probe, shape)) {
      errors.push(issue("currentDateOutOfRange", {
        months: calendar.monthsPerYear,
        days: daysInMonth(probe.month, shape)
      }));
    }
  }

  const moonResult = validateMoons(calendar.moons ?? [], calendar);
  errors.push(...moonResult.errors);
  warnings.push(...moonResult.warnings);

  const ageResult = validateAges(data?.ages ?? []);
  errors.push(...ageResult.errors);
  warnings.push(...ageResult.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * True when a moon's cycle divides every month exactly, so it always shows the
 * same phase on the same day of a month. Legal, and canon for settings such as
 * Eberron, but rarely what a GM building a calendar by hand intends.
 */
function isLockedToMonths(moon, calendar) {
  const cycle = Number(moon?.cycleLength);
  if (!Number.isInteger(cycle) || cycle <= 0) return false;
  const lengths = monthLengths(calendar);
  return lengths.length > 0 && lengths.every(length => length > 0 && length % cycle === 0);
}

/**
 * Validate a moon list: count, names, cycle bounds, offsets and phase counts.
 *
 * `calendar` is optional and only used to warn about cycles that never drift
 * against the month length, which is legal but rarely what a GM intends.
 * @returns {{valid:boolean, errors:Array, warnings:Array}}
 */
export function validateMoons(moons = [], calendar = null) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(moons)) {
    errors.push(issue("moonListInvalid"));
    return { valid: false, errors, warnings };
  }

  if (moons.length > LIMITS.MOONS_MAX) {
    errors.push(issue("moonCount", { max: LIMITS.MOONS_MAX, actual: moons.length }));
  }

  const locked = [];
  for (const moon of moons) {
    const name = String(moon?.name ?? "").trim();
    if (!name) errors.push(issue("moonNameEmpty"));

    if (!isNumberInRange(moon?.cycleLength, LIMITS.MOON_CYCLE_MIN, LIMITS.MOON_CYCLE_MAX)) {
      errors.push(issue("moonCycleRange", {
        name,
        min: LIMITS.MOON_CYCLE_MIN,
        max: LIMITS.MOON_CYCLE_MAX
      }));
    } else if (!isIntegerInRange(moon?.offset, 0, Math.ceil(Number(moon.cycleLength)) - 1)) {
      errors.push(issue("moonOffsetRange", { name, max: Math.ceil(Number(moon.cycleLength)) - 1 }));
    }

    if (!MOON_PHASE_COUNTS.includes(Number(moon?.phaseCount))) {
      errors.push(issue("moonPhaseCount", { name, counts: MOON_PHASE_COUNTS.join(", ") }));
    }

    if (calendar && isLockedToMonths(moon, calendar)) locked.push(name);
  }

  // One aggregated warning rather than one per moon: a setting where every moon
  // is month-locked is a deliberate design, not a dozen separate mistakes.
  if (locked.length) warnings.push(issue("moonCycleLocked", { names: locked.join(", ") }));

  const dupeNames = duplicates(moons.map(moon => moon?.name).filter(name => String(name ?? "").trim()));
  if (dupeNames.length) errors.push(issue("moonNameDuplicate", { names: dupeNames.join(", ") }));

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate an Age list: bounds, names, overlaps, and gap warnings.
 * @returns {{valid:boolean, errors:Array, warnings:Array}}
 */
export function validateAges(ages = []) {
  const errors = [];
  const warnings = [];

  for (const age of ages) {
    if (!String(age?.name ?? "").trim()) errors.push(issue("ageNameEmpty"));
    if (!Number.isInteger(Number(age?.startYear)) || Number(age.startYear) < LIMITS.YEAR_MIN) {
      errors.push(issue("ageStartYear", { name: age?.name ?? "", min: LIMITS.YEAR_MIN }));
    }
    if (!Number.isInteger(Number(age?.durationYears))
      || Number(age.durationYears) < LIMITS.AGE_DURATION_MIN
      || Number(age.durationYears) > LIMITS.AGE_DURATION_MAX) {
      errors.push(issue("ageDuration", {
        name: age?.name ?? "",
        min: LIMITS.AGE_DURATION_MIN,
        max: LIMITS.AGE_DURATION_MAX
      }));
    }
  }

  const dupeNames = duplicates(ages.map(a => a?.name));
  if (dupeNames.length) errors.push(issue("ageNameDuplicate", { names: dupeNames.join(", ") }));

  for (const { a, b } of findOverlaps(ages)) {
    errors.push(issue("ageOverlap", {
      a: a.name, b: b.name,
      aRange: `${a.startYear}-${endYear(a)}`,
      bRange: `${b.startYear}-${endYear(b)}`
    }));
  }

  for (const gap of findGaps(ages)) {
    warnings.push(issue("ageGap", { from: gap.from, to: gap.to }));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Compare a proposed calendar against the highest month/day numbers already in
 * use by stored notes and events, producing structural-change warnings.
 *
 * @param {object} proposed        proposed `calendar` block
 * @param {{maxMonth:number, maxDay:number, count:number}} usage
 * @param {object} [previous]      the currently stored `calendar` block
 */
export function structuralChangeWarnings(proposed, usage, previous = null) {
  const warnings = [];
  if (!usage || !usage.count) return warnings;

  if (Number(proposed.monthsPerYear) < Number(usage.maxMonth)) {
    warnings.push(issue("shrinkMonths", { months: proposed.monthsPerYear, used: usage.maxMonth, count: usage.count }));
  }
  const longestMonth = maxDaysInMonth(proposed);
  if (longestMonth < Number(usage.maxDay)) {
    warnings.push(issue("shrinkDays", { days: longestMonth, used: usage.maxDay, count: usage.count }));
  }
  const previousWeekdays = previous?.weekdayNames?.length;
  if (previousWeekdays && previousWeekdays !== proposed.weekdayNames?.length) {
    warnings.push(issue("weekdayCountChanged", { from: previousWeekdays, to: proposed.weekdayNames.length }));
  }
  return warnings;
}

/** Validate a note payload before it is written to a journal page. */
export function validateNote(note, calendar) {
  const errors = [];
  const title = String(note?.title ?? "").trim();
  if (!title) errors.push(issue("noteTitleEmpty"));
  // Bounds, not taste: a relayed write carries whatever the requesting client
  // sent, so this is the only place that stops one note filling the database.
  if (title.length > LIMITS.NOTE_TITLE_MAX) {
    errors.push(issue("noteTitleLength", { max: LIMITS.NOTE_TITLE_MAX, actual: title.length }));
  }
  if (String(note?.content ?? "").length > LIMITS.NOTE_CONTENT_MAX) {
    errors.push(issue("noteContentLength", { max: LIMITS.NOTE_CONTENT_MAX }));
  }
  if (![SCOPE.DAY, SCOPE.MONTH].includes(note?.scope)) errors.push(issue("noteScopeInvalid"));
  if (!Object.values(VISIBILITY).includes(note?.visibility)) errors.push(issue("noteVisibilityInvalid"));

  const parsed = parseKey(note?.dateKey);
  if (!parsed) {
    errors.push(issue("dateKeyInvalid", { key: note?.dateKey ?? "" }));
  } else if (parsed.scope !== note?.scope) {
    errors.push(issue("dateKeyScopeMismatch", { key: note.dateKey, scope: note.scope }));
  } else if (calendar) {
    const probe = { year: parsed.year, month: parsed.month, day: parsed.scope === SCOPE.MONTH ? 1 : parsed.day };
    if (!isValidDate(probe, calendar)) errors.push(issue("dateKeyOutOfRange", { key: note.dateKey }));
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

/** Validate a timeline event payload. */
export function validateEvent(event, calendar) {
  const errors = [];
  if (!String(event?.title ?? "").trim()) errors.push(issue("eventTitleEmpty"));
  if (![VISIBILITY.GM_ONLY, VISIBILITY.PLAYERS].includes(event?.visibility)) {
    errors.push(issue("eventVisibilityInvalid"));
  }

  const parsed = parseKey(event?.dateKey);
  if (!parsed || parsed.scope !== SCOPE.DAY) {
    errors.push(issue("eventDateInvalid", { key: event?.dateKey ?? "" }));
  } else if (calendar && !isValidDate(parsed, calendar)) {
    errors.push(issue("eventDateOutOfRange", { key: event.dateKey }));
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}
