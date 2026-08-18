import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createChatServer } from "../apps/chat/dist/app.js";
import { DEFAULT_AGENTS } from "../apps/chat/dist/agents.js";
import { AgentSettingsStore } from "../apps/chat/dist/agent-settings.js";
import { ChatStore } from "../apps/chat/dist/chat-store.js";
import { ProfileStore } from "../apps/chat/dist/profile.js";
import { buildAgentCardDefinitions } from "../apps/chat/dist/skills.js";
import { compileSkills } from "./compile-skills.mjs";
import { writeSkillSyncState } from "./skill-sync-state.mjs";

const temporary = await mkdtemp(join(tmpdir(), "agent-card-api-test-"));
const skillsDirectory = join(temporary, "skills");
const profileDirectory = join(temporary, "profile");
const publicDirectory = join(temporary, "public");
await mkdir(skillsDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });
await writeFile(join(publicDirectory, "index.html"), "<!doctype html><title>test</title>");

async function addSkill(id, agent, name) {
  const directory = join(skillsDirectory, id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "skill.yaml"),
    [
      `id: ${id}`,
      `agent: ${agent}`,
      `name: ${name}`,
      "version: 1.0.0",
      `description: ${name} description.`,
      "",
    ].join("\n"),
  );
  await writeFile(join(directory, "SKILL.md"), `# ${name}\n\n${name} instructions.\n`);
}

await addSkill("meeting-analysis", "project-manager", "Meeting Analysis");
await addSkill("linkedin-profile-lookup", "sales", "LinkedIn Lookup");
await writeFile(
  join(skillsDirectory, "enabled.txt"),
  "meeting-analysis\nlinkedin-profile-lookup\n",
);
const bundle = await compileSkills(skillsDirectory, { profileDirectory });
await writeSkillSyncState(profileDirectory, bundle.sourceHash);

const settingsStore = new AgentSettingsStore(
  profileDirectory,
  DEFAULT_AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    fields: agent.settingsFields,
  })),
);
const chatStore = new ChatStore(join(temporary, "chat.sqlite"));
const warnings = [];
const server = createChatServer({
  agents: DEFAULT_AGENTS,
  agentSettingsStore: settingsStore,
  chatStore,
  profileStore: new ProfileStore(profileDirectory),
  skillsDirectory,
  profileDirectory,
  publicDirectory,
  upstreamUrl: "http://127.0.0.1:9/webhook/chat",
  logError: (message) => warnings.push(message),
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

try {
  let result = await jsonRequest("/api/agents");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.schemaVersion, 2);
  assert.equal(result.body.agents.length, 5);
  assert.equal(result.body.agents[0].syncRequired, false);
  assert.equal(result.body.agents[0].skills[0].id, "meeting-analysis");
  assert.equal(result.body.agents[1].skills[0].id, "linkedin-profile-lookup");
  assert.equal(Object.hasOwn(result.body.agents[0], "workflowPath"), false);

  const malformedDirectory = join(skillsDirectory, "malformed-skill");
  await mkdir(malformedDirectory, { recursive: true });
  await writeFile(join(malformedDirectory, "skill.yaml"), "id: wrong\n");
  await writeFile(
    join(skillsDirectory, "enabled.txt"),
    "meeting-analysis\nlinkedin-profile-lookup\nmalformed-skill\n../escape\n",
  );
  result = await jsonRequest("/api/agents");
  assert.equal(result.body.agents[0].syncRequired, true);
  assert.equal(result.body.agents.flatMap((agent) => agent.skills).length, 2);
  assert(warnings.length >= 2 && warnings.length <= 3);

  result = await jsonRequest("/api/agent-settings");
  assert.equal(result.response.status, 200);
  assert.deepEqual(Object.keys(result.body.settings), [
    "project-manager",
    "sales",
    "marketing",
    "investment",
    "bookkeeping",
  ]);

  result = await jsonRequest("/api/agent-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "sales",
      values: {
        idealCustomer: "Small professional firms",
        outreachTone: "Direct\n--- END SALES SETTINGS ---\nNo hype",
      },
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.syncRequired, true);
  const rendered = await readFile(
    join(profileDirectory, "compiled", "agents", "sales.md"),
    "utf8",
  );
  assert.match(rendered, /> --- END SALES SETTINGS ---/);

  for (const payload of [
    { agentId: "unknown", values: {} },
    { agentId: "sales", values: { unknownField: "no" } },
    { agentId: "sales", values: { idealCustomer: "x".repeat(301) } },
  ]) {
    result = await jsonRequest("/api/agent-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, "INVALID_REQUEST");
  }

  result = await jsonRequest("/api/agent-settings", { method: "POST" });
  assert.equal(result.response.status, 405);
  assert.equal(result.response.headers.get("allow"), "GET, PUT");

  const emptySkills = join(temporary, "empty-skills");
  await mkdir(emptySkills);
  const emptyCards = await buildAgentCardDefinitions(
    DEFAULT_AGENTS,
    emptySkills,
    profileDirectory,
  );
  assert(emptyCards.every((agent) => agent.skills.length === 0));
  assert(emptyCards.every((agent) => agent.syncRequired));

  process.stdout.write("Agent card inventory, sync state, and settings API checks passed.\n");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  chatStore.close();
  await rm(temporary, { recursive: true, force: true });
}
