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
 * Filename prefixes for the workflows that must be live for the agent to work:
 * the tools it calls, the sub-workflows those call, the confirmation step, and
 * the run-once setup workflows.
 *
 * Read from the files rather than kept as a list of IDs, because a list kept by
 * hand is wrong the moment a learner installs a skill that adds one — and the
 * way it is wrong is silent. An unpublished tool is not an error, it is an
 * agent that quietly cannot do the thing it was just given.
 *
 * Triggers are deliberately absent. A Slack trigger with no token, or a funding
 * scan with no business profile, should not start itself. The learner switches
 * those on, and learnerPublishedIds below is what makes that survive a deploy.
 */
const MUST_BE_LIVE = /^\d+-(tool|setup|internal|confirm|run)-/;

/** The conversation entry point. Useless without an Anthropic credential. */
const MAIN_WORKFLOW = "phase3StartHere";

export function readWorkflowFiles(workflowsDir) {
  const files = [];
  for (const name of readdirSync(workflowsDir).sort()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      files.push({ name, workflow: JSON.parse(readFileSync(join(workflowsDir, name), "utf8")) });
    } catch {
      // A malformed workflow is the validator's job to catch. Skipping it here
      // keeps one bad file from taking down a learner's whole deploy.
    }
  }
  return files;
}

/** IDs of every workflow that has to be published for the agent to function. */
export function requiredWorkflowIds(workflowsDir) {
  return readWorkflowFiles(workflowsDir)
    .filter(({ name }) => MUST_BE_LIVE.test(name))
    .map(({ workflow }) => workflow.id)
    .filter((id) => typeof id === "string" && id.length > 0 && id !== MAIN_WORKFLOW);
}

/**
 * The workflows the learner switched on themselves.
 *
 * n8n's import deactivates everything it touches — `import:workflow` defaults
 * to `activeState: false`, and the `fromJson` alternative only works in queue
 * mode. So without remembering this first, installing any skill would silently
 * switch off the Slack trigger they set up by hand, and they would find out
 * when a message got no reply.
 *
 * The main workflow is excluded because the credential check below owns it.
 */
export function learnerPublishedIds(databasePath) {
  if (!existsSync(databasePath)) {
    return [];
  }
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return db
        .prepare("SELECT id FROM workflow_entity WHERE active = 1")
        .all()
        .map((row) => String(row.id))
        .filter((id) => id !== MAIN_WORKFLOW);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Webhook paths on run-once setup workflows, in filename order.
 *
 * A setup workflow announces itself with a webhook, the way
 * 10-setup-local-task-data already does, so a skill a learner installs builds
 * its own tables on the next deploy instead of waiting for them to find it.
 */
export function setupWebhookPaths(workflowsDir) {
  const found = [];
  for (const { name, workflow } of readWorkflowFiles(workflowsDir)) {
    if (!/^\d+-setup-/.test(name)) {
      continue;
    }
    for (const node of workflow.nodes ?? []) {
      if (node?.type === "n8n-nodes-base.webhook" && typeof node.parameters?.path === "string") {
        found.push(node.parameters.path);
      }
    }
  }
  return found;
}

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

  // Read before the import, because the import is what clears it.
  const learnerPublished = learnerPublishedIds(databasePath);

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
  // silent failure: a trigger that never fires and reports nothing. So publish
  // everything the agent needs, plus everything the learner had switched on.
  const toPublish = new Set([
    ...requiredWorkflowIds(paths.workflowsDir),
    ...learnerPublished,
  ]);

  let published = 0;
  const failures = [];
  for (const id of toPublish) {
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
 * Runs the setup workflows, which need n8n listening. Builds the local data
 * tables, pushes the learner's enabled skills into the agent, and then builds
 * the tables belonging to whichever skills they have installed.
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

  // Then any skill the learner installed. These are optional by definition, so
  // one that fails is a note rather than a failed boot: the agent still answers,
  // and only that one skill is missing its tables.
  const extras = setupWebhookPaths(paths.workflowsDir).filter(
    (path) => path !== "setup-task-data" && path !== "sync-enabled-skills",
  );
  let extrasReady = 0;
  for (const path of extras) {
    const result = await post(path, "{}");
    if (result === null || !result.includes('"ok":true')) {
      log(`  Note: one skill's setup (${path}) did not finish, so that skill may be missing its tables.`);
      continue;
    }
    extrasReady += 1;
  }

  log(
    extras.length === 0
      ? "  Task tables ready and your skills are synced in."
      : `  Task tables ready, your skills are synced in, and ${extrasReady} of ${extras.length} skill setups ran.`,
  );
  return true;
}
