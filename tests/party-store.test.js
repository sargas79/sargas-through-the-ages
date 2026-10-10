import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_CALENDAR_DATA, FLAGS, MODULE_ID } from "../scripts/constants.js";
import { installJournalWorld } from "./helpers/journal-stub.js";

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

const salt = () => Math.random();

/** Load the services as one client, sharing one module instance between them. */
async function loadServices() {
  const key = salt();
  const [calendar, store] = await Promise.all([
    import(`../scripts/services/calendar-service.js?t=${key}`),
    import(`../scripts/services/party-store-service.js?t=${key}`)
  ]);
  return { calendar, store };
}

/** Hand the world a GM built over to another client. */
async function reconnectAs(options) {
  const entries = harness.allEntries();
  const settings = new Map(harness.settings);
  harness.restore();
  harness = installJournalWorld(options);
  harness.entries.push(...entries);
  for (const [key, value] of settings) harness.settings.set(key, value);
  return loadServices();
}

function worldWithParties(members = { a: ["pa"], b: ["pb"] }) {
  return {
    ...structuredClone(DEFAULT_CALENDAR_DATA),
    parties: [
      { id: "a", name: "North", members: members.a, currentDate: { year: 1, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } },
      { id: "b", name: "South", members: members.b, currentDate: { year: 2, month: 1, day: 1 }, currentTime: { hour: 0, minute: 0 } }
    ],
    activePartyId: "a"
  };
}

const partyEntries = () => harness.allEntries().filter(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY));

describe("party stores", () => {
  it("are created for every party when the configuration is saved", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();

    await calendar.saveData(worldWithParties());

    const entries = partyEntries();
    assert.deepEqual(entries.map(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY)).sort(), ["a", "b"]);
    assert.equal(entries.find(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY) === "a").name, "Calendar (party: North)");
  });

  it("are owned by nobody by default and observed by the members", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();
    await calendar.saveData(worldWithParties());

    const north = partyEntries().find(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY) === "a");
    assert.deepEqual(north.ownership, { default: 0, pa: 2 });
  });

  it("are read by a member and not delivered to anyone else", async () => {
    harness = installJournalWorld({ isGM: true });
    const asGM = await loadServices();
    await asGM.calendar.saveData(worldWithParties());
    await asGM.store.writeParty({ id: "a", name: "North", members: ["pa"] }, { events: [{ id: "e1" }] });

    const asMember = await reconnectAs({ isGM: false, userId: "pa" });
    assert.deepEqual(asMember.store.readParty("a"), { events: [{ id: "e1" }] });
    assert.equal(asMember.store.readParty("b"), null);
    assert.deepEqual([...asMember.store.readAllParties().keys()], ["a"]);

    const asOutsider = await reconnectAs({ isGM: false, userId: "pb" });
    assert.equal(asOutsider.store.readParty("a"), null);
    assert.deepEqual([...asOutsider.store.readAllParties().keys()], ["b"]);

    const asNobody = await reconnectAs({ isGM: false, userId: "px" });
    assert.equal(asNobody.store.readParty("a"), null);
    assert.equal(asNobody.store.readAllParties().size, 0);
  });

  it("follow a player who is moved between parties, on the save that moves them", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();
    await calendar.saveData(worldWithParties());

    await calendar.saveData(worldWithParties({ a: [], b: ["pb", "pa"] }));

    const byId = Object.fromEntries(partyEntries().map(entry => [entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY), entry]));
    assert.deepEqual(byId.a.ownership, { default: 0 });
    assert.deepEqual(byId.b.ownership, { default: 0, pb: 2, pa: 2 });
  });

  it("are renamed with the party", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();
    await calendar.saveData(worldWithParties());

    const data = worldWithParties();
    data.parties[0].name = "Northmen";
    await calendar.saveData(data);

    const north = partyEntries().find(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY) === "a");
    assert.equal(north.name, "Calendar (party: Northmen)");
  });

  it("are not created, written or synced by a player", async () => {
    harness = installJournalWorld({ isGM: false, userId: "pa" });
    const { store } = await loadServices();
    const party = { id: "a", name: "North", members: ["pa"] };
    assert.equal(await store.ensurePartyEntry(party), null);
    assert.equal(await store.syncPartyEntry(party), false);
    await assert.rejects(store.writeParty(party, { events: [] }));
    assert.equal(partyEntries().length, 0);
  });

  it("have their ownership reset by the repair path once shared by hand", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, store } = await loadServices();
    await calendar.saveData(worldWithParties());

    const north = partyEntries().find(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY) === "a");
    await north.update({ ownership: { default: 2 } });

    assert.equal(await store.repairPartyOwnership(calendar.getParties()), 1);
    assert.deepEqual(north.ownership, { default: 0, pa: 2 });
    assert.equal(await store.repairPartyOwnership(calendar.getParties()), 0, "nothing left to repair");
  });

  it("can be deleted by a GM once a party is gone", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar, store } = await loadServices();
    await calendar.saveData(worldWithParties());

    assert.equal(await store.deletePartyEntry("b"), true);
    assert.deepEqual(partyEntries().map(entry => entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY)), ["a"]);
    assert.equal(await store.deletePartyEntry("b"), false);
  });

  it("leave a world without parties exactly as it was", async () => {
    harness = installJournalWorld({ isGM: true });
    const { calendar } = await loadServices();
    await calendar.saveData(structuredClone(DEFAULT_CALENDAR_DATA));
    assert.equal(partyEntries().length, 0);
  });
});
