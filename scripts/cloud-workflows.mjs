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
import { writeSkillSyncState } from "./skill-sync-state.mjs";

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
 * Triggers are deliberately absent. A funding or monthly trigger with no saved
 * profile should not start itself. The learner switches
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
 * switch off a schedule the learner set up by hand.
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
      // n8n 2 publishes a version rather than flipping `active`: its own CLI
      // answers "Please use: publish:workflow" if you try the old way. A
      // workflow published from the editor therefore has activeVersionId set
      // and, at least in some paths, active still 0 — so reading only `active`
      // misses exactly the triggers a learner switched on by hand, and the
      // deploy quietly leaves them off. Both are read, and older builds without
      // the column fall back to `active` alone.
      const hasVersionColumn = db
        .prepare("SELECT count(*) n FROM pragma_table_info('workflow_entity') WHERE name = 'activeVersionId'")
        .get().n > 0;
      const where = hasVersionColumn
        ? "active = 1 OR activeVersionId IS NOT NULL"
        : "active = 1";
      return db
        .prepare(`SELECT id FROM workflow_entity WHERE ${where}`)
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

/**
 * The credential each node was using, keyed by workflow and node name.
 *
 * The import replaces every workflow with the repository's copy, and the
 * repository cannot know the id of a credential the learner made on their own
 * machine — so those fields are empty in the file and the import empties them
 * here too. The learner is then told, by a trigger that will not publish, that
 * two nodes are missing a credential they are certain they set. They set it
 * again, push anything at all, and it happens again.
 */
export function savedCredentials(databasePath) {
  const saved = new Map();
  if (!existsSync(databasePath)) {
    return saved;
  }
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const row of db.prepare("SELECT id, nodes FROM workflow_entity").all()) {
        let nodes;
        try {
          nodes = JSON.parse(row.nodes);
        } catch {
          continue;
        }
        for (const node of Array.isArray(nodes) ? nodes : []) {
          if (node?.credentials && Object.keys(node.credentials).length > 0) {
            saved.set(`${row.id}::${node.name}`, node.credentials);
          }
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // A database that cannot be read is handled by the caller: nothing is
    // restored, which is exactly today's behaviour.
  }
  return saved;
}

/** Every credential the agent holds, grouped by type. */
export function credentialsByType(databasePath) {
  const byType = new Map();
  if (!existsSync(databasePath)) {
    return byType;
  }
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const row of db.prepare("SELECT id, name, type FROM credentials_entity").all()) {
        const list = byType.get(row.type) ?? [];
        list.push({ id: row.id, name: row.name });
        byType.set(row.type, list);
      }
    } finally {
      db.close();
    }
  } catch {
    // As above.
  }
  return byType;
}

/**
 * The credential type a node needs, for the nodes this project ships.
 *
 * Kept short and explicit rather than read from n8n's node registry: loading
 * that here to answer one question would tie this script to n8n's internals for
 * no gain, and a wrong guess would bind the wrong credential silently.
 */
const CREDENTIAL_TYPE_FOR_NODE = new Map([
  ["n8n-nodes-base.telegram", "telegramApi"],
  ["n8n-nodes-base.telegramTrigger", "telegramApi"],
]);

/**
 * Puts one workflow's credential choices back into one stored copy of its
 * nodes. Returns the "workflowId::nodeName" keys it filled, so that a fix
 * applied to several stored copies of the same workflow counts as one fix.
 */
function fillNodeCredentials(workflowId, nodes, saved, byType) {
  const filled = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.credentials && Object.keys(node.credentials).length > 0) {
      continue;
    }
    const key = `${workflowId}::${node?.name}`;
    const remembered = saved.get(key);
    if (remembered) {
      node.credentials = remembered;
      filled.push(key);
      continue;
    }
    const type = CREDENTIAL_TYPE_FOR_NODE.get(node?.type);
    const candidates = type ? (byType.get(type) ?? []) : [];
    if (candidates.length === 1) {
      node.credentials = { [type]: { ...candidates[0] } };
      filled.push(key);
    }
  }
  return filled;
}

