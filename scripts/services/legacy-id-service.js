/**
 * Carry data over from the module's previous id.
 *
 * Until 3.0.0 the module was `through-the-ages`. Foundry keys world settings
 * and document flags by module id, so after the rename every stored calendar,
 * timeline event and note sat under a scope the new id never reads, and an
 * upgraded world opened onto an empty, unconfigured calendar.
 *
 * Nothing here deletes or rewrites the old data: settings are copied, flags are
 * copied alongside the old scope, and a downgrade still finds what it left.
 * The copy runs once per world, recorded by `SETTINGS.LEGACY_ID_MIGRATED`, so
 * old data cannot resurface over later changes.
 *
 * The old scope cannot go through `game.settings.get` or `getFlag`: both refuse
 * an id that is not a registered, active module. The stored documents are read
 * directly instead, which Foundry keeps whether or not the module is active.
 */

import { log } from "../compat.js";
import { FLAGS, LEGACY_MODULE_ID, MODULE_ID, SETTINGS } from "../constants.js";
import { isGM } from "./permission-service.js";

/** World settings that hold campaign data or GM choices worth keeping. */
export const LEGACY_SETTING_KEYS = [
  SETTINGS.CALENDAR_DATA,
  SETTINGS.TIMELINE_EVENTS,
  SETTINGS.NOTES_FOLDER_ID,
  SETTINGS.CONFIGURED,
  SETTINGS.SCHEMA_VERSION,
  SETTINGS.WORLD_TIME,
  SETTINGS.PLAYER_NOTE_CREATION,
  SETTINGS.PLAYER_NOTE_SCOPE,
  SETTINGS.SHOW_TIMELINE_TO_PLAYERS,
  SETTINGS.TIMELINE_MODE
];

/** The stored world Setting documents, keyed by their full `scope.key`. */
function worldSettingDocuments() {
  const storage = game.settings?.storage?.get?.("world");
  const byKey = new Map();
  if (!storage) return byKey;
  for (const setting of storage) byKey.set(setting.key, setting);
  return byKey;
}

/**
 * A stored setting value. Depending on the Foundry version the document holds
 * either the parsed value or its JSON text, so a string is parsed when it can be.
 */
export function parseStoredValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** True when a document carries module flags under the old id but not the new one. */
function needsFlagCopy(document) {
  const flags = document?.flags ?? document?._source?.flags;
  return !!flags?.[LEGACY_MODULE_ID] && !flags?.[MODULE_ID];
}

function legacyFlags(document) {
  const flags = document?.flags ?? document?._source?.flags;
  return structuredClone(flags[LEGACY_MODULE_ID]);
}

/**
 * Copy the old world settings across.
 *
 * When the new id has never been configured, the old values win outright: any
 * new-id values are only what 3.0.0 wrote while starting up on an empty world.
 * Once a GM has configured the calendar under the new id, only settings that
 * were never written under it are filled in.
 *
 * @returns {Promise<string[]>} the keys that were copied
 */
export async function migrateLegacySettings() {
  const stored = worldSettingDocuments();
  const newConfigured = parseStoredValue(stored.get(`${MODULE_ID}.${SETTINGS.CONFIGURED}`)?.value) === true;

  const copied = [];
  for (const key of LEGACY_SETTING_KEYS) {
    const legacy = stored.get(`${LEGACY_MODULE_ID}.${key}`);
    if (!legacy) continue;
    if (newConfigured && stored.has(`${MODULE_ID}.${key}`)) continue;
    await game.settings.set(MODULE_ID, key, parseStoredValue(legacy.value));
    copied.push(key);
  }
  return copied;
}

/**
 * Copy old-scope flags onto folders, journal entries and note pages.
 *
 * A world that already started under 3.0.0 has a second, empty GM-only store
 * created then. Its contents are folded into the old store, which keeps its
 * place, and its marker is removed so only one store is found afterwards.
 *
 * @returns {Promise<{folders:number, entries:number, pages:number}>}
 */
