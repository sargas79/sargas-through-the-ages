import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS } from "../scripts/constants.js";
import {
  structuralChangeWarnings,
  validateAges,
  validateCalendarData,
  validateEvent,
  validateMoons,
  validateNote
} from "../scripts/services/validation-service.js";

const CALENDAR = { monthsPerYear: 10, daysPerMonth: 36 };

function validData(overrides = {}) {
  return {
    schemaVersion: 1,
    calendar: {
      monthsPerYear: 3,
      daysPerMonth: 10,
      monthNames: ["One", "Two", "Three"],
      weekdayNames: ["A", "B"],
      currentDate: { year: 1, month: 1, day: 1 },
      ...overrides.calendar
    },
    ages: overrides.ages ?? []
  };
}

function codes(result) {
  return result.errors.map(error => error.code);
}

describe("calendar configuration", () => {
  it("accepts a well-formed calendar", () => {
    const result = validateCalendarData(validData());
    assert.ok(result.valid, JSON.stringify(result.errors));
  });

  it("rejects out-of-range month and day counts", () => {
    assert.ok(codes(validateCalendarData(validData({ calendar: { monthsPerYear: 0 } }))).includes("monthsRange"));
    assert.ok(codes(validateCalendarData(validData({ calendar: { monthsPerYear: 99 } }))).includes("monthsRange"));
    assert.ok(codes(validateCalendarData(validData({ calendar: { daysPerMonth: 0 } }))).includes("daysRange"));
    assert.ok(codes(validateCalendarData(validData({ calendar: { daysPerMonth: 500 } }))).includes("daysRange"));
  });

  it("requires one name per month", () => {
    const data = validData();
    data.calendar.monthNames = ["One", "Two"];
    assert.ok(codes(validateCalendarData(data)).includes("monthNameCount"));
  });

  it("rejects blank and duplicate names", () => {
    const blank = validData();
    blank.calendar.monthNames = ["One", "  ", "Three"];
    assert.ok(codes(validateCalendarData(blank)).includes("monthNameEmpty"));

    const duped = validData();
    duped.calendar.weekdayNames = ["A", "a"];
    assert.ok(codes(validateCalendarData(duped)).includes("weekdayNameDuplicate"));
  });

  it("rejects a weekday count outside the supported range", () => {
    const data = validData();
    data.calendar.weekdayNames = Array.from({ length: 20 }, (_, i) => `W${i}`);
    assert.ok(codes(validateCalendarData(data)).includes("weekdayRange"));
  });

  it("rejects a current date that does not fit the structure", () => {
    const data = validData();
    data.calendar.currentDate = { year: 1, month: 4, day: 1 };
    assert.ok(codes(validateCalendarData(data)).includes("currentDateOutOfRange"));
  });

  it("rejects a year below one", () => {
    const data = validData();
    data.calendar.currentDate = { year: 0, month: 1, day: 1 };
    assert.ok(codes(validateCalendarData(data)).includes("yearMinimum"));
  });
});

describe("Age validation", () => {
  it("blocks overlapping Ages", () => {
    const result = validateAges([
      { name: "Ash", startYear: 1, durationYears: 100 },
      { name: "Iron", startYear: 50, durationYears: 100 }
    ]);
    assert.ok(!result.valid);
    assert.ok(codes(result).includes("ageOverlap"));
  });

  it("warns but does not fail on a gap", () => {
    const result = validateAges([
      { name: "Ash", startYear: 1, durationYears: 10 },
      { name: "Iron", startYear: 30, durationYears: 10 }
    ]);
    assert.ok(result.valid);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, "ageGap");
  });

  it("requires names, start years and durations", () => {
    const result = validateAges([{ name: "", startYear: 0, durationYears: 0 }]);
    const found = codes(result);
    assert.ok(found.includes("ageNameEmpty"));
    assert.ok(found.includes("ageStartYear"));
    assert.ok(found.includes("ageDuration"));
  });

  it("rejects duplicate Age names", () => {
    const result = validateAges([
      { name: "Ash", startYear: 1, durationYears: 10 },
      { name: "ash", startYear: 11, durationYears: 10 }
    ]);
    assert.ok(codes(result).includes("ageNameDuplicate"));
  });
});

