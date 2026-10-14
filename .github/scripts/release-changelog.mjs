// Write the release notes for the tag being released.
//
// The tagged commit must already carry the release's changelog section, stamped
// by `npm run release:prepare`, so the published notes and `main` never differ.
// A tag whose changelog still says [Unreleased], or names another version, is
// refused rather than stamped here, where the stamp would reach only the package.

import { readFileSync, writeFileSync } from "node:fs";
import { releaseNotes } from "../../tools/changelog.mjs";

const [version, notesPath] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error(`Expected a semver version derived from the tag, got "${version}".`);
}

const section = releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version);
writeFileSync(notesPath, `${section}\n`);
console.log(`Released ${version}, notes ${section.length} chars.`);
