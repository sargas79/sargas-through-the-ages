/**
 * CHANGELOG.md rules shared by the release tooling.
 *
 * The changelog in the repository is the record: the commit a release is tagged
 * on must already carry that release's heading and link, so `main` never lags
 * behind what was published. Preparing a release stamps them, CI checks they
 * agree with `module.json`, and the release workflow refuses a tag they do not
 * match. Everything here is pure text in, text out, so it is unit tested.
 */

export const REPOSITORY = "sargas79/sargas-through-the-ages";

// The heading text is captured without its line ending, so stamping it leaves a
// CRLF intact; `\s*$` would also have swallowed the blank line under it.
const HEADING = /^(## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?)[ \t]*\r?$/m;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** The newest section's heading, or null when the changelog has none. */
export function newestHeading(text) {
  const match = text.match(HEADING);
  return match ? { name: match[2], date: match[3] ?? null, line: match[1] } : null;
}

/** The link reference line for a released version. */
export function releaseLink(version, repository = REPOSITORY) {
  return `[${version}]: https://github.com/${repository}/releases/tag/v${version}`;
}

function hasLink(text, version) {
  return text.includes(`\n[${version}]: `);
}

/**
 * Rename the `[Unreleased]` section to `[version] - date` and add the version's
 * link reference above the older ones.
 * @throws when there is no `[Unreleased]` section to stamp
 */
export function stampRelease(text, version, date, repository = REPOSITORY) {
  if (!SEMVER.test(version ?? "")) throw new Error(`"${version}" is not MAJOR.MINOR.PATCH.`);
  const newest = newestHeading(text);
  if (newest?.name !== "Unreleased") {
    throw new Error(`CHANGELOG.md has no [Unreleased] section to release`
      + (newest ? ` (newest is [${newest.name}]).` : "."));
  }
  let stamped = text.replace(newest.line, `## [${version}] - ${date}`);
  if (!hasLink(stamped, version)) {
    const link = releaseLink(version, repository);
    const refs = stamped.search(/^\[\d+\.\d+\.\d+\]: /m);
    stamped = refs === -1
      ? `${stamped.trimEnd()}\n\n${link}\n`
      : stamped.slice(0, refs) + link + "\n" + stamped.slice(refs);
  }
  return stamped;
}

/**
 * Problems with the changelog for a branch whose manifest names `version`.
 * The newest section is either `[Unreleased]`, still collecting changes, or
 * `[version]` with a date and a link, ready to tag.
 * @returns {string[]} empty when consistent
 */
export function changelogProblems(text, version) {
  const newest = newestHeading(text);
  if (!newest) return ["CHANGELOG.md has no version section."];
  if (newest.name === "Unreleased") return [];
  const problems = [];
  if (newest.name !== version) {
    problems.push(`CHANGELOG.md's newest section is [${newest.name}] but module.json is ${version}.`
      + " Rename it to [Unreleased], or prepare the release with npm run release:prepare.");
  }
  if (!newest.date) problems.push(`CHANGELOG.md's [${newest.name}] heading has no date.`);
  if (!hasLink(text, newest.name)) problems.push(`CHANGELOG.md has no link reference for [${newest.name}].`);
  return problems;
}

/**
 * The release notes for `version`: everything under its heading, up to the next
 * one, without the link references.
 * @throws when the newest section is not `version`, so a tag whose commit was
 *   never prepared cannot publish notes the repository does not carry
 */
export function releaseNotes(text, version) {
  const newest = newestHeading(text);
  if (newest?.name !== version) {
    throw new Error(`CHANGELOG.md's newest section is [${newest?.name ?? "none"}], not [${version}].`
      + ` Run npm run release:prepare -- ${version} and commit the result before tagging v${version}.`);
  }
  const body = text.slice(text.indexOf(newest.line) + newest.line.length);
  const next = body.search(/^## \[/m);
  return (next === -1 ? body : body.slice(0, next))
    .split(/^\[\d+\.\d+\.\d+\]: /m)[0]
    .trim();
}
