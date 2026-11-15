import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, FLAGS, MODULE_ID, SETTINGS, VISIBILITY } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

/** The services under one cache-busting key, so they share their stores. */
async function loadServices() {
  const key = Math.random();
  const [calendar, timeline, journal, note] = await Promise.all([
    import(`../scripts/services/calendar-service.js?t=${key}`),
    import(`../scripts/services/timeline-service.js?t=${key}`),
    import(`../scripts/services/journal-service.js?t=${key}`),
    import(`../scripts/services/note-service.js?t=${key}`)
  ]);
  return { calendar, timeline, journal, note };
}

function worldWithParty() {
  return {
    ...structuredClone(DEFAULT_CALENDAR_DATA),
    parties: [
      { id: "a", name: "North", members: ["pa"], currentDate: { year: 1, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } }
    ],
    activePartyId: "a"
  };
}

const sharedSetting = () => harness.settings.get(`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`);
const entryWith = flag => harness.allEntries().find(entry => entry.getFlag(MODULE_ID, flag));

/**
 * The windows repaint when a document changes that `isCalendarDocument` owns
 * up to, so these are about one question: after a write, is there any document
 * a client hears about that says the timeline moved?
 */
describe("documents the open windows repaint for", () => {
  it("include the GM-only store, the only thing a GM-only event changes", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline, journal } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    const before = JSON.stringify(sharedSetting());

    await timeline.createEvent({ dateKey: "0001-01-07", title: "The traitor", visibility: VISIBILITY.GM_ONLY });

    // The shared setting is rewritten with what it already held, which Foundry
    // discards without telling anyone; the store entry is the whole signal.
    assert.equal(JSON.stringify(sharedSetting()), before);
    const store = entryWith(FLAGS.PRIVATE_ENTRY);
    assert.equal(store.getFlag(MODULE_ID, FLAGS.PRIVATE_DATA).events.length, 1);
    assert.equal(journal.isCalendarDocument(store), true);
  });

  it("include a party's store, the only thing that party's event changes", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, timeline, journal } = await loadServices();
    await calendar.saveData(worldWithParty());
    const before = JSON.stringify(sharedSetting());

    await timeline.createEvent({
      dateKey: "0001-01-05", title: "North found the key", visibility: VISIBILITY.PLAYERS, partyId: "a"
    });

    assert.equal(JSON.stringify(sharedSetting()), before);
    const store = entryWith(FLAGS.PARTY_ENTRY);
    assert.equal(store.getFlag(MODULE_ID, FLAGS.PARTY_DATA).events.length, 1);
    assert.equal(journal.isCalendarDocument(store), true);
  });

  it("include a date entry and its note pages", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, journal, note } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));

    const page = await note.createNote({ dateKey: "0001-01-03", title: "Ambush at the ford" });

    assert.equal(journal.isCalendarDocument(page), true);
    assert.equal(journal.isCalendarDocument(page.parent), true);
  });

  it("leave out journal documents the module does not own", async () => {
    harness = installJournalWorld({ isGM: true });
    const { journal } = await loadServices();

    const entry = await JournalEntry.create({ name: "Session recap", folder: "folder1" });
    const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{ name: "Recap" }]);

    assert.equal(journal.isCalendarDocument(entry), false);
    assert.equal(journal.isCalendarDocument(page), false);
    assert.equal(journal.isCalendarDocument(null), false);
    assert.equal(journal.isCalendarDocument({ documentName: "Actor", getFlag: () => true }), false);
  });
});
