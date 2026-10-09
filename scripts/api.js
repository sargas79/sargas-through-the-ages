/**
 * Public module API, exposed as `game.modules.get("sargas-through-the-ages").api`.
 *
 * Only stable, permission-checked operations are surfaced here so that macros
 * and companion modules never have to reach into internals.
 */

import { log, t } from "./compat.js";
import { MODULE_ID } from "./constants.js";
import * as ageService from "./services/age-service.js";
import * as calendarService from "./services/calendar-service.js";
import * as dateService from "./services/date-service.js";
import * as legacyIdService from "./services/legacy-id-service.js";
import * as journalService from "./services/journal-service.js";
import * as moonService from "./services/moon-service.js";
import * as noteService from "./services/note-service.js";
import * as portabilityService from "./services/portability-service.js";
import * as presetService from "./services/preset-service.js";
import * as relayService from "./services/relay-service.js";
import * as timelineService from "./services/timeline-service.js";
import { CalendarApp } from "./applications/calendar-app.js";
import { CalendarConfigApp } from "./applications/calendar-config-app.js";
import { TimelineApp } from "./applications/timeline-app.js";
import { openCalendar } from "./hooks.js";

/**
 * Apply an exported calendar file directly. GM only.
 *
 * The configuration window stages an import for review instead; this entry
 * point exists for macros that know what they are replacing.
 *
 * @param {string} jsonText          the file contents
 * @param {{applyEvents?:boolean}} options
 * @returns {Promise<object|null>} the stored data, or null when refused
 */
async function importCalendar(jsonText, { applyEvents = true } = {}) {
  const parsed = portabilityService.parseImport(jsonText);
  if (!parsed.ok) {
    const message = parsed.errors.map(error => t(`TTA.Validation.${error.code}`, error.data)).join(" ");
    ui.notifications.error(message || t("TTA.Errors.ImportInvalid"));
    return null;
  }
  const saved = await calendarService.saveData(parsed.data);
  if (!saved) return null;
  if (applyEvents && Array.isArray(parsed.events)) await timelineService.replaceEvents(parsed.events);
  ui.notifications.info(t("TTA.Notifications.CalendarImported"));
  return saved;
}

/**
 * Apply a bundled setting calendar directly. GM only.
 *
 * The configuration window stages a preset for review instead; this entry point
 * exists for macros and world-setup scripts that know what they are replacing.
 * Holidays are opt-in for the same reason they are a checkbox in the window:
 * they create journal pages.
 *
 * @param {string} id                          preset identifier
 * @param {{createHolidays?:boolean}} options
 * @returns {Promise<object|null>} the stored data, or null when refused
 */
async function applyPreset(id, { createHolidays = false } = {}) {
  const data = presetService.buildPresetData(id);
  if (!data) {
    ui.notifications.error(t("TTA.Presets.SelectFirst"));
    return null;
  }

  const saved = await calendarService.saveData(data);
  if (!saved) return null;

  if (createHolidays) {
    // The calendar is already saved by this point, so a note that will not write
    // is reported and stepped over rather than thrown back at the caller in a
    // half-applied state.
    let created = 0;
    for (const holiday of presetService.buildPresetHolidays(id)) {
      try {
        if (await noteService.createNote(holiday)) created += 1;
      } catch (error) {
        log("error", "Failed to create a preset holiday note", holiday, error);
      }
    }
    ui.notifications.info(t("TTA.Presets.HolidaysCreated", { count: created }));
  }

  ui.notifications.info(t("TTA.Presets.Loaded", { name: t(presetService.presetKeys(id).label) }));
  return saved;
}

export function buildApi() {
  return {
    // Windows
    openCalendar,
    openTimeline: () => new TimelineApp().render({ force: true }),
    openConfiguration: () => new CalendarConfigApp().render({ force: true }),

    // Calendar state
    getCalendar: calendarService.getCalendar,
    getCurrentDate: calendarService.getCurrentDate,
    getCurrentTime: calendarService.getCurrentTime,
    getCurrentAge: calendarService.getCurrentAge,
    getAges: calendarService.getAges,
    getMoons: calendarService.getMoons,
    getVisibleMoons: calendarService.getVisibleMoons,
    getMoonPhases: calendarService.getMoonPhases,
    formatDate: calendarService.formatDate,
    formatTime: calendarService.formatTime,
    setCurrentDate: calendarService.setCurrentDate,
    setCurrentDateTime: calendarService.setCurrentDateTime,
    advanceDays: calendarService.advanceDays,
    advanceTime: calendarService.advanceTime,
    advanceToNextAdventureDay: calendarService.advanceToNextAdventureDay,
    acknowledgeWorldTime: calendarService.acknowledgeWorldTime,

    // Notes
    getNotesForKey: noteService.getNotesForKey,
    getDayNotes: noteService.getDayNotes,
    getMonthNotes: noteService.getMonthNotes,
    createNote: noteService.createNote,
    updateNote: noteService.updateNote,
    deleteNote: noteService.deleteNote,
    repairNotesFolder: journalService.repairFolder,
    /** Copy data stored under the pre-3.0.0 module id again. GM only. */
    migrateLegacyData: () => legacyIdService.migrateLegacyModuleId({ force: true }),

    // Timeline
    getEvents: timelineService.getVisibleEvents,
    createEvent: timelineService.createEvent,
    updateEvent: timelineService.updateEvent,
    deleteEvent: timelineService.deleteEvent,
    promoteNote: timelineService.promoteNote,

    // Setting presets
    listPresets: () => presetService.PRESET_IDS.map(id => ({
      id,
      label: t(presetService.presetKeys(id).label),
      description: t(presetService.presetKeys(id).description)
    })),
    buildPresetData: presetService.buildPresetData,
    applyPreset,

    // Export and import
    exportCalendar: portabilityService.buildExport,
    downloadCalendarExport: (options = {}) =>
      portabilityService.downloadExport(portabilityService.buildExport(options)),
    parseCalendarImport: portabilityService.parseImport,
    importCalendar: importCalendar,

    // Pure helpers, useful for macros and companion modules
    utils: {
      dayKey: dateService.dayKey,
      monthKey: dateService.monthKey,
      parseKey: dateService.parseKey,
      addDays: dateService.addDays,
      addSeconds: dateService.addSeconds,
      toAbsoluteDay: dateService.toAbsoluteDay,
      fromAbsoluteDay: dateService.fromAbsoluteDay,
      campaignSeconds: dateService.campaignSeconds,
      weekdayName: dateService.weekdayName,
      endYear: ageService.endYear,
      findAgeForYear: ageService.findAgeForYear,
      phaseIndex: moonService.phaseIndex,
      phaseKey: moonService.phaseKey,
      illumination: moonService.illumination,
      daysUntilPhase: moonService.daysUntilPhase
    },

    /** Why a `timeChanged` payload says time moved. */
    TIME_CHANGE_REASON: calendarService.TIME_CHANGE_REASON,

    /**
     * The authenticated GM-executed write relay, for companion modules that
     * need player-initiated writes without a module socket. See
     * relay-service.js for what it guarantees and what it rests on.
     */
    relay: {
      createRelay: relayService.createRelay,
      isPrimaryGM: relayService.isPrimaryGM,
      hasActiveGM: relayService.hasActiveGM
    },

    applications: { CalendarApp, TimelineApp, CalendarConfigApp },
    MODULE_ID
  };
}
