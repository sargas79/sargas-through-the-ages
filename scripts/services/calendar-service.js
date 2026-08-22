/**
 * Owns the single shared calendar: configuration, Ages, and the authoritative
 * campaign date. All writes are GM-only; reads are safe for every client.
 */

import { isDebug, log, rerenderModuleApps, t } from "../compat.js";
import { MODULE_ID, SETTINGS } from "../constants.js";
import { findAgeForYear, visibleAges } from "./age-service.js";
import {
  addDays,
  addMonths,
  addSeconds,
  addYears,
  clampDate,
  clampTime,
  isValidDate,
  monthName,
  secondsUntilNextAdventureDay,
  toAbsoluteDay,
  weekdayName,
  yearWithAffixes
} from "./date-service.js";
import { describePhase, sortMoons, visibleMoons } from "./moon-service.js";
import { migrateCalendarData, needsMigration } from "./migration-service.js";
import { canChangeTime, canConfigureCalendar, isGM } from "./permission-service.js";

/** The full stored payload, normalised through the migration service. */
export function getData() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.CALENDAR_DATA);
  return migrateCalendarData(raw);
}

/** Just the calendar structure block. */
export function getCalendar() {
  return getData().calendar;
}

/** The shared current date. */
export function getCurrentDate() {
  return getCalendar().currentDate;
}

/** The shared campaign clock, stored to minute precision. */
export function getCurrentTime() {
  return getCalendar().currentTime;
}

/** Every configured moon, ordered. */
export function getMoons() {
  return sortMoons(getCalendar().moons ?? []);
}

/** Moons the given user may see. */
export function getVisibleMoons(user = game.user) {
  return visibleMoons(getCalendar().moons ?? [], isGM(user));
}

/**
 * Render-ready phase data for every moon the user may see on a given date.
 * Returns an empty array when no moons are configured, which is the default.
 */
export function getMoonPhases(date = getCurrentDate(), { user = game.user } = {}) {
  const calendar = getCalendar();
  const moons = visibleMoons(calendar.moons ?? [], isGM(user));
  if (!moons.length) return [];
  const absoluteDay = toAbsoluteDay(date, calendar);
  return moons.map(moon => {
    const phase = describePhase(moon, absoluteDay);
    return { ...phase, phaseLabel: t(`TTA.Moons.Phase.${phase.phaseKey}`) };
  });
}

/** Every configured Age, ordered. */
export function getAges() {
  return getData().ages;
}

/** Ages the given user may see. */
export function getVisibleAges(user = game.user) {
  return visibleAges(getAges(), isGM(user));
}

/** The Age containing a year, or null. */
export function getAgeForYear(year) {
  return findAgeForYear(getAges(), year);
}

/** The Age containing the current campaign year, or null. */
export function getCurrentAge() {
  return getAgeForYear(getCurrentDate().year);
}

/** True once a GM has completed first-time setup. */
export function isConfigured() {
  return game.settings.get(MODULE_ID, SETTINGS.CONFIGURED) === true;
}

/** Persist the whole calendar payload. GM only. */
export async function saveData(data, { markConfigured = true } = {}) {
  if (!canConfigureCalendar()) {
    ui.notifications.warn(t("TTA.Errors.GMOnly"));
    return null;
  }
  const normalized = migrateCalendarData(data);
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, normalized);
  await game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, normalized.schemaVersion);
  if (markConfigured) await game.settings.set(MODULE_ID, SETTINGS.CONFIGURED, true);
  log("debug", "Calendar data saved", normalized);
  return normalized;
}

/** Replace the Age list without touching the calendar structure. GM only. */
export async function saveAges(ages) {
  const data = getData();
  return saveData({ ...data, ages }, { markConfigured: isConfigured() });
}

/**
 * Set the shared campaign date. Out-of-range values are clamped.
 * @returns {object|null} the applied date, or null when the change was refused
 */
export async function setCurrentDate(date) {
  const applied = await setCurrentDateTime(date, getCurrentTime());
  return applied?.date ?? null;
}

/** Set the shared campaign date and time. Out-of-range values are clamped. */
export async function setCurrentDateTime(date, time) {
  if (!canChangeTime()) {
    ui.notifications.warn(t("TTA.Errors.TimeGMOnly"));
    return null;
  }
  const data = getData();
  const calendar = data.calendar;
  const target = isValidDate(date, calendar) ? date : clampDate(date, calendar);
  if (!isValidDate(date, calendar)) log("warn", "Requested date was out of range and has been clamped", date, target);

  const targetTime = clampTime(time);
  const updated = { ...data, calendar: { ...calendar, currentDate: target, currentTime: targetTime } };
  // Every campaign-date move passes through here, so this is the one place that
  // can answer "what moved the date, and who asked for it" after the fact. The
  // stack is only worth collecting when someone is actually reading the log.
  if (isDebug()) {
    log("debug", "Campaign date set", {
      from: { date: calendar.currentDate, time: calendar.currentTime },
      to: { date: target, time: targetTime },
      user: game.user?.name,
      stack: new Error().stack
    });
  }
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, updated);
  Hooks.callAll(`${MODULE_ID}.timeChanged`, { date: target, time: targetTime });
  Hooks.callAll(`${MODULE_ID}.dateChanged`, target);
  return { date: target, time: targetTime };
}

