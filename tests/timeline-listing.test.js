import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, FLAGS, MODULE_ID, VISIBILITY } from "../scripts/constants.js";
import { findListingAge } from "../scripts/services/age-service.js";
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

async function gmWorld(data = structuredClone(DEFAULT_CALENDAR_DATA)) {
  harness = installJournalWorld({ isGM: true });
  const services = await loadServices();
  await services.calendar.saveData(data);
  return services;
}

const DAY = "0001-01-03";
const noteFlags = page => page.getFlag(MODULE_ID, FLAGS.NOTE);
const titles = events => events.map(event => event.title).sort();

describe("a note promoted to the timeline", () => {
  it("can be promoted again once its event is deleted", async () => {
    const { timeline, note } = await gmWorld();
    const page = await note.createNote({ dateKey: DAY, title: "Ambush at the ford" });
    const [view] = note.getNotesForKey(DAY);

    const event = await timeline.promoteNote(view);
    assert.equal(noteFlags(page).timelineEventId, event.id);
    assert.equal(note.getNotesForKey(DAY)[0].promoted, true);
    assert.deepEqual(note.getPromotableNotes(), []);

    assert.equal(await timeline.deleteEvent(event.id), true);

    assert.equal(noteFlags(page).timelineEventId, null);
    assert.equal(note.getNotesForKey(DAY)[0].promoted, false);
    assert.deepEqual(note.getPromotableNotes().map(candidate => candidate.uuid), [page.uuid]);
  });

  it("keeps the link to a newer event when an older one is deleted", async () => {
    const { timeline, note, journal } = await gmWorld();
    const page = await note.createNote({ dateKey: DAY, title: "Ambush at the ford" });
    const [view] = note.getNotesForKey(DAY);
    const first = await timeline.promoteNote(view);
    // The note is promoted a second time; its link now names the second event.
    const second = await timeline.promoteNote(view);
    assert.equal(noteFlags(page).timelineEventId, second.id);

    await timeline.deleteEvent(first.id);

    assert.equal(noteFlags(page).timelineEventId, second.id);
    assert.equal(await journal.unlinkNoteFromEvent(page.uuid, first.id), null);
  });

  it("is not called promoted by a GM when the event it names is gone", async () => {
    const { note } = await gmWorld();
    const page = await note.createNote({ dateKey: DAY, title: "Ambush at the ford", visibility: VISIBILITY.PLAYERS });
    await page.setFlag(MODULE_ID, FLAGS.NOTE, { ...noteFlags(page), timelineEventId: "long-gone" });

    assert.equal(note.getNotesForKey(DAY)[0].promoted, false);
    assert.deepEqual(note.getPromotableNotes().map(candidate => candidate.uuid), [page.uuid]);
    // A player does not hold every event, so a missing id proves nothing to them.
    assert.equal(note.getNotesForKey(DAY, { id: "pa", isGM: false })[0].promoted, true);
  });

  it("survives its event being deleted when the note itself is gone", async () => {
    const { timeline, note } = await gmWorld();
    const page = await note.createNote({ dateKey: DAY, title: "Ambush at the ford" });
    const event = await timeline.promoteNote(note.getNotesForKey(DAY)[0]);
    await note.deleteNote(page.uuid);

    assert.equal(await timeline.deleteEvent(event.id), true);
    assert.deepEqual(timeline.getEvents(), []);
  });
});

describe("whose note it is, for promotion", () => {
  /** A note page written straight to the journal, as a given author. */
  async function noteBy(journal, authorId, visibility) {
    return journal.createNotePage({
      dateKey: DAY, title: "What the envoy carried", content: "<p>Sealed orders.</p>",
      visibility, authorId, authorName: "Someone"
    });
  }

  it("treats a GM-only note as a GM's once its author's account is gone", async () => {
    const { timeline, note, journal } = await gmWorld();
    await noteBy(journal, "deleted-gm", VISIBILITY.GM_ONLY);
    const [view] = note.getNotesForKey(DAY);

    assert.equal(view.authorKnown, false);
    assert.equal(view.isGMNote, true);
    assert.equal(timeline.isPlayerNote(view), false);

    const event = await timeline.promoteNote(view);
    assert.equal(event.visibility, VISIBILITY.GM_ONLY);
  });

  it("leaves the choice to the GM for any note whose author is gone", async () => {
    const { timeline, note, journal } = await gmWorld();
    await noteBy(journal, "deleted-user", VISIBILITY.AUTHOR_AND_GM);
    const [view] = note.getNotesForKey(DAY);

    assert.equal(view.isGMNote, false);
    assert.equal(timeline.isPlayerNote(view), false);
    assert.equal((await timeline.promoteNote(view)).visibility, VISIBILITY.GM_ONLY);
  });

  it("never forces a GM-only note onto the players' timeline", async () => {
    const { timeline } = await gmWorld();
    // The author still exists but is no longer a GM.
    const demoted = { isGMNote: false, authorKnown: true, visibility: VISIBILITY.GM_ONLY };
    assert.equal(timeline.isPlayerNote(demoted), false);
  });

  it("still takes a living player's own note for a player's", async () => {
    const { timeline } = await gmWorld();
    assert.equal(timeline.isPlayerNote({ isGMNote: false, authorKnown: true, visibility: VISIBILITY.AUTHOR_AND_GM }), true);
    assert.equal(timeline.isPlayerNote({ isGMNote: false, authorKnown: true, visibility: VISIBILITY.PARTY }), true);
    assert.equal(timeline.isPlayerNote({ isGMNote: true, authorKnown: true, visibility: VISIBILITY.PLAYERS }), false);
    assert.equal(timeline.isPlayerNote(null), false);
  });
});

