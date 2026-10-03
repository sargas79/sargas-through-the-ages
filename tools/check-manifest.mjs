/**
 * Manifest validity check.
 *
 * Foundry installs a package by reading `module.json`, so a field that is missing,
 * malformed, or that points at a file which is not in the tree only shows up once
 * the package is already published. This asserts the things the directory and the
 * installer require, and runs in CI on every push and pull request.
 *
 * The release version is not its business: the release workflow derives that from
 * the tag. What is checked here is that the repository is internally consistent —
 * `module.json`, `package.json` and the `download` URL naming one version between
 * them — so whatever is read straight from a branch resolves.
 *
 * Usage: node tools/check-manifest.mjs
 */

import { readFileSync, existsSync } from "node:fs";

const manifest = JSON.parse(readFileSync("module.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const errors = [];

// Fields Foundry needs to list and install the package.
for (const field of ["id", "title", "description", "version", "manifest", "download", "license"]) {
  if (!manifest[field]) errors.push(`module.json is missing "${field}".`);
}

if (!/^[a-z0-9-]+$/.test(manifest.id ?? "")) {
  errors.push(`module.json id "${manifest.id}" must be lowercase letters, digits and hyphens only.`);
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
  errors.push(`module.json version "${manifest.version}" is not MAJOR.MINOR.PATCH.`);
}

if (pkg.version !== manifest.version) {
  errors.push(`package.json is ${pkg.version} while module.json is ${manifest.version}.`);
}

const expectedDownload =
  `https://github.com/sargas79/sargas-through-the-ages/releases/download/v${manifest.version}/module.zip`;
if (manifest.download !== expectedDownload) {
  errors.push(`module.json download is ${manifest.download}, expected ${expectedDownload}.`);
}

if (!manifest.compatibility?.minimum || !manifest.compatibility?.verified) {
  errors.push("module.json needs both compatibility.minimum and compatibility.verified.");
}

// Without a cover the directory entry renders blank.
if (!manifest.media?.some((entry) => entry.type === "cover")) {
  errors.push('module.json needs a media entry of type "cover".');
}

for (const entry of manifest.media ?? []) {
  if (!/^https:\/\//.test(entry.url ?? "")) {
    errors.push(`media entry "${entry.type}" needs an absolute https URL, got "${entry.url}".`);
  }
}

// Every declared path must ship, or Foundry logs a 404 on world load.
const declared = [
  ...(manifest.esmodules ?? []),
  ...(manifest.styles ?? []),
  ...(manifest.languages ?? []).map((language) => language.path),
  ...(manifest.packs ?? []).map((pack) => pack.path)
];
for (const path of declared) {
  if (!existsSync(path)) errors.push(`module.json declares "${path}", which does not exist.`);
}

if (errors.length) {
  console.error("Manifest check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Manifest check passed for ${manifest.id} ${manifest.version}.`);
