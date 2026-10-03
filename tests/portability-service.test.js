import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_CALENDAR_DATA,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  LIMITS,
  SCHEMA_VERSION
} from "../scripts/constants.js";
import { migrateCalendarData } from "../scripts/services/migration-service.js";
import {
  buildExportPayload,
  exportFilename,
  parseImport,
  summarizeImport
} from "../scripts/services/portability-service.js";

const calendar = {
  monthsPerYear: 10,
  daysPerMonth: 28,
  monthNames: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  weekdayNames: ["One", "Two", "Three", "Four", "Five"],
  currentDate: { year: 5, month: 3, day: 12 },
  currentTime: { hour: 9, minute: 30 },
  moons: [
    { id: "m1", name: "Selene", cycleLength: 28, offset: 0, phaseCount: 8, color: "#ffffff", showInGrid: true, playerVisible: true, sortOrder: 0 }
  ]
};

const ages = [
  { id: "a1", name: "First Age", startYear: 1, durationYears: 100, description: "", color: "#8f3d2e", playerVisible: true, sortOrder: 0 }
];

const events = [
  {
    id: "e1",
    dateKey: "0005-03-12",
    title: "A battle",
    description: "",
    visibility: "gm-only",
    color: "#8f3d2e",
    icon: "fa-solid fa-scroll",
    source: { type: "manual", noteUuid: null },
    createdBy: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z"
  }
];

function exportText(overrides = {}) {
  return JSON.stringify(buildExportPayload({ calendar, ages, events, ...overrides }));
}

describe("buildExportPayload", () => {
  it("stamps the envelope with the current format and schema", () => {
    const payload = buildExportPayload({ calendar, ages });
    assert.equal(payload.format, EXPORT_FORMAT);
    assert.equal(payload.formatVersion, EXPORT_FORMAT_VERSION);
    assert.equal(payload.schemaVersion, SCHEMA_VERSION);
    assert.ok(payload.exportedAt);
  });

  it("omits events unless they are supplied", () => {
    assert.equal("events" in buildExportPayload({ calendar, ages }), false);
    assert.equal(buildExportPayload({ calendar, ages, events }).events.length, 1);
    assert.deepEqual(buildExportPayload({ calendar, ages, events: [] }).events, []);
  });

  it("normalises the calendar it is given", () => {
    const payload = buildExportPayload({ calendar: { ...calendar, monthsPerYear: 999 }, ages });
    assert.equal(payload.calendar.monthsPerYear, LIMITS.MONTHS_MAX);
  });

  it("carries the moons through", () => {
    const payload = buildExportPayload({ calendar, ages });
    assert.equal(payload.calendar.moons.length, 1);
    assert.equal(payload.calendar.moons[0].name, "Selene");
  });
});

describe("parseImport", () => {
  it("round-trips an export without loss", () => {
    const parsed = parseImport(exportText());
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.data, migrateCalendarData({ calendar, ages }));
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.data.calendar.moons[0].cycleLength, 28);
    assert.deepEqual(parsed.data.calendar.currentTime, { hour: 9, minute: 30 });
  });

  it("reports null events when the file carries none", () => {
    const parsed = parseImport(JSON.stringify(buildExportPayload({ calendar, ages })));
    assert.equal(parsed.events, null);
  });

  it("rejects text that is not JSON", () => {
    const parsed = parseImport("not json at all");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.data, null);
    assert.equal(parsed.errors[0].code, "importNotJson");
  });

  it("rejects JSON that is not an export envelope", () => {
    assert.equal(parseImport('{"hello":"world"}').errors[0].code, "importWrongFormat");
    assert.equal(parseImport("[1,2,3]").errors[0].code, "importNotJson");
  });

  it("rejects a newer export format", () => {
    const payload = { ...buildExportPayload({ calendar, ages }), formatVersion: EXPORT_FORMAT_VERSION + 1 };
    const parsed = parseImport(JSON.stringify(payload));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.errors[0].code, "importNewerFormat");
  });

  it("rejects an envelope with no calendar block", () => {
    const payload = buildExportPayload({ calendar, ages });
    delete payload.calendar;
    assert.equal(parseImport(JSON.stringify(payload)).errors[0].code, "importMissingCalendar");
  });

  it("clamps out-of-range values rather than failing", () => {
    const payload = buildExportPayload({ calendar, ages });
    payload.calendar.daysPerMonth = 5000;
    const parsed = parseImport(JSON.stringify(payload));
    assert.equal(parsed.data.calendar.daysPerMonth, LIMITS.DAYS_MAX);
  });

  it("caps an over-long moon list", () => {
    const payload = buildExportPayload({ calendar, ages });
    payload.calendar.moons = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`, name: `Moon ${i}`, cycleLength: 20 + i, offset: 0, phaseCount: 8, sortOrder: i
    }));
    const parsed = parseImport(JSON.stringify(payload));
    assert.equal(parsed.data.calendar.moons.length, LIMITS.MOONS_MAX);
    assert.ok(parsed.ok);
  });

  it("survives a file with no moons at all", () => {
    const payload = buildExportPayload({ calendar: { ...calendar, moons: undefined }, ages });
    const parsed = parseImport(JSON.stringify(payload));
    assert.deepEqual(parsed.data.calendar.moons, []);
  });
});

describe("summarizeImport", () => {
  it("reports before and after counts", () => {
    const parsed = parseImport(exportText());
    const summary = summarizeImport(parsed, migrateCalendarData(DEFAULT_CALENDAR_DATA));
    assert.deepEqual(summary.months, { from: 12, to: 10 });
    assert.equal(summary.yearLength.from, 360);
    assert.ok(Number.isInteger(summary.yearLength.to));
    assert.deepEqual(summary.moons, { from: 0, to: 1 });
    assert.deepEqual(summary.ages, { from: 0, to: 1 });
    assert.equal(summary.events, 1);
  });

  it("reports a null event count when the file has none", () => {
    const parsed = parseImport(JSON.stringify(buildExportPayload({ calendar, ages })));
    assert.equal(summarizeImport(parsed, migrateCalendarData(DEFAULT_CALENDAR_DATA)).events, null);
  });
});

describe("exportFilename", () => {
  it("builds a dated, slug-safe filename", () => {
    const name = exportFilename("My World!", new Date("2026-08-18T10:00:00Z"));
    assert.equal(name, "sargas-through-the-ages-my-world--2026-08-18.json");
  });

  it("falls back when the world id is unusable", () => {
    assert.ok(exportFilename("", new Date("2026-08-18T10:00:00Z")).includes("world"));
  });
});
