/**
 * Prepare a release on the current branch.
 *
 * Sets the version in `module.json` (and its `download` URL) and `package.json`,
 * and stamps the CHANGELOG's `[Unreleased]` section with the version and today's
 * date. Commit the result and tag that commit: the release workflow publishes the
 * changelog exactly as the tagged commit carries it.
 *
 * Usage: npm run release:prepare -- X.Y.Z
 */

import { readFileSync, writeFileSync } from "node:fs";
import { REPOSITORY, stampRelease } from "./changelog.mjs";

const version = process.argv[2];
const date = new Date().toISOString().slice(0, 10);

// Stamp the changelog first: it is the step that refuses, and nothing has been
// written yet when it does.
const changelog = stampRelease(readFileSync("CHANGELOG.md", "utf8"), version, date);

const manifest = JSON.parse(readFileSync("module.json", "utf8"));
manifest.version = version;
manifest.download = `https://github.com/${REPOSITORY}/releases/download/v${version}/module.zip`;

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = version;

writeFileSync("CHANGELOG.md", changelog);
writeFileSync("module.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

console.log(`Prepared ${version} (${date}). Commit, merge to main, then tag v${version}.`);
