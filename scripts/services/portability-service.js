/**
 * Export and import of the shared calendar as a plain JSON file.
 *
 * The payload covers everything the configuration window owns: the calendar
 * structure, its moons, the Age list, the parties (without their members, who
 * are user ids that mean nothing in another world), and optionally the
 * timeline events. Journal-backed notes are deliberately excluded — they are
 * ordinary `JournalEntryPage` documents that Foundry's own import/export
 * already handles, and duplicating them here would risk orphaned or doubled
 * pages.
 *
 * The pure builders and parsers below take explicit data so they can be unit
 * tested; only `downloadExport` and `readImportFile` touch the browser.
 */

import { log, t } from "../compat.js";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  MODULE_ID,
  SCHEMA_VERSION
} from "../constants.js";
import { getData } from "./calendar-service.js";
import { daysInYear } from "./date-service.js";
import { migrateCalendarData, migrateEvents } from "./migration-service.js";
import { getEvents } from "./timeline-service.js";
import { validateCalendarData } from "./validation-service.js";

/** Build the export envelope from explicit data. Pure. */
export function buildExportPayload({
  calendar,
  ages = [],
  parties = [],
  activePartyId = null,
  events = null,
  moduleVersion = "",
  worldTitle = "",
  exportedAt = new Date().toISOString()
}) {
  const normalized = migrateCalendarData({ calendar, ages, parties, activePartyId });
  const payload = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    module: { id: MODULE_ID, version: moduleVersion },
    world: { title: worldTitle },
    calendar: normalized.calendar,
    ages: normalized.ages
  };
  // Members are this world's user ids; the file carries the parties as groups
  // with a date, and the importing GM assigns their own players.
  if (normalized.parties.length) {
    payload.parties = normalized.parties.map(party => ({ ...party, members: [] }));
    payload.activePartyId = normalized.activePartyId;
  }
  if (Array.isArray(events)) payload.events = migrateEvents(events);
  return payload;
}

/** Build the export envelope from current world state. */
export function buildExport({ includeEvents = true } = {}) {
  const data = getData();
  return buildExportPayload({
    calendar: data.calendar,
    ages: data.ages,
    parties: data.parties,
    activePartyId: data.activePartyId,
    events: includeEvents ? getEvents() : null,
    moduleVersion: game.modules.get(MODULE_ID)?.version ?? "",
    worldTitle: game.world?.title ?? ""
  });
}

/** A filesystem-safe filename for an export, stamped with the world and date. */
export function exportFilename(worldId = "world", date = new Date()) {
  const slug = String(worldId).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "world";
  return `${MODULE_ID}-${slug}-${date.toISOString().slice(0, 10)}.json`;
}

/**
 * Parse and normalise an exported file.
 *
 * Unknown or newer formats are rejected outright; anything else is run through
 * the standard migration so older files upgrade and out-of-range values clamp
 * exactly as stored data would.
 *
 * @returns {{ok:boolean, data:object|null, events:Array|null, errors:Array, warnings:Array}}
 */
export function parseImport(text) {
  const fail = code => ({ ok: false, data: null, events: null, errors: [{ code, data: {} }], warnings: [] });

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("importNotJson");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("importNotJson");
  if (raw.format !== EXPORT_FORMAT) return fail("importWrongFormat");

  const formatVersion = Number(raw.formatVersion);
  if (!Number.isFinite(formatVersion) || formatVersion > EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      data: null,
      events: null,
      errors: [{ code: "importNewerFormat", data: { found: raw.formatVersion, supported: EXPORT_FORMAT_VERSION } }],
      warnings: []
    };
  }
  if (!raw.calendar || typeof raw.calendar !== "object") return fail("importMissingCalendar");

  // Whatever members a file names belong to the world it came from, so the
  // parties arrive empty and the GM is told to fill them.
  const hasParties = Array.isArray(raw.parties) && raw.parties.length > 0;
  const parties = hasParties ? raw.parties.map(party => ({ ...party, members: [] })) : [];
  const data = migrateCalendarData({ calendar: raw.calendar, ages: raw.ages, parties, activePartyId: raw.activePartyId });
  const events = Array.isArray(raw.events) ? migrateEvents(raw.events) : null;
  const validation = validateCalendarData(data);
  const warnings = [...validation.warnings];
  if (hasParties) warnings.push({ code: "importPartiesNeedMembers", data: { count: data.parties.length } });

  return {
    ok: validation.valid,
    data,
    events,
    hasParties,
    errors: validation.errors,
    warnings
  };
}

/** Counts used to describe an import to the GM before anything is applied. Pure. */
export function summarizeImport(parsed, current) {
  const next = parsed?.data?.calendar ?? {};
  const now = current?.calendar ?? {};
  return {
    months: { from: now.monthsPerYear, to: next.monthsPerYear },
    // The year length is what a GM actually recognises a calendar by, and it is
    // the only figure that stays meaningful once months differ in length.
    yearLength: { from: daysInYear(now), to: daysInYear(next) },
    weekdays: { from: now.weekdayNames?.length ?? 0, to: next.weekdayNames?.length ?? 0 },
    moons: { from: now.moons?.length ?? 0, to: next.moons?.length ?? 0 },
    ages: { from: current?.ages?.length ?? 0, to: parsed?.data?.ages?.length ?? 0 },
    parties: { from: current?.parties?.length ?? 0, to: parsed?.data?.parties?.length ?? 0 },
    events: parsed?.events?.length ?? null,
    currentDate: next.currentDate ?? null
  };
}

/** Trigger a browser download of the export payload. */
export function downloadExport(payload, filename = exportFilename(game.world?.id)) {
  const json = JSON.stringify(payload, null, 2);
  try {
    foundry.utils.saveDataToFile(json, "application/json", filename);
    log("debug", "Exported calendar data", filename);
    return true;
  } catch (error) {
    log("error", "Failed to export calendar data", error);
    ui.notifications.error(t("TTA.Errors.ExportFailed"));
    return false;
  }
}

/** Read a user-selected file as text. */
export async function readImportFile(file) {
  if (!file) return null;
  try {
    return await file.text();
  } catch (error) {
    log("error", "Failed to read the selected file", error);
    return null;
  }
}
