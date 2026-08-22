import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, MODULE_ID, SETTINGS } from "../scripts/constants.js";
import {
  acknowledgeWorldTime,
  advanceTime,
  advanceTo,
  getCurrentDate,
  getCurrentTime,
  initializeWorldTimeCheckpoint,
  isWorldTimeOutOfSync,
  onWorldTimeUpdated
} from "../scripts/services/calendar-service.js";
import { installFoundryStub } from "./helpers/foundry-stub.js";

/** Stored calendar data starting somewhere clear of the Year 1 floor. */
function calendarAt(date = { year: 5, month: 3, day: 10 }, time = { hour: 8, minute: 0 }) {
  const data = structuredClone(DEFAULT_CALENDAR_DATA);
  data.calendar.currentDate = date;
  data.calendar.currentTime = time;
  return data;
}

let stub = null;

function setup(options = {}) {
  stub = installFoundryStub({ calendarData: calendarAt(), ...options });
  return stub;
}

afterEach(() => {
  stub?.restore();
  stub = null;
});

/** Leave the module's warn-once state where a fresh divergence will report. */
function clearDriftState() {
  onWorldTimeUpdated(stub.game.time.worldTime);
}

describe("the world-time checkpoint", () => {
  it("adopts the current world time when none is stored", async () => {
    setup({ worldTime: 1234, checkpoint: null });
    await initializeWorldTimeCheckpoint();
    assert.equal(stub.settings.get(`${MODULE_ID}.${SETTINGS.WORLD_TIME}`), 1234);
  });

  it("leaves an existing checkpoint alone", async () => {
    setup({ worldTime: 1234, checkpoint: 99 });
    await initializeWorldTimeCheckpoint();
    assert.equal(stub.settings.get(`${MODULE_ID}.${SETTINGS.WORLD_TIME}`), 99);
  });

  it("is not written by a player", async () => {
    setup({ worldTime: 1234, checkpoint: null, isGM: false });
    await initializeWorldTimeCheckpoint();
    assert.equal(stub.settings.get(`${MODULE_ID}.${SETTINGS.WORLD_TIME}`), null);
  });

  it("reports drift only once world time has moved away from it", () => {
    setup({ worldTime: 100, checkpoint: 100 });
    assert.equal(isWorldTimeOutOfSync(), false);
    stub.driftWorldTime(6);
    assert.equal(isWorldTimeOutOfSync(), true);
  });

  it("reports no drift while no checkpoint has been established", () => {
    setup({ worldTime: 100, checkpoint: null });
    assert.equal(isWorldTimeOutOfSync(), false);
  });
});

describe("a combat round, or any other foreign world-time change", () => {
  it("never moves the campaign date", () => {
    setup({ worldTime: 100, checkpoint: 100 });
    const before = getCurrentDate();

    // Six seconds a round, ten rounds.
    for (let round = 0; round < 10; round++) {
      stub.driftWorldTime(6);
      onWorldTimeUpdated(stub.game.time.worldTime);
    }

    assert.deepEqual(getCurrentDate(), before);
    assert.deepEqual(stub.storedCalendar.currentDate, before);
    assert.equal(stub.writes.length, 0, "no setting was written");
  });

  it("warns a GM once for the whole divergence, not once per round", () => {
    setup({ worldTime: 100, checkpoint: 100 });
    clearDriftState();

    for (let round = 0; round < 10; round++) {
      stub.driftWorldTime(6);
      onWorldTimeUpdated(stub.game.time.worldTime);
    }

    assert.equal(stub.notifications.warn.length, 1);
    assert.equal(stub.notifications.warn[0], "TTA.Errors.TimeOutOfSync");
  });

  it("warns again once the clocks have agreed and then parted a second time", async () => {
    setup({ worldTime: 100, checkpoint: 100 });
    clearDriftState();

    stub.driftWorldTime(6);
    onWorldTimeUpdated(stub.game.time.worldTime);
    assert.equal(stub.notifications.warn.length, 1);

    await acknowledgeWorldTime();
    onWorldTimeUpdated(stub.game.time.worldTime);

    stub.driftWorldTime(6);
    onWorldTimeUpdated(stub.game.time.worldTime);
    assert.equal(stub.notifications.warn.length, 2);
  });

  it("says nothing to a player", () => {
    setup({ worldTime: 100, checkpoint: 100, isGM: false });
    stub.driftWorldTime(6);
    onWorldTimeUpdated(stub.game.time.worldTime);
    assert.equal(stub.notifications.warn.length, 0);
  });
});

