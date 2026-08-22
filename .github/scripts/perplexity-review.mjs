// Ask Perplexity to review a pull request and leave the result as a comment.
//
// The review is a single request covering the whole diff, so a pull request
// costs one call no matter how large it is. It edits its own earlier comment
// rather than adding a second one, so a branch that gets pushed to repeatedly
// ends up with one review reflecting its current state instead of a thread of
// stale ones.

import { execFileSync } from "node:child_process";

const {
  PERPLEXITY_API_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  BASE_SHA,
  HEAD_SHA,
} = process.env;

if (!PERPLEXITY_API_KEY) {
  throw new Error("PERPLEXITY_API_KEY is not set. Add it as a repository secret.");
}

// Identifies this workflow's own comment among any others on the pull request.
const marker = "<!-- perplexity-review -->";

// Enough for the diffs this repository sees, and a ceiling on what one review
// can cost when it is not.
const diffLimit = 100_000;

const diff = execFileSync("git", ["diff", "--unified=3", `${BASE_SHA}...${HEAD_SHA}`], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (diff.trim() === "") {
  console.log("Nothing changed against the merge base, so there is nothing to review.");
  process.exit(0);
}

const truncated = diff.length > diffLimit;
const body = truncated ? `${diff.slice(0, diffLimit)}\n\n[diff truncated]` : diff;

const instructions = `You are reviewing a pull request for a Foundry VTT module written in modern JavaScript.

Review the diff below and report only what is worth acting on, ordered by how much it matters:

1. Correctness bugs, including cases the change fails to handle.
2. Security problems.
3. Performance problems that would show up in practice.
4. Readability, naming, and dead code.

Quote the file and line for each point. Do not restate what the change does, do not
praise it, and do not invent problems: if the diff looks sound, say so in one line.
Answer in GitHub-flavoured markdown${truncated ? ". The diff was truncated, so say so." : "."}

${"```diff"}
${body}
${"```"}`;

const answer = await fetch("https://api.perplexity.ai/v1/agent", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ preset: "low", input: instructions, stream: false }),
});

if (!answer.ok) {
  throw new Error(`Perplexity refused the review: ${answer.status} ${await answer.text()}`);
}

const result = await answer.json();
const review = (result.output ?? [])
  .flatMap((item) => item.content ?? [])
  .filter((part) => part.type === "output_text")
  .map((part) => part.text)
  .join("\n")
  .trim();

if (review === "") {
  throw new Error(`Perplexity returned no text: ${JSON.stringify(result).slice(0, 500)}`);
}

const comment = `${marker}\n## Perplexity review\n\n${review}`;

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub refused ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const existing = await api(`/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100`);
const mine = existing.find((entry) => entry.body?.startsWith(marker));

if (mine) {
  await api(`/repos/${GITHUB_REPOSITORY}/issues/comments/${mine.id}`, {
    method: "PATCH",
    body: JSON.stringify({ body: comment }),
  });
  console.log(`Updated the review on #${PR_NUMBER}.`);
} else {
  await api(`/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: comment }),
  });
  console.log(`Posted a review on #${PR_NUMBER}.`);
}
