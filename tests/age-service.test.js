import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS } from "../scripts/constants.js";
import {
  ageLength,
  chronological,
  containsYear,
  endYear,
  findAgeForYear,
  findGaps,
  findOverlaps,
  normalizeAge,
  sortAges,
  visibleAges,
  yearsInAge
} from "../scripts/services/age-service.js";

function age(id, startYear, durationYears, extra = {}) {
  return { id, name: id, startYear, durationYears, sortOrder: 0, playerVisible: true, ...extra };
}

describe("derived values", () => {
  it("derives the end year from start and duration", () => {
    assert.equal(endYear(age("a", 1, 250)), 250);
    assert.equal(endYear(age("b", 251, 1)), 251);
  });

  it("reports year containment inclusively at both ends", () => {
    const a = age("a", 10, 5); // years 10..14
    assert.ok(containsYear(a, 10));
    assert.ok(containsYear(a, 14));
    assert.ok(!containsYear(a, 9));
    assert.ok(!containsYear(a, 15));
  });

  it("lists every year in an Age", () => {
    assert.deepEqual(yearsInAge(age("a", 7, 3)), [7, 8, 9]);
  });
});

describe("ordering", () => {
  it("sorts by explicit sort order, then by start year", () => {
    const ages = [
      age("late", 100, 10, { sortOrder: 1 }),
      age("early", 1, 10, { sortOrder: 0 })
    ];
    assert.deepEqual(sortAges(ages).map(a => a.id), ["early", "late"]);
  });

  it("sorts chronologically regardless of sort order", () => {
    const ages = [
      age("second", 100, 10, { sortOrder: 0 }),
      age("first", 1, 10, { sortOrder: 5 })
    ];
    assert.deepEqual(chronological(ages).map(a => a.id), ["first", "second"]);
  });
});

describe("current Age lookup", () => {
  const ages = [age("ash", 1, 250), age("iron", 251, 100)];

  it("finds the Age containing a year", () => {
    assert.equal(findAgeForYear(ages, 1).id, "ash");
    assert.equal(findAgeForYear(ages, 250).id, "ash");
    assert.equal(findAgeForYear(ages, 251).id, "iron");
  });

  it("returns null when no Age covers the year", () => {
    assert.equal(findAgeForYear(ages, 999), null);
    assert.equal(findAgeForYear([], 1), null);
  });
});

describe("overlap detection", () => {
  it("accepts adjacent Ages", () => {
    assert.deepEqual(findOverlaps([age("a", 1, 10), age("b", 11, 10)]), []);
  });

  it("detects a one-year overlap", () => {
    const conflicts = findOverlaps([age("a", 1, 10), age("b", 10, 10)]);
    assert.equal(conflicts.length, 1);
    assert.deepEqual([conflicts[0].a.id, conflicts[0].b.id], ["a", "b"]);
  });

  it("detects a fully contained Age", () => {
    assert.equal(findOverlaps([age("outer", 1, 100), age("inner", 20, 5)]).length, 1);
  });

  it("finds every conflicting pair", () => {
    assert.equal(findOverlaps([age("a", 1, 100), age("b", 50, 100), age("c", 90, 100)]).length, 3);
  });

  it("reports no overlaps for zero or one Age", () => {
    assert.deepEqual(findOverlaps([]), []);
    assert.deepEqual(findOverlaps([age("a", 1, 10)]), []);
  });
});

describe("gap detection", () => {
  it("finds an uncovered span between Ages", () => {
    assert.deepEqual(findGaps([age("a", 1, 10), age("b", 21, 10)]), [{ from: 11, to: 20 }]);
  });

  it("reports no gap for adjacent Ages", () => {
    assert.deepEqual(findGaps([age("a", 1, 10), age("b", 11, 10)]), []);
  });

  it("ignores the span before the first Age", () => {
    assert.deepEqual(findGaps([age("a", 50, 10)]), []);
  });
});

describe("normalisation and visibility", () => {
  it("fills defaults and clamps invalid numbers", () => {
    const normalized = normalizeAge({ name: "  Age of Ash  ", startYear: -5, durationYears: 0 }, 3);
    assert.equal(normalized.name, "Age of Ash");
    assert.equal(normalized.startYear, 1);
    assert.equal(normalized.durationYears, 1);
    assert.equal(normalized.playerVisible, true);
    assert.equal(normalized.sortOrder, 3);
    assert.ok(normalized.color);
    assert.ok(normalized.id);
  });

  it("preserves an explicit hidden flag", () => {
    assert.equal(normalizeAge({ name: "x", startYear: 1, durationYears: 1, playerVisible: false }).playerVisible, false);
  });

  it("hides GM-only Ages from players but not from GMs", () => {
    const ages = [age("open", 1, 10), age("secret", 11, 10, { playerVisible: false })];
    assert.deepEqual(visibleAges(ages, false).map(a => a.id), ["open"]);
    assert.deepEqual(visibleAges(ages, true).map(a => a.id), ["open", "secret"]);
  });
});

describe("age length", () => {
  it("counts the years an Age covers without building the list", () => {
    assert.equal(ageLength({ startYear: 1, durationYears: 1 }), 1);
    assert.equal(ageLength({ startYear: 100, durationYears: 50 }), 50);
  });

  it("agrees with yearsInAge, which it replaced in the timeline", () => {
    for (const duration of [1, 2, 7, 100]) {
      const age = { startYear: 42, durationYears: duration };
      assert.equal(ageLength(age), yearsInAge(age).length, `duration ${duration}`);
    }
  });
});

describe("age duration bounds", () => {
  // A duration of a few million years used to be stored as given, and the
  // timeline then built one array entry per year on every render.
  it("clamps a duration past the supported maximum", () => {
    const normalized = normalizeAge({ name: "Long", startYear: 1, durationYears: 1e9 });
    assert.equal(normalized.durationYears, LIMITS.AGE_DURATION_MAX);
  });

  it("leaves an ordinary duration untouched", () => {
    assert.equal(normalizeAge({ name: "Ord", startYear: 1, durationYears: 250 }).durationYears, 250);
  });

  it("still raises a duration below the minimum", () => {
    assert.equal(normalizeAge({ name: "Zero", startYear: 1, durationYears: 0 }).durationYears, LIMITS.AGE_DURATION_MIN);
  });

  it("keeps the clamped length small enough to render", () => {
    const normalized = normalizeAge({ name: "Long", startYear: 1, durationYears: Number.MAX_SAFE_INTEGER });
    assert.ok(ageLength(normalized) <= LIMITS.AGE_DURATION_MAX);
  });
});