describe("acknowledging a drift", () => {
  it("takes the current world time without touching the calendar", async () => {
    setup({ worldTime: 100, checkpoint: 100 });
    const before = getCurrentDate();
    stub.driftWorldTime(60);

    assert.equal(await acknowledgeWorldTime(), true);
    assert.equal(isWorldTimeOutOfSync(), false);
    assert.deepEqual(getCurrentDate(), before);
  });

  it("is refused for a player", async () => {
    setup({ worldTime: 100, checkpoint: 100, isGM: false });
    stub.driftWorldTime(60);

    assert.equal(await acknowledgeWorldTime(), false);
    assert.equal(isWorldTimeOutOfSync(), true);
    assert.equal(stub.notifications.warn[0], "TTA.Errors.TimeGMOnly");
  });
});

describe("advancing time", () => {
  it("moves the calendar and world time by the same seconds", async () => {
    setup({ worldTime: 1000, checkpoint: 1000 });

    const result = await advanceTime(3600);

    assert.equal(result.elapsedSeconds, 3600);
    assert.deepEqual(result.time, { hour: 9, minute: 0 });
    assert.equal(stub.game.time.worldTime, 4600);
    assert.equal(isWorldTimeOutOfSync(), false, "the checkpoint kept pace");
  });

  it("rolls into the next day and keeps the clocks together", async () => {
    setup({ worldTime: 0, checkpoint: 0 });

    const result = await advanceTime(20 * 3600);

    assert.deepEqual(result.date, { year: 5, month: 3, day: 11 });
    assert.deepEqual(result.time, { hour: 4, minute: 0 });
    assert.equal(isWorldTimeOutOfSync(), false);
  });

  it("does nothing at all when the target is the current moment", async () => {
    setup({ worldTime: 500, checkpoint: 500 });

    const result = await advanceTo({ year: 5, month: 3, day: 10 }, { hour: 8, minute: 0 });

    assert.equal(result.elapsedSeconds, 0);
    assert.equal(stub.game.time.worldTime, 500);
    assert.equal(stub.writes.length, 0);
  });

  it("is refused for a player, leaving both clocks alone", async () => {
    setup({ worldTime: 500, checkpoint: 500, isGM: false });

    assert.equal(await advanceTime(3600), null);
    assert.equal(stub.game.time.worldTime, 500);
    assert.equal(stub.notifications.warn[0], "TTA.Errors.TimeGMOnly");
  });

  it("leaves the calendar where it was when Foundry refuses the advance", async () => {
    setup({ worldTime: 500, checkpoint: 500 });
    const before = getCurrentDate();
    stub.game.time.advance = async () => { throw new Error("refused"); };

    assert.equal(await advanceTime(3600), null);
    assert.deepEqual(getCurrentDate(), before);
    assert.equal(stub.settings.get(`${MODULE_ID}.${SETTINGS.WORLD_TIME}`), 500, "the checkpoint was rolled back");
    assert.equal(stub.notifications.error[0], "TTA.Errors.TimeAdvanceFailed");
  });
});

describe("two time changes at once", () => {
  it("refuses the second while the first is still being applied", async () => {
    setup({ worldTime: 0, checkpoint: 0 });

    let releaseFirst = null;
    stub.game.time.advance = async seconds => {
      await new Promise(resolve => { releaseFirst = resolve; });
      stub.game.time.worldTime += seconds;
    };

    const first = advanceTime(3600);
    await new Promise(resolve => setTimeout(resolve, 0));

    const second = await advanceTime(3600);
    assert.equal(second, null, "the second change was refused");
    assert.ok(stub.notifications.warn.includes("TTA.Errors.TimeBusy"));

    releaseFirst();
    const applied = await first;
    assert.deepEqual(applied.time, { hour: 9, minute: 0 }, "the first change still landed");
  });

  it("discards a change whose starting date moved underneath it", async () => {
    setup({ worldTime: 0, checkpoint: 0 });

    // Another client writes the shared date while this advance is in flight.
    stub.game.time.advance = async seconds => {
      stub.setStoredDate({ year: 9, month: 1, day: 1 }, { hour: 12, minute: 0 });
      stub.game.time.worldTime += seconds;
    };

    const result = await advanceTime(3600);

    assert.equal(result, null);
    assert.deepEqual(getCurrentDate(), { year: 9, month: 1, day: 1 }, "the other write survived");
    assert.deepEqual(getCurrentTime(), { hour: 12, minute: 0 });
    assert.equal(stub.settings.get(`${MODULE_ID}.${SETTINGS.WORLD_TIME}`), 0, "the checkpoint was rolled back");
    assert.equal(isWorldTimeOutOfSync(), true, "so the drift is reported rather than hidden");
    assert.ok(stub.notifications.warn.includes("TTA.Errors.TimeRaced"));
  });

  it("takes a later change once the first has finished", async () => {
    setup({ worldTime: 0, checkpoint: 0 });

    await advanceTime(3600);
    const second = await advanceTime(3600);

    assert.deepEqual(second.time, { hour: 10, minute: 0 });
    assert.equal(isWorldTimeOutOfSync(), false);
  });
});
