// Repository-managed agent entry points must be published after import. In
// particular, a webhook workflow that remains unpublished looks healthy in the
// editor but every production request to it returns 404.
//
// User-configurable triggers remain opt-in, so this test also pins the boundary
// between a shipped webhook endpoint and a schedule or provider trigger.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RETIRED_WORKFLOW_IDS,
  learnerPublishedIds,
  requiredWorkflowIds,
  retiredPublishedIds,
  retireLegacyWorkflows,
} from "../scripts/cloud-workflows.mjs";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const dir = mkdtempSync(join(tmpdir(), "cloud-required-workflows-test-"));
const workflowsDir = join(dir, "workflows");
mkdirSync(workflowsDir, { recursive: true });

const workflow = (name, id) => {
  writeFileSync(join(workflowsDir, name), JSON.stringify({ id, nodes: [] }));
};

workflow("50-tool-example.json", "wfTool");
workflow("18-setup-example.json", "wfSetup");
workflow("115-webhook-xero-capture-control.json", "wfWebhook115");
workflow("116-webhook-xero-export-companion.json", "wfWebhook116");
workflow("117-webhook-import-xero-uncoded-csv.json", "wfWebhook117");
workflow("70-trigger-telegram-message.json", "wfTrigger");
workflow("72-trigger-funding-beat.json", "wfSchedule");
workflow("00-run-main.json", "phase3StartHere");

const ids = requiredWorkflowIds(workflowsDir);

for (const id of [
  "wfTool",
  "wfSetup",
  "wfWebhook115",
  "wfWebhook116",
  "wfWebhook117",
]) {
  check(ids.includes(id), `${id} is required and will be published`);
}
check(!ids.includes("wfTrigger"), "a provider trigger remains learner-controlled");
check(!ids.includes("wfSchedule"), "a schedule trigger remains learner-controlled");
check(!ids.includes("phase3StartHere"), "the main workflow remains credential-gated elsewhere");

const databasePath = join(dir, "database.sqlite");
const db = new DatabaseSync(databasePath);
db.exec("CREATE TABLE workflow_entity (id TEXT PRIMARY KEY, active INTEGER NOT NULL, activeVersionId TEXT)");
db.prepare("INSERT INTO workflow_entity VALUES (?, 1, ?)").run("wfLearnerTrigger", "version-new");
for (const id of RETIRED_WORKFLOW_IDS) {
  db.prepare("INSERT INTO workflow_entity VALUES (?, 1, ?)").run(id, `version-${id}`);
}
db.close();

const preserved = learnerPublishedIds(databasePath);
check(
  preserved.length === 1 && preserved[0] === "wfLearnerTrigger",
  "retired workflow IDs are never preserved as learner-published workflows",
);
check(
  retiredPublishedIds(databasePath).length === RETIRED_WORKFLOW_IDS.length,
  "every still-published retired Xero workflow is discovered",
);
const unpublishCalls = [];
retireLegacyWorkflows({
  databasePath,
  n8nBin: "/fake/n8n",
  n8nEnv: {},
  runCommand: (binary, args) => {
    unpublishCalls.push([binary, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  },
});
check(
  unpublishCalls.length === RETIRED_WORKFLOW_IDS.length &&
    unpublishCalls.every((call) => call[1] === "unpublish:workflow"),
  "cloud sync explicitly unpublishes every retired Xero browser-capture workflow",
);

rmSync(dir, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Required cloud workflows include repository-managed webhooks. Checks passed.");
