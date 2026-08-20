// Makes a clean copy of the base agent: no optional skills, no optional tools,
// and no catalogue folder either.
//
// This is an instructor tool. It reads from the last commit rather than the
// working folder, so whatever you have installed or half-edited locally cannot
// leak into what a learner downloads.
//
//   node scripts/make-base.mjs ../ai-solopreneur-base
//
// The result is a plain folder. Zip it and hand it out, or push it somewhere
// learners can download it.

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The base agent is exactly this. Anything else in skills/ or n8n/workflows/
// arrived with an optional skill and must not ship.
const BASE_SKILLS = [
  "project-assistant",
  "meeting-analysis",
  "task-capture",
  "weekly-status",
];
const BASE_WORKFLOWS = [
  "00-start-here-project-partner.json",
  "01-start-here-learner-checklist.json",
  "10-setup-local-task-data.json",
  "11-setup-sync-enabled-skills.json",
  "20-tool-list-tasks.json",
  "21-tool-create-task.json",
  "22-tool-update-task-status.json",
  "30-tool-propose-create-task.json",
  "31-tool-propose-update-task-status.json",
  "40-confirm-task-write.json",
  "90-debug-agent-health.json",
];
const AGENT_IDS = [
  "project-manager",
  "sales",
  "marketing",
  "investment",
  "bookkeeping",
];

