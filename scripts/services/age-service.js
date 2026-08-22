/**
 * Pure Age logic: derived end years, ordering, overlap and gap detection,
 * and lookup of the Age containing a given year.
 *
 * Ages are plain objects:
 * `{ id, name, startYear, durationYears, description, color, playerVisible, sortOrder }`
 */

import { DEFAULT_COLOR, LIMITS } from "../constants.js";

/** Derived last year covered by an Age. */
export function endYear(age) {
  return Number(age.startYear) + Number(age.durationYears) - 1;
}

/**
 * How many years an Age covers.
 *
 * The same answer as `yearsInAge(age).length`, without building the list to
 * count it. Everything that only needs the count uses this: the timeline asks
 * for it once per Age on every render, and a long Age made that a per-year
 * allocation for a number that is a subtraction.
 */
export function ageLength(age) {
  return Math.max(0, endYear(age) - Number(age.startYear) + 1);
}

/** True when a year falls inside an Age's range. */
export function containsYear(age, year) {
  return year >= Number(age.startYear) && year <= endYear(age);
}

/** Ages ordered by explicit sort order, then chronologically. */
export function sortAges(ages = []) {
  return [...ages].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    return (orderA - orderB) || (Number(a.startYear) - Number(b.startYear));
  });
}

/** Ages ordered strictly by start year, used for range analysis. */
export function chronological(ages = []) {
  return [...ages].sort((a, b) => Number(a.startYear) - Number(b.startYear));
}

/** The Age containing `year`, or null when the year is not covered. */
export function findAgeForYear(ages = [], year) {
  return chronological(ages).find(age => containsYear(age, year)) ?? null;
}

/**
 * Detect Ages whose year ranges intersect.
 * @returns {Array<{a:object, b:object}>} conflicting pairs
 */
export function findOverlaps(ages = []) {
  const ordered = chronological(ages);
  const conflicts = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      if (Number(b.startYear) > endYear(a)) break;
      if (Number(a.startYear) <= endYear(b) && Number(b.startYear) <= endYear(a)) {
        conflicts.push({ a, b });
      }
    }
  }
  return conflicts;
}

/**
 * Detect uncovered year ranges between consecutive Ages.
 * @returns {Array<{from:number, to:number}>}
 */
export function findGaps(ages = []) {
  const ordered = chronological(ages);
  const gaps = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const currentEnd = endYear(ordered[i]);
    const nextStart = Number(ordered[i + 1].startYear);
    if (nextStart > currentEnd + 1) gaps.push({ from: currentEnd + 1, to: nextStart - 1 });
  }
  return gaps;
}

/** Every year number covered by an Age, used by the expanded timeline mode. */
export function yearsInAge(age) {
  const start = Number(age.startYear);
  const years = [];
  for (let y = start; y <= endYear(age); y++) years.push(y);
  return years;
}

/** Normalise an Age record, filling in derived and defaulted fields. */
export function normalizeAge(age, index = 0) {
  const startYear = Math.max(LIMITS.YEAR_MIN, Math.trunc(Number(age?.startYear) || LIMITS.YEAR_MIN));
  const durationYears = Math.min(
    LIMITS.AGE_DURATION_MAX,
    Math.max(LIMITS.AGE_DURATION_MIN, Math.trunc(Number(age?.durationYears) || LIMITS.AGE_DURATION_MIN))
  );
  return {
    id: age?.id ?? `age-${index}`,
    name: String(age?.name ?? "").trim(),
    startYear,
    durationYears,
    description: age?.description ?? "",
    color: age?.color || DEFAULT_COLOR,
    playerVisible: age?.playerVisible !== false,
    sortOrder: Number.isFinite(Number(age?.sortOrder)) ? Number(age.sortOrder) : index
  };
}

/** Ages a given user may see. GMs see everything. */
export function visibleAges(ages = [], isGM = false) {
  return sortAges(ages).filter(age => isGM || age.playerVisible !== false);
}
