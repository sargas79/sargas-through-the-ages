/**
 * Create, edit, or promote a timeline event. GM only.
 *
 * When opened from a calendar note the form arrives prefilled with the note's
 * title, date and content excerpt, and records a link back to the source note.
 */

import { createRichTextInput, log, t } from "../compat.js";
import { DEFAULT_COLOR, MODULE_ID, SCOPE, VISIBILITY } from "../constants.js";
import { formatDate, getCalendar } from "../services/calendar-service.js";
import { dayKey, maxDaysInMonth, parseKey } from "../services/date-service.js";
import { canManageEvents } from "../services/permission-service.js";
import { createEvent, isPlayerNote, promoteNote, updateEvent } from "../services/timeline-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ICON_CHOICES = [
  "fa-solid fa-scroll",
  "fa-solid fa-crown",
  "fa-solid fa-gavel",
  "fa-solid fa-skull",
  "fa-solid fa-fire",
  "fa-solid fa-shield-halved",
  "fa-solid fa-handshake",
  "fa-solid fa-star",
  "fa-solid fa-book",
  "fa-solid fa-tower-observation"
];

/** Quick picks offered beside the colour input; any colour is still allowed. */
const COLOR_SWATCHES = [DEFAULT_COLOR, "#3d6a8f", "#6f5aa8", "#c98a3d"];

export class EventEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} config
   * @param {object} [config.event]      an existing event to edit
   * @param {object} [config.sourceNote] a note view being promoted
   * @param {string} [config.dateKey]    prefilled date for a new event
   */
  constructor({ event = null, sourceNote = null, dateKey = null, ...options } = {}) {
    super({ ...options, id: `tta-event-editor-${event?.id ?? sourceNote?.id ?? "new"}` });
    this.event = event;
    this.sourceNote = sourceNote;
    this.dateKey = event?.dateKey ?? sourceNote?.dateKey ?? dateKey ?? null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["tta", "tta-app", "tta-event-editor"],
    tag: "form",
    window: {
      icon: "fa-solid fa-landmark-flag",
      title: "TTA.EventEditor.TitleNew",
      resizable: true
    },
    position: { width: 640, height: "auto" },
    actions: {
      pickColor: EventEditorApp.onPickColor
    },
    form: {
      handler: EventEditorApp.onSubmit,
      closeOnSubmit: true,
      submitOnChange: false
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/event-editor.hbs` }
  };

  get title() {
    if (this.sourceNote) return t("TTA.EventEditor.TitlePromote");
    return this.event ? t("TTA.EventEditor.TitleEdit") : t("TTA.EventEditor.TitleNew");
  }

  async _prepareContext() {
    const calendar = getCalendar();
    const parsed = parseKey(this.dateKey) ?? { ...calendar.currentDate, scope: SCOPE.DAY };
    const excerpt = this.sourceNote
      ? foundry.utils.escapeHTML(
        (this.sourceNote.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400)
      )
      : "";
    // A player's note always becomes a player-visible event; see promoteNote.
    const visibilityLocked = !!this.sourceNote && isPlayerNote(this.sourceNote);

    return {
      event: this.event,
      isPromotion: !!this.sourceNote,
      sourceNote: this.sourceNote,
      sourceExcerpt: excerpt,
      calendar,
      year: parsed.year,
      month: parsed.month === 0 ? 1 : parsed.month,
      day: parsed.day === 0 ? 1 : parsed.day,
      dateLabel: formatDate({ year: parsed.year, month: parsed.month || 1, day: parsed.day || 1 }),
      title: this.event?.title ?? this.sourceNote?.title ?? "",
      color: this.event?.color ?? DEFAULT_COLOR,
      colorSwatches: COLOR_SWATCHES,
      icon: this.event?.icon ?? ICON_CHOICES[0],
      iconChoices: ICON_CHOICES.map(value => ({ value, selected: value === (this.event?.icon ?? ICON_CHOICES[0]) })),
      visibility: visibilityLocked ? VISIBILITY.PLAYERS : (this.event?.visibility ?? VISIBILITY.GM_ONLY),
      visibilityLocked,
      visibilityChoices: [
        { value: VISIBILITY.GM_ONLY, label: t(`TTA.Visibility.${VISIBILITY.GM_ONLY}`) },
        { value: VISIBILITY.PLAYERS, label: t(`TTA.Visibility.${VISIBILITY.PLAYERS}`) }
      ],
      monthChoices: calendar.monthNames.map((name, index) => ({
        value: index + 1,
        label: name,
        selected: index + 1 === (parsed.month || 1)
      })),
      maxDay: maxDaysInMonth(calendar)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const host = this.element.querySelector("[data-editor-host]");
    if (host) {
      host.replaceChildren(createRichTextInput({
        name: "description",
        value: this.event?.description ?? this.sourceNote?.content ?? "",
        height: 220
      }));
    }
  }

  /** Copy a swatch's colour into the colour input the form actually submits. */
  static onPickColor(event, target) {
    const input = this.element.querySelector('input[name="color"]');
    if (input) input.value = target.dataset.color;
  }

  static async onSubmit(event, form, formData) {
    if (!canManageEvents()) {
      ui.notifications.warn(t("TTA.Errors.EventGMOnly"));
      return;
    }
    const data = formData.object;
    const key = dayKey(Number(data.year), Number(data.month), Number(data.day));

    try {
      if (this.event) {
        await updateEvent(this.event.id, {
          dateKey: key,
          title: data.title,
          description: data.description,
          visibility: data.visibility,
          color: data.color,
          icon: data.icon
        });
        ui.notifications.info(t("TTA.Notifications.EventUpdated"));
      } else if (this.sourceNote) {
        await promoteNote(this.sourceNote, {
          dateKey: key,
          title: data.title,
          description: data.description,
          visibility: data.visibility,
          color: data.color,
          icon: data.icon,
          shareNote: data.shareNote === true || data.shareNote === "true"
        });
        ui.notifications.info(t("TTA.Notifications.NotePromoted"));
      } else {
        await createEvent({
          dateKey: key,
          title: data.title,
          description: data.description,
          visibility: data.visibility,
          color: data.color,
          icon: data.icon
        });
        ui.notifications.info(t("TTA.Notifications.EventCreated"));
      }
    } catch (error) {
      log("error", "Failed to save timeline event", error);
      ui.notifications.error(error.message ?? t("TTA.Errors.EventSaveFailed"));
      throw error;
    }
  }
}
