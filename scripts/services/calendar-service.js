/**
 * Owns the single shared calendar: configuration, Ages, and the authoritative
 * campaign date. All writes are GM-only; reads are safe for every client.
 */

import { isDebug, log, rerenderModuleApps, t } from "../compat.js";
import { MODULE_ID, SETTINGS, VISIBILITY } from "../constants.js";
import { findAgeForYear, visibleAges } from "./age-service.js";
import {
  addDays,
  addMonths,
  addSeconds,
  addYears,
  campaignSeconds,
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
import { migrateCalendarData, migrateEvents, needsMigration } from "./migration-service.js";
import { findParty, partyForUser, partyMoment, sortParties } from "./party-service.js";
import { syncPartyEntries } from "./party-store-service.js";
import { canChangeTime, canConfigureCalendar, isGM } from "./permission-service.js";
import { ensurePrivateEntry, readPrivate, writePrivate } from "./private-store-service.js";

/**
 * The full stored payload this client can see, normalised.
 *
 * The calendar structure itself is shared: players need the month names and
 * lengths to read a date at all. Hidden Ages are not, so they live in the
 * GM-only store and are merged back in here. A player's `readPrivate` returns
 * null — the document does not reach them — so their payload simply has no
 * hidden Ages in it, rather than having them and declining to draw them.
 */
export function getData() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.CALENDAR_DATA);
  const hidden = readPrivate()?.ages ?? [];
  if (!hidden.length) return migrateCalendarData(raw);
  return migrateCalendarData({ ...raw, ages: [...(raw?.ages ?? []), ...hidden] });
}

/** Just the calendar structure block. */
export function getCalendar() {
  return getData().calendar;
}

/**
 * The shared current date: the active party's, when parties are in use.
 *
 * This is "now" for the world as a whole, and for Foundry's world time. Every
 * client shows it; a party that is not active keeps its own date on its record
 * (see {@link getPartyDate}) until a GM makes it active again.
 */
export function getCurrentDate() {
  return getCalendar().currentDate;
}

/** The shared campaign clock, stored to minute precision. */
export function getCurrentTime() {
  return getCalendar().currentTime;
}

// --- Parties ---------------------------------------------------------------

/** Every party, ordered. Empty for a world that does not use parties. */
export function getParties() {
  return sortParties(getData().parties ?? []);
}

/** The id of the party whose date the calendar is standing on, or null. */
export function getActivePartyId() {
  return getData().activePartyId ?? null;
}

/** The active party record, or null. */
export function getActiveParty() {
  return findParty(getParties(), getActivePartyId());
}

/** One party by id, or null. */
export function getParty(partyId) {
  return findParty(getParties(), partyId);
}

/** The party a user belongs to, or null. GMs belong to none. */
export function getPartyForUser(user = game.user) {
  return partyForUser(getParties(), user?.id);
}

/**
 * The date and time a party stands at.
 *
 * The active party's moment is the calendar's own; any other party's is on
 * its record. With no parties, or an unknown id, this is the calendar's moment.
 * @returns {{date:object, time:object}}
 */
export function getPartyMoment(partyId) {
  const data = getData();
  return partyMoment(data.calendar, data.parties ?? [], data.activePartyId, partyId);
}

/** The date a party stands at. */
export function getPartyDate(partyId) {
  return getPartyMoment(partyId).date;
}

/** The clock a party stands at. */
export function getPartyTime(partyId) {
  return getPartyMoment(partyId).time;
}

/**
 * Resolve which party a time change is for.
 *
 * `null` means the active party, which is also what an unknown id or a world
 * without parties resolves to, so callers written before parties existed keep
 * moving the campaign date. Returns the party record for a non-active party.
 * @returns {{party:object|null, isActive:boolean}}
 */
function resolveTargetParty(data, partyId) {
  const party = findParty(data.parties ?? [], partyId);
  if (!party || party.id === data.activePartyId) return { party: null, isActive: true };
  return { party, isActive: false };
}

/**
 * The shared half of a payload, ready to be written to the world setting.
 *
 * `getData` merges the hidden Ages back in for a GM. Writing that whole would
 * put them straight back into the world setting every client reads, so only
 * the player-visible Ages go back.
 */
