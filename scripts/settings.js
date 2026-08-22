/**
 * World and client settings registration.
 *
 * Structured data (months, weekdays, Ages) is deliberately hidden from the
 * standard settings panel and edited through the Calendar Configuration
 * window instead; only simple toggles are exposed inline.
 */

import { log, rerenderModuleApps } from "./compat.js";
import {
  DEFAULT_CALENDAR_DATA,
  MODULE_ID,
  PLAYER_SCOPE,
  SCHEMA_VERSION,
  SETTINGS,
  TIMELINE_MODE
} from "./constants.js";
import { CalendarConfigApp } from "./applications/calendar-config-app.js";

export function registerSettings() {
  // --- Structured data, managed by the configuration window -----------------

  game.settings.register(MODULE_ID, SETTINGS.CALENDAR_DATA, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_CALENDAR_DATA,
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.TIMELINE_EVENTS, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.NOTES_FOLDER_ID, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.CONFIGURED, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.SCHEMA_VERSION, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  // One GM acknowledging a drift clears it for every other GM's window too,
  // which only happens if the change is re-rendered everywhere.
  game.settings.register(MODULE_ID, SETTINGS.WORLD_TIME, {
    scope: "world",
    config: false,
    type: Number,
    default: null,
    onChange: () => rerenderModuleApps()
  });

  // --- GM-facing options ----------------------------------------------------

  game.settings.registerMenu(MODULE_ID, "calendarConfigMenu", {
    name: "TTA.Settings.ConfigMenuName",
    label: "TTA.Settings.ConfigMenuLabel",
    hint: "TTA.Settings.ConfigMenuHint",
    icon: "fa-solid fa-calendar-days",
    type: CalendarConfigApp,
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTINGS.PLAYER_NOTE_CREATION, {
    name: "TTA.Settings.PlayerNotesName",
    hint: "TTA.Settings.PlayerNotesHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.PLAYER_NOTE_SCOPE, {
    name: "TTA.Settings.PlayerNoteScopeName",
    hint: "TTA.Settings.PlayerNoteScopeHint",
    scope: "world",
    config: true,
    type: String,
    default: PLAYER_SCOPE.BOTH,
    choices: {
      [PLAYER_SCOPE.DAY]: "TTA.Settings.ScopeDay",
      [PLAYER_SCOPE.MONTH]: "TTA.Settings.ScopeMonth",
      [PLAYER_SCOPE.BOTH]: "TTA.Settings.ScopeBoth"
    },
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.SHOW_TIMELINE_TO_PLAYERS, {
    name: "TTA.Settings.ShowTimelineName",
    hint: "TTA.Settings.ShowTimelineHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.TIMELINE_MODE, {
    name: "TTA.Settings.TimelineModeName",
    hint: "TTA.Settings.TimelineModeHint",
    scope: "world",
    config: true,
    type: String,
    default: TIMELINE_MODE.EXPANDED,
    choices: {
      [TIMELINE_MODE.EXPANDED]: "TTA.Timeline.ModeExpanded",
      [TIMELINE_MODE.YEAR]: "TTA.Timeline.ModeYear",
      [TIMELINE_MODE.MONTH]: "TTA.Timeline.ModeMonth"
    },
    onChange: () => rerenderModuleApps()
  });

  game.settings.register(MODULE_ID, SETTINGS.DEBUG, {
    name: "TTA.Settings.DebugName",
    hint: "TTA.Settings.DebugHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  log("debug", `Registered settings at schema version ${SCHEMA_VERSION}`);
}