describe("structural change warnings", () => {
  const usage = { maxMonth: 9, maxDay: 30, count: 12 };

  it("stays silent when nothing is stored", () => {
    assert.deepEqual(structuralChangeWarnings({ monthsPerYear: 1, daysPerMonth: 1 }, { maxMonth: 0, maxDay: 0, count: 0 }), []);
  });

  it("warns when the calendar shrinks below stored content", () => {
    const warnings = structuralChangeWarnings({ monthsPerYear: 5, daysPerMonth: 20, weekdayNames: ["A"] }, usage);
    const found = warnings.map(w => w.code);
    assert.ok(found.includes("shrinkMonths"));
    assert.ok(found.includes("shrinkDays"));
  });

  it("stays silent when the calendar grows", () => {
    const warnings = structuralChangeWarnings({ monthsPerYear: 12, daysPerMonth: 40, weekdayNames: ["A"] }, usage, { weekdayNames: ["A"] });
    assert.deepEqual(warnings.map(w => w.code), []);
  });

  it("warns when the weekday count changes", () => {
    const warnings = structuralChangeWarnings(
      { monthsPerYear: 12, daysPerMonth: 40, weekdayNames: ["A", "B"] },
      usage,
      { weekdayNames: ["A"] }
    );
    assert.ok(warnings.map(w => w.code).includes("weekdayCountChanged"));
  });
});

describe("note validation", () => {
  it("accepts a well-formed day note", () => {
    const result = validateNote({
      title: "Caravan arrives",
      scope: "day",
      visibility: "author-and-gm",
      dateKey: "0004-02-11"
    }, CALENDAR);
    assert.ok(result.valid, JSON.stringify(result.errors));
  });

  it("rejects a missing title and unknown visibility", () => {
    const found = codes(validateNote({ title: "  ", scope: "day", visibility: "nope", dateKey: "0004-02-11" }, CALENDAR));
    assert.ok(found.includes("noteTitleEmpty"));
    assert.ok(found.includes("noteVisibilityInvalid"));
  });

  it("rejects a key whose scope does not match", () => {
    const found = codes(validateNote({ title: "x", scope: "day", visibility: "gm-only", dateKey: "0004-02-00" }, CALENDAR));
    assert.ok(found.includes("dateKeyScopeMismatch"));
  });

  it("rejects a date outside the configured calendar", () => {
    const found = codes(validateNote({ title: "x", scope: "day", visibility: "gm-only", dateKey: "0004-11-01" }, CALENDAR));
    assert.ok(found.includes("dateKeyOutOfRange"));
  });

  it("accepts a month note using the day placeholder", () => {
    const result = validateNote({ title: "x", scope: "month", visibility: "gm-only", dateKey: "0004-02-00" }, CALENDAR);
    assert.ok(result.valid, JSON.stringify(result.errors));
  });
});

describe("event validation", () => {
  it("accepts a well-formed event", () => {
    const result = validateEvent({ title: "Treaty", visibility: "players", dateKey: "0004-02-11" }, CALENDAR);
    assert.ok(result.valid, JSON.stringify(result.errors));
  });

  it("requires an exact day, not a month", () => {
    assert.ok(codes(validateEvent({ title: "x", visibility: "players", dateKey: "0004-02-00" }, CALENDAR)).includes("eventDateInvalid"));
  });

  it("rejects author-and-gm visibility for events", () => {
    assert.ok(codes(validateEvent({ title: "x", visibility: "author-and-gm", dateKey: "0004-02-11" }, CALENDAR)).includes("eventVisibilityInvalid"));
  });

  it("rejects a date outside the calendar", () => {
    assert.ok(codes(validateEvent({ title: "x", visibility: "players", dateKey: "0004-02-99" }, CALENDAR)).includes("eventDateOutOfRange"));
  });
});

