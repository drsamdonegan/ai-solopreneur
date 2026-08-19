import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(projectRoot, "data", "profile", "skill-sync.json");

async function digest(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const before = await digest(statePath);
const result = spawnSync(process.execPath, ["scripts/upgrade-check.mjs", "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (result.status !== 0) throw new Error(result.stderr || "upgrade-check failed");
const report = JSON.parse(result.stdout);

if (!/^\d+\.\d+\.\d+$/.test(report.version)) throw new Error("bad version");
if (!Array.isArray(report.installedSkillIds) || !report.installedSkillIds.length) {
  throw new Error("installed skills were not reported");
}
if (report.workflowSchemaV2?.["00"] !== true || report.workflowSchemaV2?.["11"] !== true) {
  throw new Error("schema-v2 workflows were not recognised");
}
if (!/^[a-f0-9]{64}$/.test(report.skillSync?.currentSourceHash ?? "")) {
  throw new Error("current source hash was not reported");
}
if (!Array.isArray(report.nextCommands) || !report.nextCommands.includes("npm run verify")) {
  throw new Error("next commands were not reported");
}
if ((await digest(statePath)) !== before) throw new Error("upgrade-check wrote sync state");

console.log("Upgrade preflight is read-only and reports v2 workflow, skill, sync, setup, and next-command state.");
