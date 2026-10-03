/**
 * Shared constants for the Through the Ages module.
 * This file must stay free of Foundry globals so the pure services that import
 * it can be unit tested outside of a Foundry runtime.
 */

export const MODULE_ID = "sargas-through-the-ages";
export const MODULE_TITLE = "Through the Ages";
export const SCHEMA_VERSION = 5;

export const NOTES_FOLDER_NAME = "Calendar Notes";

/**
 * The GM-only entry inside the notes folder. It holds hidden Ages and GM-only
 * timeline events, which used to sit in world settings where every client could
 * read them. See `private-store-service.js`.
 */
export const PRIVATE_ENTRY_NAME = "Calendar (GM only)";

/** World and client setting keys. */
export const SETTINGS = {
  CALENDAR_DATA: "calendarData",
  TIMELINE_EVENTS: "timelineEvents",
  NOTES_FOLDER_ID: "notesFolderId",
  CONFIGURED: "calendarConfigured",
  PLAYER_NOTE_CREATION: "playerNoteCreation",
  PLAYER_NOTE_SCOPE: "playerNoteScope",
  SHOW_TIMELINE_TO_PLAYERS: "showTimelineToPlayers",
  TIMELINE_MODE: "defaultTimelineMode",
  DEBUG: "debugLogging",
  SCHEMA_VERSION: "schemaVersion",
  WORLD_TIME: "synchronizedWorldTime"
};

/** Flag keys written under `flags.sargas-through-the-ages`. */
export const FLAGS = {
  NOTE: "note",
  ENTRY: "entry",
  /** Relay traffic, written on the requesting user's own User document. */
  REQUESTS: "requests",
  RESPONSES: "responses",
  RELAY_PROBE: "relayProbe",
  /** Marks the GM-only entry, and carries its payload. */
  PRIVATE_ENTRY: "privateStore",
  PRIVATE_DATA: "privateData"
};

/** Note visibility classifications. */
export const VISIBILITY = {
  GM_ONLY: "gm-only",
  AUTHOR_AND_GM: "author-and-gm",
  PLAYERS: "players"
};

/** Calendar scope of a note. */
export const SCOPE = {
  DAY: "day",
  MONTH: "month"
};

/** Which note scopes players are allowed to create. */
export const PLAYER_SCOPE = {
  DAY: "day",
  MONTH: "month",
  BOTH: "both"
};

/** Timeline display densities. */
export const TIMELINE_MODE = {
  EXPANDED: "expanded",
  YEAR: "year",
  MONTH: "month"
};

/** Origin of a timeline event. */
export const EVENT_SOURCE = {
  MANUAL: "manual",
  PROMOTED: "promoted"
};

/** Operations relayed to an active GM for execution. */
export const RELAY_OPS = {
  CREATE_NOTE: "createNote",
  UPDATE_NOTE: "updateNote",
  DELETE_NOTE: "deleteNote"
};

/**
 * Bounds on relayed traffic. Every relayed request is a document write made by
 * the GM's client, so one player without a limit can keep it busy and fill the
 * world database. Generous enough that ordinary note-taking never meets it.
 */
export const RELAY_LIMITS = {
  WINDOW_MS: 60000,
  MAX_PER_WINDOW: 30
};

/** Configuration bounds enforced by the validation service. */
export const LIMITS = {
  MONTHS_MIN: 1,
  MONTHS_MAX: 24,
  DAYS_MIN: 1,
  DAYS_MAX: 100,
  WEEKDAYS_MIN: 1,
  WEEKDAYS_MAX: 14,
  YEAR_MIN: 1,
  AGE_DURATION_MIN: 1,
  /**
   * Ages are drawn as a band and a row of ticks, and the timeline used to build
   * one array entry per year to do it, so a duration of a few million years was
   * enough to hang every client that opened the window. The rendering no longer
   * scales with the span, but a duration this far past any published setting's
   * history is a mistake or an attack rather than a campaign, and it is cheaper
   * to refuse it than to reason about every consumer downstream.
   */
  AGE_DURATION_MAX: 100000,
  /**
   * Note bounds. A relayed write carries whatever the requesting client sent,
   * so these are what stop one player filling the world database.
   */
  NOTE_TITLE_MAX: 200,
  NOTE_CONTENT_MAX: 100000,
  MOONS_MAX: 12,
  MOON_CYCLE_MIN: 2,
  MOON_CYCLE_MAX: 1000,
  YEAR_AFFIX_MAX: 12
};

/**
 * Decimal places kept on a moon's cycle length. Real cycles are rarely whole
 * days — Selune runs 30.45 and Earth's moon 29.53 — and rounding them to whole
 * days would visibly drift a campaign's phases within a few years.
 */
export const MOON_CYCLE_DECIMALS = 4;

/** Named phase counts a moon may be divided into. */
export const MOON_PHASE_COUNTS = [2, 4, 8];

/** Default number of named phases for a newly added moon. */
export const DEFAULT_MOON_PHASE_COUNT = 8;

/**
 * Phase name keys, ordered from new moon through the full cycle. The 2- and
 * 4-phase sets are strict subsets, so every moon uses the same vocabulary.
 */
export const MOON_PHASE_KEYS = {
  2: ["New", "Full"],
  4: ["New", "FirstQuarter", "Full", "LastQuarter"],
  8: [
    "New", "WaxingCrescent", "FirstQuarter", "WaxingGibbous",
    "Full", "WaningGibbous", "LastQuarter", "WaningCrescent"
  ]
};

/** Fallback labels used when generating or padding name lists. */
export const DEFAULT_MONTH_NAMES = [
  "Firstfall", "Deepwinter", "Thawtide", "Dawnmarch", "Emberwake", "Highsun",
  "Goldreap", "Duskfall", "Stormhold", "Ashfen", "Longnight", "Yearsend"
];

export const DEFAULT_WEEKDAY_NAMES = [
  "Moonday", "Towerday", "Starday", "Forgeday", "Riverday", "Sunday", "Restday"
];

/**
 * The calendar payload written on first configuration.
 *
 * `daysPerMonth` is the uniform default: it seeds new months and stands in
 * whenever `monthLengths` is missing an entry. `monthLengths` is the
 * authoritative per-month length, which is what lets a calendar mix ordinary
 * months with short festival periods such as Harptos' Midwinter.
 */
export const DEFAULT_CALENDAR_DATA = {
  schemaVersion: SCHEMA_VERSION,
  calendar: {
    monthsPerYear: 12,
    daysPerMonth: 30,
    monthNames: [...DEFAULT_MONTH_NAMES],
    monthLengths: Array(12).fill(30),
    weekdayNames: [...DEFAULT_WEEKDAY_NAMES],
    weekdayOffset: 0,
    currentDate: { year: 1, month: 1, day: 1 },
    currentTime: { hour: 0, minute: 0 },
    yearPrefix: "",
    yearSuffix: "",
    moons: []
  },
  ages: []
};

/** Default accent colour applied to Ages and events that define none. */
export const DEFAULT_COLOR = "#8f3d2e";

/** Default accent colour applied to moons that define none. */
export const DEFAULT_MOON_COLOR = "#c9d4e8";

/** Fallback names used when adding or normalising moons. */
export const DEFAULT_MOON_NAMES = [
  "Selene", "Verrick", "Ilmara", "Kethis", "Dunmoor", "Ashryn",
  "Torvald", "Nyx", "Calder", "Wisp", "Emberlyn", "Sarrow"
];

/** Envelope identifiers for exported calendar files. */
export const EXPORT_FORMAT = "through-the-ages-calendar";
export const EXPORT_FORMAT_VERSION = 2;
