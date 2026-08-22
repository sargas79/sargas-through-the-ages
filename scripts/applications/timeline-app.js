/**
 * The visual timeline of Ages and historical events.
 *
 * Opened from the calendar window rather than from its own sidebar control, so
 * the module keeps a single entry point. Browsing here is always local: no
 * control in this window changes the shared campaign date.
 */

import { confirmDialog, enrichHTML, html, log, promptForm, renderTemplate, t, trustedHTML } from "../compat.js";
import { MODULE_ID, TIMELINE_MODE, VISIBILITY } from "../constants.js";
import { ageLength, endYear } from "../services/age-service.js";
import {
  formatDate,
  formatMonth,
  formatYear,
  getAgeForYear,
  getCalendar,
  getCurrentAge,
  getCurrentDate,
  getVisibleAges
} from "../services/calendar-service.js";
import { addMonths, addYears, daysInMonth, parseKey } from "../services/date-service.js";
import { getPromotableNotes } from "../services/note-service.js";
import { canManageEvents, canViewTimeline, isGM } from "../services/permission-service.js";
import {
  deleteEvent,
  getEventsForAge,
  getEventsForMonth,
  getEventsForYear,
  getEvent,
  getMode,
  groupEventsByYear,
  setMode
} from "../services/timeline-service.js";
import { EventEditorApp } from "./event-editor-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Years between regular ticks on the spine while the span is short enough. */
const TICK_INTERVAL = 5;

/** The most regular ticks the spine draws, whatever the span. */
const TICK_BUDGET = 40;

