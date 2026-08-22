import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_TAGS,
  isAllowedAttribute,
  isAllowedTag,
  isSafeUrl
} from "../scripts/services/sanitize-service.js";

describe("allowed tags", () => {
  it("keeps the markup a rich-text body is made of", () => {
    for (const tag of ["p", "strong", "em", "ul", "li", "table", "a", "img", "section"]) {
      assert.equal(isAllowedTag(tag), true, `${tag} should be allowed`);
    }
  });

  it("refuses the tags that can run or fetch something", () => {
    for (const tag of ["script", "style", "iframe", "object", "embed", "link", "meta", "form", "input"]) {
      assert.equal(isAllowedTag(tag), false, `${tag} should be refused`);
    }
  });

  it("compares tag names case-insensitively, as the DOM reports them", () => {
    assert.equal(isAllowedTag("P"), true);
    assert.equal(isAllowedTag("SCRIPT"), false);
  });

  it("treats an unknown tag as refused rather than as allowed", () => {
    assert.equal(isAllowedTag("marquee"), false);
    assert.equal(isAllowedTag(""), false);
    assert.equal(isAllowedTag(undefined), false);
  });
});

describe("allowed attributes", () => {
  it("keeps the ones the editor and enrichment rely on", () => {
    assert.equal(isAllowedAttribute("a", "href", "https://example.com"), true);
    assert.equal(isAllowedAttribute("a", "data-uuid", "JournalEntry.abc"), true);
    assert.equal(isAllowedAttribute("img", "src", "icons/svg/mystery-man.svg"), true);
    assert.equal(isAllowedAttribute("td", "colspan", "2"), true);
    assert.equal(isAllowedAttribute("p", "class", "tta-note"), true);
  });

  it("refuses every event handler, by omission rather than by name", () => {
    for (const attribute of ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onanimationstart"]) {
      assert.equal(isAllowedAttribute("img", attribute, "x"), false, `${attribute} should be refused`);
    }
  });

  it("refuses style, which can fetch a URL and report that a note was read", () => {
    assert.equal(isAllowedAttribute("div", "style", "background:url(https://evil.test)"), false);
  });

  it("does not allow a tag's attribute on a different tag", () => {
    assert.equal(isAllowedAttribute("p", "href", "https://example.com"), false);
    assert.equal(isAllowedAttribute("img", "colspan", "2"), false);
  });

  it("reads attribute names case-insensitively", () => {
    assert.equal(isAllowedAttribute("img", "OnError", "x"), false);
    assert.equal(isAllowedAttribute("A", "HREF", "https://example.com"), true);
  });
});

describe("url safety", () => {
  it("accepts the schemes a note legitimately links with", () => {
    assert.equal(isSafeUrl("https://example.com/a.png"), true);
    assert.equal(isSafeUrl("http://example.com"), true);
    assert.equal(isSafeUrl("mailto:gm@example.com"), true);
  });

  it("accepts a relative path, which is how a world's own assets are named", () => {
    assert.equal(isSafeUrl("icons/svg/mystery-man.svg"), true);
    assert.equal(isSafeUrl("/worlds/mine/map.webp"), true);
    assert.equal(isSafeUrl(""), true);
  });

  it("refuses a scheme that executes", () => {
    assert.equal(isSafeUrl("javascript:alert(1)"), false);
    assert.equal(isSafeUrl("vbscript:msgbox(1)"), false);
  });

  it("refuses one hidden by case", () => {
    assert.equal(isSafeUrl("JaVaScRiPt:alert(1)"), false);
    assert.equal(isSafeUrl("JAVASCRIPT:alert(1)"), false);
  });

  // A browser drops these characters while resolving a URL, so a scheme split
  // apart by them still runs. The check has to read the URL the same way.
  it("refuses one split up by the characters a browser ignores", () => {
    assert.equal(isSafeUrl("java\tscript:alert(1)"), false);
    assert.equal(isSafeUrl("java\nscript:alert(1)"), false);
    assert.equal(isSafeUrl("java\r\nscript:alert(1)"), false);
    assert.equal(isSafeUrl("java\u0000script:alert(1)"), false);
    assert.equal(isSafeUrl("java\u000bscript:alert(1)"), false);
    assert.equal(isSafeUrl("  javascript:alert(1)"), false);
  });

  it("allows a data URL only for a still image", () => {
    assert.equal(isSafeUrl("data:image/png;base64,AAAA"), true);
    assert.equal(isSafeUrl("data:image/webp;base64,AAAA"), true);
    assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false);
    assert.equal(isSafeUrl("data:image/svg+xml,<svg onload=alert(1)>"), false);
  });

  it("judges a URL attribute by its value, not only by its name", () => {
    assert.equal(isAllowedAttribute("a", "href", "javascript:alert(1)"), false);
    assert.equal(isAllowedAttribute("img", "src", "data:text/html,x"), false);
  });
});

describe("the policy as a whole", () => {
  it("names no tag that can execute", () => {
    for (const tag of ["script", "style", "iframe", "object", "embed"]) {
      assert.equal(ALLOWED_TAGS.has(tag), false);
    }
  });
});
