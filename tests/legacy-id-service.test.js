import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { FLAGS, LEGACY_MODULE_ID, MODULE_ID, SETTINGS } from "../scripts/constants.js";

const salt = () => Math.random();
const loadService = () => import(`../scripts/services/legacy-id-service.js?t=${salt()}`);

let restore = null;

afterEach(() => {
  restore?.();
  restore = null;
});

/** A document with Foundry's update shape, applying flat `-=` deletions too. */
function stubDocument(id, flags = {}, pages = []) {
  return {
    id,
    flags,
    pages,
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) applyUpdate(pages.find(page => page.id === update._id), update);
    }
  };
}

function applyUpdate(document, update) {
  for (const [key, value] of Object.entries(update)) {
    if (key === "_id") continue;
    if (key === "flags") {
      for (const [scope, data] of Object.entries(value)) document.flags[scope] = data;
      continue;
    }
    const match = key.match(/^flags\.([^.]+)\.-=(.+)$/);
    if (match) delete document.flags[match[1]]?.[match[2]];
  }
}

/**
 * A world as an upgraded GM sees it: setting documents and flags under the old
 * id, and whatever 3.0.0 wrote under the new one.
 */
function installWorld({ stored = {}, folders = [], journal = [] } = {}) {
  const documents = Object.entries(stored).map(([key, value]) => ({ key, value }));
  const values = new Map();

  const previous = { game: globalThis.game, Folder: globalThis.Folder, JournalEntry: globalThis.JournalEntry };
  const collectionUpdate = collection => async updates => {
    for (const update of updates) applyUpdate(collection.find(doc => doc.id === update._id), update);
  };

  globalThis.game = {
    user: { isGM: true },
    folders,
    journal,
    settings: {
      storage: new Map([["world", documents]]),
      get: (scope, key) => values.get(`${scope}.${key}`),
      set: async (scope, key, value) => values.set(`${scope}.${key}`, value)
    }
  };
  globalThis.Folder = { updateDocuments: collectionUpdate(folders) };
  globalThis.JournalEntry = { updateDocuments: collectionUpdate(journal) };

  restore = () => Object.assign(globalThis, previous);
  return { values };
}

const legacyKey = key => `${LEGACY_MODULE_ID}.${key}`;
const newKey = key => `${MODULE_ID}.${key}`;