export async function migrateLegacyFlags() {
  const counts = { folders: 0, entries: 0, pages: 0 };

  const folders = (game.folders ?? []).filter(needsFlagCopy);
  if (folders.length) {
    await Folder.updateDocuments(folders.map(folder => ({
      _id: folder.id,
      flags: { [MODULE_ID]: legacyFlags(folder) }
    })));
    counts.folders = folders.length;
  }

  const journal = game.journal ? [...game.journal] : [];
  const newStores = journal.filter(entry => entry.flags?.[MODULE_ID]?.[FLAGS.PRIVATE_ENTRY]);

  const entries = journal.filter(needsFlagCopy);
  if (entries.length) {
    const updates = entries.map(entry => {
      const flags = legacyFlags(entry);
      if (flags[FLAGS.PRIVATE_ENTRY] && newStores.length) {
        flags[FLAGS.PRIVATE_DATA] = mergeStores(flags[FLAGS.PRIVATE_DATA], newStores);
      }
      return { _id: entry.id, flags: { [MODULE_ID]: flags } };
    });
    await JournalEntry.updateDocuments(updates);
    counts.entries = entries.length;

    const legacyStoreMigrated = entries.some(entry => entry.flags?.[LEGACY_MODULE_ID]?.[FLAGS.PRIVATE_ENTRY]);
    if (legacyStoreMigrated && newStores.length) {
      await JournalEntry.updateDocuments(newStores.map(entry => ({
        _id: entry.id,
        [`flags.${MODULE_ID}.-=${FLAGS.PRIVATE_ENTRY}`]: null,
        [`flags.${MODULE_ID}.-=${FLAGS.PRIVATE_DATA}`]: null
      })));
      log("info", `Folded ${newStores.length} GM-only store(s) created under the new module id into the original`);
    }
  }

  for (const entry of journal) {
    const pages = entry.pages ? [...entry.pages].filter(needsFlagCopy) : [];
    if (!pages.length) continue;
    await entry.updateEmbeddedDocuments("JournalEntryPage", pages.map(page => ({
      _id: page.id,
      flags: { [MODULE_ID]: legacyFlags(page) }
    })));
    counts.pages += pages.length;
  }

  return counts;
}

/** The old store's payload with every record from the newer stores added. */
function mergeStores(legacyPayload, newStores) {
  const ages = new Map((legacyPayload?.ages ?? []).map(age => [age.id, age]));
  const events = new Map((legacyPayload?.events ?? []).map(event => [event.id, event]));
  for (const store of newStores) {
    const payload = store.flags[MODULE_ID][FLAGS.PRIVATE_DATA] ?? {};
    for (const age of payload.ages ?? []) ages.set(age.id, age);
    for (const event of payload.events ?? []) events.set(event.id, event);
  }
  return { ages: [...ages.values()], events: [...events.values()] };
}

/**
 * Run the legacy-id migration once per world. GM only.
 *
 * Must run before the schema migration and before the folder and GM-only store
 * are ensured, so those find the copied data rather than creating new copies.
 *
 * @param {{force?:boolean}} [options] `force` runs it again even if recorded as done
 * @returns {Promise<boolean>} whether anything was copied
 */
export async function migrateLegacyModuleId({ force = false } = {}) {
  if (!isGM()) return false;
  if (!force && game.settings.get(MODULE_ID, SETTINGS.LEGACY_ID_MIGRATED) === true) return false;

  const settings = await migrateLegacySettings();
  const flags = await migrateLegacyFlags();
  await game.settings.set(MODULE_ID, SETTINGS.LEGACY_ID_MIGRATED, true);

  const copied = settings.length + flags.folders + flags.entries + flags.pages;
  if (copied) {
    log("info",
      `Copied data from the previous module id "${LEGACY_MODULE_ID}": ${settings.length} settings, `
      + `${flags.folders} folders, ${flags.entries} journal entries, ${flags.pages} note pages`);
  }
  return copied > 0;
}
