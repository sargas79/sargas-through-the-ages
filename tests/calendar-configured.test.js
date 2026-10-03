import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, MODULE_ID } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;
let hooks = [];

afterEach(() => {
  harness?.restore();
  harness = null;
  hooks = [];
});

/** Fresh calendar service, with the stub's no-op `callAll` replaced by a recorder. */
async function loadCalendar() {
  harness = installJournalWorld({ isGM: true });
  globalThis.Hooks.callAll = (name, ...args) => hooks.push({ name, args });
  return import(`../scripts/services/calendar-service.js?t=${Math.random()}`);
}

const configured = () => hooks.filter(hook => hook.name === `${MODULE_ID}.calendarConfigured`).map(hook => hook.args[0]);

describe("the calendarConfigured hook", () => {
  it("fires once per save and reports an unchanged structure", async () => {
    const calendar = await loadCalendar();

    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));

    const [payload] = configured();
    assert.equal(configured().length, 1);
    assert.equal(payload.structureChanged, false);
    assert.deepEqual(payload.calendar.monthLengths, DEFAULT_CALENDAR_DATA.calendar.monthLengths);
    assert.deepEqual(payload.previous.monthLengths, DEFAULT_CALENDAR_DATA.calendar.monthLengths);
  });

  it("flags a change in month lengths so stored dates can be revalidated", async () => {
    const calendar = await loadCalendar();
    const data = structuredClone(DEFAULT_CALENDAR_DATA);
    data.calendar.monthLengths = data.calendar.monthLengths.map((length, index) => (index === 1 ? length + 3 : length));

    await calendar.saveData(data);

    const [payload] = configured();
    assert.equal(payload.structureChanged, true);
    assert.equal(payload.calendar.monthLengths[1], DEFAULT_CALENDAR_DATA.calendar.monthLengths[1] + 3);
    assert.equal(payload.previous.monthLengths[1], DEFAULT_CALENDAR_DATA.calendar.monthLengths[1]);
  });

  it("treats renamed months as a non-structural change", async () => {
    const calendar = await loadCalendar();
    const data = structuredClone(DEFAULT_CALENDAR_DATA);
    data.calendar.monthNames = data.calendar.monthNames.map(name => `${name}!`);

    await calendar.saveData(data);

    assert.equal(configured()[0].structureChanged, false);
  });

  it("stays quiet for an Age-only save, which cannot change the structure", async () => {
    const calendar = await loadCalendar();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    hooks = [];

    await calendar.saveAges([{ id: "a", name: "An Age", startYear: 1, durationYears: 10, playerVisible: true }]);

    assert.equal(configured().length, 0);
  });

  it("does not fire when the save is refused", async () => {
    harness = installJournalWorld({ isGM: false });
    globalThis.Hooks.callAll = (name, ...args) => hooks.push({ name, args });
    const calendar = await import(`../scripts/services/calendar-service.js?t=${Math.random()}`);

    assert.equal(await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA)), null);
    assert.equal(configured().length, 0);
  });
});
