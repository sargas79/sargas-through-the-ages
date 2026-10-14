import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  changelogProblems,
  newestHeading,
  releaseLink,
  releaseNotes,
  stampRelease
} from "../tools/changelog.mjs";

const PENDING = `# Changelog

## [Unreleased]

### Added

- A new thing.

## [1.1.0] - 2026-01-02

### Fixed

- An old thing.

[1.1.0]: https://github.com/sargas79/sargas-through-the-ages/releases/tag/v1.1.0
`;

describe("stamping a release", () => {
  it("renames [Unreleased] and adds the link above the older ones", () => {
    const stamped = stampRelease(PENDING, "1.2.0", "2026-03-04");
    assert.equal(newestHeading(stamped).line, "## [1.2.0] - 2026-03-04");
    assert.ok(stamped.includes(`${releaseLink("1.2.0")}\n${releaseLink("1.1.0")}`));
    assert.ok(!stamped.includes("[Unreleased]"));
  });

  it("refuses when there is nothing unreleased", () => {
    const stamped = stampRelease(PENDING, "1.2.0", "2026-03-04");
    assert.throws(() => stampRelease(stamped, "1.3.0", "2026-03-05"), /no \[Unreleased\]/);
  });

  it("refuses a version that is not MAJOR.MINOR.PATCH", () => {
    assert.throws(() => stampRelease(PENDING, "v1.2.0", "2026-03-04"), /MAJOR\.MINOR\.PATCH/);
  });
});

describe("checking the changelog against the manifest", () => {
  it("accepts a branch still collecting unreleased changes", () => {
    assert.deepEqual(changelogProblems(PENDING, "1.1.0"), []);
  });

  it("accepts a prepared release", () => {
    assert.deepEqual(changelogProblems(stampRelease(PENDING, "1.2.0", "2026-03-04"), "1.2.0"), []);
  });

  it("flags a newest section that names another version", () => {
    const problems = changelogProblems(stampRelease(PENDING, "1.2.0", "2026-03-04"), "1.3.0");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /\[1\.2\.0\] but module\.json is 1\.3\.0/);
  });

  it("flags a release heading without a date or a link", () => {
    const bare = PENDING.replace("## [Unreleased]", "## [1.2.0]");
    assert.equal(changelogProblems(bare, "1.2.0").length, 2);
  });
});

describe("release notes", () => {
  it("are the release's own section, without headings or links", () => {
    const notes = releaseNotes(stampRelease(PENDING, "1.2.0", "2026-03-04"), "1.2.0");
    assert.equal(notes, "### Added\n\n- A new thing.");
  });

  it("are refused for a tag whose commit was never prepared", () => {
    assert.throws(() => releaseNotes(PENDING, "1.2.0"), /newest section is \[Unreleased\]/);
  });

  it("can be cut from the repository's own changelog", () => {
    // The checked-in changelog is always either collecting changes or prepared
    // for module.json's version, never stamped for a release that is not there.
    const text = readFileSync("CHANGELOG.md", "utf8");
    const { version } = JSON.parse(readFileSync("module.json", "utf8"));
    assert.deepEqual(changelogProblems(text, version), []);
  });
});
