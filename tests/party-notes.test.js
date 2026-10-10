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

async function loadServices() {
  const key = salt();
  const [calendar, note, journal] = await Promise.all([
    import(`../scripts/services/calendar-service.js?t=${key}`),
    import(`../scripts/services/note-service.js?t=${key}`),
    import(`../scripts/services/journal-service.js?t=${key}`)
  ]);
  return { calendar, note, journal };
}

async function reconnectAs(options) {
  const entries = harness.allEntries();
  const settings = new Map(harness.settings);
  harness.restore();
  harness = installJournalWorld(options);
  harness.entries.push(...entries);
  harness.adopt();
  for (const [key, value] of settings) harness.settings.set(key, value);
  return loadServices();
}

function worldWithParties(members = { a: ["pa", "pa2"], b: ["pb"] }) {
  return {
    ...structuredClone(DEFAULT_CALENDAR_DATA),
    parties: [
      { id: "a", name: "North", members: members.a, currentDate: { year: 1, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } },
      { id: "b", name: "South", members: members.b, currentDate: { year: 2, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } }
    ],
    activePartyId: "a"
  };
}

const player = (id, active = true) => ({ id, name: id, isGM: false, active });

async function gmWorld() {
  harness = installJournalWorld({ isGM: true });
  // Players may write notes in this world; the relay tests need that.
  harness.settings.set(`${MODULE_ID}.${SETTINGS.PLAYER_NOTE_CREATION}`, true);
  harness.settings.set(`${MODULE_ID}.${SETTINGS.PLAYER_NOTE_SCOPE}`, "both");
  const services = await loadServices();
  await services.calendar.saveData(worldWithParties());
  return services;
}

describe("party notes written by the GM", () => {
  it("are owned by the author and observed by the members only", async () => {
    const { note } = await gmWorld();
    const page = await note.createNote({ dateKey: "0001-01-05", title: "Camp", visibility: VISIBILITY.PARTY, partyId: "a" });
    assert.deepEqual(page.ownership, { default: 0, pa: 2, pa2: 2, gm1: 3 });
    assert.equal(page.getFlag("sargas-through-the-ages", "note").partyId, "a");
  });

  it("need a party", async () => {
    const { note } = await gmWorld();
    await assert.rejects(note.createNote({ dateKey: "0001-01-05", title: "Camp", visibility: VISIBILITY.PARTY }));
  });

  it("reach a member and never the other party", async () => {
    const { note } = await gmWorld();
    await note.createNote({ dateKey: "0001-01-05", title: "Camp", visibility: VISIBILITY.PARTY, partyId: "a" });
    await note.createNote({ dateKey: "0001-01-05", title: "Everyone", visibility: VISIBILITY.PLAYERS });

    const asNorth = await reconnectAs({ isGM: false, userId: "pa" });
    assert.deepEqual(asNorth.note.getVisibleNotes().map(n => n.title).sort(), ["Camp", "Everyone"]);
    assert.equal(asNorth.note.getVisibleNotes().find(n => n.title === "Camp").visibilityLabel, "TTA.Notes.VisibilityParty");

    const asSouth = await reconnectAs({ isGM: false, userId: "pb" });
    assert.deepEqual(asSouth.note.getVisibleNotes().map(n => n.title), ["Everyone"]);
    // Not merely filtered: the page is not among the ones this client received.
    assert.deepEqual(asSouth.journal.getAllNotePages().map(({ page }) => page.name), ["Everyone"]);
  });

  it("follow a member moved between parties on the save that moves them", async () => {
    const { calendar, note } = await gmWorld();
    const page = await note.createNote({ dateKey: "0001-01-05", title: "Camp", visibility: VISIBILITY.PARTY, partyId: "a" });

    await calendar.saveData(worldWithParties({ a: ["pa2"], b: ["pb", "pa"] }));
    assert.deepEqual(page.ownership, { default: 0, pa2: 2, gm1: 3 });
  });

  it("are moved or opened up when their party is removed", async () => {
    const { calendar, note } = await gmWorld();
    const camp = await note.createNote({ dateKey: "0001-01-05", title: "Camp", visibility: VISIBILITY.PARTY, partyId: "a" });
    const fort = await note.createNote({ dateKey: "0001-01-06", title: "Fort", visibility: VISIBILITY.PARTY, partyId: "a" });
    assert.equal(note.countPartyNotes("a"), 2);

    assert.equal(await note.reassignPartyNotes("a", "b"), 2);
    assert.equal(camp.getFlag("sargas-through-the-ages", "note").partyId, "b");
    assert.deepEqual(camp.ownership, { default: 0, pb: 2, gm1: 3 });

    const data = calendar.getData();
    await calendar.saveData({ ...data, parties: data.parties.filter(party => party.id !== "b") });
    assert.equal(await note.reassignPartyNotes("b", null), 2);
    assert.equal(fort.getFlag("sargas-through-the-ages", "note").visibility, VISIBILITY.PLAYERS);
    assert.deepEqual(fort.ownership, { default: 2 });
  });
});