describe("the Age a year is listed with", () => {
  const age = (id, startYear, durationYears) => ({ id, startYear, durationYears });
  // 1-100, then a gap, then 151-200.
  const ages = [age("second", 151, 50), age("first", 1, 100)];

  it("is the Age containing it", () => {
    assert.equal(findListingAge(ages, 1).id, "first");
    assert.equal(findListingAge(ages, 100).id, "first");
    assert.equal(findListingAge(ages, 151).id, "second");
  });

  it("is the Age that ended most recently, for a year no Age covers", () => {
    assert.equal(findListingAge(ages, 101).id, "first");
    assert.equal(findListingAge(ages, 150).id, "first");
    assert.equal(findListingAge(ages, 201).id, "second");
    assert.equal(findListingAge(ages, 5000).id, "second");
  });

  it("is the first Age, for a year before all of them", () => {
    assert.equal(findListingAge([age("late", 40, 10), age("later", 60, 10)], 12).id, "late");
  });

  it("is nothing when there are no Ages", () => {
    assert.equal(findListingAge([], 12), null);
  });
});

describe("events listed while browsing by Age", () => {
  function calendarWithGap() {
    return {
      ...structuredClone(DEFAULT_CALENDAR_DATA),
      ages: [
        { id: "first", name: "The Long Peace", startYear: 1, durationYears: 100, playerVisible: true },
        { id: "second", name: "The Mending", startYear: 151, durationYears: 50, playerVisible: true }
      ]
    };
  }

  async function worldWithEvents() {
    const services = await gmWorld(calendarWithGap());
    for (const [dateKey, title] of [
      ["0050-01-01", "In the first Age"],
      ["0120-01-01", "Between the Ages"],
      ["0160-01-01", "In the second Age"],
      ["0300-01-01", "After the last Age"]
    ]) {
      await services.timeline.createEvent({ dateKey, title, visibility: VISIBILITY.PLAYERS });
    }
    return services;
  }

  it("include the uncovered years that follow the Age", async () => {
    const { calendar, timeline } = await worldWithEvents();
    const ages = calendar.getVisibleAges();
    const [first, second] = ages;

    assert.deepEqual(titles(timeline.getEventsListedWithAge(first, ages)), ["Between the Ages", "In the first Age"]);
    assert.deepEqual(titles(timeline.getEventsListedWithAge(second, ages)), ["After the last Age", "In the second Age"]);
    // The strict query is unchanged: it is what "This Age" filters down to.
    assert.deepEqual(titles(timeline.getEventsForAge(first)), ["In the first Age"]);
  });

  it("pass every event exactly once across the Ages", async () => {
    const { calendar, timeline } = await worldWithEvents();
    const ages = calendar.getVisibleAges();

    const listed = ages.flatMap(age => timeline.getEventsListedWithAge(age, ages));

    assert.equal(listed.length, timeline.getVisibleEvents().length);
    assert.equal(new Set(listed.map(event => event.id)).size, listed.length);
  });
});

describe("the ticks along an Age's spine", () => {
  async function ticksFor(span) {
    const { buildAgeTicks } = await import("../scripts/services/timeline-service.js");
    return buildAgeTicks(span);
  }
  const labels = ticks => ticks.filter(tick => tick.label !== "").map(tick => tick.label);

  it("carry years for an Age that starts in year 1", async () => {
    const ticks = await ticksFor({ startYear: 1, endYear: 100 });

    assert.deepEqual(ticks.map(tick => tick.year).slice(0, 4), [5, 10, 15, 20]);
    assert.deepEqual(labels(ticks), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("stand on round years whatever year the Age starts in", async () => {
    const ticks = await ticksFor({ startYear: 137, endYear: 236 });

    assert.ok(ticks.every(tick => tick.year % 5 === 0));
    assert.deepEqual(labels(ticks), [140, 150, 160, 170, 180, 190, 200, 210, 220, 230]);
  });

  it("stay few, and still labelled, for a very long Age", async () => {
    const ticks = await ticksFor({ startYear: 1, endYear: 3000 });

    assert.equal(ticks.length, 30);
    assert.deepEqual(labels(ticks), [500, 1000, 1500, 2000, 2500, 3000]);
  });

  it("mark and label the current year and each year with an event", async () => {
    const ticks = await ticksFor({ startYear: 1, endYear: 100, eventYears: [7, 7, 42], currentYear: 63 });
    const at = year => ticks.find(tick => tick.year === year);

    assert.deepEqual({ ...at(7) }, { year: 7, position: "6.500", label: 7, hasEvent: true, isCurrent: false });
    assert.equal(at(42).hasEvent, true);
    assert.deepEqual([at(63).label, at(63).isCurrent, at(63).hasEvent], [63, true, false]);
  });

  it("leave out anything dated outside the Age", async () => {
    const ticks = await ticksFor({ startYear: 151, endYear: 200, eventYears: [120, 300, undefined], currentYear: 12 });

    assert.ok(ticks.every(tick => tick.year >= 151 && tick.year <= 200));
    assert.ok(ticks.every(tick => !tick.hasEvent && !tick.isCurrent));
    assert.ok(ticks.every(tick => Number(tick.position) > 0 && Number(tick.position) < 100));
  });

  it("draw nothing for a span that is not one", async () => {
    assert.deepEqual(await ticksFor({ startYear: 10, endYear: 9 }), []);
    assert.deepEqual(await ticksFor({ startYear: undefined, endYear: 9 }), []);
  });
});
