// Adds one optional skill to your agent.
//
// Everything a skill needs lives in optional-skills/<id>/. Most of it is new
// files that can simply be copied in. But four files already exist and differ
// from one learner to the next: the agent workflow, the tool policy, the skill
// list, and the base agent instructions. Overwriting those would wipe out
// whatever else you have already switched on, so this makes the smallest
// possible addition to each one instead.
//
// Safe to run twice. Anything already in place is left exactly as it is.
//
//   node optional-skills/_installer/add-skill.mjs <skill-id>
//   node optional-skills/_installer/add-skill.mjs --list

import { readFile, writeFile, readdir, mkdir, copyFile, access } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const optionalSkillsDirectory = join(projectRoot, "optional-skills");
const agentWorkflowPath = join(
  projectRoot,
  "n8n",
  "workflows",
  "00-start-here-project-partner.json",
);
const policyPath = join(projectRoot, "tools", "policy.json");
const folderManifestPath = join(projectRoot, "n8n", "folders.manifest.json");
const enabledPath = join(projectRoot, "skills", "enabled.txt");

const AGENT_NODE = "Project Partner Agent";
const CONTEXT_NODE = "Build Agent Context";
// Optional tool nodes sit on their own row under the core task tools.
const TOOL_ROW_Y = 680;
const TOOL_ROW_START_X = 940;
const TOOL_ROW_STEP_X = 180;

const done = [];
const skipped = [];

function note(list, message) {
  list.push(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function listSkillIds() {
  const entries = await readdir(optionalSkillsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, target);
    } else if (await exists(target)) {
      note(skipped, `${relative(projectRoot, target)} already exists`);
    } else {
      await copyFile(source, target);
      note(done, `Added ${relative(projectRoot, target)}`);
    }
  }
}

// --- the four shared files -------------------------------------------------

function nextToolPosition(workflow) {
  const used = workflow.nodes
    .filter((node) => Array.isArray(node.position) && node.position[1] === TOOL_ROW_Y)
    .map((node) => node.position[0]);
  const nextX = used.length === 0 ? TOOL_ROW_START_X : Math.max(...used) + TOOL_ROW_STEP_X;
  return [nextX, TOOL_ROW_Y];
}

function addToolNode(workflow, toolNode) {
  if (workflow.nodes.some((node) => node.name === toolNode.name)) {
    note(skipped, `Agent tool "${toolNode.name}" is already wired in`);
    return;
  }

  workflow.nodes.push({ ...toolNode, position: nextToolPosition(workflow) });
  workflow.connections[toolNode.name] = {
    ai_tool: [[{ node: AGENT_NODE, type: "ai_tool", index: 0 }]],
  };
  note(done, `Wired the "${toolNode.name}" tool into the agent`);
}

// The base agent instructions live as a template string inside the
// "Build Agent Context" code node. New tool rules go immediately before the
// line listing what the agent can never do, so that line stays last.
const UNAVAILABLE_ANCHOR = "- Delete, archive, bulk changes,";

function patchBasePolicy(
  workflow,
  { policyRules = [], unavailableCapabilities = [], policyReplacements = [] },
) {
  if (
    policyRules.length === 0 &&
    unavailableCapabilities.length === 0 &&
    policyReplacements.length === 0
  ) {
    return;
  }

  const contextNode = workflow.nodes.find((node) => node.name === CONTEXT_NODE);
  if (!contextNode) {
    throw new Error(`The agent workflow has no "${CONTEXT_NODE}" node.`);
  }

  let code = contextNode.parameters.jsCode;

  for (const replacement of policyReplacements) {
    if (code.includes(replacement.replace)) {
      note(skipped, "A base instruction was already broadened");
      continue;
    }
    if (!code.includes(replacement.find)) {
      throw new Error(
        `Could not find this line in the base agent instructions:\n  ${replacement.find}`,
      );
    }
    code = code.replace(replacement.find, replacement.replace);
    note(done, "Broadened a base instruction to cover this skill");
  }

  for (const rule of policyRules) {
    // basePolicy is a template literal, so a backtick would end it early.
    const encoded = rule.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    if (code.includes(encoded)) {
      note(skipped, "A tool rule was already in the agent instructions");
      continue;
    }
    const anchorIndex = code.indexOf(UNAVAILABLE_ANCHOR);
    if (anchorIndex === -1) {
      throw new Error(
        "Could not find the capability line in the base agent instructions.",
      );
    }
    code = `${code.slice(0, anchorIndex)}${encoded}\n${code.slice(anchorIndex)}`;
    note(done, "Added a tool rule to the agent instructions");
  }

  for (const capability of unavailableCapabilities) {
    const anchorIndex = code.indexOf(UNAVAILABLE_ANCHOR);
    const lineEnd = code.indexOf("\n", anchorIndex);
    const line = code.slice(anchorIndex, lineEnd);
    if (line.includes(capability)) {
      note(skipped, `"${capability}" is already listed as unavailable`);
      continue;
    }
    const updated = line.replace(
      ", SQL, shell, and filesystem capabilities are unavailable.",
      `, ${capability}, SQL, shell, and filesystem capabilities are unavailable.`,
    );
    if (updated === line) {
      throw new Error("Could not extend the list of unavailable capabilities.");
    }
    code = code.slice(0, anchorIndex) + updated + code.slice(lineEnd);
    note(done, `Listed "${capability}" as unavailable`);
  }

  contextNode.parameters.jsCode = code;
}

