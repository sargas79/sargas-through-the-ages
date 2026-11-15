/**
 * Storage for the parts of the calendar that belong to one party.
 *
 * ## Why this exists
 *
 * A world setting is delivered in full to every connected client, so an event
 * that only one party should see cannot live in one: the other party's players
 * would have it on their machines whatever the interface showed them. Document
 * ownership is what Foundry does enforce, and this module already stores its
 * GM-only content that way (see `private-store-service.js`). Party content is
 * stored the same way: one JournalEntry per party in the managed folder, owned
 * by nobody by default and granted to the party's members, carrying the
 * party's records in its flags.
 *
 * ## Reading it
 *
 * `readParty` returns `null` when the entry is not there to read, which for a
 * player outside the party is always, because the document never reaches them.
 * For a GM it is null only before the entry has been created. A client merges
 * whatever `readAllParties` can see, so each client's event list simply lacks
 * the parties it is not in rather than having them and declining to draw them.
 */

import { log, t } from "../compat.js";
import { FLAGS, MODULE_ID, PARTY_ENTRY_NAME, VISIBILITY } from "../constants.js";
import { ensureFolder, getAllNotePages, managedFirst, mergeRecords } from "./journal-service.js";
import { isGM, ownershipForVisibility } from "./permission-service.js";

/**
 * Every store entry of every party this client can see, keyed by party id, the
 * one in the managed folder first.
 *
 * A party is meant to have one. They are looked for by their flag rather than
 * by where they sit, for the reason given in `private-store-service.js`: an
 * entry dragged out of the folder, or left behind when the folder was deleted,
 * used to vanish, and the next save started a second one beside it.
 * @returns {Map<string, object[]>}
 */
function getPartyEntryGroups() {
  const groups = new Map();
  if (!game.journal) return groups;
  const flagged = game.journal.filter(entry => !!entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY));
  for (const entry of managedFirst(flagged)) {
    const partyId = entry.getFlag(MODULE_ID, FLAGS.PARTY_ENTRY);
    if (!groups.has(partyId)) groups.set(partyId, []);
    groups.get(partyId).push(entry);
  }
  return groups;
}

/** Every entry holding one party's store. */
function entriesOf(partyId) {
  return getPartyEntryGroups().get(partyId) ?? [];
}

/** The store entry each party is written to, keyed by party id. */
export function getPartyEntries() {
  const entries = new Map();
  for (const [partyId, group] of getPartyEntryGroups()) entries.set(partyId, group[0]);
  return entries;
}

/** One party's store entry, or null when it does not exist or is not readable here. */
export function getPartyEntry(partyId) {
  if (!partyId) return null;
  return entriesOf(partyId)[0] ?? null;
}

function payloadOf(entry) {
  const payload = entry.getFlag(MODULE_ID, FLAGS.PARTY_DATA) ?? {};
  return { events: Array.isArray(payload.events) ? payload.events : [] };
}

/** What a party's entries hold between them, as one payload. */
function mergedPayload(group) {
  return { events: mergeRecords(group.map(entry => payloadOf(entry).events)) };
}

/**
 * One party's records, or null when its store cannot be read.
 * @returns {{events:Array}|null}
 */
export function readParty(partyId) {
  const group = partyId ? entriesOf(partyId) : [];
  return group.length ? mergedPayload(group) : null;
}

/**
 * The records of every party this client can read, keyed by party id.
 * @returns {Map<string, {events:Array}>}
 */
export function readAllParties() {
  const all = new Map();
  for (const [partyId, group] of getPartyEntryGroups()) all.set(partyId, mergedPayload(group));
  return all;
}

/** The name a party's entry carries in the sidebar. */
function entryName(party) {
  return PARTY_ENTRY_NAME.replace("{name}", party.name);
}

/**
 * The ownership a party's entry must have: nothing by default, observer for
 * each member. GM accounts always see it through their role.
 */
export function partyOwnership(party) {
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const ownership = { default: LEVELS.NONE };
  for (const userId of party.members ?? []) ownership[userId] = LEVELS.OBSERVER;
  return ownership;
}

function sameOwnership(a, b) {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  return keysA.length === keysB.length && keysA.every((key, i) => key === keysB[i] && a[key] === b[key]);
}

/**
 * Return a party's entry, creating it when necessary. GM only.
 *
 * Needs the party record rather than just its id, for the name and the members.
 */
export async function ensurePartyEntry(party) {
  if (!party?.id) return null;
  const existing = getPartyEntry(party.id);
  if (existing) return existing;
  if (!isGM()) return null;

  const folder = await ensureFolder();
  const entry = await JournalEntry.create({
    name: entryName(party),
    folder: folder?.id ?? null,
    ownership: partyOwnership(party),
    flags: {
      [MODULE_ID]: {
        [FLAGS.PARTY_ENTRY]: party.id,
        [FLAGS.PARTY_DATA]: { events: [] }
      }
    }
  });
  log("info", `Created the store for party ${party.name}`);
  return entry;
}

/**
 * Replace a party's records. GM only.
 *
 * The whole payload is written at once because it is read at once. Any other
 * entry holding this party's store is emptied, since what it held was read
 * into the payload being written.
 */
