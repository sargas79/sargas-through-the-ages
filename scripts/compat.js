/**
 * Thin wrappers around Foundry APIs that were relocated into namespaces during
 * the v12 -> v14 transition. Using them keeps the rest of the module free of
 * version probing and avoids deprecation warnings on v14.
 */

import { MODULE_ID, MODULE_TITLE, SETTINGS } from "./constants.js";
import { isAllowedAttribute, isAllowedTag } from "./services/sanitize-service.js";

/** Resolve the active TextEditor implementation. */
function textEditor() {
  return foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape a value for interpolation into markup.
 *
 * Foundry has its own helper, but this one is here so {@link html} stays a pure
 * function that can be unit tested without a Foundry runtime, and so a missing
 * global can never silently degrade into no escaping at all.
 */
export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

/**
 * Tagged template for building small fragments of markup, escaping every
 * interpolated value.
 *
 * Dialog bodies are assembled as strings and handed to DialogV2, which renders
 * them as HTML. Interpolating a note title or an imported month name into one
 * directly puts author-controlled markup into the document, so every such site
 * uses this tag: the escaping then comes from the syntax rather than from
 * remembering to call for it.
 *
 * A value that is itself already-built markup — a list of `<li>` rows composed
 * by an earlier `html` call — must be passed through {@link trustedHTML} to say
 * so explicitly.
 *
 * @example html`<p>${note.title}</p>`
 */
export function html(strings, ...values) {
  return strings.reduce((out, chunk, index) => {
    if (index >= values.length) return out + chunk;
    const value = values[index];
    return out + chunk + (value instanceof TrustedHTML ? value.toString() : escapeHTML(value));
  }, "");
}

/** Marker for a string that is already safe markup. See {@link trustedHTML}. */
class TrustedHTML {
  #value;

  constructor(value) {
    this.#value = String(value ?? "");
  }

  toString() {
    return this.#value;
  }
}

/**
 * Mark an already-escaped fragment as safe to interpolate into {@link html}.
 *
 * Every call is a place where the escaping has been reasoned about once and
 * asserted, so they are meant to be few and to stand out in review.
 */
export function trustedHTML(value) {
  return new TrustedHTML(value);
}

/**
 * Strip everything from stored markup that the sanitize policy does not allow.
 *
 * Parsing happens inside a `<template>`, whose content is inert: no script
 * runs, no image loads and no handler fires while the tree is being walked, so
 * a hostile body is defused before it is ever examined.
 *
 * A disallowed element is unwrapped rather than deleted — its text survives
 * where its markup does not — except for the few whose content is code rather
 * than prose, which are removed outright.
 */
export function sanitizeHTML(raw) {
  const source = String(raw ?? "");
  if (!source) return "";

  // Foundry always runs in a browser, but the services are unit tested in Node,
  // where there is no parser. Escaping is the safe way to fail: the body then
  // reads as plain text instead of as markup.
  if (typeof document === "undefined" || !document.createElement) return escapeHTML(source);

  try {
    const template = document.createElement("template");
    template.innerHTML = source;
    sanitizeNode(template.content);
    return template.innerHTML;
  } catch (error) {
    log("error", "Failed to sanitize stored HTML; falling back to plain text", error);
    return escapeHTML(source);
  }
}

/** Elements whose text is not prose, and so are dropped whole rather than unwrapped. */
const DROP_WHOLE = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);

/** Apply the policy to one parsed subtree, in place. */
function sanitizeNode(root) {
  // Children are copied before iterating because the walk replaces nodes as it
  // goes, which would otherwise move the live collection underneath it.
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3 /* text */) continue;
    if (node.nodeType !== 1 /* element */) {
      node.remove();
      continue;
    }

    if (DROP_WHOLE.has(node.tagName)) {
      node.remove();
      continue;
    }

    sanitizeNode(node);

    if (!isAllowedTag(node.tagName)) {
      node.replaceWith(...node.childNodes);
      continue;
    }

    for (const attribute of [...node.attributes]) {
      if (!isAllowedAttribute(node.tagName, attribute.name, attribute.value)) {
        node.removeAttribute(attribute.name);
      }
    }
  }
}

