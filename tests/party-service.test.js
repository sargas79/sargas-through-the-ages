import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS, SCHEMA_VERSION } from "../scripts/constants.js";
import { migrateCalendarData, migrateParties } from "../scripts/services/migration-service.js";
import {
  dedupeMembers,
  findDuplicateMembers,
  findParty,
  isMember,
  normalizeParty,
  partyForUser,
  partyMoment,
  sortParties
} from "../scripts/services/party-service.js";
import { validateCalendarData, validateParties } from "../scripts/services/validation-service.js";

function party(id, members = [], extra = {}) {
  return {
    id,
    name: id,
    members,
    currentDate: { year: 10, month: 1, day: 1 },
    currentTime: { hour: 8, minute: 0 },
    sortOrder: 0,
    ...extra
  };
}

const calendar = {
  monthsPerYear: 3,
  daysPerMonth: 10,
  monthLengths: [10, 10, 5],
  monthNames: ["A", "B", "C"],
  weekdayNames: ["W"],
  currentDate: { year: 1, month: 1, day: 1 },
  currentTime: { hour: 0, minute: 0 }
};

describe("normalizeParty", () => {
  it("fills defaults and dedupes members", () => {
    const normalized = normalizeParty({ name: "  North  ", members: ["u1", "u1", "", "u2"] }, 2);
    assert.equal(normalized.name, "North");
    assert.deepEqual(normalized.members, ["u1", "u2"]);
    assert.equal(normalized.id, "party-2");
    assert.equal(normalized.sortOrder, 2);
    assert.ok(normalized.color);
    assert.deepEqual(normalized.currentDate, { year: 1, month: 1, day: 1 });
    assert.deepEqual(normalized.currentTime, { hour: 0, minute: 0 });
  });

  it("clamps the clock and truncates long names", () => {
    const normalized = normalizeParty({ name: "x".repeat(200), currentTime: { hour: 30, minute: -4 } });
    assert.equal(normalized.name.length, LIMITS.PARTY_NAME_MAX);
    assert.deepEqual(normalized.currentTime, { hour: 23, minute: 0 });
  });
});

describe("membership", () => {
  const parties = [party("a", ["u1"]), party("b", ["u2", "u3"], { sortOrder: 1 })];

  it("finds the one party a user belongs to", () => {
    assert.equal(partyForUser(parties, "u3")?.id, "b");
    assert.equal(partyForUser(parties, "nobody"), null);
    assert.equal(partyForUser(parties, null), null);
    assert.equal(partyForUser([], "u1"), null);
  });

  it("answers isMember and findParty", () => {
    assert.ok(isMember(parties[0], "u1"));
    assert.ok(!isMember(parties[0], "u2"));
    assert.ok(!isMember(null, "u1"));
    assert.equal(findParty(parties, "b")?.id, "b");
    assert.equal(findParty(parties, "zz"), null);
    assert.equal(findParty(parties, null), null);
  });

  it("reports and removes users listed twice, keeping the first party by order", () => {
    const doubled = [party("late", ["u1"], { sortOrder: 5 }), party("early", ["u1", "u9"], { sortOrder: 1 })];
    const dupes = findDuplicateMembers(doubled);
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].userId, "u1");
    assert.equal(dupes[0].keptBy.id, "early");
    assert.equal(dupes[0].droppedFrom.id, "late");

    const cleaned = dedupeMembers(doubled);
    assert.deepEqual(cleaned.map(p => [p.id, p.members]), [["early", ["u1", "u9"]], ["late", []]]);
  });

  it("sorts by order then name", () => {
    const sorted = sortParties([party("b", [], { sortOrder: 1 }), party("z", [], { sortOrder: 0 }), party("a", [], { sortOrder: 0 })]);
    assert.deepEqual(sorted.map(p => p.id), ["a", "z", "b"]);
  });
});

describe("partyMoment", () => {
  const parties = [
    party("a", [], { currentDate: { year: 100, month: 2, day: 3 } }),
    party("b", [], { currentDate: { year: 200, month: 1, day: 1 }, currentTime: { hour: 20, minute: 30 } })
  ];

  it("reads the active party from the calendar, not its record", () => {
    const moment = partyMoment(calendar, parties, "a", "a");
    assert.deepEqual(moment.date, calendar.currentDate);
    assert.deepEqual(moment.time, calendar.currentTime);
  });

  it("reads a non-active party from its own record", () => {
    const moment = partyMoment(calendar, parties, "a", "b");
    assert.deepEqual(moment.date, { year: 200, month: 1, day: 1 });
    assert.deepEqual(moment.time, { hour: 20, minute: 30 });
  });

  it("falls back to the calendar for no party, an unknown party, or no parties", () => {
    assert.deepEqual(partyMoment(calendar, parties, "a", null).date, calendar.currentDate);
    assert.deepEqual(partyMoment(calendar, parties, "a", "nope").date, calendar.currentDate);
    assert.deepEqual(partyMoment(calendar, [], null, "a").date, calendar.currentDate);
  });
});