export async function writeParty(party, { events = [] } = {}) {
  if (!isGM()) throw new Error(t("TTA.Errors.GMOnly"));
  const entry = await ensurePartyEntry(party);
  if (!entry) throw new Error(t("TTA.Errors.NoFolder"));
  await entry.setFlag(MODULE_ID, FLAGS.PARTY_DATA, { events });
  for (const other of entriesOf(party.id)) {
    if (other.id === entry.id || !payloadOf(other).events.length) continue;
    await other.setFlag(MODULE_ID, FLAGS.PARTY_DATA, { events: [] });
  }
  return { events };
}

/**
 * Bring every party store that has ended up in several entries back to one.
 * GM only.
 *
 * What a party's entries hold is written into the first and the rest, empty by
 * then, are deleted. Part of the repair a GM asks for by name.
 * @returns {number} how many extra entries were removed
 */
export async function consolidatePartyStores(parties = []) {
  if (!isGM()) return 0;
  let removed = 0;
  for (const party of parties) {
    const [keep, ...extras] = entriesOf(party.id);
    if (!keep || !extras.length) continue;
    await writeParty(party, readParty(party.id));
    for (const extra of extras) await extra.delete();
    removed += extras.length;
  }
  if (removed) log("warn", `${removed} duplicate party stores were merged into their party's entry`);
  return removed;
}

/**
 * Bring a party's entry into line with its record: exactly its members may
 * read it, and it carries the party's current name. GM only.
 *
 * Called after every configuration save, so a player moved between parties
 * loses one store and gains the other on the same save that moved them.
 * @returns {boolean} whether anything was changed
 */
export async function syncPartyEntry(party) {
  if (!isGM() || !party?.id) return false;
  const entry = await ensurePartyEntry(party);
  if (!entry) return false;

  const pagesChanged = await syncPartyNotePages(party);

  // Every entry holding this party's store, not only the one written to: a
  // stray copy that kept its old ownership would go on being delivered to a
  // player who has since left the party.
  const wanted = partyOwnership(party);
  let entriesChanged = 0;
  for (const held of entriesOf(party.id)) {
    const changes = {};
    if (!sameOwnership(held.ownership ?? {}, wanted)) changes.ownership = wanted;
    if (held.name !== entryName(party)) changes.name = entryName(party);
    if (!Object.keys(changes).length) continue;
    await held.update(changes);
    log("debug", `Updated the store for party ${party.name}`, changes);
    entriesChanged += 1;
  }
  return entriesChanged > 0 || pagesChanged > 0;
}

/**
 * Bring every note shared with a party into line with its members. GM only.
 *
 * A party note's page is delivered on its own ownership, which named the
 * members as they were when it was written. Membership changes here, so the
 * pages are brought along: a player who leaves the party stops receiving its
 * notes, one who joins starts to.
 * @returns {number} how many pages were changed
 */
export async function syncPartyNotePages(party) {
  if (!isGM() || !party?.id) return 0;
  const byEntry = new Map();
  for (const { page, flags, entry } of getAllNotePages()) {
    if (flags.visibility !== VISIBILITY.PARTY || flags.partyId !== party.id) continue;
    const wanted = ownershipForVisibility(VISIBILITY.PARTY, flags.authorId, party.members);
    if (sameOwnership(page.ownership ?? {}, wanted)) continue;
    if (!byEntry.has(entry)) byEntry.set(entry, []);
    byEntry.get(entry).push({ _id: page.id, ownership: wanted });
  }
  let changed = 0;
  for (const [entry, updates] of byEntry) {
    await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
    changed += updates.length;
  }
  if (changed) log("debug", `Updated ${changed} party note pages for ${party.name}`);
  return changed;
}

/** Sync every party's entry. GM only. */
export async function syncPartyEntries(parties = []) {
  let changed = 0;
  for (const party of parties) {
    if (await syncPartyEntry(party)) changed += 1;
  }
  return changed;
}

/**
 * Remove a party's entry and everything in it. GM only.
 *
 * Only the configuration window calls this, after the party's content has
 * been moved or the GM has agreed to lose it.
 */
export async function deletePartyEntry(partyId) {
  if (!isGM()) return false;
  const group = partyId ? entriesOf(partyId) : [];
  if (!group.length) return false;
  for (const entry of group) await entry.delete();
  log("info", `Deleted the store for party ${partyId}`);
  return true;
}

/**
 * Re-apply the ownership that keeps each party's store to its members.
 *
 * A GM can change any document's permissions from the sidebar, and a party
 * entry looks like an ordinary journal entry when they do. The repair path
 * resets every entry whose ownership has drifted, and reports how many.
 */
export async function repairPartyOwnership(parties = []) {
  if (!isGM()) return 0;
  let repaired = 0;
  for (const party of parties) {
    const wanted = partyOwnership(party);
    for (const entry of entriesOf(party.id)) {
      if (sameOwnership(entry.ownership ?? {}, wanted)) continue;
      await entry.update({ ownership: wanted });
      repaired += 1;
    }
  }
  if (repaired) log("warn", `${repaired} party stores had been shared; their ownership was reset`);
  return repaired;
}