function sharedPayload(data) {
  return { ...data, ages: data.ages.filter(age => age.playerVisible !== false) };
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

/**
 * Persist the whole calendar payload, routing hidden Ages away from the world
 * setting. GM only.
 *
 * The store is created before the split rather than after it. `getData` merges
 * only what it could read, so saving a payload that was assembled while the
 * store was unreadable would write the hidden half away; making sure it exists
 * first means the read and the write are looking at the same place.
 */
export async function saveData(data, { markConfigured = true, announce = true } = {}) {
  if (!canConfigureCalendar()) {
    ui.notifications.warn(t("TTA.Errors.GMOnly"));
    return null;
  }

  const store = await ensurePrivateEntry();
  if (!store) {
    log("error", "The GM-only calendar store could not be created; nothing was saved");
    ui.notifications.error(t("TTA.Errors.PrivateStoreUnavailable"));
    return null;
  }

  const previous = structureOf(getCalendar());
  const normalized = migrateCalendarData(data);
  const shared = normalized.ages.filter(age => age.playerVisible !== false);
  const hidden = normalized.ages.filter(age => age.playerVisible === false);

  await writePrivate({ ages: hidden, events: readPrivate()?.events ?? [] });
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, { ...normalized, ages: shared });
  await game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, normalized.schemaVersion);
  if (markConfigured) await game.settings.set(MODULE_ID, SETTINGS.CONFIGURED, true);
  // Each party's store exists and is readable by exactly its members from the
  // moment the party is saved, so a player moved between parties changes what
  // they can read on the same save.
  await syncPartyEntries(normalized.parties);
  log("debug", "Calendar data saved", normalized);

  // One signal for "the calendar's shape may have changed", for modules that
  // store calendar dates and need to revalidate them. Fires only on the saving
  // client, like `timeChanged`; configuration is rare and GM-only. Age-only
  // saves pass `announce: false` because they cannot change the structure.
  if (announce) {
    const next = structureOf(normalized.calendar);
    Hooks.callAll(`${MODULE_ID}.calendarConfigured`, {
      calendar: normalized.calendar,
      previous,
      structureChanged: !sameStructure(previous, next)
    });
  }
  return normalized;
}

/** The parts of a calendar block that decide whether a stored date is still valid. */
function structureOf(calendar) {
  return {
    monthsPerYear: calendar?.monthsPerYear ?? null,
    monthLengths: Array.isArray(calendar?.monthLengths) ? [...calendar.monthLengths] : [],
    monthNames: Array.isArray(calendar?.monthNames) ? [...calendar.monthNames] : []
  };
}

function sameStructure(a, b) {
  return a.monthsPerYear === b.monthsPerYear
    && a.monthLengths.length === b.monthLengths.length
    && a.monthLengths.every((length, index) => length === b.monthLengths[index]);
}

/** Replace the Age list without touching the calendar structure. GM only. */
export async function saveAges(ages) {
  const data = getData();
  return saveData({ ...data, ages }, { markConfigured: isConfigured(), announce: false });
}

/**
 * Set the shared campaign date. Out-of-range values are clamped.
 * @returns {object|null} the applied date, or null when the change was refused
 */
export async function setCurrentDate(date, { partyId = null } = {}) {
  const applied = await setCurrentDateTime(date, getPartyTime(partyId), { partyId });
  return applied?.date ?? null;
}

/**
 * Why a campaign-date move happened, carried on the `timeChanged` payload so a
 * listener can tell a deliberate correction from the passage of time.
 */
export const TIME_CHANGE_REASON = Object.freeze({
  ADVANCE: "advance",
  SET: "set",
  NEXT_ADVENTURE_DAY: "nextAdventureDay"
});

/**
 * Set the shared campaign date and time. Out-of-range values are clamped.
 *
 * Emits `sargas-through-the-ages.timeChanged` with
 * `{ date, time, previous: { date, time }, elapsedSeconds, reason, partyId }`
 * on this client, then `sargas-through-the-ages.dateChanged` with the date
 * alone. `partyId` is the active party's id, or null without parties.
 *
 * With `partyId` naming a party that is not active, only that party's own
 * record moves. The campaign date, Foundry world time and the two hooks above
 * are untouched: a listener that treats `timeChanged` as time passing would
 * otherwise run its clocks for a group that is not at the table. Such a change
 * emits `sargas-through-the-ages.partyTimeChanged` instead, with the same
 * payload shape.
 */
export async function setCurrentDateTime(date, time, { reason = TIME_CHANGE_REASON.SET, partyId = null } = {}) {
  if (!canChangeTime()) {
    ui.notifications.warn(t("TTA.Errors.TimeGMOnly"));
    return null;
  }
  const data = getData();
  const { party, isActive } = resolveTargetParty(data, partyId);
  if (!isActive) return setPartyMoment(data, party, date, time, reason);

  const calendar = data.calendar;
  const target = isValidDate(date, calendar) ? date : clampDate(date, calendar);
  if (!isValidDate(date, calendar)) log("warn", "Requested date was out of range and has been clamped", date, target);

  const targetTime = clampTime(time);
  const previous = { date: calendar.currentDate, time: calendar.currentTime };
  const elapsedSeconds = campaignSeconds(target, targetTime, calendar) - campaignSeconds(previous.date, previous.time, calendar);
  const updated = sharedPayload({
    ...data,
    calendar: { ...calendar, currentDate: target, currentTime: targetTime }
  });
  // Every campaign-date move passes through here, so this is the one place that
  // can answer "what moved the date, and who asked for it" after the fact. The
  // stack is only worth collecting when someone is actually reading the log.
  if (isDebug()) {
    log("debug", "Campaign date set", {
      from: previous,
      to: { date: target, time: targetTime },
      elapsedSeconds,
      reason,
      user: game.user?.name,
      stack: new Error().stack
    });
  }
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, updated);
  Hooks.callAll(`${MODULE_ID}.timeChanged`, {
    date: target,
    time: targetTime,
    previous,
    elapsedSeconds,
    reason,
    partyId: data.activePartyId ?? null
  });
  Hooks.callAll(`${MODULE_ID}.dateChanged`, target);
  return { date: target, time: targetTime };
}

