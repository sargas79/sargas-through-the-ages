import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeHTML, html, sanitizeHTML, trustedHTML } from "../scripts/compat.js";

describe("escapeHTML", () => {
  it("neutralises every character that can start markup or end an attribute", () => {
    assert.equal(escapeHTML("<script>"), "&lt;script&gt;");
    assert.equal(escapeHTML('a "quoted" value'), "a &quot;quoted&quot; value");
    assert.equal(escapeHTML("it's"), "it&#39;s");
    assert.equal(escapeHTML("a & b"), "a &amp; b");
  });

  it("escapes the ampersand without double-escaping what follows", () => {
    assert.equal(escapeHTML("&lt;"), "&amp;lt;");
  });

  it("renders nullish values as empty rather than as 'undefined'", () => {
    assert.equal(escapeHTML(undefined), "");
    assert.equal(escapeHTML(null), "");
  });
});

describe("the html tag", () => {
  it("escapes an interpolated value", () => {
    const title = '<img src=x onerror="alert(1)">';
    assert.equal(
      html`<p>${title}</p>`,
      "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>"
    );
  });

  it("leaves the literal parts of the template alone", () => {
    assert.equal(html`<p class="x">${"a"}</p>`, '<p class="x">a</p>');
  });

  it("escapes every value, not only the first", () => {
    assert.equal(html`${"<a>"}|${"<b>"}|${"<c>"}`, "&lt;a&gt;|&lt;b&gt;|&lt;c&gt;");
  });

  it("handles a template with no interpolation at all", () => {
    assert.equal(html`<hr>`, "<hr>");
  });

  it("interpolates numbers and nullish values without complaint", () => {
    assert.equal(html`<i>${1}${null}${undefined}</i>`, "<i>1</i>");
  });

  // This is the shape the dialog bodies are built in: rows are composed first,
  // then placed into a list. The composed rows must not be escaped a second time.
  it("passes an already-built fragment through when it is marked trusted", () => {
    const rows = ["<a>", "<b>"].map(value => html`<li>${value}</li>`).join("");
    assert.equal(
      html`<ul>${trustedHTML(rows)}</ul>`,
      "<ul><li>&lt;a&gt;</li><li>&lt;b&gt;</li></ul>"
    );
  });

  it("does not treat a plain string that merely looks like markup as trusted", () => {
    assert.equal(html`<ul>${"<li>x</li>"}</ul>`, "<ul>&lt;li&gt;x&lt;/li&gt;</ul>");
  });
});

describe("sanitizeHTML without a DOM", () => {
  // The services are unit tested in Node, where there is no parser. Escaping is
  // the safe way to fail: the body reads as text instead of running as markup.
  it("falls back to escaping rather than to passing markup through", () => {
    assert.equal(
      sanitizeHTML('<img src=x onerror="alert(1)">'),
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  it("returns empty for an empty body", () => {
    assert.equal(sanitizeHTML(""), "");
    assert.equal(sanitizeHTML(null), "");
    assert.equal(sanitizeHTML(undefined), "");
  });
});
