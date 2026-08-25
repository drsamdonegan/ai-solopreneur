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
import {
  AGENT_NODE_BY_ID,
  AGENT_NODE_NAMES,
} from "../../scripts/agent-runtime-contract.mjs";
import {
  loadSkillPacks,
  moduleIdsForPackage,
} from "../../scripts/skill-packages.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const optionalSkillsDirectory = join(projectRoot, "optional-skills");
const skillPacksDirectory = join(projectRoot, "skill-packs");
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

async function listSkillPacks() {
  try {
    return await loadSkillPacks(skillPacksDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
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

// A skill declaring `global` puts its tools on every agent rather than one.
function agentNodesFor(agentId) {
  return agentId === "global"
    ? [...AGENT_NODE_NAMES]
    : [AGENT_NODE_BY_ID[agentId]].filter(Boolean);
}

function addToolNode(workflow, toolNode, agentId) {
  const agentNodes = agentNodesFor(agentId);
  const missingRoute = agentNodes.find(
    (name) => !workflow.nodes.some((node) => node.name === name),
  );
  if (agentNodes.length === 0 || missingRoute) {
    throw new Error(`The agent workflow has no reviewed route for "${agentId}".`);
  }

  if (workflow.nodes.some((node) => node.name === toolNode.name)) {
    note(skipped, `Agent tool "${toolNode.name}" is already there`);
  } else {
    workflow.nodes.push({ ...toolNode, position: nextToolPosition(workflow) });
    note(done, `Added the "${toolNode.name}" tool`);
  }

  // Wiring is checked one agent at a time rather than "is the node present",
  // so re-running this repairs an install made before the skill went global
  // instead of reporting it as already done.
  const wired = workflow.connections[toolNode.name]?.ai_tool?.[0] ?? [];
  const already = new Set(wired.map((connection) => connection.node));
  const missing = agentNodes.filter((name) => !already.has(name));
  if (missing.length === 0) {
    note(skipped, `"${toolNode.name}" is already wired to its agent`);
    return;
  }
  workflow.connections[toolNode.name] = {
    ai_tool: [
      [
        ...wired,
        ...missing.map((node) => ({ node, type: "ai_tool", index: 0 })),
      ],
    ],
  };
  note(done, `Wired the "${toolNode.name}" tool into ${missing.join(", ")}`);
}

function toolRuleAnchor(agentId) {
  return `/* INSTALL ${agentId} TOOL RULES */`;
}

// One agent's tool rules are the text between the anchor before its own and its
// own, because every rule is inserted immediately above the anchor it belongs
// to. Positions are read from the file rather than assumed, so the five blocks
// can be in any order.
function rulesFor(code, agentId) {
  const anchor = toolRuleAnchor(agentId);
  const end = code.indexOf(anchor);
  if (end === -1) {
    return "";
  }
  let start = 0;
  for (const other of AGENT_IDS) {
    if (other === agentId) {
      continue;
    }
    const otherAnchor = toolRuleAnchor(other);
    const at = code.indexOf(otherAnchor);
    if (at !== -1 && at < end) {
      start = Math.max(start, at + otherAnchor.length);
    }
  }
  return code.slice(start, end);
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
  const ruleAgents = agent === "global" ? [...AGENT_IDS] : [agent];
  for (const ruleAgent of ruleAgents) {
    if (!code.includes(toolRuleAnchor(ruleAgent))) {
      throw new Error(
        `Could not find the reviewed tool-policy anchor for "${ruleAgent}". ` +
          "Re-import the current base workflow before adding this skill.",
      );
    }
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
  for (const ruleAgent of ruleAgents) {
    const anchor = toolRuleAnchor(ruleAgent);
    for (const rule of scopedRules) {
      const encoded = JSON.stringify(rule);
      // A global skill writes the same sentence into five different lists, so
      // "is this text anywhere in the file" is the wrong question: it would
      // stop after the first agent and leave the other four without rules.
      // Only this agent's own stretch of the file counts.
      if (rulesFor(code, ruleAgent).includes(encoded)) {
        note(skipped, `A ${ruleAgent} tool rule was already in the agent instructions`);
        continue;
      }
      code = code.replace(anchor, `${encoded},\n      ${anchor}`);
      note(done, `Added a ${ruleAgent} tool rule to the agent instructions`);
    }
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

async function enableSkills(ids) {
  const source = await readFile(enabledPath, "utf8");
  const enabled = enabledIdsFromSource(source);
  const additions = [];
  for (const id of ids) {
    if (enabled.has(id)) {
      note(skipped, `"${id}" is already listed in skills/enabled.txt`);
      continue;
    }
    enabled.add(id);
    additions.push(id);
    note(done, `Switched "${id}" on in skills/enabled.txt`);
  }
  if (additions.length === 0) return;
  const separator = source.endsWith("\n") ? "" : "\n";
  await writeFile(enabledPath, `${source}${separator}${additions.join("\n")}\n`);
}

function enabledIdsFromSource(source) {
  return new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

// --- fetching one package or module from GitHub -----------------------------

// A learner who made their project before a skill existed has no folder for it.
// Rather than copy the whole catalogue down, this fetches exactly the one
// folder they asked for. Public repository, so no sign-in and no git.
const DEFAULT_SOURCE = {
  owner: "drsamdonegan",
  repo: "ai-solopreneur",
  ref: "main",
};

function parseGithubFolderUrl(value) {
  // https://github.com/<owner>/<repo>/tree/<ref>/(optional-skills|skill-packs)/<id>
  const match =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(value);
  if (!match) {
    throw new Error(
      `That does not look like a GitHub folder link:\n  ${value}\n\n` +
        "Open the package or module folder on GitHub and copy the address from the browser.",
    );
  }
  const [, owner, repo, ref, path] = match;
  const pathParts = path.split("/");
  const kind = pathParts.includes("skill-packs")
    ? "package"
    : pathParts.includes("optional-skills")
      ? "module"
      : null;
  if (!kind) {
    throw new Error(
      "The GitHub folder must be inside skill-packs/ or optional-skills/.",
    );
  }
  const id = path.split("/").pop();
  return { owner, repo, ref, path, id, kind };
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

async function fetchFolder(request) {
  const parent = request.kind === "package" ? skillPacksDirectory : optionalSkillsDirectory;
  const folder = join(parent, request.id);
  const relativeFolder = `${request.kind === "package" ? "skill-packs" : "optional-skills"}/${request.id}`;
  const contractFile = request.kind === "package" ? "pack.json" : "manifest.json";

  if (await exists(folder)) {
    note(skipped, `${relativeFolder} is already here, so nothing was downloaded`);
    return request.id;
  }

  process.stdout.write(`Downloading ${relativeFolder} from GitHub...\n`);
  try {
    await downloadFolder(request, request.path, folder);
    if (!(await exists(join(folder, contractFile)))) {
      throw new Error(
        `The folder downloaded, but it has no ${contractFile}:\n  ${request.path}`,
      );
    }
  } catch (error) {
    // Leave nothing half-downloaded behind for the next run to trip over.
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  note(done, `Downloaded ${relativeFolder} from GitHub`);
  return request.id;
}

// --- main ------------------------------------------------------------------

async function validateModule(id, plannedIds) {
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
    !(AGENT_IDS.includes(manifest.agent) || manifest.agent === "global") ||
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
    if (
      !plannedIds.has(required) &&
      !(await exists(join(projectRoot, "skills", required)))
    ) {
      throw new Error(
        `"${id}" needs the "${required}" skill first.\n` +
          `Run: node optional-skills/_installer/add-skill.mjs ${required}`,
      );
    }
  }
  return { id, manifest, skillDirectory };
}

async function addSkills(ids) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const plannedIds = new Set(uniqueIds);
  const modules = [];
  for (const id of uniqueIds) {
    modules.push(await validateModule(id, plannedIds));
  }

  // Validate and prepare every shared-file edit for the whole package before
  // copying anything. An old base workflow therefore fails cleanly instead of
  // leaving half a package.
  const workflow = await readJson(agentWorkflowPath);
  const policy = await readJson(policyPath);
  const needsFolders = modules.some(
    ({ manifest }) => (manifest.folders ?? []).length > 0,
  );
  const folderManifest = needsFolders ? await readJson(folderManifestPath) : null;

  for (const { manifest } of modules) {
    for (const toolNode of manifest.agentTools ?? []) {
      addToolNode(workflow, toolNode, manifest.agent);
    }
    patchBasePolicy(workflow, manifest);
    addPolicyEntries(policy, manifest.policyEntries ?? []);
    if (folderManifest !== null) {
      addFolderPlacements(folderManifest, manifest.folders ?? []);
    }
  }

  for (const { id, skillDirectory } of modules) {
    await copyTree(join(skillDirectory, "skill"), join(projectRoot, "skills", id));
    const workflowsDirectory = join(skillDirectory, "workflows");
    if (await exists(workflowsDirectory)) {
      await copyTree(workflowsDirectory, join(projectRoot, "n8n", "workflows"));
    }
  }

  // The four shared files are written once, after the cumulative edits pass.
  await writeJson(agentWorkflowPath, workflow);
  await writeJson(policyPath, policy);
  if (folderManifest !== null) {
    await writeJson(folderManifestPath, folderManifest);
  }
  await enableSkills(uniqueIds);

  return modules.map(({ manifest }) => manifest);
}

async function ensureOptionalModule(id, source = DEFAULT_SOURCE) {
  if (await exists(join(optionalSkillsDirectory, id))) return;
  await fetchFolder({
    ...source,
    id,
    kind: "module",
    path: `optional-skills/${id}`,
  });
}

async function installPackage(
  id,
  { includeExtensions = false, source = DEFAULT_SOURCE } = {},
) {
  const packs = await listSkillPacks();
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const requestedPack = byId.get(id);
  if (!requestedPack) {
    throw new Error(`There is no skill package called "${id}".`);
  }
  if (!requestedPack.installable) {
    throw new Error(
      `"${requestedPack.name}" is part of the base project and is not installed separately.`,
    );
  }

  const packagePlan = [];
  const resolved = new Set();
  function resolvePackage(packageId) {
    if (resolved.has(packageId)) return;
    const pack = byId.get(packageId);
    if (!pack) {
      throw new Error(`The package dependency "${packageId}" is not available.`);
    }
    for (const requirement of pack.requires) resolvePackage(requirement);
    resolved.add(packageId);
    packagePlan.push(pack);
  }
  resolvePackage(id);

  const selectedModules = packagePlan.flatMap((pack) =>
    pack.modules.filter(
      (module) => includeExtensions || module.role === "core",
    ),
  );
  for (const module of selectedModules) {
    if (module.source === "base") {
      if (!(await exists(join(projectRoot, "skills", module.id)))) {
        throw new Error(
          `The package plan expects the base module "${module.id}", but it is missing.`,
        );
      }
    } else {
      await ensureOptionalModule(module.id, source);
    }
  }

  const optionalIds = [...new Set(
    selectedModules
      .filter((module) => module.source === "optional")
      .map((module) => module.id),
  )];
  const manifests = await addSkills(optionalIds);
  for (const pack of packagePlan) {
    note(done, `Installed the "${pack.name}" package`);
  }
  return manifests;
}

async function addModule(id) {
  const [manifest] = await addSkills([id]);
  return [manifest];
}

async function printCatalogue() {
  const packs = await listSkillPacks();
  const enabled = enabledIdsFromSource(await readFile(enabledPath, "utf8"));
  process.stdout.write("Skill packages shown in the agent card:\n");
  for (const pack of packs) {
    const core = moduleIdsForPackage(pack);
    const installed = (
      await Promise.all(
        core.map(async (id) =>
          enabled.has(id) && (await exists(join(projectRoot, "skills", id))),
        ),
      )
    ).every(Boolean);
    const status = !pack.installable
      ? " (included in base)"
      : installed
        ? " (installed)"
        : "";
    process.stdout.write(`  ${pack.id.padEnd(31)} ${pack.name}${status}\n`);
  }

  const packagedModules = new Set(
    packs.flatMap((pack) => pack.modules.map((module) => module.id)),
  );
  const ids = await listSkillIds();
  process.stdout.write("\nUnderlying modules and add-ons:\n");
  for (const id of ids) {
    const manifest = await readJson(join(optionalSkillsDirectory, id, "manifest.json"));
    const installed = enabled.has(id) && (await exists(join(projectRoot, "skills", id)))
      ? " (installed)"
      : "";
    const relationship = packagedModules.has(id) ? " [package module]" : " [add-on]";
    process.stdout.write(
      `  ${id.padEnd(31)} ${manifest.name}${relationship}${installed}\n`,
    );
  }
  process.stdout.write(
    "\nAdd a package (core modules only):\n" +
      "  npm run add-skill -- <package-id>\n" +
      "Add its optional extensions too:\n" +
      "  npm run add-skill -- <package-id> --with-extensions\n\n" +
      "Legacy module IDs and GitHub folder links still work for surgical installs.\n",
  );
}

const args = process.argv.slice(2);
const includeExtensions = args.includes("--with-extensions");
const requested = args.find((argument) => argument !== "--with-extensions");

if (!requested || requested === "--list") {
  await printCatalogue();
  process.exit(0);
}

let manifests = [];
let installedName = requested;
try {
  let id = requested;
  let source = DEFAULT_SOURCE;
  let requestedKind = null;
  if (requested.startsWith("http")) {
    const request = parseGithubFolderUrl(requested);
    await fetchFolder(request);
    id = request.id;
    requestedKind = request.kind;
    source = { owner: request.owner, repo: request.repo, ref: request.ref };
  }

  const packs = await listSkillPacks();
  const pack = packs.find((entry) => entry.id === id);
  if (requestedKind === "package" || (!requestedKind && pack)) {
    manifests = await installPackage(id, { includeExtensions, source });
    installedName = pack?.name ?? id;
  } else {
    if (requestedKind !== "module") {
      await ensureOptionalModule(id, source);
    }
    manifests = await addModule(id);
    installedName = manifests[0].name;
  }
} catch (error) {
  // A learner should see the problem, not a stack trace.
  process.stderr.write(`\nCould not add "${requested}".\n\n${error.message}\n\n`);
  process.stderr.write(
    "Some earlier steps may already be in place. Fix the problem and run the same command again; installation is idempotent.\n",
  );
  process.exit(1);
}

process.stdout.write(`\n${installedName} is installed.\n\n`);
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
for (const manifest of manifests) {
  if (manifest.setup) process.stdout.write(`\n${manifest.setup}\n`);
}
