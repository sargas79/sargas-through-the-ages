/**
 * Hook wiring: the Calendar entry point in the Journal sidebar and the document
 * listeners that keep open windows in sync.
 */

import { log, rerenderModuleApps, t } from "./compat.js";
import { CalendarApp } from "./applications/calendar-app.js";
import { onWorldTimeUpdated } from "./services/calendar-service.js";
import { isCalendarDocument } from "./services/journal-service.js";

/**
 * Open the calendar window, or focus it if it is already up.
 *
 * A closed application can linger in `foundry.applications.instances` under its
 * id, so a stale entry is re-rendered rather than replaced: constructing a
 * second CalendarApp with the same id would orphan the first and leave the
 * window unopenable until the world reloads.
 */
export function openCalendar() {
  const existing = foundry.applications.instances?.get("tta-calendar");
  if (existing instanceof CalendarApp) {
    if (existing.rendered && existing.element?.isConnected) {
      existing.bringToFront?.();
      return existing;
    }
    return existing.render({ force: true });
  }
  return new CalendarApp().render({ force: true });
}

/**
 * Put the Calendar button at the top of the Journal sidebar tab, beside the
 * folder and entry controls, since calendar notes are journal documents.
 *
 * The sidebar is outside the module's own windows, so this is the one control
 * the module paints beyond `.tta` — see `.tta-sidebar-button` in the stylesheet.
 */
function onRenderJournalDirectory(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root || root.querySelector("[data-tta-open-calendar]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tta-sidebar-button";
  button.dataset.ttaOpenCalendar = "";
  button.append(Object.assign(document.createElement("i"), {
    className: "fa-solid fa-calendar-days",
    ariaHidden: "true"
  }));
  button.append(document.createTextNode(` ${t("TTA.Calendar.Title")}`));
  button.addEventListener("click", () => openCalendar());

  // Foundry's directory markup differs between builds, so the button is placed
  // against whichever container is actually present.
  const actions = root.querySelector(".header-actions, .action-buttons");
  if (actions) return actions.append(button);

  const header = root.querySelector(".directory-header, header");
  if (header) return header.after(button);
  root.prepend(button);
}

function onDocumentChanged(document) {
  if (!isCalendarDocument(document)) return;
  rerenderModuleApps();
}

export function registerHooks() {
  Hooks.on("renderJournalDirectory", onRenderJournalDirectory);
  Hooks.on("updateWorldTime", onWorldTimeUpdated);

  for (const event of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) {
    Hooks.on(event, onDocumentChanged);
  }
  for (const event of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
    Hooks.on(event, onDocumentChanged);
  }

  // A GM disconnecting or connecting changes whether player writes can be relayed.
  Hooks.on("userConnected", () => rerenderModuleApps());

  log("debug", "Hooks registered");
}