/**
 * Puts credential choices back after an import, and makes the obvious one where
 * there is no choice to make.
 *
 * Restoring covers the learner who already chose. The single-candidate rule
 * covers the first time: if the agent holds exactly one Telegram credential,
 * there is nothing for anyone to decide, and asking them to pick it in three
 * separate places is a puzzle rather than a safeguard. Where there is more than
 * one, nothing is guessed.
 *
 * n8n keeps a workflow's nodes in two places: workflow_entity, which is what
 * the editor shows, and a workflow_history row per version, which is what
 * Publish validates and what a published workflow actually runs. An import
 * rewrites both, so both are repaired here. Repairing only the first is how a
 * learner ends up staring at a credential that is visibly set while Publish
 * insists it is missing.
 */
export function restoreCredentials(databasePath, saved, byType) {
  if (!existsSync(databasePath)) {
    return 0;
  }
  const fixed = new Set();
  try {
    const db = new DatabaseSync(databasePath);
    try {
      const hasColumn = (name) =>
        db
          .prepare("SELECT count(*) n FROM pragma_table_info('workflow_entity') WHERE name = ?")
          .get(name).n > 0;
      const hasHistoryTable =
        db
          .prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name = 'workflow_history'")
          .get().n > 0;
      const hasVersionId = hasColumn("versionId");
      const hasActiveVersionId = hasColumn("activeVersionId");
      const columns = ["id", "nodes"];
      if (hasVersionId) {
        columns.push("versionId");
      }
      if (hasActiveVersionId) {
        columns.push("activeVersionId");
      }
      for (const row of db.prepare(`SELECT ${columns.join(", ")} FROM workflow_entity`).all()) {
        let nodes;
        try {
          nodes = JSON.parse(row.nodes);
        } catch {
          continue;
        }
        const filled = fillNodeCredentials(row.id, nodes, saved, byType);
        if (filled.length > 0) {
          db.prepare("UPDATE workflow_entity SET nodes = ? WHERE id = ?").run(
            JSON.stringify(nodes),
            row.id,
          );
          for (const key of filled) {
            fixed.add(key);
          }
        }
        if (!hasHistoryTable || !hasVersionId) {
          continue;
        }
        // The version the editor's Publish button will validate, and the
        // version currently published, when there is one. Usually the same
        // row; after an import, the one row the import just created.
        const versionIds = new Set(
          [row.versionId, hasActiveVersionId ? row.activeVersionId : null].filter(Boolean),
        );
        for (const versionId of versionIds) {
          const version = db
            .prepare("SELECT nodes FROM workflow_history WHERE workflowId = ? AND versionId = ?")
            .get(row.id, versionId);
          if (!version) {
            continue;
          }
          let versionNodes;
          try {
            versionNodes = JSON.parse(version.nodes);
          } catch {
            continue;
          }
          const filledVersion = fillNodeCredentials(row.id, versionNodes, saved, byType);
          if (filledVersion.length > 0) {
            db.prepare(
              "UPDATE workflow_history SET nodes = ? WHERE workflowId = ? AND versionId = ?",
            ).run(JSON.stringify(versionNodes), row.id, versionId);
            for (const key of filledVersion) {
              fixed.add(key);
            }
          }
        }
      }
    } finally {
      db.close();
    }
  } catch {
    return fixed.size;
  }
  return fixed.size;
}

/**
 * Trigger workflows the learner has wired to an outside account.
 *
 * Triggers are left alone by MUST_BE_LIVE on purpose: a funding or monthly
 * trigger with no saved profile should not start itself. But a trigger that
 * carries a credential is a different thing. Nobody creates a Telegram
 * credential and binds it to three nodes by accident, and the cost of getting
 * this wrong in the other direction is a bot that silently answers nobody —
 * which is exactly the failure this project keeps hitting, because it looks
 * identical to a bot that is working until someone messages it.
 *
 * Only triggers with a credential-bearing node qualify, so the credential-free
 * triggers stay off, and only when every one of those nodes is actually bound.
 */