function addPolicyEntries(policy, entries) {
  for (const entry of entries) {
    if (policy.tools.some((tool) => tool.id === entry.id)) {
      note(skipped, `Tool policy for "${entry.id}" already exists`);
      continue;
    }
    // Keep the always-unavailable destructive tools at the end of the list.
    const firstDestructive = policy.tools.findIndex(
      (tool) => tool.risk === "destructive",
    );
    const at = firstDestructive === -1 ? policy.tools.length : firstDestructive;
    policy.tools.splice(at, 0, entry);
    note(done, `Recorded the tool policy for "${entry.id}"`);
  }
}

// n8n only draws folders inside a project, so every workflow has to be filed
// into exactly one of them or a learner will never find it. A skill says which
// folder its workflows belong in, and creates that folder if it is the first
// skill to need it.
function addFolderPlacements(folderManifest, placements) {
  for (const placement of placements) {
    let folder = folderManifest.folders.find((entry) => entry.id === placement.id);

    if (!folder) {
      if (!placement.name) {
        throw new Error(
          `This skill wants to file workflows into the "${placement.id}" folder, ` +
            "which does not exist and the skill does not describe.",
        );
      }
      folder = {
        id: placement.id,
        name: placement.name,
        description: placement.description ?? "",
        workflows: [],
      };
      folderManifest.folders.push(folder);
      folderManifest.folders.sort((a, b) => a.name.localeCompare(b.name));
      note(done, `Created the "${folder.name}" folder in n8n`);
    }

    for (const file of placement.workflows) {
      const filedElsewhere = folderManifest.folders.find(
        (entry) => entry !== folder && entry.workflows.includes(file),
      );
      if (filedElsewhere) {
        note(skipped, `${file} is already filed under "${filedElsewhere.name}"`);
        continue;
      }
      if (folder.workflows.includes(file)) {
        note(skipped, `${file} is already filed under "${folder.name}"`);
        continue;
      }
      folder.workflows.push(file);
      note(done, `Filed ${file} under "${folder.name}"`);
    }
  }
}

async function enableSkill(id) {
  const source = await readFile(enabledPath, "utf8");
  const alreadyEnabled = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes(id);

  if (alreadyEnabled) {
    note(skipped, `"${id}" is already listed in skills/enabled.txt`);
    return;
  }

  const separator = source.endsWith("\n") ? "" : "\n";
  await writeFile(enabledPath, `${source}${separator}${id}\n`);
  note(done, `Switched "${id}" on in skills/enabled.txt`);
}

// --- main ------------------------------------------------------------------

async function addSkill(id) {
  const skillDirectory = join(optionalSkillsDirectory, id);
  if (!(await exists(skillDirectory))) {
    const available = await listSkillIds();
    throw new Error(
      `There is no optional skill called "${id}".\nAvailable: ${available.join(", ")}`,
    );
  }

  const manifest = await readJson(join(skillDirectory, "manifest.json"));

  for (const required of manifest.requires ?? []) {
    if (!(await exists(join(projectRoot, "skills", required)))) {
      throw new Error(
        `"${id}" needs the "${required}" skill first.\n` +
          `Run: node optional-skills/_installer/add-skill.mjs ${required}`,
      );
    }
  }

  // 1. The skill's own files.
  await copyTree(join(skillDirectory, "skill"), join(projectRoot, "skills", id));

  // 2. Its tool workflows.
  const workflowsDirectory = join(skillDirectory, "workflows");
  if (await exists(workflowsDirectory)) {
    await copyTree(workflowsDirectory, join(projectRoot, "n8n", "workflows"));
  }

  // 3. The four shared files.
  const workflow = await readJson(agentWorkflowPath);
  for (const toolNode of manifest.agentTools ?? []) {
    addToolNode(workflow, toolNode);
  }
  patchBasePolicy(workflow, manifest);
  await writeJson(agentWorkflowPath, workflow);

  const policy = await readJson(policyPath);
  addPolicyEntries(policy, manifest.policyEntries ?? []);
  await writeJson(policyPath, policy);

  if ((manifest.folders ?? []).length > 0) {
    const folderManifest = await readJson(folderManifestPath);
    addFolderPlacements(folderManifest, manifest.folders);
    await writeJson(folderManifestPath, folderManifest);
  }

  await enableSkill(id);

  return manifest;
}

const requested = process.argv[2];

if (!requested || requested === "--list") {
  const ids = await listSkillIds();
  process.stdout.write("Optional skills you can add:\n");
  for (const id of ids) {
    const manifest = await readJson(join(optionalSkillsDirectory, id, "manifest.json"));
    const installed = (await exists(join(projectRoot, "skills", id))) ? " (installed)" : "";
    process.stdout.write(`  ${id.padEnd(26)} ${manifest.name}${installed}\n`);
  }
  process.stdout.write(
    "\nAdd one with:\n  node optional-skills/_installer/add-skill.mjs <skill-id>\n",
  );
  process.exit(0);
}

let manifest;
try {
  manifest = await addSkill(requested);
} catch (error) {
  // A learner should see the problem, not a stack trace.
  process.stderr.write(`\nCould not add "${requested}".\n\n${error.message}\n\n`);
  process.stderr.write("Nothing else was changed. Fix the above and run it again.\n");
  process.exit(1);
}

process.stdout.write(`\n${manifest.name} is installed.\n\n`);
if (done.length > 0) {
  process.stdout.write("Changed:\n");
  for (const line of done) process.stdout.write(`  ${line}\n`);
}
if (skipped.length > 0) {
  process.stdout.write("\nAlready in place:\n");
  for (const line of skipped) process.stdout.write(`  ${line}\n`);
}
process.stdout.write(
  "\nNext: run the skill sync helper, then restart the services so n8n picks up the new workflows.\n" +
    "  macOS:   ./sync-skills.command  then  ./start.command\n" +
    "  Windows: sync-skills-windows.cmd  then  start-windows.cmd\n",
);
if (manifest.setup) {
  process.stdout.write(`\n${manifest.setup}\n`);
}
