// A deploy re-imports the reviewed workflows, and the import empties every
// credential field in BOTH places n8n stores a workflow's nodes: the
// workflow_entity row the editor shows, and the workflow_history row that
// Publish validates and a published workflow runs. Repairing only the first
// is a trap for learners: the editor shows the credential is set, and Publish
// still refuses with "Missing required credential".
//
// This test exists to keep the repair covering both copies.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  credentialsByType,
  restoreCredentials,
  savedCredentials,
} from "../scripts/cloud-workflows.mjs";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const dir = mkdtempSync(join(tmpdir(), "cloud-workflows-test-"));
const databasePath = join(dir, "database.sqlite");

const telegramNodes = (credentials) => [
  {
    name: "Telegram Message",
    type: "n8n-nodes-base.telegramTrigger",
    ...(credentials ? { credentials } : {}),
  },
  {
    name: "Send The Reply",
    type: "n8n-nodes-base.telegram",
    ...(credentials ? { credentials } : {}),
  },
];

const freshDb = () => {
  rmSync(databasePath, { force: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE workflow_entity (
      id TEXT PRIMARY KEY, nodes TEXT NOT NULL,
      versionId TEXT, activeVersionId TEXT
    );
    CREATE TABLE workflow_history (
      versionId TEXT PRIMARY KEY, workflowId TEXT NOT NULL, nodes TEXT NOT NULL
    );
    CREATE TABLE credentials_entity (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL
    );
  `);
  return db;
};

const nodesOf = (db, table, key, value) =>
  JSON.parse(
    db.prepare(`SELECT nodes FROM ${table} WHERE ${key} = ?`).get(value).nodes,
  );
const credentialOn = (nodes, name) =>
  nodes.find((node) => node.name === name)?.credentials?.telegramApi;

// After a fresh import both copies are empty. With exactly one Telegram
// credential on the agent, both copies come back filled without the learner
// choosing anything anywhere.
{
  const db = freshDb();
  db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(
    "cred1", "Telegram account", "telegramApi",
  );
  db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
    "wfTelegram", JSON.stringify(telegramNodes()), "v2", null,
  );
  db.prepare("INSERT INTO workflow_history VALUES (?, ?, ?)").run(
    "v2", "wfTelegram", JSON.stringify(telegramNodes()),
  );
  db.close();

  const fixed = restoreCredentials(
    databasePath,
    savedCredentials(databasePath),
    credentialsByType(databasePath),
  );
  const after = new DatabaseSync(databasePath, { readOnly: true });
  const entity = nodesOf(after, "workflow_entity", "id", "wfTelegram");
  const version = nodesOf(after, "workflow_history", "versionId", "v2");
  after.close();

  check(fixed === 2, `single-candidate fill counts each node once (got ${fixed})`);
  check(credentialOn(entity, "Telegram Message")?.id === "cred1", "editor copy gets the only credential");
  check(credentialOn(version, "Telegram Message")?.id === "cred1", "published-version copy gets it too");
  check(credentialOn(version, "Send The Reply")?.id === "cred1", "every telegram node in the version copy is filled");
}

// The half-repaired shape an earlier version of this script left behind:
// editor copy already filled, history row still empty. The history row heals
// from the editor copy's remembered choice — by id, not by guesswork.
{
  const db = freshDb();
  db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(
    "chosen", "Telegram account", "telegramApi",
  );
  db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(
    "other", "Second bot", "telegramApi",
  );
  db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
    "wfTelegram",
    JSON.stringify(telegramNodes({ telegramApi: { id: "chosen", name: "Telegram account" } })),
    "v3",
    "v3",
  );
  db.prepare("INSERT INTO workflow_history VALUES (?, ?, ?)").run(
    "v3", "wfTelegram", JSON.stringify(telegramNodes()),
  );
  db.close();

  const fixed = restoreCredentials(
    databasePath,
    savedCredentials(databasePath),
    credentialsByType(databasePath),
  );
  const after = new DatabaseSync(databasePath, { readOnly: true });
  const version = nodesOf(after, "workflow_history", "versionId", "v3");
  after.close();

  check(fixed === 2, `history-only heal still reports the fixes (got ${fixed})`);
  check(
    credentialOn(version, "Telegram Message")?.id === "chosen",
    "history row heals to the learner's chosen credential, not another of the same type",
  );
}

// A published version that is not the draft heals too, on its own nodes.
{
  const db = freshDb();
  db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(
    "cred1", "Telegram account", "telegramApi",
  );
  db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
    "wfTelegram", JSON.stringify(telegramNodes()), "draft", "live",
  );
  for (const versionId of ["draft", "live"]) {
    db.prepare("INSERT INTO workflow_history VALUES (?, ?, ?)").run(
      versionId, "wfTelegram", JSON.stringify(telegramNodes()),
    );
  }
  db.close();

  restoreCredentials(
    databasePath,
    savedCredentials(databasePath),
    credentialsByType(databasePath),
  );
  const after = new DatabaseSync(databasePath, { readOnly: true });
  const draft = nodesOf(after, "workflow_history", "versionId", "draft");
  const live = nodesOf(after, "workflow_history", "versionId", "live");
  after.close();

  check(credentialOn(draft, "Telegram Message")?.id === "cred1", "draft version heals");
  check(credentialOn(live, "Telegram Message")?.id === "cred1", "published version heals");
}

// Two credentials of the same type and no remembered choice: guessing would
// bind someone's bot to the wrong token, so nothing is filled.
{
  const db = freshDb();
  for (const [id, name] of [["a", "Bot one"], ["b", "Bot two"]]) {
    db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(id, name, "telegramApi");
  }
  db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
    "wfTelegram", JSON.stringify(telegramNodes()), "v1", null,
  );
  db.prepare("INSERT INTO workflow_history VALUES (?, ?, ?)").run(
    "v1", "wfTelegram", JSON.stringify(telegramNodes()),
  );
  db.close();

  const fixed = restoreCredentials(
    databasePath,
    savedCredentials(databasePath),
    credentialsByType(databasePath),
  );
  const after = new DatabaseSync(databasePath, { readOnly: true });
  const entity = nodesOf(after, "workflow_entity", "id", "wfTelegram");
  after.close();

  check(fixed === 0, "nothing is guessed between two credentials");
  check(credentialOn(entity, "Telegram Message") === undefined, "ambiguous nodes stay empty");
}

rmSync(dir, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Credential repair covers both stored copies. Checks passed.");
