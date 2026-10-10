import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, FLAGS, MODULE_ID, SETTINGS, VISIBILITY } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

const salt = () => Math.random();

async function loadServices() {
  const key = salt();
  const [calendar, timeline, store] = await Promise.all([
    import(`../scripts/services/calendar-service.js?t=${key}`),
    import(`../scripts/services/timeline-service.js?t=${key}`),
    import(`../scripts/services/party-store-service.js?t=${key}`)
  ]);
  return { calendar, timeline, store };
}

async function reconnectAs(options) {
  const entries = harness.allEntries();
  const settings = new Map(harness.settings);
  harness.restore();
  harness = installJournalWorld(options);
  harness.entries.push(...entries);
  for (const [key, value] of settings) harness.settings.set(key, value);
  return loadServices();
}

function worldWithParties() {
  return {
    ...structuredClone(DEFAULT_CALENDAR_DATA),
    parties: [
      { id: "a", name: "North", members: ["pa"], currentDate: { year: 1, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } },
      { id: "b", name: "South", members: ["pb"], currentDate: { year: 2, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } }
    ],
    activePartyId: "a"
  };
}

const northEvent = { dateKey: "0001-01-05", title: "North found the key", visibility: VISIBILITY.PLAYERS, partyId: "a" };
const southEvent = { dateKey: "0002-01-05", title: "South lost the key", visibility: VISIBILITY.PLAYERS, partyId: "b" };
const sharedEvent = { dateKey: "0001-01-06", title: "The comet", visibility: VISIBILITY.PLAYERS };
const secretEvent = { dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY, partyId: "a" };

const sharedSetting = () => harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`);
const partyPayload = id => harness.allEntries()
  .find(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY) === id)
  ?.getFlag(MODULE_ID, FLAGS.PARTY_DATA);

async function seed() {
  harness = installJournalWorld({ isGM: true });
  const services = await loadServices();
  await services.calendar.saveData(worldWithParties());
  for (const event of [northEvent, southEvent, sharedEvent, secretEvent]) await services.timeline.createEvent(event);
  return services;
}

describe("party events", () => {
  it("are routed to the party's store, shared ones to the setting, GM-only ones to the GM store", async () => {
    const { store } = await seed();

    assert.deepEqual(sharedSetting().map(event => event.title), ["The comet"]);
    assert.deepEqual(partyPayload("a").events.map(event => event.title), ["North found the key"]);
    assert.deepEqual(partyPayload("b").events.map(event => event.title), ["South lost the key"]);
    assert.equal(JSON.stringify(sharedSetting()).includes("found the key"), false);
    assert.equal(JSON.stringify(partyPayload("a")).includes("traitor"), false, "GM-only stays out of the party store");
    assert.ok(store.readParty("a"));
  });

  it("are all listed for the GM", async () => {
    const { timeline } = await seed();
    assert.deepEqual(timeline.getEvents().map(event => event.title).sort(),
      ["North found the key", "South lost the key", "The comet", "The traitor"]);
  });

  it("never reach a client outside the party, at the storage level", async () => {
    await seed();

    const asNorth = await reconnectAs({ isGM: false, userId: "pa" });
    assert.deepEqual(asNorth.timeline.getEvents().map(event => event.title).sort(), ["North found the key", "The comet"]);
    assert.deepEqual(asNorth.timeline.getVisibleEvents().map(event => event.title).sort(), ["North found the key", "The comet"]);

    const asSouth = await reconnectAs({ isGM: false, userId: "pb" });
    assert.deepEqual(asSouth.timeline.getEvents().map(event => event.title).sort(), ["South lost the key", "The comet"]);

    const asStranger = await reconnectAs({ isGM: false, userId: "px" });
    assert.deepEqual(asStranger.timeline.getEvents().map(event => event.title), ["The comet"]);
  });

  it("move between stores when their party changes, leaving no copy behind", async () => {
    const { timeline } = await seed();
    const event = timeline.getEvents().find(candidate => candidate.title === "North found the key");

    await timeline.updateEvent(event.id, { partyId: "b" });
    assert.deepEqual(partyPayload("a").events, []);
    assert.deepEqual(partyPayload("b").events.map(candidate => candidate.title).sort(), ["North found the key", "South lost the key"]);

    await timeline.updateEvent(event.id, { partyId: null });
    assert.deepEqual(partyPayload("b").events.map(candidate => candidate.title), ["South lost the key"]);
    assert.deepEqual(sharedSetting().map(candidate => candidate.title).sort(), ["North found the key", "The comet"]);
    assert.equal(timeline.getEvents().length, 4);
  });

  it("fall back to shared when they name a party that does not exist", async () => {
    const { timeline } = await seed();
    const event = await timeline.createEvent({ ...sharedEvent, title: "Orphan", partyId: "gone" });
    assert.equal(event.partyId, null);
    assert.ok(sharedSetting().some(candidate => candidate.title === "Orphan"));
  });

  it("can be moved wholesale when a party is removed", async () => {
    const { calendar, timeline, store } = await seed();

    assert.equal(timeline.countPartyEvents("b"), 1);
    const data = calendar.getData();
    await calendar.saveData({ ...data, parties: data.parties.filter(party => party.id !== "b") });
    assert.equal(await timeline.reassignPartyEvents("b", "a"), 1);
    await store.deletePartyEntry("b");

    assert.deepEqual(partyPayload("a").events.map(event => event.title).sort(), ["North found the key", "South lost the key"]);
    assert.equal(partyPayload("b"), undefined);
    assert.equal(timeline.getEvents().length, 4);
  });

  it("leave a world without parties exactly as before", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    const event = await timeline.createEvent(sharedEvent);
    assert.equal(event.partyId, null);
    assert.deepEqual(sharedSetting().map(candidate => candidate.title), ["The comet"]);
  });
});

describe("promoting a player's note with parties", () => {
  async function promote(noteView) {
    const { calendar, timeline } = await seed();
    const previousFromUuid = globalThis.fromUuid;
    globalThis.fromUuid = async () => null;
    try {
      return { event: await timeline.promoteNote(noteView, { visibility: VISIBILITY.GM_ONLY, partyId: "b" }), calendar };
    } finally {
      globalThis.fromUuid = previousFromUuid;
    }
  }

  const note = (authorId, isGMNote) => ({
    uuid: "JournalEntry.x.JournalEntryPage.y",
    dateKey: "0001-01-07",
    title: "We burned the bridge",
    content: "<p>No going back now.</p>",
    authorId,
    isGMNote
  });

  it("goes to the author's party, visible to players, whatever the GM asked", async () => {
    const { event } = await promote(note("pa", false));
    assert.equal(event.visibility, VISIBILITY.PLAYERS);
    assert.equal(event.partyId, "a");
    assert.ok(partyPayload("a").events.some(candidate => candidate.title === "We burned the bridge"));
  });

  it("is shared when the author is in no party", async () => {
    const { event } = await promote(note("px", false));
    assert.equal(event.partyId, null);
    assert.ok(sharedSetting().some(candidate => candidate.title === "We burned the bridge"));
  });

  it("keeps the GM's choices for a GM's own note", async () => {
    const { event } = await promote(note("gm1", true));
    assert.equal(event.visibility, VISIBILITY.GM_ONLY);
    assert.equal(event.partyId, "b");
  });
});
