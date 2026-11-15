import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, FLAGS, MODULE_ID, VISIBILITY } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

/** The services under one cache-busting key, so they share their stores. */
async function loadServices() {
  const key = Math.random();
  const [calendar, timeline, journal, privateStore, partyStore] = await Promise.all([
    import(`../scripts/services/calendar-service.js?t=${key}`),
    import(`../scripts/services/timeline-service.js?t=${key}`),
    import(`../scripts/services/journal-service.js?t=${key}`),
    import(`../scripts/services/private-store-service.js?t=${key}`),
    import(`../scripts/services/party-store-service.js?t=${key}`)
  ]);
  return { calendar, timeline, journal, privateStore, partyStore };
}

const NORTH = {
  id: "a", name: "North", members: ["pa"], currentDate: { year: 1, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 }
};

function worldWithParty(party = NORTH) {
  return { ...structuredClone(DEFAULT_CALENDAR_DATA), parties: [party], activePartyId: party.id };
}

const flagged = flag => harness.allEntries().filter(entry => entry.getFlag(MODULE_ID, flag));
const titles = events => events.map(event => event.title).sort();

/** A second GM-only entry holding a copy of an event under another id and title. */
async function secondPrivateStore(event, { folder = null, title }) {
  return JournalEntry.create({
    name: "Calendar (GM only)",
    folder,
    flags: {
      [MODULE_ID]: {
        [FLAGS.PRIVATE_ENTRY]: true,
        [FLAGS.PRIVATE_DATA]: { ages: [], events: [{ ...event, id: `${event.id}-copy`, title }] }
      }
    }
  });
}

/**
 * The stores are ordinary journal entries in the sidebar. One dragged out of
 * the notes folder, or left outside when the folder is deleted and made again,
 * used to stop being found — and the next save started an empty one beside it.
 */
describe("a store that is not in the notes folder", () => {
  it("is still read, and still the one written to", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });

    const [store] = flagged(FLAGS.PRIVATE_ENTRY);
    store.folder = null;

    assert.deepEqual(titles(timeline.getEvents()), ["The traitor"]);

    await timeline.createEvent({ dateKey: "0001-01-09", title: "The price", visibility: VISIBILITY.GM_ONLY });

    assert.equal(flagged(FLAGS.PRIVATE_ENTRY).length, 1);
    assert.deepEqual(titles(timeline.getEvents()), ["The price", "The traitor"]);
  });

  it("keeps hidden Ages when it is the GM-only store", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();
    await calendar.saveData({
      ...structuredClone(DEFAULT_CALENDAR_DATA),
      ages: [{ id: "secret", name: "The Sundering", startYear: 1, durationYears: 50, playerVisible: false }]
    });

    flagged(FLAGS.PRIVATE_ENTRY)[0].folder = null;

    assert.deepEqual(calendar.getAges().map(age => age.id), ["secret"]);
  });

  it("is read together with a second store started in its place", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    const event = await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });
    await secondPrivateStore(event, { title: "The older secret" });

    assert.deepEqual(titles(timeline.getEvents()), ["The older secret", "The traitor"]);
  });

  it("does not bring a deleted event back from the second store", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    const event = await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });
    const stray = await secondPrivateStore(event, { title: "The older secret" });

    await timeline.deleteEvent(`${event.id}-copy`);

    assert.deepEqual(titles(timeline.getEvents()), ["The traitor"]);
    // What is left is all in the entry that is where it belongs.
    assert.deepEqual(stray.getFlag(MODULE_ID, FLAGS.PRIVATE_DATA).events, []);
    const home = flagged(FLAGS.PRIVATE_ENTRY).find(entry => entry.folder?.id === "folder1");
    assert.deepEqual(titles(home.getFlag(MODULE_ID, FLAGS.PRIVATE_DATA).events), ["The traitor"]);
  });

  it("is brought back by the folder repair, and two are made one", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline, journal, privateStore } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    const event = await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });
    await secondPrivateStore(event, { title: "The older secret" });

    const result = await journal.repairFolder();
    assert.equal(result.repaired, 1);
    assert.ok(flagged(FLAGS.PRIVATE_ENTRY).every(entry => entry.folder?.id === "folder1"));

    assert.equal(await privateStore.consolidatePrivateStore(), 1);
    const stores = flagged(FLAGS.PRIVATE_ENTRY);
    assert.equal(stores.length, 1);
    assert.deepEqual(
      titles(stores[0].getFlag(MODULE_ID, FLAGS.PRIVATE_DATA).events),
      ["The older secret", "The traitor"]
    );
    assert.deepEqual(titles(timeline.getEvents()), ["The older secret", "The traitor"]);
  });

  it("keeps a second store a GM has written pages into, as an ordinary entry", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline, privateStore } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    const event = await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });
    const stray = await secondPrivateStore(event, { folder: "folder1", title: "The older secret" });
    await stray.createEmbeddedDocuments("JournalEntryPage", [{ name: "Session prep" }]);

    assert.equal(await privateStore.consolidatePrivateStore(), 1);

    assert.ok(harness.allEntries().includes(stray), "the entry with pages is not deleted");
    assert.equal(stray.allPages.length, 1);
    assert.equal(stray.getFlag(MODULE_ID, FLAGS.PRIVATE_ENTRY), undefined);
    assert.equal(stray.getFlag(MODULE_ID, FLAGS.PRIVATE_DATA), undefined);
    assert.equal(flagged(FLAGS.PRIVATE_ENTRY).length, 1);
    assert.deepEqual(titles(timeline.getEvents()), ["The older secret", "The traitor"]);
  });

  it("leaves a single store alone when there is nothing to make one", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline, privateStore } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });

    assert.equal(await privateStore.consolidatePrivateStore(), 0);
    assert.equal(flagged(FLAGS.PRIVATE_ENTRY).length, 1);
    assert.deepEqual(titles(timeline.getEvents()), ["The traitor"]);
  });
});

