import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS, SCHEMA_VERSION } from "../scripts/constants.js";
import { CALENDAR_PRESETS } from "../scripts/data/presets/index.js";
import { daysInYear, isValidDate, parseKey, toAbsoluteDay, weekdayName } from "../scripts/services/date-service.js";
import { illumination, phaseKey } from "../scripts/services/moon-service.js";
import {
  PRESET_IDS,
  buildPresetData,
  buildPresetHolidays,
  getPreset,
  presetHolidayCount,
  presetKeys
} from "../scripts/services/preset-service.js";
import { validateCalendarData } from "../scripts/services/validation-service.js";

/** The phase a named moon shows on a date, in a built preset. */
function phaseOn(id, moonName, date) {
  const calendar = buildPresetData(id).calendar;
  const moon = calendar.moons.find(m => m.name === moonName);
  assert.ok(moon, `${id} has no moon named ${moonName}`);
  return phaseKey(moon, toAbsoluteDay(date, calendar));
}

describe("the bundled preset set", () => {
  it("offers every setting exactly once", () => {
    assert.deepEqual(PRESET_IDS, ["harptos", "golarion", "eberron", "greyhawk", "darksun", "anuire", "gregorian"]);
    assert.equal(new Set(PRESET_IDS).size, PRESET_IDS.length);
  });

  it("returns null for an unknown id", () => {
    assert.equal(getPreset("krynn"), null);
    assert.equal(buildPresetData("krynn"), null);
    assert.deepEqual(buildPresetHolidays("krynn"), []);
  });

  it("names a localisation key for every preset", () => {
    for (const id of PRESET_IDS) {
      const keys = presetKeys(id);
      assert.equal(keys.label, `TTA.Presets.${id}.Label`);
      assert.equal(keys.description, `TTA.Presets.${id}.Description`);
    }
  });
});

describe("every preset builds into storable data", () => {
  for (const preset of CALENDAR_PRESETS) {
    it(`${preset.id} validates without errors`, () => {
      const data = buildPresetData(preset.id);
      const result = validateCalendarData(data);
      assert.ok(result.valid, JSON.stringify(result.errors));
      assert.equal(data.schemaVersion, SCHEMA_VERSION);
    });

    it(`${preset.id} has the year length its setting calls for`, () => {
      const calendar = buildPresetData(preset.id).calendar;
      assert.equal(daysInYear(calendar), preset.yearLength);
      assert.equal(calendar.monthNames.length, calendar.monthsPerYear);
      assert.equal(calendar.monthLengths.length, calendar.monthsPerYear);
    });

    it(`${preset.id} stays inside the configuration limits`, () => {
      const calendar = buildPresetData(preset.id).calendar;
      assert.ok(calendar.monthsPerYear <= LIMITS.MONTHS_MAX);
      assert.ok(calendar.weekdayNames.length <= LIMITS.WEEKDAYS_MAX);
      assert.ok(calendar.moons.length <= LIMITS.MOONS_MAX);
      assert.ok(calendar.monthLengths.every(length => length >= LIMITS.DAYS_MIN && length <= LIMITS.DAYS_MAX));
    });

    it(`${preset.id} produces the same data every time it is built`, () => {
      assert.deepEqual(buildPresetData(preset.id), buildPresetData(preset.id));
    });

    it(`${preset.id} dates its holidays into its own starting year`, () => {
      const calendar = buildPresetData(preset.id).calendar;
      const holidays = buildPresetHolidays(preset.id);
      assert.equal(holidays.length, presetHolidayCount(preset.id));
      for (const holiday of holidays) {
        assert.ok(holiday.dateKey.startsWith(String(calendar.currentDate.year).padStart(4, "0")));
        assert.ok(holiday.title.trim());
        // A festival dated past the end of its own month would be refused when
        // the note is written, long after the preset looked fine.
        const parsed = parseKey(holiday.dateKey);
        assert.ok(isValidDate(parsed, calendar), `${holiday.title} is not a real date: ${holiday.dateKey}`);
      }
    });
  }
});

