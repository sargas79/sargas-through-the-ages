/**
 * The smallest Foundry surface `calendar-service` actually touches.
 *
 * The service reaches for its globals only inside functions, never at import
 * time, so a test can install this before calling in and swap it out after.
 * Everything the stub records is returned, so a test can assert on what the
 * service asked Foundry to do rather than only on what it returned.
 */

import { DEFAULT_CALENDAR_DATA, MODULE_ID, SETTINGS } from "../../scripts/constants.js";

/**
 * Install stub globals for one test.
 * @param {object} [options]
 * @param {boolean} [options.isGM] whether the acting user is a Game Master
 * @param {number} [options.worldTime] the starting Foundry world time
 * @param {object|null} [options.calendarData] stored calendar payload
 * @param {number|null} [options.checkpoint] the module's stored world-time checkpoint
 * @returns {object} handles for asserting and for restoring the previous globals
 */
export function installFoundryStub({
  isGM = true,
  worldTime = 0,
  calendarData = null,
  checkpoint = null
} = {}) {
  const settings = new Map([
    [`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`, calendarData ?? structuredClone(DEFAULT_CALENDAR_DATA)],
    [`${MODULE_ID}.${SETTINGS.WORLD_TIME}`, checkpoint],
    [`${MODULE_ID}.${SETTINGS.CONFIGURED}`, true],
    [`${MODULE_ID}.${SETTINGS.SCHEMA_VERSION}`, 0],
    [`${MODULE_ID}.${SETTINGS.DEBUG}`, false]
  ]);

  const notifications = { warn: [], info: [], error: [] };
  const hooks = [];
  const writes = [];

  const stub = {
    settings,
    notifications,
    hooks,
    /** Every setting write in order, so a test can see what was set and when. */
    writes,
    /** Advance world time the way another module would, behind this module's back. */
    driftWorldTime(seconds) {
      stub.game.time.worldTime += seconds;
    },
    /** The stored calendar payload, for asserting on what was persisted. */
    get storedCalendar() {
      return settings.get(`${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`).calendar;
    },
    /** Replace the stored date the way another client's write would. */
    setStoredDate(date, time) {
      const key = `${MODULE_ID}.${SETTINGS.CALENDAR_DATA}`;
      const data = settings.get(key);
      settings.set(key, {
        ...data,
        calendar: { ...data.calendar, currentDate: date, currentTime: time ?? data.calendar.currentTime }
      });
    }
  };

  stub.game = {
    user: { isGM, name: isGM ? "Test GM" : "Test Player" },
    users: [],
    i18n: {
      localize: key => key,
      format: key => key
    },
    settings: {
      get: (module, key) => settings.get(`${module}.${key}`),
      set: async (module, key, value) => {
        settings.set(`${module}.${key}`, value);
        writes.push({ key, value });
        return value;
      }
    },
    time: {
      worldTime,
      /** Stands in for Foundry's own clock; overridable per test. */
      advance: async seconds => {
        stub.game.time.worldTime += seconds;
        return stub.game.time.worldTime;
      }
    }
  };

  const previous = {
    game: globalThis.game,
    ui: globalThis.ui,
    Hooks: globalThis.Hooks,
    foundry: globalThis.foundry
  };

  globalThis.game = stub.game;
  globalThis.ui = {
    notifications: {
      warn: message => notifications.warn.push(message),
      info: message => notifications.info.push(message),
      error: message => notifications.error.push(message)
    }
  };
  globalThis.Hooks = { callAll: (name, ...args) => hooks.push({ name, args }) };
  // No application instances: `rerenderModuleApps` walks this and returns early.
  globalThis.foundry = { applications: {} };

  stub.restore = () => {
    globalThis.game = previous.game;
    globalThis.ui = previous.ui;
    globalThis.Hooks = previous.Hooks;
    globalThis.foundry = previous.foundry;
  };

  return stub;
}
