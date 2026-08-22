/**
 * Journal storage for calendar notes.
 *
 * Layout:
 *   Folder "Calendar Notes"
 *   +- JournalEntry "0142-07-12"   (one per date key; "YYYY-MM-00" for months)
 *      +- JournalEntryPage         (one per note, carrying the module flags)
 *
 * The folder is located by its stored id rather than by name, so renaming it in
 * the sidebar does not break the module. Every function here performs document
 * writes and therefore requires GM rights; player requests are relayed to a GM
 * by the socket service.
 */

import { log, t } from "../compat.js";
import { FLAGS, MODULE_ID, NOTES_FOLDER_NAME, SETTINGS } from "../constants.js";
import { compareDateKeys, parseKey } from "./date-service.js";
import { migrateNoteFlags } from "./migration-service.js";
import { isGM, ownershipForVisibility } from "./permission-service.js";

/** The managed folder, or null when it does not exist yet. */
export function getFolder() {
  const id = game.settings.get(MODULE_ID, SETTINGS.NOTES_FOLDER_ID);
  if (!id) return null;
  return game.folders.get(id) ?? null;
}

/**
 * Return the managed folder, creating or re-linking it when necessary.
 * Only a GM can create it; players simply get whatever already exists.
 */
export async function ensureFolder() {
  const existing = getFolder();
  if (existing) return existing;
  if (!isGM()) return null;

  const byName = game.folders.find(f => f.type === "JournalEntry" && f.name === NOTES_FOLDER_NAME);
  if (byName) {
    await game.settings.set(MODULE_ID, SETTINGS.NOTES_FOLDER_ID, byName.id);
    log("info", "Re-linked the existing calendar notes folder");
    return byName;
  }

  const folder = await Folder.create({
    name: NOTES_FOLDER_NAME,
    type: "JournalEntry",
    color: "#8f3d2e",
    flags: { [MODULE_ID]: { managed: true } }
  });
  await game.settings.set(MODULE_ID, SETTINGS.NOTES_FOLDER_ID, folder.id);
  log("info", "Created the calendar notes journal folder");
  return folder;
}

/** All journal entries managed by the module, regardless of date. */
export function getManagedEntries() {
  const folder = getFolder();
  if (!folder) return [];
  return game.journal.filter(entry => entry.folder?.id === folder.id);
}

/** The entry for a canonical date key, or null. */
export function getEntryForKey(dateKey) {
  const folder = getFolder();
  if (!folder) return null;
  return game.journal.find(entry => entry.folder?.id === folder.id && entry.name === dateKey) ?? null;
}

/**
 * Return the entry for a date key, creating it if needed. GM only.
 *
 * The entry is readable by everyone; per-note privacy is enforced on the pages,
 * so a shared date can hold both private and public notes.
 */
export async function ensureEntryForKey(dateKey) {
  const existing = getEntryForKey(dateKey);
  if (existing) return existing;
  if (!isGM()) return null;

  const folder = await ensureFolder();
  return JournalEntry.create({
    name: dateKey,
    folder: folder?.id ?? null,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [FLAGS.ENTRY]: { dateKey, managed: true } } }
  });
}

/** Module flags stored on a page, normalised, or null when it is not a note. */
export function readNoteFlags(page) {
  const raw = page?.getFlag?.(MODULE_ID, FLAGS.NOTE);
  return raw ? migrateNoteFlags(raw) : null;
}

/** Every note page in the managed folder, as `{ page, flags, entry }` records. */
export function getAllNotePages() {
  const notes = [];
  for (const entry of getManagedEntries()) {
    for (const page of entry.pages) {
      const flags = readNoteFlags(page);
      if (flags) notes.push({ page, flags, entry });
    }
  }
  return notes.sort((a, b) => compareDateKeys(a.flags.dateKey, b.flags.dateKey));
}

/** Note pages recorded against one exact date key. */
export function getNotePagesForKey(dateKey) {
  const entry = getEntryForKey(dateKey);
  if (!entry) return [];
  const notes = [];
  for (const page of entry.pages) {
    const flags = readNoteFlags(page);
    if (flags) notes.push({ page, flags, entry });
  }
  return notes;
}

/**
 * Create a note page. GM only - player requests arrive here through the socket
 * relay once the requesting user has been validated.
 */