/** Advance (or rewind) the campaign date by whole days. GM only. */
export async function advanceDays(delta) {
  const result = await advanceTime(Math.trunc(delta) * 86400);
  return result?.date ?? null;
}

/** Advance (or rewind) the campaign date by whole months. GM only. */
export async function advanceMonths(delta) {
  const calendar = getCalendar();
  const target = addMonths(calendar.currentDate, delta, calendar);
  const result = await advanceTo(target, calendar.currentTime);
  return result?.date ?? null;
}

/** Advance (or rewind) the campaign date by whole years. GM only. */
export async function advanceYears(delta) {
  const calendar = getCalendar();
  const target = addYears(calendar.currentDate, delta, calendar);
  const result = await advanceTo(target, calendar.currentTime);
  return result?.date ?? null;
}

/** Advance the campaign by exact elapsed seconds through Foundry's world clock. */
export async function advanceTime(seconds) {
  const calendar = getCalendar();
  const target = addSeconds(calendar.currentDate, calendar.currentTime, seconds, calendar);
  return advanceTo(target.date, target.time);
}

/** Advance to 07:00 on the following campaign day. */
export async function advanceToNextAdventureDay() {
  return advanceTime(secondsUntilNextAdventureDay(getCurrentTime()));
}

/** The campaign clock as a single second count, for delta arithmetic. */
function campaignSeconds(date, time, calendar) {
  return (toAbsoluteDay(date, calendar) * 86400) + (time.hour * 3600) + (time.minute * 60);
}

/** True when two stored date/time pairs describe the same campaign moment. */
function isSameMoment(a, b) {
  return a.date.year === b.date.year
    && a.date.month === b.date.month
    && a.date.day === b.date.day
    && a.time.hour === b.time.hour
    && a.time.minute === b.time.minute;
}

/**
 * Whether a time change is part-way through.
 *
 * {@link advanceTo} computes its delta from a snapshot and then waits on two
 * server round-trips before writing the result, so a second call starting in
 * that window would work from a date that is about to change and write the
 * wrong one last. The whole calendar payload is a single setting, so the later
 * write wins outright rather than merging.
 */
let advanceInFlight = false;

/** Apply a target calendar time and its matching delta to Foundry world time. */
export async function advanceTo(date, time) {
  if (!canChangeTime()) {
    ui.notifications.warn(t("TTA.Errors.TimeGMOnly"));
    return null;
  }
  if (advanceInFlight) {
    log("warn", "Ignored a time change while another was still in flight", date, time);
    ui.notifications.warn(t("TTA.Errors.TimeBusy"));
    return null;
  }

  advanceInFlight = true;
  try {
    return await applyTimeChange(date, time);
  } finally {
    advanceInFlight = false;
  }
}

/** The body of {@link advanceTo}, run under its in-flight guard. */
async function applyTimeChange(date, time) {
  const calendar = getCalendar();
  const targetDate = isValidDate(date, calendar) ? date : clampDate(date, calendar);
  const targetTime = clampTime(time);
  const snapshot = { date: calendar.currentDate, time: calendar.currentTime };
  const currentSeconds = campaignSeconds(snapshot.date, snapshot.time, calendar);
  const targetSeconds = campaignSeconds(targetDate, targetTime, calendar);
  const elapsedSeconds = targetSeconds - currentSeconds;
  if (elapsedSeconds === 0) return { date: calendar.currentDate, time: calendar.currentTime, elapsedSeconds: 0 };

  const currentWorldTime = game.time.worldTime;
  const expectedWorldTime = currentWorldTime + elapsedSeconds;
  try {
    // Store the expected value before advancing so every client can recognise this update.
    await game.settings.set(MODULE_ID, SETTINGS.WORLD_TIME, expectedWorldTime);
    await game.time.advance(elapsedSeconds);
  } catch (error) {
    await game.settings.set(MODULE_ID, SETTINGS.WORLD_TIME, currentWorldTime);
    log("error", "Failed to advance Foundry world time", error);
    ui.notifications.error(t("TTA.Errors.TimeAdvanceFailed"));
    return null;
  }

  // The delta above was measured against a date that another client may have
  // moved while the two awaits ran. Writing now would silently discard their
  // change, so the run is abandoned instead: world time keeps the seconds it
  // gained and the checkpoint goes back to its old value, which is what raises
  // the drift strip and lets a GM decide what the calendar should say.
  const latest = getCalendar();
  if (!isSameMoment({ date: latest.currentDate, time: latest.currentTime }, snapshot)) {
    await game.settings.set(MODULE_ID, SETTINGS.WORLD_TIME, currentWorldTime);
    log("warn", "Campaign date changed while a time advance was in flight; the advance was discarded", {
      snapshot,
      latest: { date: latest.currentDate, time: latest.currentTime }
    });
    ui.notifications.warn(t("TTA.Errors.TimeRaced"));
    // The clocks now differ and the GM has just been told why, so the drift
    // strip stands on its own without a second toast behind it.
    reportedDrift = true;
    rerenderModuleApps();
    return null;
  }

  try {
    const applied = await setCurrentDateTime(targetDate, targetTime);
    return applied ? { ...applied, elapsedSeconds } : null;
  } catch (error) {
    log("error", "Foundry world time advanced but calendar persistence failed", error);
    ui.notifications.error(t("TTA.Errors.TimeCalendarSyncFailed"));
    return null;
  }
}

