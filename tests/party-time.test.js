import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, MODULE_ID, SETTINGS } from "../scripts/constants.js";
import {
  advanceDays,
  advanceTime,
  advanceTo,
  advanceToNextAdventureDay,
  getActivePartyId,
  getCurrentDate,
  getCurrentTime,
  getPartyDate,
  getPartyTime,
  getViewerDate,
  setActiveParty,
  setCurrentDateTime,
  TIME_CHANGE_REASON
} from "../scripts/services/calendar-service.js";
import { installFoundryStub } from "./helpers/foundry-stub.js";

const A_DATE = { year: 5, month: 3, day: 10 };
const A_TIME = { hour: 8, minute: 0 };
const B_DATE = { year: 40, month: 1, day: 2 };
const B_TIME = { hour: 20, minute: 15 };

/** Two parties, A active and standing on the calendar's date, B on its own. */
function twoParties() {
  const data = structuredClone(DEFAULT_CALENDAR_DATA);
  data.calendar.currentDate = { ...A_DATE };
  data.calendar.currentTime = { ...A_TIME };
  data.parties = [
    // A's own record is deliberately stale: the calendar is the truth for the active party.
    { id: "a", name: "North", members: ["pa"], currentDate: { year: 1, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 }, sortOrder: 0 },
    { id: "b", name: "South", members: ["pb"], currentDate: { ...B_DATE }, currentTime: { ...B_TIME }, sortOrder: 1 }
  ];
  data.activePartyId = "a";
  return data;
}

let stub = null;

function setup(options = {}) {
  stub = installFoundryStub({ calendarData: twoParties(), worldTime: 1000, checkpoint: 1000, ...options });
  return stub;
}

afterEach(() => {
  stub?.restore();
  stub = null;
});

const hooksNamed = name => stub.hooks.filter(hook => hook.name === `${MODULE_ID}.${name}`);
const checkpoint = () => stub.settings.get(`${MODULE_ID}.${SETTINGS.WORLD_TIME}`);

describe("reading party dates", () => {
  it("reads the active party from the calendar and another party from its record", () => {
    setup();
    assert.equal(getActivePartyId(), "a");
    assert.deepEqual(getPartyDate("a"), A_DATE);
    assert.deepEqual(getPartyDate("b"), B_DATE);
    assert.deepEqual(getPartyTime("b"), B_TIME);
    assert.deepEqual(getPartyDate(null), A_DATE);
    assert.deepEqual(getPartyDate("missing"), A_DATE);
  });

  it("shows a viewer their own party, and everyone else the active party", () => {
    setup();
    assert.deepEqual(getViewerDate({ id: "pb" }), B_DATE);
    assert.deepEqual(getViewerDate({ id: "pa" }), A_DATE);
    assert.deepEqual(getViewerDate({ id: "nobody" }), A_DATE);
    assert.deepEqual(getViewerDate({ id: "gm", isGM: true }), A_DATE);
  });
});

describe("moving a party that is not active", () => {
  it("writes only its record and leaves world time and the checkpoint alone", async () => {
    setup();
    const result = await advanceDays(3, { partyId: "b" });

    assert.deepEqual(result, { year: 40, month: 1, day: 5 });
    assert.deepEqual(getPartyDate("b"), { year: 40, month: 1, day: 5 });
    assert.deepEqual(getPartyTime("b"), B_TIME);
    assert.deepEqual(getCurrentDate(), A_DATE, "the campaign date did not move");
    assert.equal(stub.game.time.worldTime, 1000);
    assert.equal(checkpoint(), 1000);
  });

  it("fires partyTimeChanged, not timeChanged or dateChanged", async () => {
    setup();
    await advanceTime(3600, { partyId: "b" });

    assert.equal(hooksNamed("timeChanged").length, 0);
    assert.equal(hooksNamed("dateChanged").length, 0);
    const [hook] = hooksNamed("partyTimeChanged");
    assert.ok(hook);
    const payload = hook.args[0];
    assert.equal(payload.partyId, "b");
    assert.equal(payload.elapsedSeconds, 3600);
    assert.equal(payload.reason, TIME_CHANGE_REASON.ADVANCE);
    assert.deepEqual(payload.previous, { date: B_DATE, time: B_TIME });
    assert.deepEqual(payload.time, { hour: 21, minute: 15 });
  });

  it("works through advanceTo, setCurrentDateTime and next adventure day", async () => {
    setup();
    await advanceTo({ year: 41, month: 2, day: 2 }, { hour: 1, minute: 0 }, { partyId: "b" });
    assert.deepEqual(getPartyDate("b"), { year: 41, month: 2, day: 2 });

    await setCurrentDateTime({ year: 42, month: 1, day: 1 }, { hour: 23, minute: 0 }, { partyId: "b" });
    assert.deepEqual(getPartyDate("b"), { year: 42, month: 1, day: 1 });

    await advanceToNextAdventureDay({ partyId: "b" });
    assert.deepEqual(getPartyDate("b"), { year: 42, month: 1, day: 2 });
    assert.deepEqual(getPartyTime("b"), { hour: 7, minute: 0 });
    assert.equal(stub.game.time.worldTime, 1000);
  });

  it("clamps a date that falls off the calendar", async () => {
    setup();
    await setCurrentDateTime({ year: 42, month: 99, day: 99 }, { hour: 0, minute: 0 }, { partyId: "b" });
    assert.deepEqual(getPartyDate("b"), { year: 42, month: 12, day: 30 });
  });

  it("is refused for a player", async () => {
    setup({ isGM: false });
    assert.equal(await advanceDays(1, { partyId: "b" }), null);
    assert.deepEqual(getPartyDate("b"), B_DATE);
  });
});