export class TimelineApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super({ ...options, id: "tta-timeline" });
    const current = getCurrentDate();
    this.viewYear = current.year;
    this.viewMonth = current.month;
    this.filter = "all";
  }

  /** Ticket of the most recent events repaint, used to discard stale ones. */
  #eventsPass = 0;

  static DEFAULT_OPTIONS = {
    classes: ["tta", "tta-app", "tta-timeline"],
    tag: "div",
    window: {
      icon: "fa-solid fa-hourglass-half",
      title: "TTA.Timeline.Title",
      resizable: true
    },
    position: { width: 880, height: 700 },
    actions: {
      setMode: TimelineApp.onSetMode,
      prev: TimelineApp.onPrev,
      next: TimelineApp.onNext,
      gotoCurrent: TimelineApp.onGotoCurrent,
      gotoAge: TimelineApp.onGotoAge,
      addEvent: TimelineApp.onAddEvent,
      promoteFromNote: TimelineApp.onPromoteFromNote,
      editEvent: TimelineApp.onEditEvent,
      deleteEvent: TimelineApp.onDeleteEvent,
      openSource: TimelineApp.onOpenSource
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/timeline.hbs`,
      scrollable: [".tta-timeline-body"]
    }
  };

  get title() {
    return t("TTA.Timeline.Title");
  }

  /** The Age that frames the current view, based on the browsed year. */
  get viewAge() {
    return getAgeForYear(this.viewYear) ?? getCurrentAge();
  }

  async _prepareContext() {
    const calendar = getCalendar();
    const current = getCurrentDate();
    const mode = getMode();
    const gm = isGM();
    const age = this.viewAge;

    let events = [];
    let years = [];
    if (mode === TIMELINE_MODE.MONTH) {
      events = getEventsForMonth(this.viewYear, this.viewMonth);
      years = [this.viewYear];
    } else if (mode === TIMELINE_MODE.YEAR) {
      events = getEventsForYear(this.viewYear);
      years = [this.viewYear];
    } else if (age) {
      events = getEventsForAge(age);
      // Deliberately not every year the Age covers. The grouping below adds a
      // year as soon as an event falls in it, and the filter drops the years
      // that stay empty, so listing the span up front only built groups to
      // throw away — one per year, on every render, for the whole Age.
      years = [];
    } else {
      events = getEventsForYear(this.viewYear);
      years = [this.viewYear];
    }

    events = this.#applyFilter(events);
    const decorated = await Promise.all(events.map(async event => this.#decorate(event, gm)));
    // A year with nothing recorded in it is never listed, in any mode: the
    // spine above already shows the shape of the span, so the list below only
    // carries the years that actually hold events.
    const grouped = groupEventsByYear(decorated, years, current.year)
      .filter(group => group.events.length > 0)
      .map(group => ({ ...group, yearLabel: formatYear(group.year, calendar) }));

    const bands = this.#buildBands(age);
    const ticks = this.#buildTicks(mode, calendar, current, age, events);

    return {
      bands,
      ticks,
      scopeLabel: this.#scopeLabel(mode, age),
      isGM: gm,
      canManage: canManageEvents(),
      canView: canViewTimeline(),
      mode,
      modes: [
        { value: TIMELINE_MODE.EXPANDED, label: t("TTA.Timeline.ModeExpanded"), active: mode === TIMELINE_MODE.EXPANDED },
        { value: TIMELINE_MODE.YEAR, label: t("TTA.Timeline.ModeYear"), active: mode === TIMELINE_MODE.YEAR },
        { value: TIMELINE_MODE.MONTH, label: t("TTA.Timeline.ModeMonth"), active: mode === TIMELINE_MODE.MONTH }
      ],
      isExpanded: mode === TIMELINE_MODE.EXPANDED,
      isYearMode: mode === TIMELINE_MODE.YEAR,
      isMonthMode: mode === TIMELINE_MODE.MONTH,
      age: age ? { ...age, endYear: endYear(age), yearCount: ageLength(age) } : null,
      hasAge: !!age,
      ages: getVisibleAges().map(a => ({ ...a, endYear: endYear(a), isCurrent: a.id === getCurrentAge()?.id })),
      viewYear: this.viewYear,
      viewMonth: this.viewMonth,
      viewMonthLabel: formatMonth(this.viewYear, this.viewMonth),
      currentDate: current,
      currentDateLabel: formatDate(current),
      groups: grouped,
      eventCount: decorated.length,
      isEmpty: decorated.length === 0,
      calendar,
      filter: this.filter,
      filterChoices: this.#filterChoices(gm)
    };
  }

  /**
   * The Age bands: one proportional block per visible Age. A band's share of
   * the row is its duration over the whole span, floored so a very short Age
   * stays wide enough to read.
   */
  #buildBands(viewAge) {
    const ages = getVisibleAges();
    const span = ages.reduce((total, age) => total + Number(age.durationYears), 0) || 1;
    const currentId = getCurrentAge()?.id;
    return ages.map(age => ({
      id: age.id,
      name: age.name,
      color: age.color,
      startYear: Number(age.startYear),
      endYear: endYear(age),
      yearCount: ageLength(age),
      flex: Math.max(Number(age.durationYears) / span, 0.14).toFixed(4),
      isCurrent: age.id === currentId,
      isViewed: age.id === viewAge?.id
    }));
  }

  /**
   * Ticks along the spine, positioned as a percentage of the browsed span.
   * A tick is drawn for the current position, for anything carrying an event,
   * and otherwise only at a regular interval, so a long Age stays legible.
   *
   * The marks come from the same filtered events the list below is built from,
   * never from a fresh query: a spine that marked events the active filter has
   * excluded would promise rows that are not there to find.
   *
   * @param {object[]} events the mode-scoped, filtered events being listed
   */
  #buildTicks(mode, calendar, current, age, events) {
    const ticks = [];

    if (mode === TIMELINE_MODE.MONTH) {
      const days = new Set(events.map(event => parseKey(event.dateKey)?.day));
      const inCurrentMonth = this.viewYear === current.year && this.viewMonth === current.month;
      const dayCount = daysInMonth(this.viewMonth, calendar);
      for (let day = 1; day <= dayCount; day++) {
        const hasEvent = days.has(day);
        ticks.push({
          position: (((day - 0.5) / dayCount) * 100).toFixed(3),
          label: (day % 5 === 0 || hasEvent) ? day : "",
          hasEvent,
          isCurrent: inCurrentMonth && day === current.day
        });
      }
      return ticks;
    }

    if (mode === TIMELINE_MODE.YEAR) {
      const months = new Set(events.map(event => parseKey(event.dateKey)?.month));
      calendar.monthNames.forEach((name, index) => {
        const month = index + 1;
        ticks.push({
          position: (((index + 0.5) / calendar.monthsPerYear) * 100).toFixed(3),
          label: String(name).slice(0, 3),
          hasEvent: months.has(month),
          isCurrent: this.viewYear === current.year && month === current.month
        });
      });
      return ticks;
    }

    if (!age) return ticks;

    const years = new Set(events.map(event => parseKey(event.dateKey)?.year));
    const start = Number(age.startYear);
    const last = endYear(age);
    const span = ageLength(age) || 1;

    // Regular ticks every fifth year while that stays legible, then spaced out
    // so their number is bounded however long the Age is. A span of thousands
    // of years used to draw a tick per year: unreadable, and built by a loop
    // whose length was the Age's duration.
    const step = Math.max(TICK_INTERVAL, Math.ceil(span / TICK_BUDGET));

    const marked = new Set();
    for (let year = start; year <= last; year += step) marked.add(year);
    for (const year of years) {
      if (Number.isInteger(year) && year >= start && year <= last) marked.add(year);
    }
    if (current.year >= start && current.year <= last) marked.add(current.year);

    return [...marked].sort((a, b) => a - b).map(year => {
      const hasEvent = years.has(year);
      const isCurrent = year === current.year;
      return {
        position: (((year - start + 0.5) / span) * 100).toFixed(3),
        label: (isCurrent || hasEvent || year % 20 === 0) ? year : "",
        hasEvent,
        isCurrent
      };
    });
  }

  /** What the toolbar names as the browsed scope, per mode. */
  #scopeLabel(mode, age) {
    if (mode === TIMELINE_MODE.MONTH) return formatMonth(this.viewYear, this.viewMonth);
    if (mode === TIMELINE_MODE.YEAR) return `${t("TTA.Common.Year")} ${this.viewYear}`;
    if (!age) return t("TTA.Ages.NoCurrentAge");
    return `${age.name} · ${age.startYear}–${endYear(age)}`;
  }

  #filterChoices(gm) {
    const choices = [
      { value: "all", label: t("TTA.Timeline.FilterAll") },
      { value: "age", label: t("TTA.Timeline.FilterAge") },
      { value: "year", label: t("TTA.Timeline.FilterYear") },
      { value: "month", label: t("TTA.Timeline.FilterMonth") },
      { value: "players", label: t("TTA.Timeline.FilterPlayerVisible") }
    ];
    if (gm) choices.push({ value: "gm", label: t("TTA.Timeline.FilterGMOnly") });
    return choices.map(choice => ({ ...choice, selected: choice.value === this.filter }));
  }

  #applyFilter(events) {
    const age = this.viewAge;
    switch (this.filter) {
      case "age":
        return age ? events.filter(event => {
          const year = parseKey(event.dateKey)?.year;
          return year >= Number(age.startYear) && year <= endYear(age);
        }) : events;
      case "year":
        return events.filter(event => parseKey(event.dateKey)?.year === this.viewYear);
      case "month":
        return events.filter(event => {
          const parsed = parseKey(event.dateKey);
          return parsed?.year === this.viewYear && parsed?.month === this.viewMonth;
        });
      case "players":
        return events.filter(event => event.visibility === VISIBILITY.PLAYERS);
      case "gm":
        return events.filter(event => event.visibility === VISIBILITY.GM_ONLY);
      default:
        return events;
    }
  }

  async #decorate(event, gm) {
    const parsed = parseKey(event.dateKey);
    const sourceAvailable = event.source?.noteUuid ? !!(await fromUuid(event.source.noteUuid).catch(() => null)) : false;
    return {
      ...event,
      dateLabel: parsed ? formatDate(parsed) : event.dateKey,
      year: parsed?.year ?? null,
      enriched: await enrichHTML(event.description),
      visibilityLabel: t(`TTA.Visibility.${event.visibility}`),
      isPlayerVisible: event.visibility === VISIBILITY.PLAYERS,
      // The origin indicator and the source link are GM-only information.
      showOrigin: gm && event.source?.type === "promoted",
      sourceAvailable,
      sourceUuid: event.source?.noteUuid ?? null
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-filter-select]")?.addEventListener("change", event => {
      this.filter = event.currentTarget.value;
      this.#browse();
    });
  }

  /**
   * Show a different span, or the same span filtered differently, without
   * rendering the window again.
   *
   * Only the region below the Age bands depends on either: the bands keep their
   * geometry whatever is browsed, and a full render would rebuild them under
   * the pointer. That costs the band row its horizontal scroll - a campaign
   * with many Ages scrolls that row - the body its vertical scroll, and the
   * clicked control its focus, for a repaint of markup that has not changed.
   */
  #browse() {
    this.#applyViewMarks();
    this.#refreshEvents();
  }

  /**
   * Move the marks that say which span is being browsed. Both read from local
   * state, so they can move on the click itself rather than waiting for the
   * events below to be rebuilt.
   */
  #applyViewMarks() {
    const viewed = this.viewAge;
    for (const band of this.element.querySelectorAll(".tta-band")) {
      band.classList.toggle("tta-band-active", Number(band.dataset.year) === Number(viewed?.startYear));
    }
    const scope = this.element.querySelector(".tta-timeline-scope");
    if (scope) scope.textContent = this.#scopeLabel(getMode(), viewed);
  }

  /**
   * Repaint the spine, the count and the year list for the current view.
   *
   * Preparing the context enriches event descriptions and resolves promoted
   * events' source notes, so two quick clicks can be in flight at once and the
   * earlier one can finish last. Each pass takes a ticket and abandons its
   * result once another pass has started, so what is listed always matches the
   * span the toolbar names.
   */
  async #refreshEvents() {
    const ticket = ++this.#eventsPass;
    try {
      if (!this.rendered) return;
      const context = await this._prepareContext({});
      if (ticket !== this.#eventsPass || !this.rendered) return;
      const html = await renderTemplate(
        `modules/${MODULE_ID}/templates/partials/timeline-events.hbs`,
        context
      );
      if (ticket !== this.#eventsPass || !this.rendered) return;
      const region = this.element.querySelector(".tta-timeline-events");
      if (!region) return;
      region.innerHTML = html;
    } catch (error) {
      // A failed repaint leaves the previous list in place, which is stale but
      // readable; a full render would recover it at the cost of the flash this
      // whole path exists to avoid.
      log("error", "Failed to refresh the timeline events", error);
    }
  }

  static async onSetMode(event, target) {
    const mode = target.dataset.mode;
    if (!isGM()) {
      ui.notifications.warn(t("TTA.Errors.ModeGMOnly"));
      return;
    }
    await setMode(mode);
    this.render();
  }

  static onPrev() {
    this.#step(-1);
  }

  static onNext() {
    this.#step(1);
  }

  /** Step the local view by one Age, year, or month depending on the mode. */
  #step(delta) {
    const mode = getMode();
    const calendar = getCalendar();
    if (mode === TIMELINE_MODE.MONTH) {
      const next = addMonths({ year: this.viewYear, month: this.viewMonth, day: 1 }, delta, calendar);
      this.viewYear = next.year;
      this.viewMonth = next.month;
    } else if (mode === TIMELINE_MODE.YEAR) {
      this.viewYear = addYears({ year: this.viewYear, month: this.viewMonth, day: 1 }, delta, calendar).year;
    } else {
      const ages = getVisibleAges();
      const index = ages.findIndex(age => age.id === this.viewAge?.id);
      const target = ages[index + delta];
      if (!target) return;
      this.viewYear = Number(target.startYear);
    }
    this.#browse();
  }

  static onGotoCurrent() {
    const current = getCurrentDate();
    this.viewYear = current.year;
    this.viewMonth = current.month;
    this.#browse();
  }

  /** Jump the local view to the Age whose band was clicked. */
  static onGotoAge(event, target) {
    const year = Number(target.dataset.year);
    if (!Number.isInteger(year) || year === Number(this.viewAge?.startYear)) return;
    this.viewYear = year;
    this.#browse();
  }

  static onAddEvent() {
    if (!canManageEvents()) return ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    new EventEditorApp({
      dateKey: null,
      event: null
    }).render({ force: true });
  }

  /**
   * Pick an eligible calendar note and open the promotion form for it.
   * Only day notes that have not already been promoted are offered.
   */
  static async onPromoteFromNote() {
    if (!canManageEvents()) return ui.notifications.warn(t("TTA.Errors.EventGMOnly"));

    const notes = getPromotableNotes();
    if (!notes.length) return ui.notifications.info(t("TTA.Timeline.NoPromotableNotes"));

    const options = notes
      .map(note => html`<option value="${note.uuid}">${`${note.dateKey} — ${note.title} (${note.authorName})`}</option>`)
      .join("");

    const result = await promptForm({
      title: t("TTA.Timeline.FromNoteTitle"),
      content: html`<div class="tta-prompt">
        <label for="tta-promote-note">${t("TTA.Timeline.FromNoteLabel")}</label>
        <select id="tta-promote-note" name="uuid">${trustedHTML(options)}</select>
      </div>`,
      okLabel: t("TTA.Timeline.FromNote")
    });
    if (!result?.uuid) return;

    const note = notes.find(candidate => candidate.uuid === result.uuid);
    if (!note) return ui.notifications.warn(t("TTA.Errors.NoteMissing"));
    new EventEditorApp({ sourceNote: note }).render({ force: true });
  }

  static onEditEvent(event, target) {
    if (!canManageEvents()) return ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    const record = getEvent(target.dataset.eventId);
    if (!record) return ui.notifications.warn(t("TTA.Errors.EventMissing"));
    new EventEditorApp({ event: record }).render({ force: true });
  }

  static async onDeleteEvent(event, target) {
    if (!canManageEvents()) return ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
    const record = getEvent(target.dataset.eventId);
    if (!record) return ui.notifications.warn(t("TTA.Errors.EventMissing"));

    const confirmed = await confirmDialog({
      title: t("TTA.Timeline.DeleteTitle"),
      content: html`<p>${t("TTA.Timeline.DeleteBody", { title: record.title })}</p>`,
      yesLabel: t("TTA.Common.Delete"),
      yesIcon: "fa-solid fa-trash"
    });
    if (!confirmed) return;

    try {
      await deleteEvent(record.id);
      ui.notifications.info(t("TTA.Notifications.EventDeleted"));
      this.render();
    } catch (error) {
      log("error", "Failed to delete timeline event", error);
      ui.notifications.error(error.message ?? t("TTA.Errors.EventDeleteFailed"));
    }
  }

  /** Open the journal page a promoted event originated from. GM-only control. */
  static async onOpenSource(event, target) {
    const document = await fromUuid(target.dataset.uuid).catch(() => null);
    if (!document) return ui.notifications.warn(t("TTA.Timeline.SourceUnavailable"));
    document.parent?.sheet?.render(true, { pageId: document.id });
  }
}
