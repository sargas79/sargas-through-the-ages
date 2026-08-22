/**
 * GM-only calendar configuration: months, days, weekday names, the starting
 * date, and the list of Ages.
 *
 * The window edits an in-memory draft so a GM can restructure the calendar and
 * review the consequences before anything is written. Structural changes that
 * could strand existing notes or events require an explicit confirmation.
 */

import { confirmDialog, log, randomID, t } from "../compat.js";
import {
  DEFAULT_COLOR,
  DEFAULT_MONTH_NAMES,
  DEFAULT_MOON_COLOR,
  DEFAULT_MOON_NAMES,
  DEFAULT_MOON_PHASE_COUNT,
  DEFAULT_WEEKDAY_NAMES,
  LIMITS,
  MODULE_ID,
  MOON_PHASE_COUNTS
} from "../constants.js";
import { endYear, sortAges } from "../services/age-service.js";
import { getData, saveData } from "../services/calendar-service.js";
import { daysInMonth, toAbsoluteDay, yearWithAffixes } from "../services/date-service.js";
import * as journal from "../services/journal-service.js";
import * as note from "../services/note-service.js";
import { migrateCalendarData, resizeMonthLengths, resizeNames } from "../services/migration-service.js";
import { clampCycleLength, describePhase, sortMoons } from "../services/moon-service.js";
import { canConfigureCalendar } from "../services/permission-service.js";
import * as portability from "../services/portability-service.js";
import * as presets from "../services/preset-service.js";
import * as timeline from "../services/timeline-service.js";
import { structuralChangeWarnings, validateCalendarData } from "../services/validation-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CalendarConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super({ ...options, id: "tta-calendar-config" });
    this.draft = migrateCalendarData(getData());
    /**
     * The campaign date as it was last painted into the form's date fields.
     *
     * The draft is a snapshot, and this window can sit open across a whole
     * session while the campaign date moves underneath it. Saving must not put
     * that stale date back, so the fields are compared against this to tell a
     * GM who edited them from one who simply left them alone. Every render
     * re-anchors it, since that is when the fields are repainted.
     */
    this.openingDate = { ...this.draft.calendar.currentDate };
    /** Events staged by an import, written only when the form is submitted. */
    this.pendingEvents = null;
    /** Holiday notes staged by a preset, created only when the form is submitted. */
    this.pendingHolidays = null;
    /** The preset id showing in the picker, kept across re-renders. */
    this.presetId = "";
  }

  static DEFAULT_OPTIONS = {
    classes: ["tta", "tta-app", "tta-config"],
    tag: "form",
    window: {
      icon: "fa-solid fa-gears",
      title: "TTA.Config.Title",
      resizable: true
    },
    position: { width: 820, height: 760 },
    form: {
      handler: CalendarConfigApp.onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    },
    actions: {
      addAge: CalendarConfigApp.onAddAge,
      removeAge: CalendarConfigApp.onRemoveAge,
      moveAgeUp: CalendarConfigApp.onMoveAgeUp,
      moveAgeDown: CalendarConfigApp.onMoveAgeDown,
      resetNames: CalendarConfigApp.onResetNames,
      repairFolder: CalendarConfigApp.onRepairFolder,
      addMoon: CalendarConfigApp.onAddMoon,
      removeMoon: CalendarConfigApp.onRemoveMoon,
      moveMoonUp: CalendarConfigApp.onMoveMoonUp,
      moveMoonDown: CalendarConfigApp.onMoveMoonDown,
      loadPreset: CalendarConfigApp.onLoadPreset,
      discardHolidays: CalendarConfigApp.onDiscardHolidays,
      uniformDays: CalendarConfigApp.onUniformDays,
      exportCalendar: CalendarConfigApp.onExportCalendar,
      importCalendar: CalendarConfigApp.onImportCalendar,
      discardImport: CalendarConfigApp.onDiscardImport
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/calendar-config.hbs`,
      scrollable: [".tta-config-body"]
    }
  };

  async _prepareContext() {
    const calendar = this.draft.calendar;
    const validation = validateCalendarData(this.draft);
    // The date fields are about to be painted from the draft, so that is what
    // "unedited" means from here until the next render.
    this.openingDate = { ...calendar.currentDate };

    return {
      calendar,
      limits: LIMITS,
      weekdayCount: calendar.weekdayNames.length,
      monthNames: calendar.monthNames.map((name, index) => ({
        index,
        number: index + 1,
        name,
        length: daysInMonth(index + 1, calendar)
      })),
      weekdayNames: calendar.weekdayNames.map((name, index) => ({ index, number: index + 1, name })),
      weekdayChoices: calendar.weekdayNames.map((name, index) => ({
        value: index,
        label: name,
        selected: index === (calendar.weekdayOffset ?? 0)
      })),
      currentMonthDays: daysInMonth(calendar.currentDate.month, calendar),
      yearPreview: yearWithAffixes(calendar.currentDate.year, calendar)
        ?? t("TTA.Format.YearPlain", { year: calendar.currentDate.year }),
      presetChoices: presets.PRESET_IDS.map(id => ({
        value: id,
        label: t(presets.presetKeys(id).label),
        selected: id === this.presetId
      })),
      presetDescription: this.presetId ? t(presets.presetKeys(this.presetId).description) : "",
      pendingHolidayCount: this.pendingHolidays?.length ?? null,
      hasPendingHolidays: Array.isArray(this.pendingHolidays) && this.pendingHolidays.length > 0,
      monthChoices: calendar.monthNames.map((name, index) => ({
        value: index + 1,
        label: name,
        selected: index + 1 === calendar.currentDate.month
      })),
      ages: sortAges(this.draft.ages).map(age => ({
        ...age,
        endYear: endYear(age)
      })),
      hasAges: this.draft.ages.length > 0,
      moons: sortMoons(calendar.moons).map(moon => this.#decorateMoon(moon)),
      hasMoons: calendar.moons.length > 0,
      canAddMoon: calendar.moons.length < LIMITS.MOONS_MAX,
      moonsMax: LIMITS.MOONS_MAX,
      pendingEventCount: this.pendingEvents?.length ?? null,
      hasPendingImport: Array.isArray(this.pendingEvents),
      errors: validation.errors.map(error => t(`TTA.Validation.${error.code}`, error.data)),
      warnings: validation.warnings.map(warning => t(`TTA.Validation.${warning.code}`, warning.data)),
      isValid: validation.valid,
      folderName: journal.getFolder()?.name ?? null
    };
  }

  /** A moon row plus its phase on the draft's current date, for the preview. */
  #decorateMoon(moon) {
    const calendar = this.draft.calendar;
    const phase = describePhase(moon, toAbsoluteDay(calendar.currentDate, calendar));
    return {
      ...moon,
      offsetMax: Math.ceil(moon.cycleLength) - 1,
      phaseLabel: t(`TTA.Moons.Phase.${phase.phaseKey}`),
      illumination: phase.illumination,
      terminator: phase.terminator,
      gibbous: phase.gibbous,
      waxing: phase.waxing,
      phaseChoices: MOON_PHASE_COUNTS.map(count => ({
        value: count,
        label: t("TTA.Moons.PhaseCountOption", { count }),
        selected: count === moon.phaseCount
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const input of this.element.querySelectorAll("[data-structure]")) {
      input.addEventListener("change", this.#onStructureChange.bind(this));
    }

    const picker = this.element.querySelector("[data-preset-select]");
    if (picker) {
      picker.value = this.presetId;
      picker.addEventListener("change", () => {
        this.presetId = picker.value;
        const hint = this.element.querySelector("[data-preset-description]");
        if (hint) hint.textContent = this.presetId ? t(presets.presetKeys(this.presetId).description) : "";
      });
    }
  }

  /** Counts changed: capture the draft, resize the name lists, and re-render. */
  #onStructureChange() {
    this.#readForm();
    this.render();
  }

  /** Read the whole form back into the draft. */
  #readForm() {
    const root = this.element;
    if (!root) return this.draft;

    const number = (selector, fallback) => {
      const value = Number(root.querySelector(selector)?.value);
      return Number.isFinite(value) ? Math.trunc(value) : fallback;
    };

    const previous = this.draft.calendar;
    const monthsPerYear = Math.min(Math.max(number("[name='monthsPerYear']", previous.monthsPerYear), LIMITS.MONTHS_MIN), LIMITS.MONTHS_MAX);
    const daysPerMonth = Math.min(Math.max(number("[name='daysPerMonth']", previous.daysPerMonth), LIMITS.DAYS_MIN), LIMITS.DAYS_MAX);
    const weekdayCount = Math.min(Math.max(number("[name='weekdayCount']", previous.weekdayNames.length), LIMITS.WEEKDAYS_MIN), LIMITS.WEEKDAYS_MAX);

    const monthNames = [...root.querySelectorAll("[data-month-name]")].map(input => input.value);
    const monthLengths = resizeMonthLengths(
      [...root.querySelectorAll("[data-month-days]")].map(input => Number(input.value)),
      monthsPerYear,
      daysPerMonth
    );
    const weekdayNames = [...root.querySelectorAll("[data-weekday-name]")].map(input => input.value);
    const weekdayOffset = Math.min(Math.max(number("[name='weekdayOffset']", previous.weekdayOffset ?? 0), 0), weekdayCount - 1);
    const text = (selector, fallback) => root.querySelector(selector)?.value ?? fallback;

    const moons = [...root.querySelectorAll("[data-moon-row]")].map((row, index) => {
      const cycleLength = clampCycleLength(row.querySelector("[data-field='cycleLength']")?.value);
      // The offset is whole days into a cycle that need not be a whole number,
      // so it wraps at the cycle's last day rather than at the cycle itself.
      const wrapAt = Math.ceil(cycleLength);
      const rawOffset = Math.trunc(Number(row.querySelector("[data-field='offset']")?.value)) || 0;
      return {
        id: row.dataset.moonId,
        name: row.querySelector("[data-field='name']")?.value ?? "",
        cycleLength,
        offset: ((rawOffset % wrapAt) + wrapAt) % wrapAt,
        phaseCount: Number(row.querySelector("[data-field='phaseCount']")?.value) || DEFAULT_MOON_PHASE_COUNT,
        color: row.querySelector("[data-field='color']")?.value || DEFAULT_MOON_COLOR,
        showInGrid: row.querySelector("[data-field='showInGrid']")?.checked ?? true,
        playerVisible: row.querySelector("[data-field='playerVisible']")?.checked ?? true,
        sortOrder: index
      };
    });

    const currentMonth = Math.min(Math.max(1, number("[name='currentMonth']", previous.currentDate.month)), monthsPerYear);

    const ages = [...root.querySelectorAll("[data-age-row]")].map((row, index) => ({
      id: row.dataset.ageId,
      name: row.querySelector("[data-field='name']")?.value ?? "",
      startYear: Number(row.querySelector("[data-field='startYear']")?.value) || LIMITS.YEAR_MIN,
      durationYears: Number(row.querySelector("[data-field='durationYears']")?.value) || LIMITS.AGE_DURATION_MIN,
      description: row.querySelector("[data-field='description']")?.value ?? "",
      color: row.querySelector("[data-field='color']")?.value || DEFAULT_COLOR,
      playerVisible: row.querySelector("[data-field='playerVisible']")?.checked ?? true,
      sortOrder: index
    }));

    // Hold a date inside the calendar the form is currently describing, which
    // may have fewer months or shorter ones than the stored calendar does.
    const fitToDraft = date => {
      const month = Math.min(Math.max(1, Math.trunc(date.month)), monthsPerYear);
      return {
        year: Math.max(LIMITS.YEAR_MIN, Math.trunc(date.year)),
        month,
        day: Math.min(Math.max(1, Math.trunc(date.day)), monthLengths[month - 1])
      };
    };

    // This window can sit open for a whole session while the campaign date
    // moves in the calendar window. Date fields the GM actually edited are
    // theirs to keep; fields still holding what the window opened with take
    // whatever the shared calendar says now, so saving configuration can never
    // rewind the campaign. The clock has no field here at all, so it is always
    // read live rather than carried in the draft.
    const live = getData().calendar;
    const formDate = fitToDraft({
      year: number("[name='currentYear']", previous.currentDate.year),
      month: currentMonth,
      day: number("[name='currentDay']", previous.currentDate.day)
    });
    const dateEdited = formDate.year !== this.openingDate.year
      || formDate.month !== this.openingDate.month
      || formDate.day !== this.openingDate.day;

    this.draft = {
      ...this.draft,
      calendar: {
        monthsPerYear,
        daysPerMonth,
        monthNames: resizeNames(monthNames, monthsPerYear, DEFAULT_MONTH_NAMES, t("TTA.Config.MonthFallback")),
        monthLengths,
        weekdayNames: resizeNames(weekdayNames, weekdayCount, DEFAULT_WEEKDAY_NAMES, t("TTA.Config.WeekdayFallback")),
        weekdayOffset,
        currentDate: dateEdited ? formDate : fitToDraft(live.currentDate),
        currentTime: live.currentTime,
        yearPrefix: text("[name='yearPrefix']", previous.yearPrefix ?? ""),
        yearSuffix: text("[name='yearSuffix']", previous.yearSuffix ?? ""),
        moons
      },
      ages
    };
    return this.draft;
  }

  static async onAddAge() {
    this.#readForm();
    const last = sortAges(this.draft.ages).at(-1);
    const startYear = last ? endYear(last) + 1 : LIMITS.YEAR_MIN;
    this.draft.ages.push({
      id: randomID(),
      name: t("TTA.Config.NewAgeName"),
      startYear,
      durationYears: 100,
      description: "",
      color: DEFAULT_COLOR,
      playerVisible: true,
      sortOrder: this.draft.ages.length
    });
    this.render();
  }

  static async onRemoveAge(event, target) {
    this.#readForm();
    const id = target.closest("[data-age-row]")?.dataset.ageId;
    const age = this.draft.ages.find(a => a.id === id);
    if (!age) return;

    const eventCount = timeline.countEventsInAgeRange(age);
    const confirmed = await confirmDialog({
      title: t("TTA.Config.RemoveAgeTitle"),
      content: `<p>${t("TTA.Config.RemoveAgeBody", { name: age.name })}</p>`
        + (eventCount ? `<p class="notification warning">${t("TTA.Config.RemoveAgeEvents", { count: eventCount })}</p>` : "")
    });
    if (!confirmed) return;

    this.draft.ages = this.draft.ages.filter(a => a.id !== id);
    this.render();
  }

  static async onMoveAgeUp(event, target) {
    this.#moveAge(target, -1);
  }

  static async onMoveAgeDown(event, target) {
    this.#moveAge(target, 1);
  }

  #moveAge(target, delta) {
    this.#readForm();
    const id = target.closest("[data-age-row]")?.dataset.ageId;
    const ordered = sortAges(this.draft.ages);
    const index = ordered.findIndex(age => age.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    this.draft.ages = ordered.map((age, i) => ({ ...age, sortOrder: i }));
    this.render();
  }

  static async onAddMoon() {
    this.#readForm();
    const moons = this.draft.calendar.moons;
    if (moons.length >= LIMITS.MOONS_MAX) {
      ui.notifications.warn(t("TTA.Moons.LimitReached", { max: LIMITS.MOONS_MAX }));
      return;
    }
    // Pick the first unused default so a new row never collides with an
    // existing name, which would fail validation on save.
    const taken = new Set(moons.map(moon => String(moon.name ?? "").trim().toLowerCase()));
    const name = DEFAULT_MOON_NAMES.find(candidate => !taken.has(candidate.toLowerCase()))
      ?? t("TTA.Moons.NewMoonName");

    moons.push({
      id: randomID(),
      name,
      cycleLength: 28,
      offset: 0,
      phaseCount: DEFAULT_MOON_PHASE_COUNT,
      color: DEFAULT_MOON_COLOR,
      showInGrid: true,
      playerVisible: true,
      sortOrder: moons.length
    });
    this.render();
  }

  static async onRemoveMoon(event, target) {
    this.#readForm();
    const id = target.closest("[data-moon-row]")?.dataset.moonId;
    const moon = this.draft.calendar.moons.find(m => m.id === id);
    if (!moon) return;

    const confirmed = await confirmDialog({
      title: t("TTA.Moons.RemoveTitle"),
      content: `<p>${t("TTA.Moons.RemoveBody", { name: moon.name })}</p>`,
      yesLabel: t("TTA.Common.Remove"),
      yesIcon: "fa-solid fa-trash"
    });
    if (!confirmed) return;

    this.draft.calendar.moons = this.draft.calendar.moons.filter(m => m.id !== id);
    this.render();
  }

  static async onMoveMoonUp(event, target) {
    this.#moveMoon(target, -1);
  }

  static async onMoveMoonDown(event, target) {
    this.#moveMoon(target, 1);
  }

  #moveMoon(target, delta) {
    this.#readForm();
    const id = target.closest("[data-moon-row]")?.dataset.moonId;
    const ordered = sortMoons(this.draft.calendar.moons);
    const index = ordered.findIndex(moon => moon.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    this.draft.calendar.moons = ordered.map((moon, i) => ({ ...moon, sortOrder: i }));
    this.render();
  }

  /**
   * Load a bundled setting calendar into the draft.
   *
   * This deliberately mirrors the JSON import below: the preset replaces the
   * draft and stages its holidays, but nothing reaches the world until the GM
   * reviews the result and saves.
   */
  static async onLoadPreset() {
    if (!canConfigureCalendar()) {
      ui.notifications.warn(t("TTA.Errors.GMOnly"));
      return;
    }

    this.#readForm();
    const id = this.element?.querySelector("[data-preset-select]")?.value ?? "";
    const preset = presets.getPreset(id);
    if (!preset) {
      ui.notifications.warn(t("TTA.Presets.SelectFirst"));
      return;
    }

    const keys = presets.presetKeys(id);
    const data = presets.buildPresetData(id);
    const wantsHolidays = this.element?.querySelector("[data-preset-holidays]")?.checked ?? true;
    const holidays = wantsHolidays ? presets.buildPresetHolidays(id) : [];

    const summary = portability.summarizeImport({ data }, getData());
    const rows = [
      t("TTA.Import.RowMonths", summary.months),
      t("TTA.Import.RowYearLength", summary.yearLength),
      t("TTA.Import.RowWeekdays", summary.weekdays),
      t("TTA.Import.RowMoons", summary.moons),
      t("TTA.Import.RowAges", summary.ages),
      t("TTA.Presets.RowHolidays", { count: holidays.length })
    ];
    const caveats = (preset.caveats ?? []).map(key => `<li>${t(key)}</li>`).join("");

    const confirmed = await confirmDialog({
      title: t("TTA.Presets.ConfirmTitle"),
      content: `<p>${t("TTA.Presets.ConfirmBody", { name: t(keys.label) })}</p>`
        + `<ul>${rows.map(row => `<li>${row}</li>`).join("")}</ul>`
        + (caveats ? `<p class="notification warning">${t("TTA.Presets.CaveatsHeading")}</p><ul>${caveats}</ul>` : "")
        + `<p>${t("TTA.Import.ReviewHint")}</p>`,
      yesLabel: t("TTA.Presets.Load")
    });
    if (!confirmed) return;

    this.draft = data;
    this.presetId = id;
    this.pendingHolidays = holidays.length ? holidays : null;
    ui.notifications.info(t("TTA.Presets.Loaded", { name: t(keys.label) }));
    this.render();
  }

  /** Drop staged holiday notes without touching the loaded calendar draft. */
  static async onDiscardHolidays() {
    this.#readForm();
    this.pendingHolidays = null;
    this.render();
  }

  /** Give every month the same length, taken from the default days field. */
  static async onUniformDays() {
    this.#readForm();
    const { daysPerMonth, monthsPerYear } = this.draft.calendar;
    this.draft.calendar.monthLengths = Array(monthsPerYear).fill(daysPerMonth);
    this.render();
  }

  /** Download the draft as a JSON file, optionally with the stored events. */
  static async onExportCalendar() {
    this.#readForm();
    const includeEvents = this.element?.querySelector("[data-export-events]")?.checked ?? true;
    const payload = portability.buildExportPayload({
      calendar: this.draft.calendar,
      ages: this.draft.ages,
      events: includeEvents ? timeline.getEvents() : null,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "",
      worldTitle: game.world?.title ?? ""
    });
    if (portability.downloadExport(payload)) {
      ui.notifications.info(t("TTA.Notifications.CalendarExported"));
    }
  }

  /**
   * Load a JSON export into the draft. Nothing is written to the world until
   * the GM reviews the result and submits the form.
   */
  static async onImportCalendar() {
    if (!canConfigureCalendar()) {
      ui.notifications.warn(t("TTA.Errors.GMOnly"));
      return;
    }

    const file = await CalendarConfigApp.#pickFile();
    if (!file) return;

    const text = await portability.readImportFile(file);
    if (text === null) {
      ui.notifications.error(t("TTA.Errors.ImportUnreadable"));
      return;
    }

    const parsed = portability.parseImport(text);
    if (!parsed.ok) {
      const message = parsed.errors.map(error => t(`TTA.Validation.${error.code}`, error.data)).join(" ");
      ui.notifications.error(message || t("TTA.Errors.ImportInvalid"));
      return;
    }

    const summary = portability.summarizeImport(parsed, getData());
    const rows = [
      t("TTA.Import.RowMonths", summary.months),
      t("TTA.Import.RowYearLength", summary.yearLength),
      t("TTA.Import.RowWeekdays", summary.weekdays),
      t("TTA.Import.RowMoons", summary.moons),
      t("TTA.Import.RowAges", summary.ages)
    ];
    if (summary.events !== null) rows.push(t("TTA.Import.RowEvents", { count: summary.events }));

    const problems = [...parsed.errors, ...parsed.warnings]
      .map(entry => `<li>${t(`TTA.Validation.${entry.code}`, entry.data)}</li>`)
      .join("");

    const confirmed = await confirmDialog({
      title: t("TTA.Import.ConfirmTitle"),
      content: `<p>${t("TTA.Import.ConfirmBody", { name: file.name })}</p>`
        + `<ul>${rows.map(row => `<li>${row}</li>`).join("")}</ul>`
        + (problems ? `<p class="notification warning">${t("TTA.Import.ProblemsHeading")}</p><ul>${problems}</ul>` : "")
        + `<p>${t("TTA.Import.ReviewHint")}</p>`,
      yesLabel: t("TTA.Import.Load")
    });
    if (!confirmed) return;

    this.draft = parsed.data;
    this.pendingEvents = parsed.events;
    ui.notifications.info(t("TTA.Notifications.CalendarImported"));
    this.render();
  }

  /** Drop staged import events without touching the loaded calendar draft. */
  static async onDiscardImport() {
    this.pendingEvents = null;
    this.render();
  }

  /**
   * Create the staged holiday notes as ordinary calendar notes.
   *
   * Failures are logged and counted rather than thrown: a single bad page
   * should not abandon a configuration the GM has already saved.
   */
  async #createStagedHolidays() {
    let created = 0;
    for (const holiday of this.pendingHolidays) {
      try {
        const page = await note.createNote(holiday);
        if (page) created += 1;
      } catch (error) {
        log("error", "Failed to create a preset holiday note", holiday, error);
      }
    }
    return created;
  }

  /** Prompt for a single JSON file, resolving null when the GM cancels. */
  static #pickFile() {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
  }

  static async onResetNames() {
    this.#readForm();
    const { monthsPerYear, weekdayNames } = this.draft.calendar;
    this.draft.calendar.monthNames = resizeNames([], monthsPerYear, DEFAULT_MONTH_NAMES, t("TTA.Config.MonthFallback"));
    this.draft.calendar.weekdayNames = resizeNames([], weekdayNames.length, DEFAULT_WEEKDAY_NAMES, t("TTA.Config.WeekdayFallback"));
    this.render();
  }

  static async onRepairFolder() {
    const result = await journal.repairFolder();
    if (!result) {
      ui.notifications.warn(t("TTA.Errors.GMOnly"));
      return;
    }
    ui.notifications.info(t("TTA.Notifications.FolderRepaired", { count: result.repaired }));
    this.render();
  }

  /** Validate, warn about structural consequences, then persist. */
  static async onSubmit() {
    if (!canConfigureCalendar()) {
      ui.notifications.warn(t("TTA.Errors.GMOnly"));
      return;
    }
    this.#readForm();

    const validation = validateCalendarData(this.draft);
    if (!validation.valid) {
      ui.notifications.error(t("TTA.Errors.ConfigInvalid"));
      this.render();
      return;
    }

    const noteUsage = journal.getDateUsage();
    const eventUsage = timeline.getDateUsage();
    const usage = {
      maxMonth: Math.max(noteUsage.maxMonth, eventUsage.maxMonth),
      maxDay: Math.max(noteUsage.maxDay, eventUsage.maxDay),
      count: noteUsage.count + eventUsage.count
    };

    const stored = getData().calendar;
    const warnings = [
      ...structuralChangeWarnings(this.draft.calendar, usage, stored),
      ...validation.warnings
    ];
    if (Array.isArray(this.pendingEvents)) {
      warnings.push({
        code: "importReplacesEvents",
        data: { count: this.pendingEvents.length, existing: eventUsage.count }
      });
    }

    if (warnings.length) {
      const list = warnings.map(warning => `<li>${t(`TTA.Validation.${warning.code}`, warning.data)}</li>`).join("");
      const confirmed = await confirmDialog({
        title: t("TTA.Config.ConfirmChangesTitle"),
        content: `<p>${t("TTA.Config.ConfirmChangesBody")}</p><ul>${list}</ul>`,
        yesLabel: t("TTA.Config.ApplyAnyway")
      });
      if (!confirmed) return;
    }

    try {
      await saveData(this.draft);
      if (Array.isArray(this.pendingEvents)) {
        await timeline.replaceEvents(this.pendingEvents);
        this.pendingEvents = null;
      }
      await journal.ensureFolder();
      if (Array.isArray(this.pendingHolidays)) {
        const created = await this.#createStagedHolidays();
        this.pendingHolidays = null;
        ui.notifications.info(t("TTA.Presets.HolidaysCreated", { count: created }));
      }
      ui.notifications.info(t("TTA.Notifications.ConfigSaved"));
      this.render();
    } catch (error) {
      log("error", "Failed to save calendar configuration", error);
      ui.notifications.error(error.message ?? t("TTA.Errors.ConfigSaveFailed"));
    }
  }
}