export function connectedTriggerIds(workflowsDir, databasePath) {
  if (!existsSync(databasePath)) {
    return [];
  }
  const needsCredential = new Map();
  for (const { name, workflow } of readWorkflowFiles(workflowsDir)) {
    if (!/^\d+-trigger-/.test(name) || typeof workflow.id !== "string") {
      continue;
    }
    const nodeNames = (workflow.nodes ?? [])
      .filter((node) => CREDENTIAL_TYPE_FOR_NODE.has(node?.type))
      .map((node) => node?.name);
    if (nodeNames.length > 0) {
      needsCredential.set(workflow.id, nodeNames);
    }
  }
  if (needsCredential.size === 0) {
    return [];
  }
  const connected = [];
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const [id, nodeNames] of needsCredential) {
        const row = db.prepare("SELECT nodes FROM workflow_entity WHERE id = ?").get(id);
        if (!row) {
          continue;
        }
        let nodes;
        try {
          nodes = JSON.parse(row.nodes);
        } catch {
          continue;
        }
        const bound = (name) => {
          const node = (Array.isArray(nodes) ? nodes : []).find((entry) => entry?.name === name);
          return Boolean(node?.credentials && Object.keys(node.credentials).length > 0);
        };
        if (nodeNames.every(bound)) {
          connected.push(id);
        }
      }
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
  return connected;
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
    // Even with nothing to import, a credential may still be missing from a
    // node: an earlier deploy cleared it, or the learner has only just made
    // one. Both leave a trigger that cannot publish and says so in a way that
    // sounds like they did something wrong. It is a read and a conditional
    // write, so it is cheap enough to do on every boot rather than only on the
    // deploys that happen to carry a workflow change.
    const filled = restoreCredentials(
      databasePath,
      savedCredentials(databasePath),
      credentialsByType(databasePath),
    );
    if (filled > 0) {
      log(`  ${filled} credential ${filled === 1 ? "choice" : "choices"} restored.`);
    }
    // A connected trigger that is switched off has to be switched on here too,
    // not only on the deploys that carry a workflow change. Otherwise the
    // deploy that ships this repair is itself a deploy that imports nothing,
    // and the repair does not run until something unrelated changes.
    const live = new Set(learnerPublishedIds(databasePath));
    const toStart = connectedTriggerIds(paths.workflowsDir, databasePath).filter(
      (id) => !live.has(id),
    );
    let started = 0;
    for (const id of toStart) {
      const result = runCli(paths.n8nBin, ["publish:workflow", `--id=${id}`], n8nEnv);
      if (!result.error && result.status === 0) {
        started += 1;
      }
    }
    if (started > 0) {
      log(`  ${started} connected ${started === 1 ? "trigger is" : "triggers are"} switched back on.`);
    }
    return { skipped: true, reason: "workflows unchanged since last deploy" };
  }

  log(
    workflowsChanged
      ? `  Workflows changed in this deploy. Updating ${fileCount} of them...`
      : "  Your Anthropic credential is here. Turning your agent on...",
  );

  // Read before the import, because the import is what clears it.
  const learnerPublished = learnerPublishedIds(databasePath);
  const chosenCredentials = savedCredentials(databasePath);
  const heldCredentials = credentialsByType(databasePath);

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

  // Before publishing anything: an import empties every credential field, so a
  // trigger the learner had wired up would be published in a state that cannot
  // run. Putting the choices back first means publish sees the same workflow
  // they left.
  const restored = restoreCredentials(
    databasePath,
    chosenCredentials,
    heldCredentials,
  );
  if (restored > 0) {
    log(`  ${restored} credential ${restored === 1 ? "choice" : "choices"} kept.`);
  }

  // Imports always land unpublished. In the cloud an unpublished workflow is a
  // silent failure: a trigger that never fires and reports nothing. So publish
  // everything the agent needs, plus everything the learner had switched on.
  const toPublish = new Set([
    ...requiredWorkflowIds(paths.workflowsDir),
    ...learnerPublished,
    // Read after the restore above, so a credential that was just put back --
    // or bound for the first time -- counts as connected.
    ...connectedTriggerIds(paths.workflowsDir, databasePath),
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
  const bundle = await compileSkills(paths.skillsDir, {
    profileDirectory: paths.profileDataDir,
  });
  const skills = await post("sync-enabled-skills", JSON.stringify(bundle));
  if (skills === null || !skills.includes('"ok":true')) {
    log("  Note: your skills did not finish syncing into the agent.");
    return false;
  }
  await writeSkillSyncState(paths.profileDataDir, bundle.sourceHash);

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
