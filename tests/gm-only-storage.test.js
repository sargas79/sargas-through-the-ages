import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, MODULE_ID, SETTINGS, VISIBILITY } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

const salt = () => Math.random();

/**
 * Load the three services as one client would see them.
 *
 * They are imported together under a shared cache-busting key so that
 * `timeline-service` and `calendar-service` resolve to the *same*
 * `private-store-service` instance, which is what makes the merge and the split
 * agree with each other.
 */
async function loadServices() {
  const key = salt();
  const [calendar, timeline, store] = await Promise.all([
    import(`../scripts/services/calendar-service.js?t=${key}`),
    import(`../scripts/services/timeline-service.js?t=${key}`),
    import(`../scripts/services/private-store-service.js?t=${key}`)
  ]);
  return { calendar, timeline, store };
}

/** A calendar payload with one visible and one hidden Age. */
function calendarWithAges() {
  return {
    ...structuredClone(DEFAULT_CALENDAR_DATA),
    ages: [
      { id: "open", name: "The Long Peace", startYear: 1, durationYears: 100, playerVisible: true },
      {
        id: "secret",
        name: "The Sundering",
        description: "The gods walked and three cities burned.",
        startYear: 101,
        durationYears: 50,
        playerVisible: false
      }
    ]
  };
}

describe("hidden Ages", () => {
  it("are kept out of the world setting when a GM saves", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();

    await calendar.saveData(calendarWithAges());

    const stored = harness.settings.get(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`);
    assert.deepEqual(stored.ages.map(age => age.id), ["open"]);
    // The description is the part worth checking: it is where a campaign secret
    // actually lives, and it used to travel to every client.
    assert.equal(JSON.stringify(stored).includes("three cities burned"), false);
  });

  it("are still there for the GM who saved them", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();

    await calendar.saveData(calendarWithAges());

    const ages = calendar.getAges();
    assert.deepEqual(ages.map(age => age.id).sort(), ["open", "secret"]);
    assert.equal(ages.find(age => age.id === "secret").description, "The gods walked and three cities burned.");
  });

  it("never reach a player's client at all", async () => {
    harness = installJournalWorld({ isGM: true });
    const asGM = await loadServices();
    await asGM.calendar.saveData(calendarWithAges());

    const entries = harness.allEntries();
    const settings = new Map(harness.settings);
    harness.restore();

    harness = installJournalWorld({ isGM: false, userId: "player1" });
    harness.entries.push(...entries);
    for (const [key, value] of settings) harness.settings.set(key, value);
    const asPlayer = await loadServices();

    assert.deepEqual(asPlayer.calendar.getAges().map(age => age.id), ["open"]);
    assert.equal(asPlayer.store.readPrivate(), null);
  });

  it("move back into the world setting when unhidden", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();

    await calendar.saveData(calendarWithAges());
    const revealed = calendar.getAges().map(age => ({ ...age, playerVisible: true }));
    await calendar.saveData({ ...calendar.getData(), ages: revealed });

    const stored = harness.settings.get(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`);
    assert.deepEqual(stored.ages.map(age => age.id).sort(), ["open", "secret"]);
  });

  it("survive a campaign date change, which rewrites the same setting", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();
    await calendar.saveData(calendarWithAges());

    await calendar.setCurrentDateTime({ year: 5, month: 2, day: 3 }, { hour: 7, minute: 0 });

    // Still hidden from the setting, and still present for the GM.
    const stored = harness.settings.get(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`);
    assert.deepEqual(stored.ages.map(age => age.id), ["open"]);
    assert.deepEqual(calendar.getAges().map(age => age.id).sort(), ["open", "secret"]);
  });
});

describe("GM-only events", () => {
  const secret = {
    dateKey: "0001-01-05",
    title: "The betrayal",
    description: "Lord Varen takes the coin.",
    visibility: VISIBILITY.GM_ONLY
  };
  const shared = {
    dateKey: "0001-01-06",
    title: "The festival",
    description: "Everyone is invited.",
    visibility: VISIBILITY.PLAYERS
  };

  it("are kept out of the world setting", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));

    await timeline.createEvent(secret);
    await timeline.createEvent(shared);

    const stored = harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`);
    assert.deepEqual(stored.map(event => event.title), ["The festival"]);
    assert.equal(JSON.stringify(stored).includes("takes the coin"), false);
  });

  it("are still listed for the GM", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));

    await timeline.createEvent(secret);
    await timeline.createEvent(shared);

    assert.deepEqual(timeline.getEvents().map(event => event.title).sort(), ["The betrayal", "The festival"]);
  });

  it("never reach a player's client at all", async () => {
    harness = installJournalWorld({ isGM: true });
    const asGM = await loadServices();
    await asGM.calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    await asGM.timeline.createEvent(secret);
    await asGM.timeline.createEvent(shared);

    const entries = harness.allEntries();
    const settings = new Map(harness.settings);
    harness.restore();

    harness = installJournalWorld({ isGM: false, userId: "player1" });
    harness.entries.push(...entries);
    for (const [key, value] of settings) harness.settings.set(key, value);
    const asPlayer = await loadServices();

    assert.deepEqual(asPlayer.timeline.getEvents().map(event => event.title), ["The festival"]);
    assert.deepEqual(asPlayer.timeline.getVisibleEvents().map(event => event.title), ["The festival"]);
  });

  it("move between the stores when their visibility changes", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));

    const event = await timeline.createEvent(secret);
    await timeline.updateEvent(event.id, { visibility: VISIBILITY.PLAYERS });

    const stored = harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`);
    assert.deepEqual(stored.map(candidate => candidate.title), ["The betrayal"]);

    // And back again, without leaving a copy behind in the shared setting.
    await timeline.updateEvent(event.id, { visibility: VISIBILITY.GM_ONLY });
    assert.deepEqual(harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`), []);
    assert.equal(timeline.getEvents().length, 1);
  });

  it("are deleted from the store they actually live in", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));

    const event = await timeline.createEvent(secret);
    assert.equal(await timeline.deleteEvent(event.id), true);
    assert.deepEqual(timeline.getEvents(), []);
  });
});

