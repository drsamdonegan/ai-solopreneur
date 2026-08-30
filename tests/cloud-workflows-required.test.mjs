// Repository-managed agent entry points must be published after import. In
// particular, a webhook workflow that remains unpublished looks healthy in the
// editor but every production request to it returns 404.
//
// User-configurable triggers remain opt-in, so this test also pins the boundary
// between a shipped webhook endpoint and a schedule or provider trigger.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RETIRED_WORKFLOW_IDS,
  ensureXeroCaptureCredentials,
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

check(
  ensureXeroCaptureCredentials({ enabled: false }).configured === false,
  "capture credential bootstrapping is inert while the feature is disabled",
);
let importedCredentials;
let temporaryCredentialPath;
const credentialResult = ensureXeroCaptureCredentials({
  enabled: true,
  controlSecret: "control-secret-12345678901234567890",
  bridgeSecret: "bridge-secret-123456789012345678901",
  n8nBin: "/fake/n8n",
  n8nEnv: { N8N_USER_FOLDER: "/fake/data" },
  runCommand: (binary, args) => {
    temporaryCredentialPath = args.find((value) => value.startsWith("--input=")).slice(8);
    importedCredentials = JSON.parse(readFileSync(temporaryCredentialPath, "utf8"));
    check(binary === "/fake/n8n" && args[0] === "import:credentials", "capture credentials use n8n's supported import path");
    return { status: 0, stdout: "", stderr: "" };
  },
});
check(credentialResult.configured === true, "valid hosting secrets configure the capture credentials");
check(
  importedCredentials.length === 2 &&
    importedCredentials[0].id === "phase20XeroCaptureControl" &&
    importedCredentials[0].data.name === "X-Xero-Capture-Control" &&
    importedCredentials[1].id === "phase20XeroCaptureBridge" &&
    importedCredentials[1].data.name === "X-Xero-Capture-Key" &&
    importedCredentials[0].data.value !== importedCredentials[1].data.value,
  "control and bridge credentials have stable IDs, separate headers, and separate values",
);
check(!existsSync(temporaryCredentialPath), "the plaintext credential import file is removed immediately");
let rejectedSharedSecret = false;
try {
  ensureXeroCaptureCredentials({
    enabled: true,
    controlSecret: "shared-secret-12345678901234567890",
    bridgeSecret: "shared-secret-12345678901234567890",
  });
} catch {
  rejectedSharedSecret = true;
}
check(rejectedSharedSecret, "control and bridge authentication can never share one secret");

rmSync(dir, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Required cloud workflows include repository-managed webhooks. Checks passed.");
