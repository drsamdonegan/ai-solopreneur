// A trigger the learner connected to an outside account has to survive a
// deploy. Triggers are deliberately not in MUST_BE_LIVE — a funding or monthly
// trigger with no saved profile should not start itself — so the rule is
// narrower: a trigger qualifies only when it carries a credential-bearing node
// and every one of those nodes is bound.
//
// This test pins both halves. Losing the first half gives a Telegram bot that
// silently answers nobody after every push; losing the second half starts
// schedules the learner never asked for.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connectedTriggerIds } from "../scripts/cloud-workflows.mjs";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const dir = mkdtempSync(join(tmpdir(), "cloud-triggers-test-"));
const workflowsDir = join(dir, "workflows");
const databasePath = join(dir, "database.sqlite");
mkdirSync(workflowsDir, { recursive: true });

const telegramNodes = (credentials) => [
  { name: "Telegram Message", type: "n8n-nodes-base.telegramTrigger", ...(credentials ? { credentials } : {}) },
  { name: "Send The Reply", type: "n8n-nodes-base.telegram", ...(credentials ? { credentials } : {}) },
];
// A schedule trigger needs no account, so nothing about it can count as consent.
const scheduleNodes = [{ name: "Every Morning", type: "n8n-nodes-base.scheduleTrigger" }];

writeFileSync(
  join(workflowsDir, "70-trigger-telegram-message.json"),
  JSON.stringify({ id: "wfTelegram", nodes: telegramNodes() }),
);
writeFileSync(
  join(workflowsDir, "72-trigger-funding-beat.json"),
  JSON.stringify({ id: "wfFunding", nodes: scheduleNodes }),
);
// A tool workflow is not a trigger and must never be picked up by this rule.
writeFileSync(
  join(workflowsDir, "50-tool-start-domain-research.json"),
  JSON.stringify({ id: "wfTool", nodes: telegramNodes({ telegramApi: { id: "c1", name: "Telegram account" } }) }),
);

const seed = (rows) => {
  rmSync(databasePath, { force: true });
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE workflow_entity (id TEXT PRIMARY KEY, nodes TEXT NOT NULL)");
  for (const [id, nodes] of rows) {
    db.prepare("INSERT INTO workflow_entity VALUES (?, ?)").run(id, JSON.stringify(nodes));
  }
  db.close();
};

const bound = { telegramApi: { id: "c1", name: "Telegram account" } };

// Fully bound Telegram trigger: this is the one that must come back on.
seed([
  ["wfTelegram", telegramNodes(bound)],
  ["wfFunding", scheduleNodes],
  ["wfTool", telegramNodes(bound)],
]);
{
  const ids = connectedTriggerIds(workflowsDir, databasePath);
  check(ids.includes("wfTelegram"), "a fully bound Telegram trigger counts as connected");
  check(!ids.includes("wfFunding"), "a credential-free trigger never counts as connected");
  check(!ids.includes("wfTool"), "a tool workflow is not treated as a trigger");
}

// Credential missing entirely: the learner has not connected anything yet.
seed([["wfTelegram", telegramNodes()], ["wfFunding", scheduleNodes], ["wfTool", telegramNodes(bound)]]);
check(
  connectedTriggerIds(workflowsDir, databasePath).length === 0,
  "an unbound Telegram trigger stays off",
);

// Half-bound: the reply node would fail at run time, so this is not ready.
seed([
  ["wfTelegram", [
    { name: "Telegram Message", type: "n8n-nodes-base.telegramTrigger", credentials: bound },
    { name: "Send The Reply", type: "n8n-nodes-base.telegram" },
  ]],
]);
check(
  !connectedTriggerIds(workflowsDir, databasePath).includes("wfTelegram"),
  "a partly bound trigger stays off rather than half-working",
);

// A workflow present in the repo but not yet in the database must not throw.
seed([]);
check(connectedTriggerIds(workflowsDir, databasePath).length === 0, "a missing workflow row is not connected");
check(connectedTriggerIds(workflowsDir, join(dir, "nope.sqlite")).length === 0, "a missing database is handled");

rmSync(dir, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Connected triggers come back on, credential-free triggers stay off. Checks passed.");
