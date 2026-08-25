import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = async (name) => JSON.parse(await readFile(join(here, "../workflows", name), "utf8"));
const setup = await read("18-setup-xero-capture-data.json");
const status = await read("110-tool-get-xero-queue-status.json");
const ingest = await read("111-webhook-import-xero-statement-scan.json");
const annotations = await read("112-webhook-get-xero-annotations.json");
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };
const node = (workflow, name) => workflow.nodes.find((candidate) => candidate.name === name);

const tables = setup.nodes.filter((candidate) => candidate.parameters?.operation === "create").map((candidate) => candidate.parameters.tableName);
check(tables.includes("xero_statement_scans"), "setup must create scan evidence table");
check(tables.includes("xero_statement_lines"), "setup must create statement-line evidence table");
for (const field of ["scanId", "bankAccountId", "expectedCount", "observedCount", "complete", "blockingReasonsJson", "captureSourceHash"]) {
  check(JSON.stringify(node(setup, "Create Scan Table")).includes(`\"name\":\"${field}\"`) || JSON.stringify(node(setup, "Create Scan Table")).includes(`\"name\": \"${field}\"`), `scan table must include ${field}`);
}
for (const field of ["statementLineId", "scanId", "active", "visibleContact", "visibleAccount", "visibleDescription", "visibleTaxType", "uiMode", "matchedXeroTransactionId", "sourceHash", "capturedAt"]) {
  check(JSON.stringify(node(setup, "Create Statement Line Table")).includes(field), `line table must include ${field}`);
}

check(node(ingest, "Authenticated Scan")?.parameters?.authentication === "headerAuth", "scan ingest must use header authentication");
check(node(annotations, "Authenticated Annotation Request")?.parameters?.authentication === "headerAuth", "annotation lookup must use header authentication");
check(node(ingest, "Authenticated Scan")?.credentials?.httpHeaderAuth?.name === "Xero Capture Bridge", "scan ingest must use the named bridge credential");
const validation = node(ingest, "Validate Scan")?.parameters?.jsCode || "";
check(validation.includes("pagination coverage is incomplete"), "ingest must independently check pagination");
check(validation.includes("source hashes are invalid"), "ingest must independently check line hashes");
const writes = node(ingest, "Prepare Line Updates")?.parameters?.jsCode || "";
check(writes.includes("if (scan.complete === 'yes')"), "only a complete scan may produce active-line writes");
check(writes.includes("active:'no'"), "a later complete scan should retire disappeared lines");
check(writes.includes("if (!lineRows.length)"), "incomplete and empty scans must skip line upserts");

const statusShape = node(status, "Shape Queue Status")?.parameters?.jsCode || "";
check(statusShape.includes("ageMinutes<=30"), "queue status must enforce the 30-minute freshness gate");
check(statusShape.includes("state:'missing'"), "queue status must name a missing capture");
check(statusShape.includes("'stale'"), "queue status must name a stale capture");
const annotationShape = node(annotations, "Shape Annotations")?.parameters?.jsCode || "";
check(annotationShape.includes("likelyDescription"), "annotations must return likely descriptions");
check(annotationShape.includes("statementSourceHash"), "annotations must match the current captured source hash");
check(annotationShape.includes("readyInXero"), "annotations must distinguish prepared rows");
check(annotationShape.includes("persistentOverlay:false"), "overlay must be declared nonpersistent");

for (const workflow of [setup, status, ingest, annotations]) {
  check(workflow.meta?.phase === 20, `${workflow.name} must be phase 20`);
  check(workflow.meta?.testedWithN8n === "2.30.5", `${workflow.name} must state its tested n8n version`);
}

process.stdout.write(`Xero capture workflow contract: ${checks} checks passed.\n`);
