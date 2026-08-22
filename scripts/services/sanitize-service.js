/**
 * The HTML policy applied to stored note and event bodies.
 *
 * Note bodies are authored in a rich-text editor but they do not always arrive
 * through one: a relayed write carries whatever string the requesting client
 * sent, and an imported file carries whatever its author wrote. Both are
 * rendered back as HTML, so the markup that survives has to be decided here
 * rather than trusted from the source.
 *
 * The policy is an allow list. Anything not named below is dropped, which is
 * what keeps a tag or attribute added to HTML in some future browser from
 * quietly becoming a way in.
 *
 * Nothing in this module touches the DOM or any Foundry global: it decides what
 * is allowed, and `sanitizeHTML` in `compat.js` walks a parsed document
 * applying it. That split is what lets the rules be unit tested.
 */

/**
 * Tags a note body may contain: the ones Foundry's own rich-text editor emits,
 * plus the `section` that carries a secret block.
 */
export const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "span", "div", "section", "blockquote", "pre", "code",
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "sub", "sup", "small",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "a", "img", "figure", "figcaption"
]);

/**
 * Attributes allowed on every permitted tag.
 *
 * `class` is here because Foundry's own enrichment and secret blocks are styled
 * by class; `style` deliberately is not, since an attacker-supplied style rule
 * can load an external URL and report that the note was read.
 */
const GLOBAL_ATTRS = new Set(["class", "title", "lang", "dir"]);

/** Additional attributes allowed on specific tags. */
const TAG_ATTRS = {
  a: new Set(["href", "target", "rel", "data-uuid", "data-id", "data-type", "data-pack", "data-tooltip"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  td: new Set(["colspan", "rowspan", "headers"]),
  th: new Set(["colspan", "rowspan", "headers", "scope"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "type", "reversed"]),
  section: new Set(["id"]),
  code: new Set(["data-language"])
};

/** Attributes whose value is a URL, and therefore has to name a safe scheme. */
const URL_ATTRS = new Set(["href", "src"]);

/**
 * Schemes a link or image may use.
 *
 * Relative paths carry no scheme at all and are the common case for a Foundry
 * world's own assets, so they are accepted by having no scheme to reject.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "data:", "mailto:"]);

/**
 * `data:` URLs are allowed only for still images. A `data:text/html` document
 * is a script host, and Foundry renders note bodies inside the application
 * window rather than a sandboxed frame.
 */
const SAFE_DATA_PREFIXES = ["data:image/png", "data:image/jpeg", "data:image/gif", "data:image/webp"];

/** The highest character code a browser discards while resolving a URL. */
const URL_IGNORED_MAX = 0x20;

/** True when a tag name may appear in a stored body. */
export function isAllowedTag(tagName) {
  return ALLOWED_TAGS.has(String(tagName ?? "").toLowerCase());
}

/**
 * True when a URL attribute value names a scheme that cannot execute.
 *
 * The value is judged after dropping the control characters and whitespace a
 * browser ignores when it resolves a URL, so a scheme split up by a tab or a
 * newline is read the way the browser would read it rather than the way it is
 * written.
 */
export function isSafeUrl(value) {
  const cleaned = [...String(value ?? "")]
    .filter(character => character.charCodeAt(0) > URL_IGNORED_MAX)
    .join("")
    .toLowerCase();
  if (!cleaned) return true;

  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned);
  if (!scheme) return true; // relative path, no scheme to judge

  if (!SAFE_SCHEMES.has(`${scheme[1]}:`)) return false;
  if (scheme[1] === "data") return SAFE_DATA_PREFIXES.some(prefix => cleaned.startsWith(prefix));
  return true;
}

/**
 * True when an attribute may be kept on a tag.
 *
 * Every `on*` handler is refused by omission rather than by name: they are not
 * in any allow list above, so `onerror` and whatever the next one is called are
 * both dropped without this having to know about them.
 *
 * @param {string} tagName       the element the attribute sits on
 * @param {string} attributeName the attribute being tested
 * @param {string} value         its value, checked when the attribute is a URL
 */
export function isAllowedAttribute(tagName, attributeName, value = "") {
  const tag = String(tagName ?? "").toLowerCase();
  const name = String(attributeName ?? "").toLowerCase();

  const permitted = GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.has(name);
  if (!permitted) return false;
  if (URL_ATTRS.has(name)) return isSafeUrl(value);
  return true;
}
