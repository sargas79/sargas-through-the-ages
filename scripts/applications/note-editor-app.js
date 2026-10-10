/**
 * Create or edit a single calendar note.
 *
 * The same window serves GMs and players; the visibility selector is only
 * rendered for GMs, and the note service re-checks every permission on submit.
 */

import { createRichTextInput, log, t } from "../compat.js";
import { MODULE_ID, SCOPE, VISIBILITY } from "../constants.js";
import { formatDate, formatMonth, getCalendar, getParties, getPartyForUser } from "../services/calendar-service.js";
import { parseKey } from "../services/date-service.js";
import { createNote, defaultVisibilityFor, updateNote } from "../services/note-service.js";
import { canChangeNoteVisibility, isGM } from "../services/permission-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NoteEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} config
   * @param {string} [config.dateKey] target date key for a new note
   * @param {object} [config.note]    an existing note view to edit
   */
  constructor({ dateKey = null, note = null, ...options } = {}) {
    super({ ...options, id: `tta-note-editor-${note?.id ?? dateKey ?? "new"}` });
    this.note = note;
    this.dateKey = dateKey ?? note?.dateKey ?? null;
    this.scope = parseKey(this.dateKey)?.scope ?? SCOPE.DAY;
  }

  static DEFAULT_OPTIONS = {
    classes: ["tta", "tta-app", "tta-note-editor"],
    tag: "form",
    window: {
      icon: "fa-solid fa-feather",
      title: "TTA.NoteEditor.TitleNew",
      resizable: true
    },
    position: { width: 620, height: "auto" },
    form: {
      handler: NoteEditorApp.onSubmit,
      closeOnSubmit: true,
      submitOnChange: false
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/note-editor.hbs` }
  };

  get title() {
    const label = this.note ? t("TTA.NoteEditor.TitleEdit") : t("TTA.NoteEditor.TitleNew");
    return `${label} — ${this.dateLabel}`;
  }

  /** Friendly label for the note's date, using the configured names. */
  get dateLabel() {
    const parsed = parseKey(this.dateKey);
    if (!parsed) return t("TTA.Common.UnknownDate");
    if (parsed.scope === SCOPE.MONTH) return formatMonth(parsed.year, parsed.month);
    return formatDate(parsed, { withWeekday: true });
  }

  async _prepareContext() {
    const gm = isGM();
    const parties = getParties();
    const ownParty = gm ? null : getPartyForUser();
    const visibility = this.note?.visibility ?? defaultVisibilityFor();
    const partyId = this.note?.partyId ?? null;
    const visibilityChoices = [
      { value: VISIBILITY.GM_ONLY, label: t(`TTA.Visibility.${VISIBILITY.GM_ONLY}`) },
      { value: VISIBILITY.AUTHOR_AND_GM, label: t(`TTA.Visibility.${VISIBILITY.AUTHOR_AND_GM}`) },
      { value: VISIBILITY.PLAYERS, label: t(`TTA.Visibility.${VISIBILITY.PLAYERS}`) }
    ];
    if (parties.length) visibilityChoices.push({ value: VISIBILITY.PARTY, label: t(`TTA.Visibility.${VISIBILITY.PARTY}`) });

    let privacyHint = t("TTA.NoteEditor.PrivacyHintGM");
    if (!gm) privacyHint = ownParty ? t("TTA.NoteEditor.PrivacyHintPlayerParty") : t("TTA.NoteEditor.PrivacyHintPlayer");

    return {
      note: this.note,
      dateKey: this.dateKey,
      dateLabel: this.dateLabel,
      scope: this.scope,
      isMonthNote: this.scope === SCOPE.MONTH,
      isGM: gm,
      canSetVisibility: canChangeNoteVisibility(),
      visibility,
      visibilityChoices,
      // A GM picks the party for a party note; a player in a party gets one
      // choice, which is to share the note with that party or not.
      partyChoices: gm && parties.length
        ? parties.map(party => ({ value: party.id, label: party.name, selected: party.id === partyId }))
        : null,
      shareWithParty: ownParty ? { name: ownParty.name, checked: visibility === VISIBILITY.PARTY } : null,
      privacyHint,
      calendar: getCalendar()
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const host = this.element.querySelector("[data-editor-host]");
    if (host) {
      host.replaceChildren(createRichTextInput({
        name: "content",
        value: this.note?.content ?? ""
      }));
    }
    this.element.querySelector("input[name='title']")?.focus();
  }

  /**
   * Persist the note. Validation and permission checks live in the note
   * service, so a rejected submission surfaces as a notification.
   */
  static async onSubmit(event, form, formData) {
    const data = formData.object;
    // A GM's visibility comes from the select; a player's from the share box,
    // when they have a party to share with. The service re-checks both.
    let visibility;
    if (canChangeNoteVisibility()) visibility = data.visibility;
    else if (data.shareWithParty !== undefined) {
      visibility = data.shareWithParty === true || data.shareWithParty === "true" ? VISIBILITY.PARTY : VISIBILITY.AUTHOR_AND_GM;
    }
    const partyId = data.partyId || undefined;
    try {
      if (this.note) {
        await updateNote(this.note.uuid, {
          title: data.title,
          content: data.content,
          visibility,
          partyId
        });
        ui.notifications.info(t("TTA.Notifications.NoteUpdated"));
      } else {
        await createNote({
          dateKey: this.dateKey,
          title: data.title,
          content: data.content,
          visibility,
          partyId
        });
        ui.notifications.info(t("TTA.Notifications.NoteCreated"));
      }
    } catch (error) {
      log("error", "Failed to save note", error);
      ui.notifications.error(error.message ?? t("TTA.Errors.NoteSaveFailed"));
      throw error;
    }
  }
}
