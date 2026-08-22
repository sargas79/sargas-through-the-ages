/**
 * Storage for the parts of the calendar players are not meant to see.
 *
 * ## Why this exists
 *
 * The calendar, its Ages and the timeline events were all kept in world
 * settings, and Foundry delivers every world setting to every connected client.
 * Marking an event GM-only or an Age hidden therefore filtered it out of the
 * interface but not out of the data: a player could read the whole list from
 * the console. The visibility controls promised secrecy and only ever provided
 * tidiness.
 *
 * Document ownership is the mechanism Foundry does enforce, and this module
 * already relies on it for note privacy — a GM-only note page grants nothing by
 * default and never reaches a player's client. GM-only calendar content is
 * stored the same way: one JournalEntry in the managed folder, owned by nobody
 * by default, carrying the hidden records in its flags.
 *
 * ## Reading it
 *
 * `readPrivate` returns `null` when the entry is not there to read, which is a
 * different fact from an entry that is there and empty. For a player it is
 * always null, because the document is never delivered to them. For a GM it is
 * null only before the store has been created. Callers merge nothing in either
 * case, but `saveData` needs to tell the two apart before it splits a payload
 * back up, or a GM saving while the store was unreadable would write the hidden
 * half away.
 */

import { log, t } from "../compat.js";
import { FLAGS, MODULE_ID, PRIVATE_ENTRY_NAME } from "../constants.js";
import { ensureFolder, getFolder } from "./journal-service.js";
import { isGM } from "./permission-service.js";

/** The GM-only entry, or null when it does not exist or is not readable here. */
export function getPrivateEntry() {
  const folder = getFolder();
  if (!folder || !game.journal) return null;
  return game.journal.find(entry =>
    entry.folder?.id === folder.id && entry.getFlag(MODULE_ID, FLAGS.PRIVATE_ENTRY)
  ) ?? null;
}

/** True when the GM-only store exists and this client may read it. */
export function isPrivateStoreReadable() {
  return !!getPrivateEntry();
}

/**
 * The hidden records, or null when the store cannot be read.
 * @returns {{ages:Array, events:Array}|null}
 */
export function readPrivate() {
  const entry = getPrivateEntry();
  if (!entry) return null;
  const payload = entry.getFlag(MODULE_ID, FLAGS.PRIVATE_DATA) ?? {};
  return {
    ages: Array.isArray(payload.ages) ? payload.ages : [],
    events: Array.isArray(payload.events) ? payload.events : []
  };
}

/**
 * Return the GM-only entry, creating it when necessary. GM only.
 *
 * `ownership: { default: NONE }` is the whole point: a document no one owns is
 * one the server does not send to a player's client.
 */
export async function ensurePrivateEntry() {
  const existing = getPrivateEntry();
  if (existing) return existing;
  if (!isGM()) return null;

  const folder = await ensureFolder();
  const entry = await JournalEntry.create({
    name: PRIVATE_ENTRY_NAME,
    folder: folder?.id ?? null,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: {
      [MODULE_ID]: {
        [FLAGS.PRIVATE_ENTRY]: true,
        [FLAGS.PRIVATE_DATA]: { ages: [], events: [] }
      }
    }
  });
  log("info", "Created the GM-only calendar store");
  return entry;
}

/**
 * Replace the hidden records. GM only.
 *
 * The whole payload is written at once because it is read at once: there is no
 * partial state worth the extra round trip.
 */
export async function writePrivate({ ages = [], events = [] } = {}) {
  if (!isGM()) throw new Error(t("TTA.Errors.GMOnly"));
  const entry = await ensurePrivateEntry();
  if (!entry) throw new Error(t("TTA.Errors.NoFolder"));
  await entry.setFlag(MODULE_ID, FLAGS.PRIVATE_DATA, { ages, events });
  return { ages, events };
}

/**
 * Re-apply the ownership that makes the store private.
 *
 * A GM can change any document's permissions from the sidebar, and this entry
 * looks like an ordinary journal entry when they do. The repair path resets it
 * rather than trusting that nobody has.
 */
export async function repairPrivateOwnership() {
  const entry = getPrivateEntry();
  if (!entry || !isGM()) return false;
  const ownership = entry.ownership ?? {};
  const shared = Object.entries(ownership)
    .some(([id, level]) => level > CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
      && (id === "default" || !game.users.get(id)?.isGM));
  if (!shared) return false;

  await entry.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
  log("warn", "The GM-only calendar store had been shared; its ownership was reset");
  return true;
}