/**
 * Move a party that is not active. Only its record changes; see
 * {@link setCurrentDateTime} for why the campaign hooks stay quiet.
 */
async function setPartyMoment(data, party, date, time, reason) {
  const calendar = data.calendar;
  const target = isValidDate(date, calendar) ? date : clampDate(date, calendar);
  if (!isValidDate(date, calendar)) log("warn", "Requested party date was out of range and has been clamped", date, target);
  const targetTime = clampTime(time);
  const previous = { date: party.currentDate, time: party.currentTime };
  const elapsedSeconds = campaignSeconds(target, targetTime, calendar) - campaignSeconds(previous.date, previous.time, calendar);

  const parties = data.parties.map(record => record.id === party.id
    ? { ...record, currentDate: target, currentTime: targetTime }
    : record);
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, sharedPayload({ ...data, parties }));
  log("debug", "Party date set", { party: party.id, from: previous, to: { date: target, time: targetTime }, reason });
  Hooks.callAll(`${MODULE_ID}.partyTimeChanged`, {
    date: target,
    time: targetTime,
    previous,
    elapsedSeconds,
    reason,
    partyId: party.id
  });
  return { date: target, time: targetTime };
}

/** Advance (or rewind) a party's date by whole days. GM only. */
export async function advanceDays(delta, { partyId = null } = {}) {
  const result = await advanceTime(Math.trunc(delta) * 86400, { reason: TIME_CHANGE_REASON.ADVANCE, partyId });
  return result?.date ?? null;
}

/** Advance (or rewind) a party's date by whole months. GM only. */
export async function advanceMonths(delta, { partyId = null } = {}) {
  const calendar = getCalendar();
  const moment = getPartyMoment(partyId);
  const target = addMonths(moment.date, delta, calendar);
  const result = await advanceTo(target, moment.time, { reason: TIME_CHANGE_REASON.ADVANCE, partyId });
  return result?.date ?? null;
}

/** Advance (or rewind) a party's date by whole years. GM only. */
export async function advanceYears(delta, { partyId = null } = {}) {
  const calendar = getCalendar();
  const moment = getPartyMoment(partyId);
  const target = addYears(moment.date, delta, calendar);
  const result = await advanceTo(target, moment.time, { reason: TIME_CHANGE_REASON.ADVANCE, partyId });
  return result?.date ?? null;
}

/**
 * Advance a party by exact elapsed seconds. For the active party this goes
 * through Foundry's world clock; for any other it is arithmetic on its record.
 */
export async function advanceTime(seconds, { reason = TIME_CHANGE_REASON.ADVANCE, partyId = null } = {}) {
  const calendar = getCalendar();
  const moment = getPartyMoment(partyId);
  const target = addSeconds(moment.date, moment.time, seconds, calendar);
  return advanceTo(target.date, target.time, { reason, partyId });
}

/** Advance a party to 07:00 on its following campaign day. */
export async function advanceToNextAdventureDay({ partyId = null } = {}) {
  return advanceTime(secondsUntilNextAdventureDay(getPartyTime(partyId)), {
    reason: TIME_CHANGE_REASON.NEXT_ADVENTURE_DAY,
    partyId
  });
}

/**
 * Make a party the one the calendar stands on. GM only.
 *
 * The outgoing party's date is written to its record and the incoming party's
 * date is loaded into the calendar, in one write. Foundry world time is left
 * exactly where it is: a switch is not time passing, so it does not fire
 * `timeChanged`, and a companion module must not treat it as an advance. It
 * fires `sargas-through-the-ages.activePartyChanged` with
 * `{ partyId, previousPartyId }` instead.
 *
 * @returns {object|null} the now-active party, or null when the switch was refused
 */
