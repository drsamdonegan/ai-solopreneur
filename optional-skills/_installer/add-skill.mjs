// Adds one optional skill to your agent.
//
// Everything a skill needs lives in optional-skills/<id>/. Most of it is new
// files that can simply be copied in. But four files already exist and differ
// from one learner to the next:
//
//   n8n/workflows/00-start-here-project-partner.json  the agent, and the base
//                                                     instructions inside it
//   tools/policy.json                                 what each tool may do
//   skills/enabled.txt                                which skills are loaded
//   n8n/folders.manifest.json                         where it shows in n8n
//
// Overwriting any of those would wipe out whatever else the learner has
// already switched on, so this makes the smallest possible addition to each
// one instead.
//
// Safe to run twice. Anything already in place is left exactly as it is.
//
//   node optional-skills/_installer/add-skill.mjs <skill-id>
//   node optional-skills/_installer/add-skill.mjs <github-folder-url>
//   node optional-skills/_installer/add-skill.mjs --list

import { readFile, writeFile, readdir, mkdir, copyFile, access, rm } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_IDS,
  parseSkillMetadata,
} from "../../scripts/compile-skills.mjs";
import { AGENT_NODE_BY_ID } from "../../scripts/agent-runtime-contract.mjs";

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

function addToolNode(workflow, toolNode, agentId) {
  const agentNode = AGENT_NODE_BY_ID[agentId];
  if (!agentNode || !workflow.nodes.some((node) => node.name === agentNode)) {
    throw new Error(`The agent workflow has no reviewed route for "${agentId}".`);
  }
  if (workflow.nodes.some((node) => node.name === toolNode.name)) {
    note(skipped, `Agent tool "${toolNode.name}" is already wired in`);
    return;
  }

  workflow.nodes.push({ ...toolNode, position: nextToolPosition(workflow) });
  workflow.connections[toolNode.name] = {
    ai_tool: [[{ node: agentNode, type: "ai_tool", index: 0 }]],
  };
  note(done, `Wired the "${toolNode.name}" tool into ${agentNode}`);
}

function toolRuleAnchor(agentId) {
  return `/* INSTALL ${agentId} TOOL RULES */`;
}