export async function createNotePage({ dateKey, title, content, visibility, authorId, authorName }) {
  const entry = await ensureEntryForKey(dateKey);
  if (!entry) throw new Error(t("TTA.Errors.NoFolder"));

  const parsed = parseKey(dateKey);
  const now = new Date().toISOString();
  const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
    name: title,
    type: "text",
    text: { content: content ?? "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
    ownership: ownershipForVisibility(visibility, authorId),
    flags: {
      [MODULE_ID]: {
        [FLAGS.NOTE]: {
          dateKey,
          scope: parsed.scope,
          authorId,
          authorName,
          visibility,
          timelineEventId: null,
          createdAt: now,
          updatedAt: now
        }
      }
    }
  }]);
  log("debug", "Created note page", page?.uuid, dateKey);
  return page;
}

/**
 * True when a page is one of ours: a note page inside the managed folder.
 *
 * Carrying the module's flags is not on its own enough to be a calendar note.
 * A write path is reached with a uuid the caller chose, so the page it resolves
 * to has to be confirmed as living where this module's notes live before it is
 * edited or deleted.
 */
export function isManagedNotePage(page) {
  if (!page || !readNoteFlags(page)) return false;
  const folder = getFolder();
  return !!folder && page.parent?.folder?.id === folder.id;
}

/** Apply an update to an existing note page. GM only. */
export async function updateNotePage(pageUuid, { title, content, visibility }) {
  const page = await fromUuid(pageUuid);
  if (!page) throw new Error(t("TTA.Errors.NoteMissing"));
  const flags = readNoteFlags(page);
  if (!flags) throw new Error(t("TTA.Errors.NoteMissing"));
  if (!isManagedNotePage(page)) throw new Error(t("TTA.Errors.NoteNotManaged"));

  const update = { _id: page.id };
  if (title !== undefined) update.name = title;
  if (content !== undefined) {
    update.text = { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML };
  }

  const nextVisibility = visibility ?? flags.visibility;
  if (visibility !== undefined && visibility !== flags.visibility) {
    update.ownership = ownershipForVisibility(nextVisibility, flags.authorId);
  }
  update.flags = {
    [MODULE_ID]: {
      [FLAGS.NOTE]: { ...flags, visibility: nextVisibility, updatedAt: new Date().toISOString() }
    }
  };

  await page.parent.updateEmbeddedDocuments("JournalEntryPage", [update]);
  return page;
}

/** Record the timeline event a note was promoted into. GM only. */
export async function linkNoteToEvent(pageUuid, eventId) {
  const page = await fromUuid(pageUuid);
  if (!page) return null;
  const flags = readNoteFlags(page);
  if (!flags) return null;
  await page.setFlag(MODULE_ID, FLAGS.NOTE, {
    ...flags,
    timelineEventId: eventId,
    updatedAt: new Date().toISOString()
  });
  return page;
}

/**
 * Delete a note page. GM only.
 *
 * The parent date entry is intentionally left in place even when it becomes
 * empty: no journal document is ever removed as a side effect.
 */
export async function deleteNotePage(pageUuid) {
  const page = await fromUuid(pageUuid);
  if (!page) return false;
  if (!isManagedNotePage(page)) throw new Error(t("TTA.Errors.NoteNotManaged"));
  await page.parent.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
  return true;
}

/**
 * Highest month and day numbers referenced by stored notes, used to warn a GM
 * before they shrink the calendar underneath existing content.
 */
export function getDateUsage() {
  let maxMonth = 0;
  let maxDay = 0;
  let count = 0;
  for (const { flags } of getAllNotePages()) {
    const parsed = parseKey(flags.dateKey);
    if (!parsed) continue;
    count += 1;
    maxMonth = Math.max(maxMonth, parsed.month);
    maxDay = Math.max(maxDay, parsed.day);
  }
  return { maxMonth, maxDay, count };
}

/**
 * Administrative repair: re-create or re-link the managed folder and re-home
 * any managed entry that has drifted out of it. GM only.
 */
export async function repairFolder() {
  if (!isGM()) return null;
  const folder = await ensureFolder();
  if (!folder) return null;

  const strays = game.journal.filter(entry =>
    entry.folder?.id !== folder.id && entry.getFlag(MODULE_ID, FLAGS.ENTRY)
  );
  if (strays.length) {
    await JournalEntry.updateDocuments(strays.map(entry => ({ _id: entry.id, folder: folder.id })));
    log("info", `Repaired ${strays.length} calendar note entries`);
  }
  return { folder, repaired: strays.length };
}
