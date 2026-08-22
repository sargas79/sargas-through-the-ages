/**
 * Through the Ages - module entry point.
 *
 * Lifecycle:
 *   init  - settings, Handlebars helpers and partials, hook registration
 *   setup - public API
 *   ready - migration, journal folder verification, relay wiring
 */

import { buildApi } from "./api.js";
import { loadTemplates, log } from "./compat.js";
import { MODULE_ID, MODULE_TITLE } from "./constants.js";
import { registerHooks } from "./hooks.js";
import { registerSettings } from "./settings.js";
import {
  initializeWorldTimeCheckpoint,
  onCalendarDataChanged,
  runMigrationIfNeeded
} from "./services/calendar-service.js";
import { ensureFolder } from "./services/journal-service.js";
import { registerRelayHandlers } from "./services/note-service.js";
import { isGM } from "./services/permission-service.js";
import { clearStaleRelayFlags, registerRelay, verifyRelayAvailable } from "./services/relay-service.js";

const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

const PARTIALS = [
  `${TEMPLATE_ROOT}/partials/calendar-day.hbs`,
  `${TEMPLATE_ROOT}/partials/day-detail.hbs`,
  `${TEMPLATE_ROOT}/partials/note-list.hbs`,
  `${TEMPLATE_ROOT}/partials/timeline-event.hbs`,
  `${TEMPLATE_ROOT}/partials/timeline-events.hbs`
];

/** Handlebars helpers used by the module templates. */
function registerHandlebarsHelpers() {
  Handlebars.registerHelper("ttaEq", (a, b) => a === b);
  Handlebars.registerHelper("ttaNot", value => !value);
  Handlebars.registerHelper("ttaPad2", value => String(value ?? "").padStart(2, "0"));
  Handlebars.registerHelper("ttaOr", (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper("ttaAnd", (...args) => args.slice(0, -1).every(Boolean));
}

Hooks.once("init", () => {
  log("info", `Initialising ${MODULE_TITLE}`);
  registerSettings();
  registerHandlebarsHelpers();
  registerHooks();
});

Hooks.once("setup", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = buildApi();
  loadTemplates(PARTIALS).catch(error => log("error", "Failed to preload templates", error));
});

Hooks.once("ready", async () => {
  registerRelay();

  if (isGM()) {
    registerRelayHandlers();
    try {
      await runMigrationIfNeeded();
      await ensureFolder();
      await initializeWorldTimeCheckpoint();
    } catch (error) {
      log("error", "Startup tasks failed", error);
      ui.notifications.error(game.i18n.localize("TTA.Errors.StartupFailed"));
    }
  }

  // Housekeeping for this client's own leftovers, and one clear line in the log
  // if the transport the relay depends on is not available to this user.
  await clearStaleRelayFlags();
  await verifyRelayAvailable();

  onCalendarDataChanged();
  log("info", `${MODULE_TITLE} ready`);
});
