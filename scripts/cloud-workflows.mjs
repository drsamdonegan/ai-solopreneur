/**
 * Keeps the cloud agent's workflows in step with the repository.
 *
 * This is what makes "push to main and it goes live" true for the parts of the
 * agent that are not code: the reviewed workflows in n8n/workflows are the
 * source of truth, and a deploy that changes them changes the running agent.
 *
 * It deliberately does *not* run on every boot. A learner who edits a workflow
 * in the n8n editor would otherwise silently lose that edit the next time
 * anything else triggered a redeploy. Instead the repository's workflows are
 * fingerprinted, and an import happens only when that fingerprint changes —
 * which is exactly when they pushed a change.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CLI_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Workflows that must be live for the agent to answer at all: the tools it
 * calls and the two setup workflows that build its data tables and sync its
 * skills. Mirrors workflowIds in scripts/local.mjs.
 */
const SETUP_WORKFLOWS = ["phase4TaskSetup", "phase5SyncEnabledSkills"];

const TOOL_WORKFLOWS = [
  "phase4ListTasks",
  "phase4CreateTask",
  "phase4UpdateTaskStatus",
  "phase5ProposeCreateTask",
  "phase5ProposeTaskStatus",
  "phase5ConfirmTaskWrite",
  "phase9StartDomainResearch",
  "phase9CompleteDomainResearch",
  "phase9GetBusinessMemory",
  "phase11StartPaidDomainResearch",
  "phase11CompletePaidDomainResearch",
  "phase11GetPaidDomainResearch",
  "phase13StartSeoArticle",
  "phase13WriteSeoArticle",
  "phase13GetSeoArticle",
  "phase12LookupLinkedInProfile",
];

/** The conversation entry point. Useless without an Anthropic credential. */
const MAIN_WORKFLOW = "phase3StartHere";

function fingerprintWorkflows(workflowsDir) {
  const hash = createHash("sha256");
  const files = readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of files) {
    hash.update(name);
    hash.update(readFileSync(join(workflowsDir, name)));
  }
  return { fingerprint: hash.digest("hex"), fileCount: files.length };
}

function readSyncState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

/**
 * True when the agent has an Anthropic credential. Without one the main
 * workflow would be published and then fail on every message, which reads to a
 * learner as a broken agent rather than a missing credential.
 */
function hasAnthropicCredential(databasePath) {
  if (!existsSync(databasePath)) {
    return false;
  }
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT count(*) n FROM credentials_entity WHERE type = ?")
        .get("anthropicApi");
      return (row?.n ?? 0) > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function runCli(n8nBin, args, env) {
  return spawnSync(process.execPath, [n8nBin, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1_024 * 1_024,
    timeout: CLI_TIMEOUT_MS,
  });
}

function lastLines(result, count = 6) {
  return `${result.stderr || ""}${result.stdout || ""}`
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .join("\n");
}

/**
 * Imports and publishes the reviewed workflows.
 *
 * Runs against the database directly, before n8n starts, so nothing has to be
 * restarted for the changes to take effect.
 *
 * @returns {{skipped: boolean, imported?: number, published?: number,
 *            mainPublished?: boolean, reason?: string}}
 */
export function syncWorkflows({ paths, n8nEnv, log }) {
  if (!existsSync(paths.workflowsDir)) {
    return { skipped: true, reason: "no workflows in this build" };
  }

  const { fingerprint, fileCount } = fingerprintWorkflows(paths.workflowsDir);
  const stateFile = join(paths.configDir, "workflow-sync.json");
  const state = readSyncState(stateFile);
  const databasePath = join(paths.n8nUserFolder, ".n8n", "database.sqlite");
  const credentialPresent = hasAnthropicCredential(databasePath);

  // Re-run when the workflows changed, and also when a credential has appeared
  // since last time, because that is the moment the main workflow can go live.
  const workflowsChanged = state.fingerprint !== fingerprint;
  const credentialAppeared =
    credentialPresent && state.mainPublished !== true;

  if (!workflowsChanged && !credentialAppeared) {
    return { skipped: true, reason: "workflows unchanged since last deploy" };
  }

  log(
    workflowsChanged
      ? `  Workflows changed in this deploy. Updating ${fileCount} of them...`
      : "  Your Anthropic credential is here. Turning your agent on...",
  );

  const importResult = runCli(
    paths.n8nBin,
    ["import:workflow", "--separate", `--input=${paths.workflowsDir}`],
    n8nEnv,
  );
  if (importResult.error || importResult.status !== 0) {
    throw new Error(
      `The reviewed workflows could not be updated.\n${lastLines(importResult)}`,
    );
  }

  // Imports always land unpublished. In the cloud an unpublished workflow is a
  // silent failure: a trigger that never fires and reports nothing.
  let published = 0;
  const failures = [];
  for (const id of [...SETUP_WORKFLOWS, ...TOOL_WORKFLOWS]) {
    const result = runCli(paths.n8nBin, ["publish:workflow", `--id=${id}`], n8nEnv);
    if (result.error || result.status !== 0) {
      failures.push(id);
      continue;
    }
    published += 1;
  }

  let mainPublished = false;
  if (credentialPresent) {
    const result = runCli(
      paths.n8nBin,
      ["publish:workflow", `--id=${MAIN_WORKFLOW}`],
      n8nEnv,
    );
    mainPublished = !result.error && result.status === 0;
  }

  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        fingerprint,
        fileCount,
        published,
        mainPublished,
        syncedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  if (failures.length > 0) {
    log(
      `  Note: ${failures.length} workflows could not be turned on (${failures.slice(0, 3).join(", ")}${failures.length > 3 ? ", ..." : ""}).`,
    );
  }

  return { skipped: false, imported: fileCount, published, mainPublished };
}

/**
 * Runs the two setup workflows, which need n8n listening. Builds the local
 * data tables and pushes the learner's enabled skills into the agent.
 */
export async function primeAgent({ paths, n8nPort, log }) {
  const post = async (name, body) => {
    const url = `http://127.0.0.1:${n8nPort}/webhook/${name}`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        if (response.ok) {
          return await response.text();
        }
      } catch {
        // n8n registers webhooks a moment after it reports healthy.
      }
      await new Promise((done) => setTimeout(done, 1_000));
    }
    return null;
  };

  const tables = await post("setup-task-data", "{}");
  if (tables === null || !tables.includes('"ok":true')) {
    log("  Note: the agent's task tables did not finish setting up.");
    return false;
  }

  const { compileSkills } = await import("./compile-skills.mjs");
  const bundle = JSON.stringify(await compileSkills(paths.skillsDir));
  const skills = await post("sync-enabled-skills", bundle);
  if (skills === null || !skills.includes('"ok":true')) {
    log("  Note: your skills did not finish syncing into the agent.");
    return false;
  }

  log("  Task tables ready and your skills are synced in.");
  return true;
}
