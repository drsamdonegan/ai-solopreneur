import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileSkills } from "./compile-skills.mjs";
import { readSkillSyncState } from "./skill-sync-state.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDirectory = join(projectRoot, "skills");
const profileDirectory = join(projectRoot, "data", "profile");
const workflowsDirectory = join(projectRoot, "n8n", "workflows");
const optionalDirectory = join(projectRoot, "optional-skills");
const agentIds = [
  "project-manager",
  "sales",
  "marketing",
  "investment",
  "bookkeeping",
];

async function directories(path) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function installedSkillIds() {
  const ids = [];
  for (const id of await directories(skillsDirectory)) {
    try {
      await readFile(join(skillsDirectory, id, "skill.yaml"), "utf8");
      ids.push(id);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return ids;
}

async function enabledSkillIds() {
  return (await readFile(join(skillsDirectory, "enabled.txt"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function workflowReadiness() {
  const main = JSON.parse(
    await readFile(
      join(workflowsDirectory, "00-start-here-project-partner.json"),
      "utf8",
    ),
  );
  const sync = JSON.parse(
    await readFile(
      join(workflowsDirectory, "11-setup-sync-enabled-skills.json"),
      "utf8",
    ),
  );
  const mainCode = main.nodes?.find(
    (node) => node.name === "Build Agent Context",
  )?.parameters?.jsCode ?? "";
  const syncCode = sync.nodes?.find(
    (node) => node.name === "Validate Skill Bundle",
  )?.parameters?.jsCode ?? "";

  return {
    "00":
      mainCode.includes("bundle?.schemaVersion === 2") &&
      mainCode.includes("request.agentId") &&
      agentIds.every((id) => mainCode.includes(id)),
    "11":
      syncCode.includes("body.schemaVersion !== 2") &&
      agentIds.every((id) => syncCode.includes(id)),
  };
}

async function setupWorkflows(installedIds) {
  const results = [];
  for (const id of await directories(optionalDirectory)) {
    if (!installedIds.includes(id)) continue;
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(optionalDirectory, id, "manifest.json"), "utf8"),
      );
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const names = (manifest.folders ?? [])
      .flatMap((folder) => folder.workflows ?? [])
      .filter((name) => /^\d+-setup-[a-z0-9-]+\.json$/.test(name));
    for (const file of [...new Set(names)].sort()) {
      results.push({ skillId: id, file });
    }
  }
  return results;
}

function dirtyTrackedFiles() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    return ["Git status unavailable; make a manual backup before upgrading."];
  }
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3));
}

const version = (await readFile(join(projectRoot, "VERSION"), "utf8")).trim();
const installed = await installedSkillIds();
const enabled = await enabledSkillIds();
const workflows = await workflowReadiness();
const bundle = await compileSkills(skillsDirectory, { profileDirectory });
const syncState = await readSkillSyncState(profileDirectory);
const setup = await setupWorkflows(installed);
const dirty = dirtyTrackedFiles();
const syncMatches = syncState?.sourceHash === bundle.sourceHash;
const nextCommands = [];

if (dirty.length > 0) {
  nextCommands.push("npm run backup", "git status --short");
}
if (!workflows["00"] || !workflows["11"]) {
  nextCommands.push("npm run import-workflows");
}
if (!syncMatches || !workflows["00"] || !workflows["11"]) {
  nextCommands.push("npm run sync-skills");
}
nextCommands.push("npm run verify", "npm run diagnose");

const report = {
  version,
  dirtyTrackedFiles: dirty,
  installedSkillIds: installed,
  enabledSkillIds: enabled,
  workflowSchemaV2: workflows,
  skillSync: {
    currentSourceHash: bundle.sourceHash,
    lastSyncedSourceHash: syncState?.sourceHash ?? null,
    lastSyncedAt: syncState?.syncedAt ?? null,
    matches: syncMatches,
  },
  setupWorkflowsToConfirm: setup,
  nextCommands: [...new Set(nextCommands)],
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const mark = (ready) => (ready ? "ready" : "needs import");
  process.stdout.write(`Upgrade preflight for v${version}\n\n`);
  process.stdout.write(
    `Tracked source changes: ${dirty.length ? dirty.join(", ") : "none"}\n`,
  );
  process.stdout.write(`Installed skills: ${installed.join(", ") || "none"}\n`);
  process.stdout.write(`Enabled skills: ${enabled.join(", ") || "none"}\n`);
  process.stdout.write(
    `Workflow schemas: 00 ${mark(workflows["00"])}; 11 ${mark(workflows["11"])}\n`,
  );
  process.stdout.write(
    `Skill sync: ${syncMatches ? "current" : "required"} (${bundle.sourceHash.slice(0, 12)} current; ${syncState?.sourceHash?.slice(0, 12) ?? "never synced"} saved)\n`,
  );
  process.stdout.write(
    `Setup workflows to confirm: ${setup.length ? setup.map(({ skillId, file }) => `${file} (${skillId})`).join(", ") : "none"}\n`,
  );
  process.stdout.write("\nNext commands:\n");
  for (const command of report.nextCommands) process.stdout.write(`  ${command}\n`);
}
