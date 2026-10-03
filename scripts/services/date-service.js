/**
 * Pure calendar arithmetic.
 *
 * Nothing in this module touches Foundry globals: every function takes an
 * explicit calendar descriptor
 * `{ monthsPerYear, daysPerMonth, monthLengths, weekdayNames }` so the rules
 * stay deterministic and unit testable.
 *
 * Months may differ in length. `monthLengths` holds the authoritative value
 * for each month and `daysPerMonth` is the uniform fallback used when an entry
 * is missing, which is how calendars written before variable lengths existed
 * keep producing exactly the same dates. Because every calculation below runs
 * off a continuous absolute-day index, short festival months such as Harptos'
 * Midwinter slot in without disturbing weekdays or moon phases.
 */

import { LIMITS, SCOPE } from "../constants.js";

/** Pad a year to the canonical four-digit form used in date keys. */
export function padYear(year) {
  return String(Math.trunc(year)).padStart(4, "0");
}

/** Pad a month or day to the canonical two-digit form used in date keys. */
export function pad2(value) {
  return String(Math.trunc(value)).padStart(2, "0");
}

/** Build the canonical `YYYY-MM-DD` key for a day note. */
export function dayKey(year, month, day) {
  return `${padYear(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Build the canonical `YYYY-MM-00` key for a month note. */
export function monthKey(year, month) {
  return `${padYear(year)}-${pad2(month)}-00`;
}

/** Build the key appropriate for a scope. */
export function keyForScope(date, scope) {
  return scope === SCOPE.MONTH ? monthKey(date.year, date.month) : dayKey(date.year, date.month, date.day);
}

/**
 * Parse a canonical date key.
 * @returns {{year:number, month:number, day:number, scope:string}|null}
 */
export function parseKey(key) {
  if (typeof key !== "string") return null;
  const match = /^(\d{1,6})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return {
    year,
    month,
    day,
    scope: day === 0 ? SCOPE.MONTH : SCOPE.DAY
  };
}

/** Numeric ordering for two canonical date keys. Month keys sort before their days. */
export function compareDateKeys(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return (pa.year - pb.year) || (pa.month - pb.month) || (pa.day - pb.day);
}

/** True when `date` describes an in-range day for the given calendar. */
export function isValidDate(date, calendar) {
  if (!date || !calendar) return false;
  const { year, month, day } = date;
  if (![year, month, day].every(v => Number.isInteger(v))) return false;
  if (year < LIMITS.YEAR_MIN) return false;
  if (month < 1 || month > calendar.monthsPerYear) return false;
  if (day < 1 || day > daysInMonth(month, calendar)) return false;
  return true;
}

/** Clamp a possibly out-of-range date into the configured calendar bounds. */
export function clampDate(date, calendar) {
  const year = Math.max(LIMITS.YEAR_MIN, Math.trunc(Number(date?.year) || LIMITS.YEAR_MIN));
  const month = Math.min(Math.max(1, Math.trunc(Number(date?.month) || 1)), calendar.monthsPerYear);
  const day = Math.min(Math.max(1, Math.trunc(Number(date?.day) || 1)), daysInMonth(month, calendar));
  return { year, month, day };
}

/** True when `time` is an exact minute within a 24-hour day. */
export function isValidTime(time) {
  if (!time) return false;
  const { hour, minute } = time;
  return Number.isInteger(hour) && Number.isInteger(minute)
    && hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

/** Clamp an arbitrary value to a 24-hour, minute-precision clock time. */
export function clampTime(time) {
  const hour = Math.min(Math.max(0, Math.trunc(Number(time?.hour) || 0)), 23);
  const minute = Math.min(Math.max(0, Math.trunc(Number(time?.minute) || 0)), 59);
  return { hour, minute };
}

/** Advance a date and minute-precision time by a whole number of seconds. */
export function addSeconds(date, time, seconds, calendar) {
  const start = (time.hour * 3600) + (time.minute * 60);
  const total = start + Math.trunc(seconds);
  const dayDelta = Math.floor(total / 86400);
  const secondOfDay = ((total % 86400) + 86400) % 86400;
  const targetDate = addDays(date, dayDelta, calendar);

  if (toAbsoluteDay(targetDate, calendar) === 0 && dayDelta < 0) {
    return { date: targetDate, time: { hour: 0, minute: 0 } };
  }

  return {
    date: targetDate,
    time: {
      hour: Math.floor(secondOfDay / 3600),
      minute: Math.floor((secondOfDay % 3600) / 60)
    }
  };
}

/** Seconds until 07:00 on the following calendar day. */
export function secondsUntilNextAdventureDay(time) {
  const current = (time.hour * 3600) + (time.minute * 60);
  return (86400 - current) + (7 * 3600);
}

/**
 * Hold a month length inside the supported range.
 *
 * Stored data is clamped on the way in, but this layer is also reachable from
 * the public API and from a calendar hand-built by another module. An absurd
 * length here would have {@link buildMonthGrid} allocate an absurd grid, so the
 * bound is enforced where the value is read rather than trusted.
 */
function clampMonthLength(days) {
  return Math.min(Math.max(days, LIMITS.DAYS_MIN), LIMITS.DAYS_MAX);
}

/**
 * Length of a single month (1-based) in days.
 * Falls back to the uniform `daysPerMonth` when no explicit length is stored.
 */
export function daysInMonth(month, calendar) {
  const explicit = Array.isArray(calendar?.monthLengths)
    ? Math.trunc(Number(calendar.monthLengths[Math.trunc(Number(month)) - 1]))
    : NaN;
  if (Number.isFinite(explicit) && explicit >= LIMITS.DAYS_MIN) return clampMonthLength(explicit);
  const uniform = Math.trunc(Number(calendar?.daysPerMonth));
  return Number.isFinite(uniform) && uniform >= LIMITS.DAYS_MIN ? clampMonthLength(uniform) : LIMITS.DAYS_MIN;
}

/** The length of every month, in order. */
export function monthLengths(calendar) {
  const count = Math.max(1, Math.trunc(Number(calendar?.monthsPerYear)) || 1);
  return Array.from({ length: count }, (_, index) => daysInMonth(index + 1, calendar));
}

/** Total days in one year of the calendar. */
export function daysInYear(calendar) {
  return monthLengths(calendar).reduce((total, length) => total + length, 0);
}

/** The longest month, used wherever a single upper bound is needed. */
export function maxDaysInMonth(calendar) {
  return Math.max(...monthLengths(calendar));
}

/** Days elapsed in the year before a month (1-based) begins. */
export function monthStartOffset(month, calendar) {
  const lengths = monthLengths(calendar);
  const upto = Math.min(Math.max(Math.trunc(Number(month)) - 1, 0), lengths.length);
  let total = 0;
  for (let i = 0; i < upto; i++) total += lengths[i];
  return total;
}

/**
 * Convert a date to a zero-based absolute day index counted from Year 1, Month 1, Day 1.
 */
export function toAbsoluteDay(date, calendar) {
  return ((date.year - 1) * daysInYear(calendar))
    + monthStartOffset(date.month, calendar)
    + (date.day - 1);
}

/**
 * The campaign clock as a single second count, for delta arithmetic between
 * two moments of the same calendar. Minute precision, like the stored clock.
 */
export function campaignSeconds(date, time, calendar) {
  return (toAbsoluteDay(date, calendar) * 86400)
    + ((time?.hour ?? 0) * 3600)
    + ((time?.minute ?? 0) * 60);
}

/** Inverse of {@link toAbsoluteDay}. Values below zero clamp to the first day. */
export function fromAbsoluteDay(absoluteDay, calendar) {
  const lengths = monthLengths(calendar);
  const perYear = lengths.reduce((total, length) => total + length, 0);
  const abs = Math.max(0, Math.trunc(absoluteDay));
  const year = Math.floor(abs / perYear) + 1;

  let remainder = abs % perYear;
  let month = 1;
  for (const length of lengths) {
    if (remainder < length) break;
    remainder -= length;
    month++;
  }
  return { year, month, day: remainder + 1 };
}

/**
 * Advance (or rewind, with a negative delta) a date by whole days.
 * The result is never earlier than Year 1, Month 1, Day 1.
 */
export function addDays(date, delta, calendar) {
  return fromAbsoluteDay(toAbsoluteDay(date, calendar) + Math.trunc(delta), calendar);
}

/** Advance (or rewind) by whole months, keeping the day number where possible. */
export function addMonths(date, delta, calendar) {
  const { monthsPerYear } = calendar;
  const totalMonths = ((date.year - 1) * monthsPerYear) + (date.month - 1) + Math.trunc(delta);
  const safeMonths = Math.max(0, totalMonths);
  const year = Math.floor(safeMonths / monthsPerYear) + 1;
  const month = (safeMonths % monthsPerYear) + 1;
  const day = Math.min(date.day, daysInMonth(month, calendar));
  return { year, month, day };
}

/** Advance (or rewind) by whole years. */
export function addYears(date, delta, calendar) {
  const year = Math.max(LIMITS.YEAR_MIN, date.year + Math.trunc(delta));
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(date.month, calendar)) };
}

/**
 * Zero-based index into `weekdayNames` for a date.
 *
 * `weekdayOffset` names the weekday that Year 1, Month 1, Day 1 falls on, which
 * is what lets a calendar line its weekdays up with an established setting
 * instead of always starting the week on its first named day.
 */
export function weekdayIndex(date, calendar) {
  const count = calendar.weekdayNames?.length || 1;
  const offset = Math.trunc(Number(calendar.weekdayOffset)) || 0;
  return (((toAbsoluteDay(date, calendar) + offset) % count) + count) % count;
}

/** Display name of the weekday for a date. */
export function weekdayName(date, calendar) {
  return calendar.weekdayNames?.[weekdayIndex(date, calendar)] ?? "";
}

/**
 * A year rendered with the calendar's era affixes, e.g. `1495 DR`.
 * Returns null when the calendar sets neither, leaving the caller free to fall
 * back to its own localised wording.
 */
export function yearWithAffixes(year, calendar) {
  const prefix = String(calendar?.yearPrefix ?? "").trim();
  const suffix = String(calendar?.yearSuffix ?? "").trim();
  if (!prefix && !suffix) return null;
  return [prefix, String(year), suffix].filter(Boolean).join(" ");
}

/** Display name of a month number (1-based). */
export function monthName(month, calendar) {
  return calendar.monthNames?.[month - 1] ?? String(month);
}

/** True when two dates describe the same day. */
export function isSameDay(a, b) {
  return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
}

/** True when two dates fall in the same month of the same year. */
export function isSameMonth(a, b) {
  return !!a && !!b && a.year === b.year && a.month === b.month;
}

/**
 * Build the renderable month grid for a date, honouring the configured
 * weekday count. Leading blanks align day 1 under its weekday column.
 * @returns {{weeks: Array<Array<{day:number|null}>>, leading:number}}
 */
export function buildMonthGrid(year, month, calendar) {
  const weekdayCount = calendar.weekdayNames?.length || 1;
  const leading = weekdayIndex({ year, month, day: 1 }, calendar);
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth(month, calendar); d++) cells.push({ day: d });
  while (cells.length % weekdayCount !== 0) cells.push({ day: null });

  const weeks = [];
  for (let i = 0; i < cells.length; i += weekdayCount) weeks.push(cells.slice(i, i + weekdayCount));
  return { weeks, leading };
}