function git(args) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.slice(0, 2).join(" ")} failed: ${result.stderr?.toString().trim()}`,
    );
  }
  return result.stdout;
}

function shouldInclude(path) {
  // The catalogue itself never ships in a base copy.
  if (path === "optional-skills" || path.startsWith("optional-skills/")) {
    return false;
  }
  // A skill folder that is not one of the base four came from an install.
  if (path.startsWith("skills/")) {
    const id = path.split("/")[1];
    return id === "enabled.txt" || BASE_SKILLS.includes(id);
  }
  if (path.startsWith("n8n/workflows/")) {
    return BASE_WORKFLOWS.includes(path.split("/")[2]);
  }
  return true;
}

const target = process.argv[2];
if (!target) {
  process.stderr.write(
    "Where should the base agent go?\n\n" +
      "  node scripts/make-base.mjs ../ai-solopreneur-base\n",
  );
  process.exit(1);
}

const destination = resolve(process.cwd(), target);
if (destination === projectRoot) {
  process.stderr.write("That is this project. Choose a different folder.\n");
  process.exit(1);
}

let alreadyThere = false;
try {
  await access(destination);
  alreadyThere = true;
} catch {}

if (alreadyThere) {
  if (process.argv[3] !== "--overwrite") {
    process.stderr.write(
      `${destination} already exists.\n\n` +
        "Delete it yourself, or re-run with --overwrite to replace it.\n",
    );
    process.exit(1);
  }
  await rm(destination, { recursive: true, force: true });
}

const head = git(["rev-parse", "--short", "HEAD"]).toString().trim();
const tracked = git(["ls-tree", "-r", "HEAD", "--name-only", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean);

const included = tracked.filter(shouldInclude);
const skipped = tracked.length - included.length;
const optionalManifests = tracked
  .filter((path) => /^optional-skills\/[^/]+\/manifest\.json$/.test(path))
  .map((path) => JSON.parse(git(["show", `HEAD:${path}`]).toString()));

for (const path of included) {
  const outPath = join(destination, path);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, git(["show", `HEAD:${path}`]));
}

// A maintainer may have optional skills enabled in the source checkout. The
// generated learner base always receives the canonical four, independently of
// that local release state.
await writeFile(
  join(destination, "skills", "enabled.txt"),
  `${BASE_SKILLS.join("\n")}\n`,
  "utf8",
);

// Optional installers make surgical additions to three shared JSON files.
// Excluding the skill's own files is therefore not enough: reverse every
// catalogue-declared addition so the output is a physically clean base even
// when the release checkout has optional skills installed.
const agentPath = join(
  destination,
  "n8n",
  "workflows",
  "00-start-here-project-partner.json",
);
const policyPath = join(destination, "tools", "policy.json");
const foldersPath = join(destination, "n8n", "folders.manifest.json");
const agentWorkflow = JSON.parse(await readFile(agentPath, "utf8"));
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const folders = JSON.parse(await readFile(foldersPath, "utf8"));
const optionalToolNames = new Set(
  optionalManifests.flatMap((manifest) =>
    (manifest.agentTools ?? []).map((tool) => tool.name),
  ),
);
const optionalPolicyIds = new Set(
  optionalManifests.flatMap((manifest) =>
    (manifest.policyEntries ?? []).map((entry) => entry.id),
  ),
);
const optionalWorkflowNames = new Set(
  optionalManifests.flatMap((manifest) =>
    (manifest.folders ?? []).flatMap((folder) => folder.workflows ?? []),
  ),
);

agentWorkflow.nodes = agentWorkflow.nodes.filter(
  (node) => !optionalToolNames.has(node.name),
);
for (const toolName of optionalToolNames) {
  delete agentWorkflow.connections[toolName];
}
for (const sourceConnections of Object.values(agentWorkflow.connections)) {
  for (const [type, groups] of Object.entries(sourceConnections)) {
    sourceConnections[type] = groups.map((group) =>
      group.filter((connection) => !optionalToolNames.has(connection.node)),
    );
  }
}

const contextNode = agentWorkflow.nodes.find(
  (node) => node.name === "Build Agent Context",
);
if (!contextNode) {
  throw new Error('The committed agent has no "Build Agent Context" node.');
}
let contextCode = contextNode.parameters.jsCode;
function removeRuleFromAgent(code, agentId, rule) {
  const anchor = `/* INSTALL ${agentId} TOOL RULES */`;
  const end = code.indexOf(anchor);
  if (end === -1) {
    return code;
  }

  let start = 0;
  for (const otherAgentId of AGENT_IDS) {
    if (otherAgentId === agentId) {
      continue;
    }
    const otherAnchor = `/* INSTALL ${otherAgentId} TOOL RULES */`;
    const at = code.indexOf(otherAnchor);
    if (at !== -1 && at < end) {
      start = Math.max(start, at + otherAnchor.length);
    }
  }

  const before = code.slice(0, start);
  let scopedRules = code.slice(start, end);
  const encodedRule = `${JSON.stringify(rule)},\n      `;
  while (scopedRules.includes(encodedRule)) {
    scopedRules = scopedRules.replace(encodedRule, "");
  }
  return `${before}${scopedRules}${code.slice(end)}`;
}

// Undo the catalogue in reverse order. Some later skills deliberately broaden
// text introduced by an earlier skill (Telegram extends Domain Research's
// safety line), so reversing in catalogue order can strand the later text.
for (const manifest of [...optionalManifests].reverse()) {
  const rules = [
    ...(manifest.policyRules ?? []),
    ...(manifest.unavailableCapabilities ?? []).map(
      (capability) => `- ${capability} is unavailable for this role.`,
    ),
  ];
  const targetAgents =
    manifest.agent === "global" ? AGENT_IDS : [manifest.agent];
  for (const targetAgent of targetAgents) {
    for (const rule of rules) {
      contextCode = removeRuleFromAgent(contextCode, targetAgent, rule);
    }
  }
  for (const replacement of manifest.policyReplacements ?? []) {
    if (contextCode.includes(replacement.replace)) {
      contextCode = contextCode.replace(replacement.replace, replacement.find);
    }
  }
}

for (const manifest of optionalManifests) {
  const rules = [
    ...(manifest.policyRules ?? []),
    ...(manifest.unavailableCapabilities ?? []).map(
      (capability) => `- ${capability} is unavailable for this role.`,
    ),
  ];
  for (const rule of rules) {
    if (contextCode.includes(JSON.stringify(rule))) {
      throw new Error(
        `Optional prompt rule from "${manifest.id}" remained in the learner base.`,
      );
    }
  }
  for (const replacement of manifest.policyReplacements ?? []) {
    if (contextCode.includes(replacement.replace)) {
      throw new Error(
        `Optional prompt replacement from "${manifest.id}" remained in the learner base.`,
      );
    }
  }
}
contextNode.parameters.jsCode = contextCode;

policy.tools = policy.tools.filter((tool) => !optionalPolicyIds.has(tool.id));
for (const folder of folders.folders) {
  folder.workflows = folder.workflows.filter(
    (workflow) => !optionalWorkflowNames.has(workflow),
  );
}
folders.folders = folders.folders.filter((folder) => folder.workflows.length > 0);

await writeFile(agentPath, `${JSON.stringify(agentWorkflow, null, 2)}\n`, "utf8");
await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
await writeFile(foldersPath, `${JSON.stringify(folders, null, 2)}\n`, "utf8");

process.stdout.write(`\nBase agent written to ${destination}\n\n`);
process.stdout.write(`  from commit   ${head}\n`);
process.stdout.write(`  files         ${included.length} (${skipped} left out)\n`);
process.stdout.write(`  skills        ${BASE_SKILLS.join(", ")}\n`);
process.stdout.write(`  workflows     ${BASE_WORKFLOWS.length}\n`);

process.stdout.write(
  "\nNothing optional is installed. A learner who runs setup here gets the\n" +
    "project manager and its task tools, and adds skills from GitHub as needed.\n",
);