function patchBasePolicy(
  workflow,
  {
    agent,
    policyRules = [],
    unavailableCapabilities = [],
    policyReplacements = [],
  },
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
  const anchor = toolRuleAnchor(agent);
  if (!code.includes(anchor)) {
    throw new Error(
      `Could not find the reviewed tool-policy anchor for "${agent}". ` +
        "Re-import the current base workflow before adding this skill.",
    );
  }

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

  const scopedRules = [
    ...policyRules,
    ...unavailableCapabilities.map(
      (capability) => `- ${capability} is unavailable for this role.`,
    ),
  ];
  for (const rule of scopedRules) {
    const encoded = JSON.stringify(rule);
    if (code.includes(encoded)) {
      note(skipped, `A ${agent} tool rule was already in the agent instructions`);
      continue;
    }
    code = code.replace(anchor, `${encoded},\n      ${anchor}`);
    note(done, `Added a ${agent} tool rule to the agent instructions`);
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

// --- fetching one skill from GitHub ----------------------------------------

// A learner who made their project before a skill existed has no folder for it.
// Rather than copy the whole catalogue down, this fetches exactly the one
// folder they asked for. Public repository, so no sign-in and no git.
const DEFAULT_SOURCE = {
  owner: "drsamdonegan",
  repo: "ai-solopreneur",
  ref: "main",
};

function parseSkillUrl(value) {
  // https://github.com/<owner>/<repo>/tree/<ref>/optional-skills/<id>
  const match =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(value);
  if (!match) {
    throw new Error(
      `That does not look like a GitHub folder link:\n  ${value}\n\n` +
        "Open the skill's folder on GitHub and copy the address from the browser.",
    );
  }
  const [, owner, repo, ref, path] = match;
  const id = path.split("/").pop();
  return { owner, repo, ref, path, id };
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "ai-solopreneur-add-skill", Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) {
    throw new Error(`GitHub has nothing at that address:\n  ${url}`);
  }
  if (response.status === 403) {
    throw new Error(
      "GitHub is rate limiting this computer. Wait an hour and try again, or ask " +
        "your instructor for the skill folder directly.",
    );
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for:\n  ${url}`);
  }
  return response.json();
}

async function downloadFolder(source, path, target) {
  const url =
    `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${path}` +
    `?ref=${encodeURIComponent(source.ref)}`;
  const entries = await githubJson(url);
  if (!Array.isArray(entries)) {
    throw new Error(`Expected a folder at ${path}, but GitHub returned a file.`);
  }

  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    const destination = join(target, entry.name);
    if (entry.type === "dir") {
      await downloadFolder(source, entry.path, destination);
    } else if (entry.type === "file") {
      const file = await fetch(entry.download_url, {
        headers: { "User-Agent": "ai-solopreneur-add-skill" },
      });
      if (!file.ok) {
        throw new Error(`Could not download ${entry.path} (${file.status}).`);
      }
      await writeFile(destination, Buffer.from(await file.arrayBuffer()));
    }
  }
}

async function fetchSkill(request) {
  const skillDirectory = join(optionalSkillsDirectory, request.id);

  if (await exists(skillDirectory)) {
    note(skipped, `optional-skills/${request.id} is already here, so nothing was downloaded`);
    return request.id;
  }

  process.stdout.write(`Downloading the ${request.id} skill from GitHub...\n`);
  try {
    await downloadFolder(request, request.path, skillDirectory);
    if (!(await exists(join(skillDirectory, "manifest.json")))) {
      throw new Error(
        `The folder downloaded, but it has no manifest.json, so it is not a skill:\n  ${request.path}`,
      );
    }
  } catch (error) {
    // Leave nothing half-downloaded behind for the next run to trip over.
    await rm(skillDirectory, { recursive: true, force: true });
    throw error;
  }
  note(done, `Downloaded optional-skills/${request.id} from GitHub`);
  return request.id;
}

// --- main ------------------------------------------------------------------

async function addSkill(id) {
  const skillDirectory = join(optionalSkillsDirectory, id);
  if (!(await exists(skillDirectory))) {
    const available = await listSkillIds();
    throw new Error(
      `There is no optional skill called "${id}".\n` +
        `Available here: ${available.join(", ")}\n\n` +
        "If the skill is newer than your copy of the project, paste its GitHub\n" +
        "folder address instead and it will be downloaded first:\n" +
        `  npm run add-skill -- https://github.com/${DEFAULT_SOURCE.owner}/${DEFAULT_SOURCE.repo}/tree/${DEFAULT_SOURCE.ref}/optional-skills/${id}`,
    );
  }

  const manifest = await readJson(join(skillDirectory, "manifest.json"));
  if (
    manifest.id !== id ||
    !AGENT_IDS.includes(manifest.agent) ||
    typeof manifest.name !== "string"
  ) {
    throw new Error(
      `optional-skills/${id}/manifest.json has an invalid id, name, or agent.`,
    );
  }
  const metadataPath = join(skillDirectory, "skill", "skill.yaml");
  const metadata = parseSkillMetadata(
    await readFile(metadataPath, "utf8"),
    metadataPath,
  );
  if (metadata.id !== id || metadata.agent !== manifest.agent) {
    throw new Error(
      `The manifest assigns "${id}" to ${manifest.agent}, but skill.yaml ` +
        `declares ${metadata.id} for ${metadata.agent}.`,
    );
  }

  for (const required of manifest.requires ?? []) {
    if (!(await exists(join(projectRoot, "skills", required)))) {
      throw new Error(
        `"${id}" needs the "${required}" skill first.\n` +
          `Run: node optional-skills/_installer/add-skill.mjs ${required}`,
      );
    }
  }

  // Validate and prepare every shared-file edit before copying anything. An
  // old base workflow therefore fails cleanly instead of leaving half a skill.
  const workflow = await readJson(agentWorkflowPath);
  for (const toolNode of manifest.agentTools ?? []) {
    addToolNode(workflow, toolNode, manifest.agent);
  }
  patchBasePolicy(workflow, manifest);

  const policy = await readJson(policyPath);
  addPolicyEntries(policy, manifest.policyEntries ?? []);

  let folderManifest = null;
  if ((manifest.folders ?? []).length > 0) {
    folderManifest = await readJson(folderManifestPath);
    addFolderPlacements(folderManifest, manifest.folders);
  }

  // 1. The skill's own files.
  await copyTree(join(skillDirectory, "skill"), join(projectRoot, "skills", id));

  // 2. Its tool workflows.
  const workflowsDirectory = join(skillDirectory, "workflows");
  if (await exists(workflowsDirectory)) {
    await copyTree(workflowsDirectory, join(projectRoot, "n8n", "workflows"));
  }

  // 3. The four shared files, already validated in memory above.
  await writeJson(agentWorkflowPath, workflow);
  await writeJson(policyPath, policy);
  if (folderManifest !== null) {
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
    "\nAdd one with:\n" +
      "  npm run add-skill -- <skill-id>\n\n" +
      "Or paste a skill's GitHub folder address to download just that one first:\n" +
      `  npm run add-skill -- https://github.com/${DEFAULT_SOURCE.owner}/${DEFAULT_SOURCE.repo}/tree/${DEFAULT_SOURCE.ref}/optional-skills/<skill-id>\n`,
  );
  process.exit(0);
}

let manifest;
try {
  // A GitHub folder address means fetch that one skill, then install it.
  const id = requested.startsWith("http")
    ? await fetchSkill(parseSkillUrl(requested))
    : requested;
  manifest = await addSkill(id);
} catch (error) {
  // A learner should see the problem, not a stack trace.
  process.stderr.write(`\nCould not add "${requested}".\n\n${error.message}\n\n`);
  process.stderr.write(
    "Some earlier steps may already be in place. Fix the problem and run the same command again; installation is idempotent.\n",
  );
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