export async function setActiveParty(partyId) {
  if (!canChangeTime()) {
    ui.notifications.warn(t("TTA.Errors.TimeGMOnly"));
    return null;
  }
  // The advance's race guard would discard the advance anyway once the date
  // moved under it, but refusing here spares the GM a confusing pair of toasts.
  if (advanceInFlight) {
    ui.notifications.warn(t("TTA.Errors.TimeBusy"));
    return null;
  }
  const data = getData();
  const incoming = findParty(data.parties ?? [], partyId);
  if (!incoming) {
    ui.notifications.warn(t("TTA.Errors.PartyMissing"));
    return null;
  }
  const previousPartyId = data.activePartyId ?? null;
  if (incoming.id === previousPartyId) return incoming;

  const calendar = data.calendar;
  const parties = data.parties.map(record => {
    if (record.id === previousPartyId) {
      return { ...record, currentDate: calendar.currentDate, currentTime: calendar.currentTime };
    }
    return record;
  });
  const updated = sharedPayload({
    ...data,
    parties,
    activePartyId: incoming.id,
    calendar: { ...calendar, currentDate: incoming.currentDate, currentTime: incoming.currentTime }
  });
  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, updated);
  log("info", `Active party is now ${incoming.name}`, { partyId: incoming.id, previousPartyId });
  Hooks.callAll(`${MODULE_ID}.activePartyChanged`, { partyId: incoming.id, previousPartyId });
  return findParty(parties, incoming.id);
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

/**
 * Apply a target calendar time and its matching delta to Foundry world time.
 * `reason` is carried onto the `timeChanged` payload; a direct call is a
 * deliberate "set" unless the caller says otherwise.
 */
export async function advanceTo(date, time, { reason = TIME_CHANGE_REASON.SET, partyId = null } = {}) {
  if (!canChangeTime()) {
    ui.notifications.warn(t("TTA.Errors.TimeGMOnly"));
    return null;
  }
  // A party that is not active has no claim on Foundry world time, so its
  // advance is a plain write to its record and needs none of the machinery below.
  if (!resolveTargetParty(getData(), partyId).isActive) {
    return setCurrentDateTime(date, time, { reason, partyId });
  }
  if (advanceInFlight) {
    log("warn", "Ignored a time change while another was still in flight", date, time);
    ui.notifications.warn(t("TTA.Errors.TimeBusy"));
    return null;
  }

  advanceInFlight = true;
  try {
    return await applyTimeChange(date, time, reason);
  } finally {
    advanceInFlight = false;
  }
}

/** The body of {@link advanceTo}, run under its in-flight guard. */
async function applyTimeChange(date, time, reason) {
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
    const applied = await setCurrentDateTime(targetDate, targetTime, { reason });
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

/**
 * Run the stored-data migration once, if needed. GM only; safe to call twice.
 *
 * Schema 5 is the one that moves content rather than reshaping it: hidden Ages
 * and GM-only events were in world settings, which every client receives, and
 * are lifted out into the GM-only store. Until this runs they are still
 * readable by anyone in the world, so it runs on the first GM to connect.
 */
export async function runMigrationIfNeeded() {
  if (!isGM()) return false;
  const raw = game.settings.get(MODULE_ID, SETTINGS.CALENDAR_DATA);
  if (!needsMigration(raw)) return false;

  const migrated = migrateCalendarData(raw);
  const sharedEvents = migrateEvents(game.settings.get(MODULE_ID, SETTINGS.TIMELINE_EVENTS));

  const hiddenAges = migrated.ages.filter(age => age.playerVisible === false);
  const hiddenEvents = sharedEvents.filter(event => event.visibility !== VISIBILITY.PLAYERS);

  const store = await ensurePrivateEntry();
  if (!store) {
    log("error", "Could not create the GM-only store; the migration was not applied");
    return false;
  }

  const existing = readPrivate() ?? { ages: [], events: [] };
  await writePrivate({
    // Anything already in the store stays: running the migration twice must not
    // drop what the first run put there.
    ages: mergeById(existing.ages, hiddenAges),
    events: mergeById(existing.events, hiddenEvents)
  });

  await game.settings.set(MODULE_ID, SETTINGS.CALENDAR_DATA, {
    ...migrated,
    ages: migrated.ages.filter(age => age.playerVisible !== false)
  });
  await game.settings.set(
    MODULE_ID,
    SETTINGS.TIMELINE_EVENTS,
    sharedEvents.filter(event => event.visibility === VISIBILITY.PLAYERS)
  );
  await game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, migrated.schemaVersion);

  log("info",
    `Migrated calendar data to schema version ${migrated.schemaVersion}; moved `
    + `${hiddenAges.length} hidden Ages and ${hiddenEvents.length} GM-only events out of world settings`);
  return true;
}

/** Combine two record lists on `id`, letting the second win. Order preserved. */
function mergeById(first, second) {
  const merged = new Map(first.map(record => [record.id, record]));
  for (const record of second) merged.set(record.id, record);
  return [...merged.values()];
}

/** Setting change handler: keep every open module window in sync. */
export function onCalendarDataChanged() {
  rerenderModuleApps();
}