describe("moving the active party", () => {
  it("behaves as before and tags the hook with the party", async () => {
    setup();
    await advanceTime(60, { partyId: "a" });
    assert.equal(stub.game.time.worldTime, 1060);
    assert.deepEqual(getCurrentTime(), { hour: 8, minute: 1 });
    const [hook] = hooksNamed("timeChanged");
    assert.equal(hook.args[0].partyId, "a");
    assert.equal(hooksNamed("partyTimeChanged").length, 0);
    assert.equal(hooksNamed("dateChanged").length, 1);
  });

  it("reports a null party when the world has none", async () => {
    stub = installFoundryStub({ worldTime: 0, checkpoint: 0 });
    await advanceTime(60);
    assert.equal(hooksNamed("timeChanged")[0].args[0].partyId, null);
  });
});

describe("switching the active party", () => {
  it("stores the outgoing date, loads the incoming one, and leaves world time alone", async () => {
    setup();
    const result = await setActiveParty("b");

    assert.equal(result.id, "b");
    assert.equal(getActivePartyId(), "b");
    assert.deepEqual(getCurrentDate(), B_DATE);
    assert.deepEqual(getCurrentTime(), B_TIME);
    assert.deepEqual(getPartyDate("a"), A_DATE, "A's stale record was refreshed from the calendar");
    assert.deepEqual(getPartyTime("a"), A_TIME);
    assert.equal(stub.game.time.worldTime, 1000);
    assert.equal(checkpoint(), 1000);
    assert.equal(stub.writes.length, 1, "one setting write");
  });

  it("fires activePartyChanged and nothing that looks like time passing", async () => {
    setup();
    await setActiveParty("b");
    assert.equal(hooksNamed("timeChanged").length, 0);
    assert.equal(hooksNamed("dateChanged").length, 0);
    assert.equal(hooksNamed("partyTimeChanged").length, 0);
    assert.deepEqual(hooksNamed("activePartyChanged")[0].args[0], { partyId: "b", previousPartyId: "a" });
  });

  it("round-trips both dates exactly", async () => {
    setup();
    await setActiveParty("b");
    await setActiveParty("a");
    assert.deepEqual(getCurrentDate(), A_DATE);
    assert.deepEqual(getCurrentTime(), A_TIME);
    assert.deepEqual(getPartyDate("b"), B_DATE);
    assert.deepEqual(getPartyTime("b"), B_TIME);
  });

  it("is a no-op for the party that is already active", async () => {
    setup();
    await setActiveParty("a");
    assert.equal(stub.writes.length, 0);
    assert.equal(hooksNamed("activePartyChanged").length, 0);
  });

  it("refuses an unknown party and a player", async () => {
    setup();
    assert.equal(await setActiveParty("zzz"), null);
    assert.equal(stub.notifications.warn[0], "TTA.Errors.PartyMissing");
    stub.restore();

    setup({ isGM: false });
    assert.equal(await setActiveParty("b"), null);
    assert.equal(getActivePartyId(), "a");
  });

  it("discards an advance that a switch landed in the middle of", async () => {
    setup();
    // Another GM switches parties while this client's world-time advance is awaiting.
    stub.game.time.advance = async seconds => {
      stub.game.time.worldTime += seconds;
      const key = `${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`;
      const data = stub.settings.get(key);
      stub.settings.set(key, {
        ...data,
        activePartyId: "b",
        calendar: { ...data.calendar, currentDate: { ...B_DATE }, currentTime: { ...B_TIME } }
      });
      return stub.game.time.worldTime;
    };

    const result = await advanceTime(3600);
    assert.equal(result, null);
    assert.deepEqual(getCurrentDate(), B_DATE, "the switch stood");
    assert.equal(checkpoint(), 1000, "the checkpoint went back, so the drift is reported");
    assert.equal(stub.notifications.warn[0], "TTA.Errors.TimeRaced");
  });
});
