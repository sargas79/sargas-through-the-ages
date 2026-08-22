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

class StubEntry {
  constructor(world, { id, name, folder = null, ownership = {}, flags = {} }) {
    this.world = world;
    this.id = id;
    this.name = name;
    this.folder = folder ? { id: folder } : null;
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

  async update(changes) {
    if (changes.ownership) this.ownership = changes.ownership;
    if (changes.folder) this.folder = { id: changes.folder };
    return this;
  }

  /** Whether a user would receive this document at all. */
  visibleTo(user) {
    if (user.isGM) return true;
    return (this.ownership[user.id] ?? this.ownership.default ?? LEVELS.NONE) > LEVELS.NONE;
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

  const world = { entries, settings };

  return {
    entries,
    settings,
    user,
    /** Every entry in the world, including ones this client cannot see. */
    allEntries: () => entries,
    restore() {
      globalThis.game = previous.game;
      globalThis.ui = previous.ui;
      globalThis.Hooks = previous.Hooks;
      globalThis.foundry = previous.foundry;
      globalThis.CONST = previous.CONST;
      globalThis.JournalEntry = previous.JournalEntry;
    }
  };
}
