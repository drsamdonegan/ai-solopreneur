import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AGENT_IDS } from "./compile-skills.mjs";
import {
  AGENT_NODE_BY_ID,
  validateAgentRouting,
  validateAgentToolScopes,
} from "./agent-runtime-contract.mjs";

const workflowPath = fileURLToPath(
  new URL("../n8n/workflows/00-start-here-project-partner.json", import.meta.url),
);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));

assert.deepEqual(validateAgentRouting(workflow), []);

const buildCode = workflow.nodes.find(
  (node) => node.name === "Build Agent Context",
).parameters.jsCode;
const runBuild = new Function("$json", "$", buildCode);
const fixtureBundle = {
  schemaVersion: 2,
  enabledSkills: [],
  globalInstructions: "GLOBAL-MARKER",
  agents: Object.fromEntries(
    AGENT_IDS.map((agentId) => [
      agentId,
      {
        skillIds: [`skill-${agentId}`],
        instructions: `SKILL-MARKER-${agentId}`,
        context: `CONTEXT-MARKER-${agentId}`,
      },
    ]),
  ),
  sourceHash: "a".repeat(64),
};

for (const selectedAgent of AGENT_IDS) {
  const request = {
    valid: true,
    schemaVersion: 3,
    requestId: "22222222-2222-4222-8222-222222222222",
    sessionId: "11111111-1111-4111-8111-111111111111",
    agentId: selectedAgent,
    message: "Current request",
    history: [],
    documents: [],
  };
  const result = runBuild(
    { value: JSON.stringify(fixtureBundle) },
    (name) => {
      assert.equal(name, "Validate and Normalise");
      return { first: () => ({ json: request }) };
    },
  ).json;
  assert.equal(result.agentId, selectedAgent);
  assert.equal(result.bundleState, "ready");
  assert.match(result.systemMessage, new RegExp(`SKILL-MARKER-${selectedAgent}`));
  assert.match(result.systemMessage, new RegExp(`CONTEXT-MARKER-${selectedAgent}`));
  for (const otherAgent of AGENT_IDS.filter((id) => id !== selectedAgent)) {
    assert.doesNotMatch(
      result.systemMessage,
      new RegExp(`SKILL-MARKER-${otherAgent}`),
    );
    assert.doesNotMatch(
      result.systemMessage,
      new RegExp(`CONTEXT-MARKER-${otherAgent}`),
    );
  }
}

const legacyResult = runBuild(
  {
    value: JSON.stringify({
      schemaVersion: 1,
      enabledSkills: [],
      combinedInstructions: "LEGACY-MIXED-MARKER",
    }),
  },
  () => ({
    first: () => ({
      json: {
        agentId: "sales",
        message: "Current request",
        history: [],
        documents: [],
      },
    }),
  }),
).json;
assert.equal(legacyResult.bundleState, "v1");
assert.equal(legacyResult.syncRequired, true);
assert.match(legacyResult.systemMessage, /run the skill sync helper/);
assert.doesNotMatch(legacyResult.systemMessage, /LEGACY-MIXED-MARKER/);

const validationCode = workflow.nodes.find(
  (node) => node.name === "Validate and Normalise",
).parameters.jsCode;
const runValidation = new Function("$json", validationCode);
const requestBody = {
  schemaVersion: 3,
  requestId: "22222222-2222-4222-8222-222222222222",
  sessionId: "11111111-1111-4111-8111-111111111111",
  message: "Hello",
  history: [],
  documents: [],
};
for (const agentId of AGENT_IDS) {
  assert.equal(runValidation({ body: { ...requestBody, agentId } }).json.valid, true);
}
const unknown = runValidation({
  body: { ...requestBody, agentId: "unknown-agent" },
}).json;
assert.equal(unknown.valid, false);
assert.equal(unknown.errorCode, "INVALID_REQUEST");

const fixtureWorkflow = structuredClone(workflow);

/**
 * Which agent owns each connected tool.
 *
 * The base tools are listed because they ship with the agent. Everything else
 * is read from the installed skills, because a hand-written map goes stale the
 * moment a learner installs a skill that adds a tool — and it goes stale as a
 * failing release check rather than as anything a learner could act on.
 */
const ownership = new Map([
  ["list_tasks", "project-manager"],
  ["create_task", "project-manager"],
  ["update_task_status", "project-manager"],
]);

const optionalSkillsDir = fileURLToPath(new URL("../optional-skills", import.meta.url));
const installedSkillsDir = fileURLToPath(new URL("../skills", import.meta.url));
for (const entry of await readdir(optionalSkillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith("_")) {
    continue;
  }
  try {
    // A skill counts as installed once its instructions are in skills/.
    await readFile(`${installedSkillsDir}/${entry.name}/skill.yaml`, "utf8");
  } catch {
    continue;
  }
  const manifest = JSON.parse(
    await readFile(`${optionalSkillsDir}/${entry.name}/manifest.json`, "utf8"),
  );
  for (const tool of manifest.agentTools ?? []) {
    assert.ok(
      manifest.agent,
      `${entry.name} wires tools into the agent but declares no owning agent`,
    );
    ownership.set(tool.name, manifest.agent);
  }
}
for (const agentId of AGENT_IDS) {
  const toolName = `mock_tool_${agentId.replaceAll("-", "_")}`;
  fixtureWorkflow.nodes.push({ name: toolName, type: "test.tool" });
  fixtureWorkflow.connections[toolName] = {
    ai_tool: [[{
      node: AGENT_NODE_BY_ID[agentId],
      type: "ai_tool",
      index: 0,
    }]],
  };
  ownership.set(toolName, agentId);
}
assert.deepEqual(validateAgentToolScopes(fixtureWorkflow, ownership), []);
fixtureWorkflow.connections.mock_tool_project_manager.ai_tool[0].push({
  node: "Sales Agent",
  type: "ai_tool",
  index: 0,
});
assert.match(
  validateAgentToolScopes(fixtureWorkflow, ownership).join("\n"),
  /mock_tool_project_manager must connect only to Project Manager Agent/,
);

process.stdout.write("Agent prompt, route, v1 fallback, and tool-scope checks passed.\n");
