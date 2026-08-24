import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../apps/chat/public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../apps/chat/public/styles.css", import.meta.url), "utf8");

const expectedStages = [
  ["queued", 4],
  ["loading_context", 10],
  ["researching_keywords", 22],
  ["choosing_strategy", 36],
  ["finding_sources", 50],
  ["drafting", 68],
  ["checking_claims", 82],
  ["repairing", 91],
  ["saving", 97],
  ["ready_for_review", 100],
];

let previousIndex = -1;
let previousPercent = -1;
for (const [stage, percent] of expectedStages) {
  const index = source.indexOf(`${stage}:`);
  assert(index > previousIndex, `${stage} must appear in monotonic stage order`);
  assert.match(source.slice(index, index + 260), new RegExp(`percent: ${percent}\\b`));
  assert(percent > previousPercent, `${stage} percent must move forward`);
  previousIndex = index;
  previousPercent = percent;
}

for (const aria of ["role", "aria-valuemin", "aria-valuemax", "aria-valuenow"]) {
  assert(source.includes(`\"${aria}\"`), `article progress must set ${aria}`);
}
assert.match(source, /payload\.job\?\.requestedTopic/);
assert.match(source, /payload\.job\?\.strategy\?\.primaryKeyword/);
assert.match(source, /querySelector\("\.article-panel"\)/);
assert.match(source, /previousPanel\?\.remove\(\)/);
assert.match(source, /window\.setTimeout\(\(\) => \{\s*void refreshArticlePanel\(\);\s*\}, 4_000\)/);
assert.match(source, /articleRefreshFailures = Math\.min\(articleRefreshFailures \+ 1, 4\)/);
assert.match(source, /Math\.min\(30_000, 4_000 \* \(2 \*\* \(articleRefreshFailures - 1\)\)\)/);
assert.match(source, /Reconnecting…/);
assert.match(source, /visibilitychange[\s\S]*refreshArticlePanel\(\)/);

for (const selector of [
  ".article-progress__spinner",
  ".article-progress__track",
  ".article-progress__fill",
  ".article-progress--done",
]) {
  assert(styles.includes(selector), `missing ${selector} styling`);
}
assert.match(styles, /\.article-progress__track\s*\{[\s\S]*height: 6px/);
assert.match(styles, /\.article-progress__fill\s*\{[\s\S]*background: var\(--brand-primary\)/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);

console.log("Article progress UI stage, accessibility, lifecycle, and styling tests passed.");
