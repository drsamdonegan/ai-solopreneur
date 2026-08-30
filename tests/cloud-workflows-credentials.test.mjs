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
const headerCredentialOn = (nodes, name) =>
  nodes.find((node) => node.name === name)?.credentials?.httpHeaderAuth;

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

// The authenticated Xero capture webhooks use two credentials of the same
// type. Their IDs are repository-owned and stable, so both an empty import and
// a stale/wrong binding must heal deterministically in the editor and in the
// published workflow version.
{
  const db = freshDb();
  for (const [id, name] of [
    ["phase20XeroCaptureControl", "Xero Capture Control"],
    ["phase20XeroCaptureBridge", "Xero Capture Bridge"],
    ["wrong-header", "Unrelated Header"],
  ]) {
    db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(
      id,
      name,
      "httpHeaderAuth",
    );
  }
  db.prepare("INSERT INTO credentials_entity VALUES (?, ?, ?)").run(
    "connected-xero-readonly",
    "Xero (read-only)",
    "oAuth2Api",
  );
  const sourceNodes = [
    {
      name: "Probe Xero",
      type: "n8n-nodes-base.httpRequest",
      credentials: {
        oAuth2Api: {
          id: "connected-xero-readonly",
          name: "Xero (read-only)",
        },
      },
    },
  ];
  db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
    "phase19CheckXeroConnection",
    JSON.stringify(sourceNodes),
    "check-live",
    "check-live",
  );
  db.prepare("INSERT INTO workflow_history VALUES (?, ?, ?)").run(
    "check-live",
    "phase19CheckXeroConnection",
    JSON.stringify(sourceNodes),
  );
  const entityNodes = [
    {
      name: "Authenticated Claim",
      type: "n8n-nodes-base.webhook",
      credentials: {
        httpHeaderAuth: { id: "wrong-header", name: "Unrelated Header" },
      },
    },
    {
      name: "Authenticated Progress",
      type: "n8n-nodes-base.webhook",
    },
    {
      name: "Read Claim Organisation Details",
      type: "n8n-nodes-base.httpRequest",
    },
  ];
  db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
    "phase20XeroExportCompanion",
    JSON.stringify(entityNodes),
    "xero-live",
    "xero-live",
  );
  db.prepare("INSERT INTO workflow_history VALUES (?, ?, ?)").run(
    "xero-live",
    "phase20XeroExportCompanion",
    JSON.stringify(entityNodes),
  );
  db.close();

  const fixed = restoreCredentials(
    databasePath,
    savedCredentials(databasePath),
    credentialsByType(databasePath),
  );
  const after = new DatabaseSync(databasePath, { readOnly: true });
  const entity = nodesOf(
    after,
    "workflow_entity",
    "id",
    "phase20XeroExportCompanion",
  );
  const live = nodesOf(after, "workflow_history", "versionId", "xero-live");
  after.close();

  check(fixed === 3, `fixed capture bindings count each node once (got ${fixed})`);
  for (const nodes of [entity, live]) {
    check(
      headerCredentialOn(nodes, "Authenticated Claim")?.id
        === "phase20XeroCaptureBridge",
      "a stale capture-claim binding heals to the shipped bridge credential",
    );
    check(
      headerCredentialOn(nodes, "Authenticated Progress")?.id
        === "phase20XeroCaptureBridge",
      "an empty capture-progress binding heals despite same-type ambiguity",
    );
    check(
      nodes.find((node) => node.name === "Read Claim Organisation Details")
        ?.credentials?.oAuth2Api?.id === "connected-xero-readonly",
      "the capture organisation probe inherits the already-connected Xero read-only credential",
    );
  }
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