function moonRecord(overrides = {}) {
  return { id: "m1", name: "Selene", cycleLength: 28, offset: 0, phaseCount: 8, ...overrides };
}

describe("validateMoons", () => {
  it("accepts an empty list, which is the default", () => {
    const result = validateMoons([]);
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it("accepts a well-formed moon", () => {
    assert.ok(validateMoons([moonRecord()]).valid);
  });

  it("rejects a non-array list", () => {
    assert.deepEqual(codes(validateMoons("nope")), ["moonListInvalid"]);
  });

  it("rejects more moons than the limit allows", () => {
    const many = Array.from({ length: LIMITS.MOONS_MAX + 1 }, (_, i) => moonRecord({ id: `m${i}`, name: `Moon ${i}` }));
    assert.ok(codes(validateMoons(many)).includes("moonCount"));
  });

  it("requires a name", () => {
    assert.ok(codes(validateMoons([moonRecord({ name: "  " })])).includes("moonNameEmpty"));
  });

  it("requires unique names", () => {
    const moons = [moonRecord(), moonRecord({ id: "m2" })];
    assert.ok(codes(validateMoons(moons)).includes("moonNameDuplicate"));
  });

  it("bounds the cycle length", () => {
    assert.ok(codes(validateMoons([moonRecord({ cycleLength: 1 })])).includes("moonCycleRange"));
    assert.ok(codes(validateMoons([moonRecord({ cycleLength: 10000 })])).includes("moonCycleRange"));
    // Fractional cycles are legal: real moons rarely run a whole number of days.
    assert.ok(validateMoons([moonRecord({ cycleLength: 29.53 })]).valid);
  });

  it("bounds the offset by the cycle length", () => {
    assert.ok(codes(validateMoons([moonRecord({ offset: 28 })])).includes("moonOffsetRange"));
    assert.ok(codes(validateMoons([moonRecord({ offset: -1 })])).includes("moonOffsetRange"));
    assert.ok(validateMoons([moonRecord({ offset: 27 })]).valid);
  });

  it("restricts the phase count to the supported values", () => {
    assert.ok(codes(validateMoons([moonRecord({ phaseCount: 5 })])).includes("moonPhaseCount"));
    assert.ok(validateMoons([moonRecord({ phaseCount: 2 })]).valid);
  });

  it("warns when a cycle divides the month exactly", () => {
    const result = validateMoons([moonRecord({ cycleLength: 10 })], { daysPerMonth: 30 });
    assert.ok(result.valid);
    assert.ok(result.warnings.some(warning => warning.code === "moonCycleLocked"));
  });
});

describe("validateCalendarData with moons", () => {
  it("passes moon errors through", () => {
    const data = validData();
    data.calendar.moons = [moonRecord({ name: "" })];
    assert.ok(codes(validateCalendarData(data)).includes("moonNameEmpty"));
  });

  it("stays valid when no moons are configured", () => {
    assert.ok(validateCalendarData(validData()).valid);
  });
});

describe("month lengths", () => {
  function withLengths(calendar) {
    return validateCalendarData(validData({ calendar }));
  }

  it("accepts a calendar described by daysPerMonth alone", () => {
    // Uniform calendars need no explicit list, which is how pre-4 data reads.
    assert.ok(validateCalendarData(validData()).valid);
  });

  it("accepts one length per month", () => {
    assert.ok(withLengths({ monthLengths: [10, 1, 10] }).valid);
  });

  it("rejects a list that does not match the month count", () => {
    assert.ok(codes(withLengths({ monthLengths: [10, 1] })).includes("monthLengthCount"));
  });

  it("rejects an empty list, which describes no months at all", () => {
    assert.ok(codes(withLengths({ monthLengths: [] })).includes("monthLengthCount"));
  });

  it("rejects a list that is not a list", () => {
    assert.ok(codes(withLengths({ monthLengths: 30 })).includes("monthLengthCount"));
  });

  it("rejects lengths outside the supported range", () => {
    assert.ok(codes(withLengths({ monthLengths: [10, 0, 10] })).includes("monthLengthRange"));
    assert.ok(codes(withLengths({ monthLengths: [10, 1, 500] })).includes("monthLengthRange"));
  });

  it("judges the current date against its own month", () => {
    const result = withLengths({
      monthLengths: [10, 1, 10],
      currentDate: { year: 1, month: 2, day: 5 }
    });
    assert.ok(codes(result).includes("currentDateOutOfRange"));
  });
});

describe("weekday offset", () => {
  it("accepts an offset inside the weekday count", () => {
    assert.ok(validateCalendarData(validData({ calendar: { weekdayOffset: 1 } })).valid);
  });

  it("rejects an offset past the last weekday", () => {
    const result = validateCalendarData(validData({ calendar: { weekdayOffset: 2 } }));
    assert.ok(codes(result).includes("weekdayOffsetRange"));
  });
});

describe("moons at the raised limit", () => {
  function moons(count) {
    return Array.from({ length: count }, (_, i) => moonRecord({ id: `m${i}`, name: `Moon ${i}` }));
  }

  it("accepts a full set of twelve", () => {
    assert.equal(LIMITS.MOONS_MAX, 12);
    assert.ok(validateMoons(moons(12)).valid);
  });

  it("still rejects one moon too many", () => {
    assert.ok(codes(validateMoons(moons(13))).includes("moonCount"));
  });

  it("names every month-locked moon in a single warning", () => {
    const calendar = { monthsPerYear: 2, daysPerMonth: 28, monthLengths: [28, 28] };
    const result = validateMoons(moons(3), calendar);
    const locked = result.warnings.filter(warning => warning.code === "moonCycleLocked");
    assert.equal(locked.length, 1);
    assert.equal(locked[0].data.names, "Moon 0, Moon 1, Moon 2");
  });

  it("does not call a moon locked when it drifts against a festival month", () => {
    const calendar = { monthsPerYear: 2, daysPerMonth: 28, monthLengths: [28, 5] };
    const locked = validateMoons(moons(1), calendar).warnings
      .filter(warning => warning.code === "moonCycleLocked");
    assert.equal(locked.length, 0);
  });
});

describe("note bounds", () => {
  const calendar = { monthsPerYear: 12, daysPerMonth: 30, monthLengths: Array(12).fill(30) };
  const note = extra => ({
    dateKey: "0001-01-01",
    scope: "day",
    title: "A note",
    visibility: "author-and-gm",
    ...extra
  });

  it("accepts a note inside the limits", () => {
    assert.equal(validateNote(note(), calendar).valid, true);
  });

  // A relayed write carries whatever the requesting client sent, so these are
  // the only bounds standing between one player and the world database.
  it("rejects a title past the limit", () => {
    const result = validateNote(note({ title: "x".repeat(LIMITS.NOTE_TITLE_MAX + 1) }), calendar);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === "noteTitleLength"));
  });

  it("accepts a title exactly at the limit", () => {
    assert.equal(validateNote(note({ title: "x".repeat(LIMITS.NOTE_TITLE_MAX) }), calendar).valid, true);
  });

  it("rejects a body past the limit", () => {
    const result = validateNote(note({ content: "x".repeat(LIMITS.NOTE_CONTENT_MAX + 1) }), calendar);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === "noteContentLength"));
  });

  it("still treats a missing body as valid, since most notes have none", () => {
    assert.equal(validateNote(note({ content: undefined }), calendar).valid, true);
  });
});

describe("age duration bounds", () => {
  it("rejects a duration past the supported maximum", () => {
    const result = validateAges([{ name: "Long", startYear: 1, durationYears: LIMITS.AGE_DURATION_MAX + 1 }]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === "ageDuration"));
  });

  it("accepts a duration exactly at the maximum", () => {
    const result = validateAges([{ name: "Long", startYear: 1, durationYears: LIMITS.AGE_DURATION_MAX }]);
    assert.equal(result.valid, true);
  });
});