/** Render a Handlebars template by path. */
export function renderTemplate(path, data) {
  const fn = foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return fn(path, data);
}

/** Pre-load and cache Handlebars templates and partials. */
export function loadTemplates(paths) {
  const fn = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  return fn(paths);
}

/**
 * Enrich stored HTML for display (links, rolls, secrets).
 *
 * Sanitizing happens here rather than only on the way in, for two reasons: a
 * world upgrading to this version already holds bodies that were written before
 * anything checked them, and enrichment legitimately produces markup of its own
 * from plain text, so it has to run second or its output would be stripped.
 */
export async function enrichHTML(source, options = {}) {
  if (!source) return "";
  const safe = sanitizeHTML(source);
  try {
    return await textEditor().enrichHTML(safe, { secrets: false, ...options });
  } catch (error) {
    log("error", "Failed to enrich HTML", error);
    return safe;
  }
}

/** Generate a stable random identifier. */
export function randomID() {
  return foundry.utils.randomID();
}

/** Localise a key, optionally with interpolation data. */
export function t(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

/** Confirmation dialog. Resolves true only on an explicit confirmation. */
export async function confirmDialog({ title, content, yesLabel, noLabel, yesIcon = "fa-solid fa-check" }) {
  const DialogV2 = foundry.applications.api.DialogV2;
  return DialogV2.confirm({
    window: { title, icon: "fa-solid fa-triangle-exclamation" },
    content,
    yes: { label: yesLabel ?? t("TTA.Common.Confirm"), icon: yesIcon },
    no: { label: noLabel ?? t("TTA.Common.Cancel") },
    rejectClose: false,
    modal: true
  });
}

/**
 * Build a rich-text input element, falling back to a plain textarea if the
 * ProseMirror element is unavailable for any reason.
 */
export function createRichTextInput({ name, value = "", height = 260 }) {
  try {
    const element = foundry.applications.elements.HTMLProseMirrorElement.create({
      name,
      value,
      toggled: false,
      height
    });
    element.classList.add("tta-richtext");
    return element;
  } catch (error) {
    log("warn", "ProseMirror editor unavailable, falling back to a textarea", error);
    const textarea = document.createElement("textarea");
    textarea.name = name;
    textarea.value = value;
    textarea.classList.add("tta-richtext-fallback");
    textarea.style.minHeight = `${height}px`;
    return textarea;
  }
}

/** Whether verbose diagnostics are enabled. */
export function isDebug() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.DEBUG) === true;
  } catch {
    return false;
  }
}

/**
 * Namespaced logging. `debug` messages are suppressed unless debug logging is
 * enabled; warnings and errors always surface.
 */
export function log(level, ...args) {
  if (level === "debug" && !isDebug()) return;
  const prefix = `${MODULE_TITLE} |`;
  const fn = console[level] ?? console.log;
  fn.call(console, prefix, ...args);
}

/**
 * Re-render every open Through the Ages application.
 *
 * Used after any shared-state change (time, configuration, notes, events) so
 * connected clients update without a reload.
 */
export function rerenderModuleApps() {
  const instances = foundry?.applications?.instances;
  if (!instances) return;
  for (const app of instances.values()) {
    if (!app?.id?.startsWith("tta-")) continue;
    if (app.rendered) app.render({ force: false });
  }
}

/**
 * Show a small modal form and resolve with its values, or null if dismissed.
 * @param {{title:string, content:string, okLabel?:string, okIcon?:string}} config
 */
export async function promptForm({ title, content, okLabel, okIcon = "fa-solid fa-check" }) {
  const DialogV2 = foundry.applications.api.DialogV2;
  try {
    return await DialogV2.prompt({
      window: { title },
      content,
      modal: true,
      rejectClose: false,
      ok: {
        label: okLabel ?? t("TTA.Common.Apply"),
        icon: okIcon,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog?.element?.querySelector("form");
          if (!form) return {};
          const FDE = foundry?.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
          return new FDE(form).object;
        }
      }
    });
  } catch (error) {
    log("debug", "Prompt dismissed", error);
    return null;
  }
}