describe("relayed party notes", () => {
  it("let a player share a new note with their own party, and nothing wider", async () => {
    const { note } = await gmWorld();
    const base = { dateKey: "0001-01-05", scope: "day", title: "Our camp", content: "" };

    const shared = await note.relayCreateNote({ ...base, visibility: VISIBILITY.PARTY }, player("pa"));
    const page = (await fromUuid(shared));
    assert.equal(page.getFlag("sargas-through-the-ages", "note").visibility, VISIBILITY.PARTY);
    assert.equal(page.getFlag("sargas-through-the-ages", "note").partyId, "a");
    // The author owns their note; the other members observe it.
    assert.deepEqual(page.ownership, { default: 0, pa: 3, pa2: 2 });

    await assert.rejects(note.relayCreateNote({ ...base, visibility: VISIBILITY.PARTY, partyId: "b" }, player("pa")));
    await assert.rejects(note.relayCreateNote({ ...base, visibility: VISIBILITY.PLAYERS }, player("pa")));
    await assert.rejects(note.relayCreateNote({ ...base, visibility: VISIBILITY.GM_ONLY }, player("pa")));
    await assert.rejects(note.relayCreateNote({ ...base, visibility: VISIBILITY.PARTY }, player("px")), /NotePartyDenied/);
  });

  it("let a player share and unshare their own existing note", async () => {
    const { note } = await gmWorld();
    const uuid = await note.relayCreateNote({ dateKey: "0001-01-05", scope: "day", title: "Mine", content: "" }, player("pa"));
    const page = await fromUuid(uuid);
    assert.equal(page.getFlag("sargas-through-the-ages", "note").visibility, VISIBILITY.AUTHOR_AND_GM);

    await note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.PARTY }, player("pa"));
    assert.equal(page.getFlag("sargas-through-the-ages", "note").partyId, "a");
    assert.deepEqual(page.ownership, { default: 0, pa: 3, pa2: 2 });

    await note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.AUTHOR_AND_GM }, player("pa"));
    assert.equal(page.getFlag("sargas-through-the-ages", "note").partyId, null);
    assert.deepEqual(page.ownership, { default: 0, pa: 3 });
  });

  it("refuse a player sharing to another party, to all players, or someone else's note", async () => {
    const { note } = await gmWorld();
    const uuid = await note.relayCreateNote({ dateKey: "0001-01-05", scope: "day", title: "Mine", content: "" }, player("pa"));

    await assert.rejects(note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.PARTY, partyId: "b" }, player("pa")), /NotePartyDenied/);
    await assert.rejects(note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.PLAYERS }, player("pa")), /NotePartyDenied/);
    await assert.rejects(note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.GM_ONLY }, player("pa")), /NotePartyDenied/);
    // A fellow member may read the shared note but not change it.
    await note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.PARTY }, player("pa"));
    await assert.rejects(note.relayUpdateNote({ pageUuid: uuid, title: "Theirs" }, player("pa2")), /NoteEditDenied/);
  });

  it("leave a title-only edit alone", async () => {
    const { note } = await gmWorld();
    const uuid = await note.relayCreateNote({ dateKey: "0001-01-05", scope: "day", title: "Mine", content: "" }, player("pa"));
    await note.relayUpdateNote({ pageUuid: uuid, visibility: VISIBILITY.PARTY }, player("pa"));
    await note.relayUpdateNote({ pageUuid: uuid, title: "Renamed" }, player("pa"));
    const page = await fromUuid(uuid);
    assert.equal(page.name, "Renamed");
    assert.equal(page.getFlag("sargas-through-the-ages", "note").visibility, VISIBILITY.PARTY);
  });
});
