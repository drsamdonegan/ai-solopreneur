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

import { mkdir, writeFile, rm, access } from "node:fs/promises";
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

process.stdout.write(`\nBase agent written to ${destination}\n\n`);
process.stdout.write(`  from commit   ${head}\n`);
process.stdout.write(`  files         ${included.length} (${skipped} left out)\n`);
process.stdout.write(`  skills        ${BASE_SKILLS.join(", ")}\n`);
process.stdout.write(`  workflows     ${BASE_WORKFLOWS.length}\n`);

process.stdout.write(
  "\nNothing optional is installed. A learner who runs setup here gets the\n" +
    "project manager and its task tools, and adds skills from GitHub as needed.\n",
);
