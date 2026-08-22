import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { FLAGS, MODULE_ID, VISIBILITY } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

/** Load the store fresh, since it reads globals the harness installs. */
async function loadStore() {
  return import(`../scripts/services/private-store-service.js?t=${Math.random()}`);
}

describe("the GM-only store", () => {
  it("is created with ownership that gives nobody access by default", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();

    const entry = await store.ensurePrivateEntry();
    assert.equal(entry.ownership.default, 0, "default ownership must be NONE");
  });

  it("is created once and then reused", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();

    const first = await store.ensurePrivateEntry();
    const second = await store.ensurePrivateEntry();
    assert.equal(first.id, second.id);
    assert.equal(harness.allEntries().length, 1);
  });

  it("round-trips the records written to it", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();

    await store.writePrivate({
      ages: [{ id: "a1", name: "The Sundering", playerVisible: false }],
      events: [{ id: "e1", title: "A secret", visibility: VISIBILITY.GM_ONLY }]
    });

    const read = store.readPrivate();
    assert.equal(read.ages[0].name, "The Sundering");
    assert.equal(read.events[0].title, "A secret");
  });

  it("reports an empty store as empty rather than as absent", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();
    await store.ensurePrivateEntry();

    assert.deepEqual(store.readPrivate(), { ages: [], events: [] });
    assert.equal(store.isPrivateStoreReadable(), true);
  });

  it("reports an absent store as absent, which is not the same as empty", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();

    assert.equal(store.readPrivate(), null);
    assert.equal(store.isPrivateStoreReadable(), false);
  });
});

describe("what a player receives", () => {
  // This is the whole point of the change. Under the world setting a player
  // held every GM-only record and was merely not shown them.
  it("cannot read the store a GM wrote", async () => {
    harness = installJournalWorld({ isGM: true });
    const asGM = await loadStore();
    await asGM.writePrivate({
      ages: [{ id: "a1", name: "Hidden Age", playerVisible: false }],
      events: [{ id: "e1", title: "The traitor's name", visibility: VISIBILITY.GM_ONLY }]
    });
    const entries = harness.allEntries();
    harness.restore();

    // Same world, a player's client. The entry exists but is not delivered.
    harness = installJournalWorld({ isGM: false, userId: "player1" });
    harness.entries.push(...entries);
    const asPlayer = await loadStore();

    assert.equal(asPlayer.getPrivateEntry(), null);
    assert.equal(asPlayer.readPrivate(), null);
  });

  it("cannot create the store either", async () => {
    harness = installJournalWorld({ isGM: false, userId: "player1" });
    const store = await loadStore();
    assert.equal(await store.ensurePrivateEntry(), null);
  });

  it("cannot write to it", async () => {
    harness = installJournalWorld({ isGM: false, userId: "player1" });
    const store = await loadStore();
    await assert.rejects(() => store.writePrivate({ ages: [], events: [] }), /GMOnly/);
  });
});

describe("ownership repair", () => {
  it("resets the store when it has been shared with everyone", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();
    const entry = await store.ensurePrivateEntry();

    // As if a GM changed the permissions from the journal sidebar.
    await entry.update({ ownership: { default: 2 } });
    assert.equal(await store.repairPrivateOwnership(), true);
    assert.equal(entry.ownership.default, 0);
  });

  it("leaves a correctly owned store alone", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();
    await store.ensurePrivateEntry();
    assert.equal(await store.repairPrivateOwnership(), false);
  });

  it("does nothing when there is no store to repair", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();
    assert.equal(await store.repairPrivateOwnership(), false);
  });
});

describe("the store's marker", () => {
  it("is found by its flag rather than by its name", async () => {
    harness = installJournalWorld({ isGM: true });
    const store = await loadStore();
    const entry = await store.ensurePrivateEntry();

    // Renaming it in the sidebar must not lose it, the same rule the notes
    // folder already follows.
    entry.name = "Something a GM renamed it to";
    assert.equal(store.getPrivateEntry()?.id, entry.id);
    assert.equal(entry.getFlag(MODULE_ID, FLAGS.PRIVATE_ENTRY), true);
  });
});
