/**
 * The journal surface the GM-only store touches: a folder, entries, and flags.
 *
 * The point being modelled is Foundry's delivery rule, not its API: a document
 * a client has no ownership of never reaches that client at all. So the stub's
 * journal collection filters by ownership on read, and a player looking for the
 * GM-only entry finds nothing — which is exactly the difference between this
 * store and the world setting it replaced.
 */

import { MODULE_ID, SETTINGS } from "../../scripts/constants.js";

const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

/** Whether a user would receive a document with this ownership at all. */
function delivered(ownership, user) {
  if (user.isGM) return true;
  return (ownership[user.id] ?? ownership.default ?? LEVELS.NONE) > LEVELS.NONE;
}

/** One note page: the slice of JournalEntryPage the journal service touches. */
class StubPage {
  constructor(entry, { _id, name, type = "text", text = {}, ownership = {}, flags = {} }) {
    this.parent = entry;
    this.id = _id;
    this.uuid = `JournalEntry.${entry.id}.JournalEntryPage.${_id}`;
    this.name = name;
    this.type = type;
    this.text = text;
    this.ownership = { default: LEVELS.NONE, ...ownership };
    this.flags = flags;
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value;
    return this;
  }

  visibleTo(user) {
    return delivered(this.ownership, user);
  }
}

class StubEntry {
  constructor(world, { id, name, folder = null, ownership = {}, flags = {} }) {
    this.world = world;
    this.id = id;
    this.name = name;
    this.folder = folder ? { id: folder } : null;
    this.ownership = { default: LEVELS.NONE, ...ownership };
    this.flags = flags;
    /** Every page, whoever may see it. */
    this.allPages = [];
  }

  /**
   * The pages this client receives. A page is delivered on its own ownership,
   * which is what the module's note privacy rests on.
   */
  get pages() {
    return this.allPages.filter(page => page.visibleTo(this.world.user));
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value;
    return this;
  }

  async update(changes) {
    if (changes.ownership) this.ownership = changes.ownership;
    if (changes.folder) this.folder = { id: changes.folder };
    if (changes.name) this.name = changes.name;
    return this;
  }

  async delete() {
    const index = this.world.entries.indexOf(this);
    if (index >= 0) this.world.entries.splice(index, 1);
    return this;
  }

  async createEmbeddedDocuments(type, data) {
    return data.map(record => {
      const page = new StubPage(this, { ...record, _id: `page${++this.world.nextPageId}` });
      this.allPages.push(page);
      return page;
    });
  }

  async updateEmbeddedDocuments(type, updates) {
    for (const update of updates) {
      const page = this.allPages.find(candidate => candidate.id === update._id);
      if (!page) continue;
      if (update.name !== undefined) page.name = update.name;
      if (update.text !== undefined) page.text = update.text;
      if (update.ownership !== undefined) page.ownership = update.ownership;
      // Flags merge by module scope, which is as deep as the service writes.
      for (const [scope, value] of Object.entries(update.flags ?? {})) {
        page.flags[scope] = { ...(page.flags[scope] ?? {}), ...value };
      }
    }
    return updates;
  }

  async deleteEmbeddedDocuments(type, ids) {
    this.allPages = this.allPages.filter(page => !ids.includes(page.id));
    return ids;
  }

  /** Whether a user would receive this document at all. */
  visibleTo(user) {
    return delivered(this.ownership, user);
  }
}

/**
 * Install a world with a notes folder and a journal collection.
 * @param {{isGM?:boolean, userId?:string}} options who this client is
 */
export function installJournalWorld({ isGM = true, userId = "gm1" } = {}) {
  const entries = [];
  let nextId = 0;

  const settings = new Map([
    [`${MODULE_ID}.${SETTINGS.NOTES_FOLDER_ID}`, "folder1"],
    [`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`, null],
    [`${MODULE_ID}.${SETTINGS.TIMELINE_EVENTS}`, []],
    [`${MODULE_ID}.${SETTINGS.SCHEMA_VERSION}`, 0],
    [`${MODULE_ID}.${SETTINGS.CONFIGURED}`, true],
    [`${MODULE_ID}.${SETTINGS.DEBUG}`, false]
  ]);

  const user = { id: userId, isGM, name: isGM ? "The GM" : "A Player" };

  const previous = {
    game: globalThis.game,
    ui: globalThis.ui,
    Hooks: globalThis.Hooks,
    foundry: globalThis.foundry,
    CONST: globalThis.CONST,
    JournalEntry: globalThis.JournalEntry
  };

  // Only the documents this client would actually receive.
  const delivered = () => entries.filter(entry => entry.visibleTo(user));

  const journal = {
    find: predicate => delivered().find(predicate) ?? null,
    filter: predicate => delivered().filter(predicate),
    get: id => delivered().find(entry => entry.id === id) ?? null
  };

  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: LEVELS, JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
  globalThis.JournalEntry = {
    create: async data => {
      const entry = new StubEntry(world, { ...data, id: `entry${++nextId}` });
      entries.push(entry);
      return entry;
    }
  };
  globalThis.foundry = { applications: {}, utils: { randomID: () => `id${++nextId}` } };
  globalThis.game = {
    user,
    users: Object.assign([user], { get: id => (id === user.id ? user : null) }),
    journal,
    folders: Object.assign([{ id: "folder1", name: "Calendar Notes", type: "JournalEntry" }], {
      get: id => (id === "folder1" ? { id: "folder1", name: "Calendar Notes", type: "JournalEntry" } : null)
    }),
    settings: {
      get: (scope, key) => settings.get(`${scope}.${key}`),
      set: async (scope, key, value) => settings.set(`${scope}.${key}`, value)
    },
    i18n: { localize: key => key, format: key => key }
  };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };

  const world = { entries, settings, user, nextPageId: 0 };
  // Entries carried over from another client's world keep their own `world`;
  // point them at this one so page delivery follows this client's user.
  const adopt = () => {
    for (const entry of entries) {
      entry.world = world;
      world.nextPageId = Math.max(world.nextPageId, entry.allPages.length);
    }
  };

  // Resolves page and entry uuids the way the service builds them, honouring
  // delivery: a page this client would never receive resolves to null.
  const previousFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => {
    const [, entryId, , pageId] = String(uuid ?? "").split(".");
    const entry = entries.find(candidate => candidate.id === entryId && candidate.visibleTo(user));
    if (!entry) return null;
    if (!pageId) return entry;
    return entry.allPages.find(page => page.id === pageId && page.visibleTo(user)) ?? null;
  };

  return {
    entries,
    settings,
    user,
    world,
    /** Every entry in the world, including ones this client cannot see. */
    allEntries: () => entries,
    /** Every page in the world, including ones this client cannot see. */
    allPages: () => entries.flatMap(entry => entry.allPages),
    /** Call after pushing another world's entries in, so delivery follows this user. */
    adopt,
    restore() {
      globalThis.game = previous.game;
      globalThis.ui = previous.ui;
      globalThis.Hooks = previous.Hooks;
      globalThis.foundry = previous.foundry;
      globalThis.CONST = previous.CONST;
      globalThis.JournalEntry = previous.JournalEntry;
      globalThis.fromUuid = previousFromUuid;
    }
  };
}