/** Set the initial checkpoint without altering either existing clock. GM only. */
export async function initializeWorldTimeCheckpoint() {
  if (!isGM()) return;
  const checkpoint = game.settings.get(MODULE_ID, SETTINGS.WORLD_TIME);
  if (typeof checkpoint !== "number" || !Number.isFinite(checkpoint)) {
    await game.settings.set(MODULE_ID, SETTINGS.WORLD_TIME, game.time.worldTime);
  }
}

/** Whether Foundry world time changed since the module's last acknowledged value. */
export function isWorldTimeOutOfSync() {
  const checkpoint = game.settings.get(MODULE_ID, SETTINGS.WORLD_TIME);
  return typeof checkpoint === "number" && Number.isFinite(checkpoint)
    && checkpoint !== game.time.worldTime;
}

/** Accept the current Foundry world time without changing the campaign calendar. */
export async function acknowledgeWorldTime() {
  if (!canChangeTime()) {
    ui.notifications.warn(t("TTA.Errors.TimeGMOnly"));
    return false;
  }
  await game.settings.set(MODULE_ID, SETTINGS.WORLD_TIME, game.time.worldTime);
  reportedDrift = false;
  return true;
}

/**
 * Whether the GM has already been told about the divergence now on screen.
 *
 * A combat round advances Foundry world time by a few seconds without asking
 * this module, and so does every round after it. The drift strip is the standing
 * report; a toast per round on top of it says nothing new and buries whatever
 * else is in the notification queue. One toast per divergence is enough, and the
 * next one is due only once the clocks have agreed again.
 */
let reportedDrift = false;

/** Warn GMs when another source changes Foundry world time independently. */
export function onWorldTimeUpdated(worldTime) {
  const checkpoint = game.settings.get(MODULE_ID, SETTINGS.WORLD_TIME);
  if (typeof checkpoint !== "number" || !Number.isFinite(checkpoint)) return;

  if (worldTime === checkpoint) {
    reportedDrift = false;
    return;
  }

  if (isGM() && !reportedDrift) {
    ui.notifications.warn(t("TTA.Errors.TimeOutOfSync"));
    reportedDrift = true;
  }
  log("warn", "Foundry world time changed outside Through the Ages", { worldTime, checkpoint });
  rerenderModuleApps();
}

/**
 * A year label honouring the calendar's era affixes, e.g. `1495 DR`.
 * Calendars that set no affixes keep the plain localised wording.
 */
export function formatYear(year, calendar = getCalendar()) {
  return yearWithAffixes(year, calendar) ?? t("TTA.Format.YearPlain", { year });
}

/** A human-readable date label using the configured month and weekday names. */
export function formatDate(date, { withWeekday = true } = {}) {
  const calendar = getCalendar();
  const month = monthName(date.month, calendar);
  const base = t("TTA.Format.Date", { day: date.day, month, year: formatYear(date.year, calendar) });
  if (!withWeekday) return base;
  return t("TTA.Format.DateWithWeekday", { weekday: weekdayName(date, calendar), date: base });
}

/** A consistent 24-hour clock label for the stored minute-precision time. */
export function formatTime(time = getCurrentTime()) {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** A human-readable month label. */
export function formatMonth(year, month) {
  const calendar = getCalendar();
  return t("TTA.Format.Month", { month: monthName(month, calendar), year: formatYear(year, calendar) });
}

/** Run the stored-data migration once, if needed. GM only; safe to call twice. */
export async function runMigrationIfNeeded() {
  if (!isGM()) return false;
  const raw = game.settings.get(MODULE_ID, SETTINGS.CALENDAR_DATA);
  if (!needsMigration(raw)) return false;
  const migrated = migrateCalendarData(raw);
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, migrated);
  await game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, migrated.schemaVersion);
  log("info", `Migrated calendar data to schema version ${migrated.schemaVersion}`);
  return true;
}

/** Setting change handler: keep every open module window in sync. */
export function onCalendarDataChanged() {
  rerenderModuleApps();
}