describe("the schema 5 migration", () => {
  it("lifts hidden content out of the world settings it used to sit in", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline, store } = await loadServices();

    // A world as an earlier version left it: everything in world settings.
    harness.settings.set(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`, {
      ...calendarWithAges(),
      schemaVersion: 4
    });
    harness.settings.set(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`, [
      { id: "e1", dateKey: "0001-01-05", title: "The betrayal", visibility: VISIBILITY.GM_ONLY },
      { id: "e2", dateKey: "0001-01-06", title: "The festival", visibility: VISIBILITY.PLAYERS }
    ]);

    assert.equal(await calendar.runMigrationIfNeeded(), true);

    const storedCalendar = harness.settings.get(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`);
    const storedEvents = harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`);
    assert.deepEqual(storedCalendar.ages.map(age => age.id), ["open"]);
    assert.deepEqual(storedEvents.map(event => event.title), ["The festival"]);

    // And nothing was lost: the GM still sees all of it.
    assert.deepEqual(store.readPrivate().ages.map(age => age.id), ["secret"]);
    assert.deepEqual(timeline.getEvents().map(event => event.title).sort(), ["The betrayal", "The festival"]);
  });

  it("is safe to run twice", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, store } = await loadServices();
    harness.settings.set(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`, {
      ...calendarWithAges(),
      schemaVersion: 4
    });

    await calendar.runMigrationIfNeeded();
    const first = structuredClone(store.readPrivate());
    // The second call finds the data already current and does nothing.
    assert.equal(await calendar.runMigrationIfNeeded(), false);
    assert.deepEqual(store.readPrivate(), first);
  });

  it("does not run for a player", async () => {
    harness = installJournalWorld({ isGM: false, userId: "player1" });
    const { calendar } = await loadServices();
    harness.settings.set(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`, {
      ...calendarWithAges(),
      schemaVersion: 4
    });
    assert.equal(await calendar.runMigrationIfNeeded(), false);
  });
});

describe("promoted notes", () => {
  const note = (isGMNote) => ({
    uuid: "JournalEntry.x.JournalEntryPage.y",
    dateKey: "0001-01-07",
    title: "We burned the bridge",
    content: "<p>No going back now.</p>",
    isGMNote
  });

  async function promote(noteView, options) {
    harness = installJournalWorld({ isGM: true });
    const previousFromUuid = globalThis.fromUuid;
    // The source page itself is not under test; linking simply finds nothing.
    globalThis.fromUuid = async () => null;
    try {
      const { calendar, timeline } = await loadServices();
      await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
      return await timeline.promoteNote(noteView, options);
    } finally {
      globalThis.fromUuid = previousFromUuid;
    }
  }

  it("become player-visible when a player wrote the note, whatever was asked", async () => {
    const event = await promote(note(false), { visibility: VISIBILITY.GM_ONLY });

    assert.equal(event.visibility, VISIBILITY.PLAYERS);
    const stored = harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`);
    assert.deepEqual(stored.map(candidate => candidate.title), ["We burned the bridge"]);
  });

  it("keep the GM's chosen visibility for a GM's own note", async () => {
    const event = await promote(note(true), { visibility: VISIBILITY.GM_ONLY });

    assert.equal(event.visibility, VISIBILITY.GM_ONLY);
    assert.deepEqual(harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`), []);
  });
});