describe("preset weekday anchors", () => {
  it("puts 1 Zarantyr on a Sul, as Eberron reckons it", () => {
    const calendar = buildPresetData("eberron").calendar;
    assert.equal(weekdayName({ year: 998, month: 1, day: 1 }, calendar), "Sul");
    // A 336-day year is 48 whole weeks, so the date never drifts.
    assert.equal(weekdayName({ year: 1099, month: 1, day: 1 }, calendar), "Sul");
  });

  it("puts 1 Abadius 4710 AR on a Fireday, matching 1 January 2010", () => {
    const calendar = buildPresetData("golarion").calendar;
    assert.equal(weekdayName({ year: 4710, month: 1, day: 1 }, calendar), "Fireday");
  });

  it("puts 1 January 2026 on a Thursday", () => {
    const calendar = buildPresetData("gregorian").calendar;
    assert.equal(weekdayName({ year: 2026, month: 1, day: 1 }, calendar), "Thursday");
  });

  it("starts the Greyhawk year on a Starday", () => {
    const calendar = buildPresetData("greyhawk").calendar;
    assert.equal(weekdayName({ year: 591, month: 1, day: 1 }, calendar), "Starday");
  });

  it("opens the Anuirean spring months on a Firlen", () => {
    const calendar = buildPresetData("anuire").calendar;
    for (const month of [2, 3, 4]) {
      assert.equal(weekdayName({ year: 1524, month, day: 1 }, calendar), "Firlen");
    }
  });
});

describe("preset moon anchors", () => {
  it("hangs a full Selûne over Midsummer", () => {
    assert.equal(phaseOn("harptos", "Selûne", { year: 1495, month: 10, day: 1 }), "Full");
  });

  it("puts both Greyhawk moons full together at Richfest", () => {
    assert.equal(phaseOn("greyhawk", "Luna", { year: 591, month: 9, day: 4 }), "Full");
    assert.equal(phaseOn("greyhawk", "Celene", { year: 591, month: 9, day: 4 }), "Full");
  });

  it("keeps Celene full at all four Greyhawk festivals", () => {
    for (const month of [1, 5, 9, 13]) {
      assert.equal(phaseOn("greyhawk", "Celene", { year: 591, month, day: 4 }), "Full");
    }
  });

  it("starts the Athasian moons new on their recorded nights", () => {
    assert.equal(phaseOn("darksun", "Ral", { year: 1, month: 1, day: 13 }), "New");
    assert.equal(phaseOn("darksun", "Guthay", { year: 1, month: 2, day: 2 }), "New");
  });

  it("opens every Anuirean month on the new moon, festivals and all", () => {
    for (const year of [1524, 1525, 2024]) {
      for (const month of [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16]) {
        assert.equal(phaseOn("anuire", "The Moon", { year, month, day: 1 }), "New", `${year}-${month}`);
      }
    }
  });

  it("brings the Anuirean moon full on the 17th of Erntenir", () => {
    assert.equal(phaseOn("anuire", "The Moon", { year: 1524, month: 10, day: 17 }), "Full");
  });

  it("starts Somal new on 7 Abadius 4710 AR", () => {
    assert.equal(phaseOn("golarion", "Somal", { year: 4710, month: 1, day: 7 }), "New");
  });

  it("matches the new moon of 18 January 2026", () => {
    const calendar = buildPresetData("gregorian").calendar;
    const [moon] = calendar.moons;
    const dark = illumination(moon, toAbsoluteDay({ year: 2026, month: 1, day: 18 }, calendar));
    assert.ok(dark < 0.01, `expected a dark moon, got ${dark}`);
  });

  it("spreads Eberron's twelve moons across different phases", () => {
    const calendar = buildPresetData("eberron").calendar;
    const day = toAbsoluteDay({ year: 998, month: 1, day: 1 }, calendar);
    const phases = calendar.moons.map(moon => phaseKey(moon, day));
    assert.equal(calendar.moons.length, 12);
    // Twelve moons over eight named phases: no more than two may coincide.
    const counts = new Map();
    for (const phase of phases) counts.set(phase, (counts.get(phase) ?? 0) + 1);
    assert.ok(Math.max(...counts.values()) <= 2, phases.join(", "));
  });
});

describe("preset era labels", () => {
  it("carries each setting's year suffix", () => {
    const suffix = id => buildPresetData(id).calendar.yearSuffix;
    assert.equal(suffix("harptos"), "DR");
    assert.equal(suffix("golarion"), "AR");
    assert.equal(suffix("eberron"), "YK");
    assert.equal(suffix("greyhawk"), "CY");
    assert.equal(suffix("darksun"), "FY");
    assert.equal(suffix("anuire"), "HC");
    assert.equal(suffix("gregorian"), "");
  });

  it("covers the starting year with an Age", () => {
    for (const id of PRESET_IDS) {
      const data = buildPresetData(id);
      const year = data.calendar.currentDate.year;
      const covering = data.ages.find(age => year >= age.startYear && year <= age.startYear + age.durationYears - 1);
      assert.ok(covering, `${id} has no Age covering ${year}`);
    }
  });
});