describe("a party's store that is not in the notes folder", () => {
  async function worldWithPartyEvent() {
    harness = installJournalWorld({ isGM: true });
    const services = await loadServices();
    await services.calendar.saveData(worldWithParty());
    const event = await services.timeline.createEvent({
      dateKey: "0001-01-05", title: "North found the key", visibility: VISIBILITY.PLAYERS, partyId: "a"
    });
    return { ...services, event };
  }

  it("is still read, and still the one written to", async () => {
    const { timeline } = await worldWithPartyEvent();
    flagged(FLAGS.PARTY_ENTRY)[0].folder = null;

    assert.deepEqual(titles(timeline.getEvents()), ["North found the key"]);

    await timeline.createEvent({
      dateKey: "0001-01-06", title: "North lost the key", visibility: VISIBILITY.PLAYERS, partyId: "a"
    });

    assert.equal(flagged(FLAGS.PARTY_ENTRY).length, 1);
    assert.deepEqual(titles(timeline.getEvents()), ["North found the key", "North lost the key"]);
  });

  it("stops being delivered to a player who has left the party", async () => {
    const { partyStore } = await worldWithPartyEvent();
    const [store] = flagged(FLAGS.PARTY_ENTRY);
    store.folder = null;
    assert.equal(store.visibleTo({ id: "pa", isGM: false }), true);

    await partyStore.syncPartyEntry({ ...NORTH, members: ["pb"] });

    assert.equal(store.visibleTo({ id: "pa", isGM: false }), false);
    assert.equal(store.visibleTo({ id: "pb", isGM: false }), true);
  });

  it("is made one with a second store by the repair", async () => {
    const { timeline, journal, partyStore, event } = await worldWithPartyEvent();
    await JournalEntry.create({
      name: "Calendar (party: North)",
      folder: null,
      flags: {
        [MODULE_ID]: {
          [FLAGS.PARTY_ENTRY]: "a",
          [FLAGS.PARTY_DATA]: { events: [{ ...event, id: `${event.id}-copy`, title: "North's older find" }] }
        }
      }
    });
    assert.deepEqual(titles(timeline.getEvents()), ["North found the key", "North's older find"]);

    await journal.repairFolder();
    assert.equal(await partyStore.consolidatePartyStores([NORTH]), 1);

    const stores = flagged(FLAGS.PARTY_ENTRY);
    assert.equal(stores.length, 1);
    assert.equal(stores[0].folder?.id, "folder1");
    assert.deepEqual(titles(timeline.getEvents()), ["North found the key", "North's older find"]);
  });

  it("keeps a stray copy that holds pages when its party is deleted", async () => {
    const { partyStore } = await worldWithPartyEvent();
    const stray = await JournalEntry.create({
      name: "Calendar (party: North)",
      folder: null,
      flags: { [MODULE_ID]: { [FLAGS.PARTY_ENTRY]: "a", [FLAGS.PARTY_DATA]: { events: [] } } }
    });
    await stray.createEmbeddedDocuments("JournalEntryPage", [{ name: "North's handouts" }]);

    assert.equal(await partyStore.deletePartyEntry("a"), true);

    assert.equal(flagged(FLAGS.PARTY_ENTRY).length, 0);
    assert.ok(harness.allEntries().includes(stray));
    assert.equal(stray.allPages.length, 1);
  });

  it("is deleted with its party wherever it is", async () => {
    const { partyStore } = await worldWithPartyEvent();
    flagged(FLAGS.PARTY_ENTRY)[0].folder = null;

    assert.equal(await partyStore.deletePartyEntry("a"), true);
    assert.equal(flagged(FLAGS.PARTY_ENTRY).length, 0);
  });
});