describe("migration", () => {
  it("defaults a world written before parties to an empty list", () => {
    const result = migrateCalendarData({ schemaVersion: 5, calendar: {}, ages: [] });
    assert.equal(result.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(result.parties, []);
    assert.equal(result.activePartyId, null);
  });

  it("drops a dangling active id and clamps party dates to the calendar", () => {
    const result = migrateCalendarData({
      calendar: { monthsPerYear: 3, daysPerMonth: 10, monthLengths: [10, 10, 5] },
      parties: [party("a", [], { currentDate: { year: 5, month: 3, day: 9 } })],
      activePartyId: "gone"
    });
    assert.equal(result.activePartyId, null);
    assert.deepEqual(result.parties[0].currentDate, { year: 5, month: 3, day: 5 });
  });

  it("keeps a valid active id and removes a user from every party after the first", () => {
    const result = migrateCalendarData({
      calendar: {},
      parties: [party("a", ["u1"], { sortOrder: 0 }), party("b", ["u1", "u2"], { sortOrder: 1 })],
      activePartyId: "b"
    });
    assert.equal(result.activePartyId, "b");
    assert.deepEqual(result.parties.map(p => p.members), [["u1"], ["u2"]]);
  });

  it("is idempotent", () => {
    const once = migrateCalendarData({
      calendar: {},
      parties: [party("a", ["u1"]), party("b", ["u1"])],
      activePartyId: "a"
    });
    assert.deepEqual(migrateCalendarData(once), once);
  });

  it("drops junk entries and caps the list", () => {
    const many = Array.from({ length: LIMITS.PARTIES_MAX + 3 }, (_, i) => party(`p${i}`));
    const result = migrateParties([null, "x", ...many], { monthsPerYear: 12, monthLengths: Array(12).fill(30), daysPerMonth: 30 });
    assert.equal(result.length, LIMITS.PARTIES_MAX);
    assert.deepEqual(result.map(p => p.sortOrder), result.map((_, i) => i));
  });
});

describe("validateParties", () => {
  const codes = result => result.errors.map(e => e.code);

  it("accepts the empty list with no active party", () => {
    assert.ok(validateParties([], null).valid);
  });

  it("rejects an active id with no parties, and parties with no active id", () => {
    assert.ok(codes(validateParties([], "a")).includes("partyActiveWithoutParties"));
    assert.ok(codes(validateParties([party("a")], null)).includes("partyActiveMissing"));
    assert.ok(codes(validateParties([party("a")], "b")).includes("partyActiveMissing"));
    assert.ok(validateParties([party("a")], "a").valid);
  });

  it("rejects a user in two parties", () => {
    const result = validateParties([party("a", ["u1"]), party("b", ["u1"])], "a");
    assert.ok(codes(result).includes("partyMemberDuplicate"));
  });

  it("rejects duplicate ids and names, empty names, and a bad clock", () => {
    const result = validateParties([
      party("a", [], { name: "Same" }),
      party("a", [], { name: "same", currentTime: { hour: 24, minute: 0 } }),
      party("c", [], { name: "" })
    ], "a");
    const found = codes(result);
    for (const code of ["partyIdDuplicate", "partyNameDuplicate", "partyNameEmpty", "partyTimeInvalid"]) {
      assert.ok(found.includes(code), code);
    }
  });

  it("checks every party's date against the calendar", () => {
    const bad = party("a", [], { currentDate: { year: 1, month: 3, day: 9 } });
    assert.ok(codes(validateParties([bad], "a", calendar)).includes("partyDateOutOfRange"));
    assert.ok(validateParties([bad], "a").valid, "no calendar, no range check");
  });

  it("runs from validateCalendarData only when the payload carries parties", () => {
    const base = { calendar, ages: [] };
    assert.ok(validateCalendarData(base).valid);
    const withBad = { ...base, parties: [party("a")], activePartyId: null };
    assert.ok(codes(validateCalendarData(withBad)).includes("partyActiveMissing"));
  });
});
