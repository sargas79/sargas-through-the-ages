/**
 * The Foundry surface the relay actually touches: users, their flags, and the
 * `updateUser` hook.
 *
 * The relay's whole point is that a request's identity comes from the document
 * it was written on rather than from anything in its payload, so this stub
 * models exactly that: `asUser` says which client is acting, and a flag write
 * only reaches the hook attributed to the user who made it. A test can then
 * write a request onto someone else's document — which is what the old socket
 * transport allowed — and assert that it is ignored.
 */

import { MODULE_ID } from "../../scripts/constants.js";

/** One user document, with the small slice of the Foundry API the relay uses. */
class StubUser {
  constructor(world, { id, name, isGM = false, active = true }) {
    this.world = world;
    this.id = id;
    this.name = name;
    this.isGM = isGM;
    this.active = active;
    this.flags = {};
    /** Set to refuse writes, to model a server that will not accept them. */
    this.readOnly = false;
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    return this.update({ [`flags.${scope}.${key}`]: value });
  }

  async unsetFlag(scope, key) {
    return this.update({ [`flags.${scope}.-=${key}`]: null });
  }

  /**
   * Apply a flat update of dotted paths, the way Foundry's own update does,
   * including the `-=key` form that deletes rather than assigns.
   *
   * `byUserId` is who performed the write, which Foundry reports to the hook
   * and the server is the authority on. It defaults to this document's own
   * owner because that is the only case Foundry permits for a non-GM; a test
   * passes it explicitly to model a GM writing onto someone else's document.
   */
  async update(changes, byUserId = this.id) {
    if (this.readOnly) throw new Error("User update refused");

    const touched = {};
    for (const [path, value] of Object.entries(changes)) {
      const parts = path.split(".");
      if (parts[0] !== "flags") continue;

      let cursor = this.flags;
      const leaf = parts.pop();
      for (const part of parts.slice(1)) {
        cursor[part] ??= {};
        cursor = cursor[part];
      }
      if (leaf.startsWith("-=")) delete cursor[leaf.slice(2)];
      else cursor[leaf] = value;

      // The hook only needs to say which module's flags were touched; the
      // handlers re-read the document for the actual values.
      touched[parts[1]] = true;
    }

    const changed = { flags: Object.fromEntries(Object.keys(touched).map(scope => [scope, {}])) };
    await this.world.fire("updateUser", this, changed, {}, byUserId);
    return this;
  }
}

/**
 * Install a world of users and the hook plumbing the relay listens on.
 *
 * @param {Array<{id:string,name:string,isGM?:boolean,active?:boolean}>} definitions
 * @param {string} actingId the user this client is signed in as
 */
export function installRelayWorld(definitions, actingId) {
  const world = {
    hooks: new Map(),
    async fire(event, ...args) {
      for (const handler of world.hooks.get(event) ?? []) await handler(...args);
    }
  };

  const users = definitions.map(definition => new StubUser(world, definition));
  const byId = new Map(users.map(user => [user.id, user]));

  const collection = users.slice();
  collection.get = id => byId.get(id);

  const previous = {
    game: globalThis.game,
    ui: globalThis.ui,
    Hooks: globalThis.Hooks,
    foundry: globalThis.foundry
  };

  let counter = 0;
  globalThis.foundry = {
    applications: {},
    utils: { randomID: () => `req${++counter}` }
  };
  globalThis.game = {
    user: byId.get(actingId),
    users: collection,
    settings: { get: () => false, set: async () => {} },
    i18n: { localize: key => key, format: key => key }
  };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.Hooks = {
    on: (event, handler) => {
      if (!world.hooks.has(event)) world.hooks.set(event, []);
      world.hooks.get(event).push(handler);
    },
    once: (event, handler) => globalThis.Hooks.on(event, handler),
    callAll: () => {}
  };

  return {
    world,
    users: byId,
    MODULE_ID,
    /** Switch which client this process is standing in for. */
    actAs(id) {
      globalThis.game.user = byId.get(id);
    },
    restore() {
      globalThis.game = previous.game;
      globalThis.ui = previous.ui;
      globalThis.Hooks = previous.Hooks;
      globalThis.foundry = previous.foundry;
    }
  };
}
