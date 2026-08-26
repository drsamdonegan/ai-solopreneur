import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [html, source, styles, registry] = await Promise.all([
  readFile("apps/chat/public/index.html", "utf8"),
  readFile("apps/chat/public/app.js", "utf8"),
  readFile("apps/chat/public/styles.css", "utf8"),
  readFile("apps/chat/config/agents.json", "utf8").then(JSON.parse),
]);

const syntax = spawnSync(process.execPath, ["--check", "apps/chat/public/app.js"], {
  encoding: "utf8",
});
assert.equal(syntax.status, 0, syntax.stderr);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML ids must be unique");
assert.match(html, /<title>My AI Agent<\/title>/);
assert.match(html, /<div class="agent-list" id="agent-list"><\/div>/);
assert.doesNotMatch(html, /id="agent-list"[^>]+role=/);
assert.match(html, /id="my-business-button"/);
assert.match(html, /id="agent-dialog"/);
assert.match(html, /<h3 id="agent-dialog-skills-title">Skill packages<\/h3>/);
assert.match(html, /What do you want to call this workspace\?/);
assert.match(html, /placeholder="What should your agent do\?"/);
assert.doesNotMatch(html, /\sstyle=/);

assert.doesNotMatch(source, /\.innerHTML\s*=/);
assert.match(source, /\/api\/xero\/connect/);
assert.match(source, /Open Xero credentials/);
assert.doesNotMatch(
  source,
  /className = "agent-(?:row|settings|button)"|aria-pressed/,
);
assert.match(source, /createElementNS\(namespace, "svg"\)/);
assert.match(source, /chip\.setAttribute\("aria-hidden", "true"\)/);
assert.match(source, /card\.setAttribute\("aria-haspopup", "dialog"\)/);
assert.match(source, /card\.setAttribute\(\s*"aria-current"/);
assert.match(source, /function workspaceName\(\)/);
assert.match(source, /return activeAgent\(\)\?\.name \?\? config\.name/);
assert.match(source, /elements\.agentInitials\.style\.backgroundImage/);
assert.match(source, /function skillPackageState\(skill\)/);
assert.match(source, /chip\.dataset\.installed = String\(skill\.installed === true\)/);
assert.match(source, /chip\.dataset\.partial = String\(skill\.partiallyInstalled === true\)/);
assert.match(source, /Optional additions not installed/);
assert.match(source, /Run npm run sync-skills before relying on it in chat/);
assert.match(source, /No packaged skills are available for this agent yet/);
assert.match(source, /Includes:/);
assert.doesNotMatch(
  source,
  /elements\.mobileAgentInitials\.style\.backgroundImage/,
);

const setBusy = /function setBusy\(isBusy\) \{([\s\S]+?)\n  \}/.exec(source)?.[1];
assert(setBusy, "setBusy must exist");
assert.doesNotMatch(setBusy, /renderAgentList\(/);
assert.match(setBusy, /elements\.agentDialogChat\.disabled = controlsBusy/);
assert.match(source, /if \(event\.key === "Escape" && elements\.agentDialog\.open\)/);
assert.match(source, /const focusWasInPanel = elements\.agentPanel\.contains/);

for (const agent of registry.agents) {
  assert(source.includes(`id: "${agent.id}"`), `fallback missing ${agent.id}`);
  assert(
    source.includes(`accentColour: "${agent.accentColour}"`),
    `fallback missing ${agent.accentColour}`,
  );
  assert.match(styles, new RegExp(`\\[data-agent-id="${agent.id}"\\]`));
  for (const field of agent.settingsFields) {
    assert(
      source.includes(`id: "${field.id}"`),
      `fallback missing ${agent.id}.${field.id}`,
    );
    assert(source.includes(field.label), `fallback missing label ${field.label}`);
  }
}

for (const packageId of [
  "meeting-to-actions",
  "linkedin-profile-lookup",
  "linkedin-prospect-search",
  "domain-research",
  "seo-aeo-article-writer",
  "funding-and-investor-updates",
]) {
  assert(
    source.includes(`"${packageId}":`),
    `skill-package icon map missing ${packageId}`,
  );
}

assert.match(styles, /\.agent-card__skill::after/);
assert.match(styles, /\.agent-card__skill\[data-installed="false"\]\[data-partial="false"\]/);
assert.match(styles, /border-style: dashed/);
assert.match(styles, /\.agent-card__skill\[data-partial="true"\]/);
assert.match(styles, /@media \(hover: none\), \(pointer: coarse\)/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles, /\.paste-dialog\.agent-dialog textarea/);
assert.doesNotMatch(styles, /\.agent-row|\.agent-settings|\.agent-button/);

process.stdout.write("Agent card semantics, fallback, identity, and responsive UI checks passed.\n");