describe("legacy module id migration", () => {
  it("copies old world settings, parsing stored JSON text", async () => {
    const calendar = { schemaVersion: 5, calendar: { monthsPerYear: 10 }, ages: [] };
    const { values } = installWorld({
      stored: {
        [legacyKey(SETTINGS.CALENDAR_DATA)]: JSON.stringify(calendar),
        [legacyKey(SETTINGS.TIMELINE_EVENTS)]: [{ id: "e1" }],
        [legacyKey(SETTINGS.CONFIGURED)]: "true",
        [legacyKey(SETTINGS.NOTES_FOLDER_ID)]: "\"folderA\"",
        [legacyKey(SETTINGS.DEBUG)]: "true"
      }
    });
    const { migrateLegacyModuleId } = await loadService();

    assert.equal(await migrateLegacyModuleId(), true);
    assert.deepEqual(values.get(newKey(SETTINGS.CALENDAR_DATA)), calendar);
    assert.deepEqual(values.get(newKey(SETTINGS.TIMELINE_EVENTS)), [{ id: "e1" }]);
    assert.equal(values.get(newKey(SETTINGS.CONFIGURED)), true);
    assert.equal(values.get(newKey(SETTINGS.NOTES_FOLDER_ID)), "folderA");
    assert.equal(values.has(newKey(SETTINGS.DEBUG)), false);
    assert.equal(values.get(newKey(SETTINGS.LEGACY_ID_MIGRATED)), true);
  });

  it("overrides what 3.0.0 wrote on an unconfigured world", async () => {
    const { values } = installWorld({
      stored: {
        [legacyKey(SETTINGS.NOTES_FOLDER_ID)]: "\"old\"",
        [newKey(SETTINGS.NOTES_FOLDER_ID)]: "\"relinked\""
      }
    });
    const { migrateLegacySettings } = await loadService();

    await migrateLegacySettings();
    assert.equal(values.get(newKey(SETTINGS.NOTES_FOLDER_ID)), "old");
  });

  it("keeps a calendar already configured under the new id", async () => {
    const { values } = installWorld({
      stored: {
        [legacyKey(SETTINGS.CALENDAR_DATA)]: "{\"old\":true}",
        [legacyKey(SETTINGS.TIMELINE_MODE)]: "\"year\"",
        [newKey(SETTINGS.CONFIGURED)]: "true",
        [newKey(SETTINGS.CALENDAR_DATA)]: "{\"new\":true}"
      }
    });
    const { migrateLegacySettings } = await loadService();

    assert.deepEqual(await migrateLegacySettings(), [SETTINGS.TIMELINE_MODE]);
    assert.equal(values.has(newKey(SETTINGS.CALENDAR_DATA)), false);
  });

  it("runs only once unless forced", async () => {
    const { values } = installWorld({ stored: { [legacyKey(SETTINGS.TIMELINE_EVENTS)]: [] } });
    values.set(newKey(SETTINGS.LEGACY_ID_MIGRATED), true);
    const { migrateLegacyModuleId } = await loadService();

    assert.equal(await migrateLegacyModuleId(), false);
    assert.equal(await migrateLegacyModuleId({ force: true }), true);
  });

  it("copies flags onto folders, entries and note pages, keeping the old scope", async () => {
    const page = stubDocument("p1", { [LEGACY_MODULE_ID]: { [FLAGS.NOTE]: { dateKey: "0001-01-01" } } });
    const entry = stubDocument("e1", { [LEGACY_MODULE_ID]: { [FLAGS.ENTRY]: { dateKey: "0001-01-01" } } }, [page]);
    const folder = stubDocument("f1", { [LEGACY_MODULE_ID]: { managed: true } });
    installWorld({ folders: [folder], journal: [entry] });
    const { migrateLegacyFlags } = await loadService();

    assert.deepEqual(await migrateLegacyFlags(), { folders: 1, entries: 1, pages: 1 });
    assert.deepEqual(page.flags[MODULE_ID], page.flags[LEGACY_MODULE_ID]);
    assert.deepEqual(entry.flags[MODULE_ID], entry.flags[LEGACY_MODULE_ID]);
    assert.deepEqual(folder.flags[MODULE_ID], { managed: true });
    assert.deepEqual(await migrateLegacyFlags(), { folders: 0, entries: 0, pages: 0 });
  });

  it("folds a GM-only store created by 3.0.0 into the original", async () => {
    const original = stubDocument("old", {
      [LEGACY_MODULE_ID]: {
        [FLAGS.PRIVATE_ENTRY]: true,
        [FLAGS.PRIVATE_DATA]: { ages: [{ id: "a1" }], events: [{ id: "x1" }] }
      }
    });
    const created = stubDocument("new", {
      [MODULE_ID]: {
        [FLAGS.PRIVATE_ENTRY]: true,
        [FLAGS.PRIVATE_DATA]: { ages: [], events: [{ id: "x2" }] }
      }
    });
    installWorld({ journal: [original, created] });
    const { migrateLegacyFlags } = await loadService();

    await migrateLegacyFlags();
    assert.equal(original.flags[MODULE_ID][FLAGS.PRIVATE_ENTRY], true);
    assert.deepEqual(original.flags[MODULE_ID][FLAGS.PRIVATE_DATA], {
      ages: [{ id: "a1" }],
      events: [{ id: "x1" }, { id: "x2" }]
    });
    assert.equal(created.flags[MODULE_ID][FLAGS.PRIVATE_ENTRY], undefined);
  });
});
