/**
 * The main calendar window: the single entry point, reached from the Calendar
 * button in the Journal sidebar.
 *
 * Browsing state (viewed month, selected day, active filter) is local to each
 * client. Only the GM time controls change the shared campaign date.
 */

import { confirmDialog, enrichHTML, html, isDebug, log, promptForm, renderTemplate, t, trustedHTML } from "../compat.js";
import { MODULE_ID, SCOPE } from "../constants.js";
import { endYear } from "../services/age-service.js";
import {
  advanceDays,
  advanceMonths,
  advanceTime,
  advanceTo,
  advanceToNextAdventureDay,
  acknowledgeWorldTime,
  formatDate,
  formatTime,
  formatMonth,
  formatYear,
  getAgeForYear,
  getCalendar,
  getCurrentAge,
  getCurrentDate,
  getCurrentTime,
  getMoonPhases,
  getVisibleMoons,
  isConfigured,
  isWorldTimeOutOfSync,
} from "../services/calendar-service.js";
import {
  addMonths,
  addYears,
  buildMonthGrid,
  clampDate,
  dayKey,
  daysInMonth,
  isSameDay,
  isSameMonth,
  monthKey,
  monthName,
  toAbsoluteDay,
  weekdayName
} from "../services/date-service.js";
import { describePhase } from "../services/moon-service.js";
import { getFolder as getNotesFolder } from "../services/journal-service.js";
import {
  deleteNote,
  filterNotes,
  getFilterChoices,
  getMonthNoteCounts,
  getNotesForKey
} from "../services/note-service.js";
import {
  allowedNoteScopes,
  canChangeTime,
  canConfigureCalendar,
  canPromoteNotes,
  canViewTimeline,
  isGM
} from "../services/permission-service.js";
import {
  getEventsForDay,
  getEventsForMonth,
  getMonthEventCounts
} from "../services/timeline-service.js";
import { CalendarConfigApp } from "./calendar-config-app.js";
import { EventEditorApp } from "./event-editor-app.js";
import { NoteEditorApp } from "./note-editor-app.js";
import { TimelineApp } from "./timeline-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CalendarApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super({ ...options, id: "tta-calendar" });
    const current = getCurrentDate();
    this.viewYear = current.year;
    this.viewMonth = current.month;
    this.selectedDay = current.day;
    this.filter = "all";
    this.timePreset = "minute";
  }

  /** Ticket of the most recent detail repaint, used to discard stale ones. */
  #detailPass = 0;

  static DEFAULT_OPTIONS = {
    classes: ["tta", "tta-app", "tta-calendar"],
    tag: "div",
    window: {
      icon: "fa-solid fa-calendar-days",
      title: "TTA.Calendar.Title",
      resizable: true
    },
    position: { width: 980, height: 720 },
    actions: {
      prevMonth: CalendarApp.onPrevMonth,
      nextMonth: CalendarApp.onNextMonth,
      prevYear: CalendarApp.onPrevYear,
      nextYear: CalendarApp.onNextYear,
      gotoCurrent: CalendarApp.onGotoCurrent,
      selectDay: CalendarApp.onSelectDay,
      nextDay: CalendarApp.onNextDay,
      advanceTime: CalendarApp.onAdvanceTime,
      acknowledgeWorldTime: CalendarApp.onAcknowledgeWorldTime,
      setDate: CalendarApp.onSetDate,
      setSelectedAsCurrent: CalendarApp.onSetSelectedAsCurrent,
      openConfig: CalendarApp.onOpenConfig,
      openTimeline: CalendarApp.onOpenTimeline,
      addDayNote: CalendarApp.onAddDayNote,
      addMonthNote: CalendarApp.onAddMonthNote,
      editNote: CalendarApp.onEditNote,
      deleteNote: CalendarApp.onDeleteNote,
      promoteNote: CalendarApp.onPromoteNote,
      openJournal: CalendarApp.onOpenJournal,
      openNotesFolder: CalendarApp.onOpenNotesFolder
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/calendar.hbs`,
      scrollable: [".tta-grid-wrap", ".tta-detail"]
    }
  };

  get title() {
    return t("TTA.Calendar.Title");
  }

  /** The date currently selected for the detail panel. */
  get selectedDate() {
    return { year: this.viewYear, month: this.viewMonth, day: this.selectedDay };
  }

  async _prepareContext() {
    const calendar = getCalendar();
    const current = getCurrentDate();
    const gm = isGM();

    // Keep browsing state inside the configured bounds after a reconfiguration.
    this.viewMonth = Math.min(Math.max(1, this.viewMonth), calendar.monthsPerYear);
    this.selectedDay = Math.min(Math.max(1, this.selectedDay), daysInMonth(this.viewMonth, calendar));

    const grid = buildMonthGrid(this.viewYear, this.viewMonth, calendar);
    const noteCounts = getMonthNoteCounts(this.viewYear, this.viewMonth);
    const eventCounts = getMonthEventCounts(this.viewYear, this.viewMonth);
    const gridMoons = getVisibleMoons().filter(moon => moon.showInGrid !== false);

    const weeks = grid.weeks.map(week => week.map(cell => {
      if (cell.day === null) return { empty: true };
      const date = { year: this.viewYear, month: this.viewMonth, day: cell.day };
      const notes = noteCounts[cell.day] ?? 0;
      const events = eventCounts[cell.day] ?? 0;
      const absoluteDay = toAbsoluteDay(date, calendar);
      return {
        empty: false,
        day: cell.day,
        // Only the days a moon turns over into a new phase carry a disc; the
        // detail panel still reports the phase for every day.
        moons: gridMoons
          .map(moon => describePhase(moon, absoluteDay))
          .filter(phase => phase.isPhaseChange),
        // The cell shows at most three note dots and two event dots; the exact
        // counts stay in the cell's accessible label.
        noteDots: new Array(Math.min(notes, 3)).fill(true),
        eventDots: new Array(Math.min(events, 2)).fill(true),
        dateKey: dayKey(date.year, date.month, date.day),
        weekday: weekdayName(date, calendar),
        isCurrent: isSameDay(date, current),
        isSelected: cell.day === this.selectedDay,
        noteCount: notes,
        eventCount: events,
        hasNotes: notes > 0,
        hasEvents: events > 0,
        label: t("TTA.Calendar.DayCellLabel", {
          day: cell.day,
          month: monthName(this.viewMonth, calendar),
          year: this.viewYear,
          notes,
          events
        })
      };
    }));

    const selectedKey = dayKey(this.viewYear, this.viewMonth, this.selectedDay);
    const monthNoteKey = monthKey(this.viewYear, this.viewMonth);

    const dayNotes = await this.#decorate(filterNotes(getNotesForKey(selectedKey), this.filter));
    const monthNotes = await this.#decorate(filterNotes(getNotesForKey(monthNoteKey), this.filter));

    const dayEvents = getEventsForDay(this.viewYear, this.viewMonth, this.selectedDay);
    const monthEvents = getEventsForMonth(this.viewYear, this.viewMonth);
    const viewAge = getAgeForYear(this.viewYear);
    const currentAge = getCurrentAge();
    const scopes = allowedNoteScopes();

    return {
      isGM: gm,
      configured: isConfigured(),
      calendar,
      weekdayNames: calendar.weekdayNames,
      weeks,
      viewYear: this.viewYear,
      viewYearLabel: formatYear(this.viewYear, calendar),
      viewMonth: this.viewMonth,
      viewMonthName: monthName(this.viewMonth, calendar),
      viewLabel: formatMonth(this.viewYear, this.viewMonth),
      viewingCurrentMonth: isSameMonth({ year: this.viewYear, month: this.viewMonth }, current),
      currentDate: current,
      currentDateLabel: formatDate(current),
      currentTimeLabel: formatTime(),
      currentAge: currentAge ? { ...currentAge, endYear: endYear(currentAge) } : null,
      viewAge: viewAge ? { ...viewAge, endYear: endYear(viewAge) } : null,
      selectedDay: this.selectedDay,
      currentMoons: getMoonPhases(current),
      selectedMoons: getMoonPhases(this.selectedDate),
      selectedKey,
      selectedLabel: formatDate(this.selectedDate),
      selectedIsCurrent: isSameDay(this.selectedDate, current),
      monthNoteKey,
      dayNotes,
      monthNotes,
      dayEvents,
      monthEvents,
      hasDayContent: dayNotes.length > 0 || dayEvents.length > 0,
      canChangeTime: canChangeTime(),
      worldTimeOutOfSync: isWorldTimeOutOfSync(),
      canConfigure: canConfigureCalendar(),
      canPromote: canPromoteNotes(),
      canViewTimeline: canViewTimeline(),
      timePresets: [
        "minute", "tenMinutes", "hour", "tenHours", "day", "adventureDay", "week", "month"
      ].map(value => ({
        value,
        label: t(`TTA.Time.Preset.${value}`),
        selected: value === this.timePreset
      })),
      canAddDayNote: scopes.includes(SCOPE.DAY),
      canAddMonthNote: scopes.includes(SCOPE.MONTH),
      // Two player-facing refusals the panel states rather than hides: notes
      // switched off by the GM, and no GM online to relay a write to.
      playerNotesDisabled: !gm && scopes.length === 0,
      noGMOnline: !gm && scopes.length > 0 && !game.users.some(user => user.isGM && user.active),
      showFilters: gm,
      filter: this.filter,
      filterChoices: getFilterChoices().map(choice => ({ ...choice, selected: choice.value === this.filter })),
      moduleVersion: isDebug() ? (game.modules.get(MODULE_ID)?.version ?? "") : ""
    };
  }

  /** Enrich note bodies only for the notes actually rendered in the panel. */
  async #decorate(notes) {
    return Promise.all(notes.map(async note => ({
      ...note,
      enriched: await enrichHTML(note.content)
    })));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#bindDetailListeners();
    const preset = this.element.querySelector("[data-time-preset]");
    preset?.addEventListener("change", event => {
      this.timePreset = event.currentTarget.value;
    });
  }

  /**
   * The filter select lives inside the detail panel, so its listener has to be
   * re-attached whenever that panel is repainted on its own.
   */
  #bindDetailListeners() {
    const filter = this.element.querySelector("[data-filter-select]");
    filter?.addEventListener("change", event => {
      this.filter = event.currentTarget.value;
      this.#refreshDetail();
    });
  }

  /**
   * Repaint only the detail panel and the grid's selection marks. Selecting a
   * day changes nothing else on screen, and a full render would rebuild the
   * window underneath the pointer: the grid would flash, its scroll position
   * would jump back to the top and the clicked day would lose focus.
   *
   * Preparing the context enriches note bodies, so two quick clicks can be in
   * flight at once and the earlier one can finish last. Each pass takes a ticket
   * and abandons its result if another pass has started meanwhile, so the panel
   * always ends up showing the day the grid says is selected.
   */
  async #refreshDetail() {
    const ticket = ++this.#detailPass;
    try {
      if (!this.rendered) return;
      const context = await this._prepareContext({});
      if (ticket !== this.#detailPass || !this.rendered) return;
      const html = await renderTemplate(
        `modules/${MODULE_ID}/templates/partials/day-detail.hbs`,
        context
      );
      if (ticket !== this.#detailPass || !this.rendered) return;
      const detail = this.element.querySelector(".tta-detail");
      if (!detail) return;
      detail.innerHTML = html;
      this.#markSelectedDay();
      this.#bindDetailListeners();
    } catch (error) {
      // A failed repaint leaves the previous panel in place: stale but readable,
      // where a full render would recover it at the cost of the flash this whole
      // path exists to avoid.
      log("error", "Failed to refresh the calendar detail panel", error);
    }
  }

  /** Move the selected-day styling and aria state to the current selection. */
  #markSelectedDay() {
    for (const button of this.element.querySelectorAll(".tta-day-button")) {
      const isSelected = Number(button.dataset.day) === this.selectedDay;
      button.setAttribute("aria-pressed", String(isSelected));
      button.closest(".tta-day")?.classList.toggle("tta-day-selected", isSelected);
    }
  }

  /** Move the browsing view without touching world time. */
  #browse(date) {
    this.viewYear = date.year;
    this.viewMonth = date.month;
    this.render();
  }

  static onPrevMonth() {
    this.#browse(addMonths({ year: this.viewYear, month: this.viewMonth, day: 1 }, -1, getCalendar()));
  }

  static onNextMonth() {
    this.#browse(addMonths({ year: this.viewYear, month: this.viewMonth, day: 1 }, 1, getCalendar()));
  }

  static onPrevYear() {
    this.#browse(addYears({ year: this.viewYear, month: this.viewMonth, day: 1 }, -1, getCalendar()));
  }

  static onNextYear() {
    this.#browse(addYears({ year: this.viewYear, month: this.viewMonth, day: 1 }, 1, getCalendar()));
  }

  static onGotoCurrent() {
    const current = getCurrentDate();
    this.viewYear = current.year;
    this.viewMonth = current.month;
    this.selectedDay = current.day;
    this.render();
  }

  static onSelectDay(event, target) {
    const day = Number(target.dataset.day);
    if (!Number.isInteger(day) || day === this.selectedDay) return;
    this.selectedDay = day;
    // Move the marks before awaiting anything, so the grid answers the click
    // immediately even while the panel is still being built.
    this.#markSelectedDay();
    this.#refreshDetail();
  }

  static async onNextDay() {
    await advanceDays(1);
    CalendarApp.onGotoCurrent.call(this);
  }

  static async onAdvanceTime() {
    const advances = {
      minute: () => advanceTime(60),
      tenMinutes: () => advanceTime(600),
      hour: () => advanceTime(3600),
      tenHours: () => advanceTime(36000),
      day: () => advanceTime(86400),
      adventureDay: () => advanceToNextAdventureDay(),
      week: () => advanceTime(604800),
      month: () => advanceMonths(1)
    };
    await advances[this.timePreset]?.();
    CalendarApp.onGotoCurrent.call(this);
  }

  static async onAcknowledgeWorldTime() {
    if (await acknowledgeWorldTime()) this.render();
  }

  static async onSetDate() {
    await CalendarApp.#promptForCurrentDate.call(this, getCurrentDate());
  }

  /**
   * Move the campaign date to the day selected in the grid.
   *
   * This is the only way back to an earlier date from the window: a backwards
   * move takes a deliberate day selection and two confirmations rather than one
   * click on a control that sits beside its opposite.
   */
  static async onSetSelectedAsCurrent() {
    await CalendarApp.#promptForCurrentDate.call(this, this.selectedDate);
  }

  /** The Set Date form, opened over whichever date the caller starts from. */
  static async #promptForCurrentDate(startDate) {
    const calendar = getCalendar();
    const current = clampDate(startDate, calendar);
    const currentTime = getCurrentTime();
    const monthOptions = calendar.monthNames
      .map((name, index) => html`<option value="${index + 1}" ${trustedHTML(index + 1 === current.month ? "selected" : "")}>${name}</option>`)
      .join("");

    const result = await promptForm({
      title: t("TTA.Time.SetDateTitle"),
      content: html`<div class="tta-prompt tta-prompt-grid">
        <label for="tta-set-year">${t("TTA.Common.Year")}</label>
        <input id="tta-set-year" type="number" name="year" min="1" step="1" value="${current.year}">
        <label for="tta-set-month">${t("TTA.Common.Month")}</label>
        <select id="tta-set-month" name="month">${trustedHTML(monthOptions)}</select>
        <label for="tta-set-day">${t("TTA.Common.Day")}</label>
        <input id="tta-set-day" type="number" name="day" min="1" max="${daysInMonth(current.month, calendar)}" step="1" value="${current.day}">
        <label for="tta-set-hour">${t("TTA.Common.Time")}</label>
        <div class="tta-time-inputs">
          <input id="tta-set-hour" type="number" name="hour" min="0" max="23" step="1" value="${currentTime.hour}" aria-label="${t("TTA.Time.Hour")}">
          <span aria-hidden="true">:</span>
          <input type="number" name="minute" min="0" max="59" step="1" value="${currentTime.minute}" aria-label="${t("TTA.Time.Minute")}">
        </div>
      </div>`,
      okLabel: t("TTA.Time.SetDate")
    });
    if (!result) return;

    const confirmed = await confirmDialog({
      title: t("TTA.Time.SetDateConfirmTitle"),
      content: `<p>${t("TTA.Time.SetDateConfirmBody")}</p>`,
      yesLabel: t("TTA.Time.SetDate")
    });
    if (!confirmed) return;

    await advanceTo({
      year: Number(result.year),
      month: Number(result.month),
      day: Number(result.day)
    }, { hour: Number(result.hour), minute: Number(result.minute) });
    CalendarApp.onGotoCurrent.call(this);
  }

  static onOpenConfig() {
    if (!canConfigureCalendar()) return ui.notifications.warn(t("TTA.Errors.GMOnly"));
    new CalendarConfigApp().render({ force: true });
  }

  static onOpenTimeline() {
    if (!canViewTimeline()) return ui.notifications.warn(t("TTA.Errors.TimelineHidden"));
    new TimelineApp().render({ force: true });
  }

  static onAddDayNote() {
    new NoteEditorApp({ dateKey: dayKey(this.viewYear, this.viewMonth, this.selectedDay) }).render({ force: true });
  }

  static onAddMonthNote() {
    new NoteEditorApp({ dateKey: monthKey(this.viewYear, this.viewMonth) }).render({ force: true });
  }

  /** Locate a rendered note record by the uuid stored on its element. */
  #findNote(uuid) {
    const all = [
      ...getNotesForKey(dayKey(this.viewYear, this.viewMonth, this.selectedDay)),
      ...getNotesForKey(monthKey(this.viewYear, this.viewMonth))
    ];
    return all.find(note => note.uuid === uuid) ?? null;
  }

  static onEditNote(event, target) {
    const note = this.#findNote(target.dataset.uuid);
    if (!note) return ui.notifications.warn(t("TTA.Errors.NoteMissing"));
    new NoteEditorApp({ note }).render({ force: true });
  }

  static async onDeleteNote(event, target) {
    const note = this.#findNote(target.dataset.uuid);
    if (!note) return ui.notifications.warn(t("TTA.Errors.NoteMissing"));

    const confirmed = await confirmDialog({
      title: t("TTA.Notes.DeleteTitle"),
      content: html`<p>${t("TTA.Notes.DeleteBody", { title: note.title })}</p>`,
      yesLabel: t("TTA.Common.Delete"),
      yesIcon: "fa-solid fa-trash"
    });
    if (!confirmed) return;

    try {
      await deleteNote(note.uuid);
      ui.notifications.info(t("TTA.Notifications.NoteDeleted"));
      this.render();
    } catch (error) {
      log("error", "Failed to delete note", error);
      ui.notifications.error(error.message ?? t("TTA.Errors.NoteDeleteFailed"));
    }
  }

  static onPromoteNote(event, target) {
    if (!canPromoteNotes()) return ui.notifications.warn(t("TTA.Errors.PromoteGMOnly"));
    const note = this.#findNote(target.dataset.uuid);
    if (!note) return ui.notifications.warn(t("TTA.Errors.NoteMissing"));
    if (note.scope !== SCOPE.DAY) return ui.notifications.warn(t("TTA.Errors.PromoteDayOnly"));
    new EventEditorApp({ sourceNote: note }).render({ force: true });
  }

  static async onOpenJournal(event, target) {
    const document = await fromUuid(target.dataset.uuid);
    if (!document) return ui.notifications.warn(t("TTA.Errors.NoteMissing"));
    document.parent?.sheet?.render(true, { pageId: document.id });
  }

  /**
   * Reveal the Calendar Notes folder in Foundry's own journal directory:
   * activate the tab, expand the folder if it is collapsed, and scroll it into
   * view. The directory's markup differs between builds, so the folder is
   * located and expanded through the DOM rather than through internal state.
   */
  static async onOpenNotesFolder() {
    const folder = getNotesFolder();
    const directory = ui.journal;

    try {
      if (directory?.activate) directory.activate();
      else ui.sidebar?.changeTab?.("journal", "primary");
    } catch (error) {
      log("debug", "Could not activate the journal sidebar tab", error);
    }

    if (!folder) return ui.notifications.info(t("TTA.Errors.NoFolder"));

    await directory?.render?.({ force: true });
    const root = directory?.element instanceof HTMLElement ? directory.element : directory?.element?.[0];
    const element = root?.querySelector(`.folder[data-folder-id="${folder.id}"], [data-folder-id="${folder.id}"]`);
    if (!element) return;

    if (element.classList.contains("collapsed")) {
      element.querySelector(".folder-header, header, summary")?.click();
    }
    element.scrollIntoView({ block: "nearest" });
  }
}
