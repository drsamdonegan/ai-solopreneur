import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const captureRoot = join(here, "..");
const reconciliationRoot = join(captureRoot, "..", "xero-reconciliation");
const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const workflow = async (name) => load(join(captureRoot, "workflows", name));
const reconciliation = async (name) => load(join(reconciliationRoot, "workflows", name));
const node = (value, name) => {
  const found = value.nodes.find((entry) => entry.name === name);
  assert.ok(found, `missing node ${name}`);
  return found;
};
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

const [start, status, control, bridge, importer, setup, review, suggestions, prepare, installedImporter] = await Promise.all([
  workflow("113-tool-start-xero-queue-capture.json"),
  workflow("114-tool-get-xero-capture-status.json"),
  workflow("115-webhook-xero-capture-control.json"),
  workflow("116-webhook-xero-export-companion.json"),
  workflow("117-webhook-import-xero-uncoded-csv.json"),
  workflow("18-setup-xero-capture-data.json"),
  reconciliation("105-run-reconciliation-review.json"),
  reconciliation("103-tool-get-reconciliation-suggestions.json"),
  reconciliation("108-tool-prepare-green-matches.json"),
  load(join(here, "..", "..", "..", "n8n", "workflows", "117-webhook-import-xero-uncoded-csv.json")),
]);

const startCode = node(start, "Validate Start Input").parameters.jsCode;
check(startCode.includes("source must be user or agent") && startCode.includes("period='all'"), "start must accept the app contract and default to all open history");
check(startCode.includes("/api/xero-capture/runs/"), "start must return the stable chat progress route");
const startDecision = node(start, "Decide Start").parameters.jsCode;
const startColumns = node(start, "Save Capture Run").parameters.columns;
check(startDecision.includes("importKey:''") && startDecision.includes("importClaimId:''"), "new runs must initialize the atomic import identity fields");
check(startDecision.includes("expectedCount:Number(live.statementLinesObserved||0)") && !startDecision.includes("expectedCount:Number(live.bankAccountsExpected||0)"), "an already-running capture must report expectedCount in statement-line units");
check(startColumns.value.dateOrder === "" && startColumns.value.importKey && startColumns.value.importClaimId, "start must leave date order for live Xero binding and persist empty import identity fields");
check(["importKey", "importClaimId"].every((key) => startColumns.schema.some((entry) => entry.id === key)), "capture-run insert schema must include import identity fields");

const statusCode = node(status, "Shape Capture Status").parameters.jsCode;
check(statusCode.includes("HELPER_OFFLINE") && statusCode.includes("expiresAt"), "status must fail an abandoned helper run explicitly");
check(statusCode.includes("statementLinesObserved||0") && statusCode.includes("expectedCount"), "captured and expected counts must use statement-line rows");
check(statusCode.includes("...(reviewRunId?{reviewRunId}:{})"), "capture status must place the deterministic review binding inside the sanitized run payload");
const STATUS_CAPTURE_ID = "123e4567-e89b-42d3-a456-426614174000";
const STATUS_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const statusCapture = {
  runId: STATUS_CAPTURE_ID,
  sessionId: STATUS_SESSION_ID,
  source: "agent",
  status: "reviewing",
  phase: "reviewing",
  reviewRunId: `csv-review-${STATUS_CAPTURE_ID}`,
  companionId: "companion-test",
  runCreatedAt: new Date().toISOString(),
  runUpdatedAt: new Date().toISOString(),
  lastHeartbeatAt: new Date().toISOString(),
  progressCurrent: 5,
  progressTotal: 6,
  bankAccountsCaptured: 2,
  statementLinesObserved: 3,
};
const statusResult = new Function("$", "$input", "$json", statusCode)(
  (name) => ({
    first: () => ({ json: name === "Validate Status Input"
      ? { valid: true, sessionId: STATUS_SESSION_ID, requestId: STATUS_SESSION_ID, runId: STATUS_CAPTURE_ID }
      : statusCapture }),
    all: () => [statusCapture].map((json) => ({ json })),
  }),
  { all: () => [{ json: { runId: statusCapture.reviewRunId, status: "completed" } }] },
  {},
)[0].json.response;
check(statusResult.run.reviewRunId === `csv-review-${STATUS_CAPTURE_ID}` && statusResult.run.state === "ready", "ready status must bind the browser payload to the exact deterministic review run");

for (const [name, path] of [["Authenticated Capture Start", "xero-capture-start"], ["Authenticated Capture Status", "xero-capture-status"], ["Authenticated Capture Cancel", "xero-capture-cancel"]]) {
  const hook = node(control, name);
  check(hook.parameters.path === path && hook.parameters.authentication === "headerAuth", `${path} must be authenticated at the webhook`);
  check(hook.credentials.httpHeaderAuth.name === "Xero Capture Control", `${path} must use the separate control credential`);
}
check(/schemaVersion:\s*1,\s*run:/.test(node(control, "Respond Capture Status").parameters.responseBody), "control status must return the app's exact nullable run envelope");
for (const cancelNodeName of ["Plan Cancel", "Shape Cancelled Run"]) {
  const cancelCode = node(control, cancelNodeName).parameters.jsCode;
  check(cancelCode.includes("expectedCount:Number(stored.statementLinesObserved||0)") && !cancelCode.includes("expectedCount:Number(stored.bankAccountsExpected||0)"), `${cancelNodeName} must report expectedCount in statement-line units`);
}

for (const name of ["Authenticated Claim", "Authenticated Progress"]) {
  const hook = node(bridge, name);
  check(hook.parameters.authentication === "headerAuth" && hook.credentials.httpHeaderAuth.name === "Xero Capture Bridge", `${name} must use the bridge credential`);
}
const bindCode = node(bridge, "Bind Claim To Organisation").parameters.jsCode;
check(bindCode.includes("mode:'user-mediated-xero-export'"), "the claimed mode must match the companion feature gate exactly");
check(bindCode.includes("['AU','NZ','GB']") && bindCode.includes("country==='US'?'MDY'"), "date order must derive from the live Xero country and fail closed otherwise");
const progressCode = node(bridge, "Plan Progress").parameters.jsCode;
check(progressCode.includes("IMPORT_OWNS_REVIEW_STATE") && progressCode.includes("backward"), "companion progress must be monotonic and unable to overwrite import-owned review states");

const importHook = node(importer, "Raw Authenticated CSV Import");
check(importHook.parameters.path === "xero-capture-import" && importHook.credentials.httpHeaderAuth.name === "Xero Capture Bridge", "raw CSV import must use the bridge webhook");
const parseCode = node(importer, "Parse Official CSV").parameters.jsCode;
for (const phrase of ["all_bank_accounts_requested", "combinedNarration", "yourComments", "ACCOUNT_SECTION_MISSING", "sha256Hex", "uncoded_export", "CSV_ROW_LIMIT"]) {
  check(parseCode.includes(phrase), `strict grouped parser must include ${phrase}`);
}
check(!importer.connections["Normalise CSV Shape"] && importer.connections["Verify Export Organisation"].main[0][0].node === "Parse Official CSV", "only the strict grouped parser may be connected");
check(node(importer, "Respond CSV Import").parameters.options.responseCode.includes("422"), "rejected CSV imports must return non-2xx");
check(importer.connections["Has CSV Lines?"].main[1][0].node === "Plan Read-Only Review", "a valid zero-row report must still start and finish a review");

const replayNode = node(importer, "Import Replay?");
const claimNode = node(importer, "Claim CSV Import");
const ownershipNode = node(importer, "Verify CSV Import Ownership");
check(importer.connections["Valid CSV?"].main[0][0].node === replayNode.name, "a valid import must check for an already accepted replay before claiming");
check(importer.connections[replayNode.name].main[1][0].node === claimNode.name, "only a non-replay import may attempt the atomic claim");
check(importer.connections[replayNode.name].main[0][0].node === "Plan Reviewing Replay Recovery", "an accepted replay must inspect a stale interrupted review before responding");
const claimFilters = claimNode.parameters.filters.conditions;
check(["runId", "companionId", "status", "importKey", "importClaimId"].every((key) => claimFilters.some((filter) => filter.keyName === key)), "the import claim must compare-and-swap the full prior upload or stale-lease identity");
check(claimFilters.find((filter) => filter.keyName === "status").keyValue.includes("claimPreviousStatus") && claimFilters.find((filter) => filter.keyName === "importClaimId").keyValue.includes("claimPreviousImportClaimId"), "normal and stale-recovery claims must use parser-bound previous values");
check(importer.connections["Claim CSV Import"].main[0][0].node === "Read CSV Import Ownership" && importer.connections["Read CSV Import Ownership"].main[0][0].node === ownershipNode.name, "claim ownership must be post-read and verified before writes");
const ownershipRead = node(importer, "Read CSV Import Ownership");
check(ownershipRead.parameters.returnAll === false && ["runId", "companionId"].every((key) => ownershipRead.parameters.filters.conditions.some((filter) => filter.keyName === key)), "post-claim ownership read must be bounded to the compound run identity");
check(ownershipNode.parameters.jsCode.includes("importClaimId") && ownershipNode.parameters.jsCode.includes("IMPORT_CLAIM_RACE_LOST") && ownershipNode.parameters.jsCode.includes("IMPORT_IN_PROGRESS"), "concurrent imports must verify the unique claim token and expose a bounded in-progress retry state");
check(importer.connections["Import Owned?"].main[0][0].node === "Emit Account Scans" && importer.connections["Import Owned?"].main[1][0].node === "Respond CSV Import", "only the verified import owner may write scans or start review");
const reviewingFilters = node(importer, "Mark Capture Reviewing").parameters.filters.conditions;
check(["runId", "companionId", "status", "importKey", "importClaimId"].every((key) => reviewingFilters.some((filter) => filter.keyName === key)), "review transition must preserve compound import ownership");
for (const workflowCopy of [importer, installedImporter]) {
  const reviewingValues = node(workflowCopy, "Mark Capture Reviewing").parameters.columns.value;
  check(reviewingValues.runUpdatedAt.includes("$('Plan Read-Only Review').first().json.updatedAt"), "review transition must persist the planned review timestamp rather than an absent field");
  check(reviewingValues.bankAccountsCaptured.includes("$('Plan Read-Only Review').first().json.accountCount"), "review transition must persist the parser's account count");
  check(reviewingValues.statementLinesObserved.includes("$('Plan Read-Only Review').first().json.rowCount"), "review transition must persist the parser's statement-line count");
}
check(node(importer, "Mark Capture Reviewing").alwaysOutputData === true, "a fast completed review must not make the import webhook hang when the reviewing compare-and-swap loses");
check(importer.connections["Plan Read-Only Review"].main[0][0].node === "Start Automatic Read-Only Review" && importer.connections["Start Automatic Read-Only Review"].main[0][0].node === "Mark Capture Reviewing", "the deterministic review must be dispatched before the run can claim reviewing state");
check(node(importer, "Start Automatic Read-Only Review").parameters.workflowInputs.value.sessionId.includes("sessionId"), "automatic review must retain the originating conversation session");
const importRead = node(importer, "Read Import Run");
check(importRead.parameters.returnAll === false && importRead.parameters.limit === 2 && ["runId", "companionId"].every((key) => importRead.parameters.filters.conditions.some((filter) => filter.keyName === key)), "import lookup must be bounded to the authenticated compound run identity");

const recoveryRead = node(importer, "Read Recovery Review Run");
check(recoveryRead.parameters.dataTableId.value === "reconciliation_runs_v2" && recoveryRead.parameters.returnAll === false && recoveryRead.parameters.limit === 2 && recoveryRead.alwaysOutputData === true, "interrupted-review inspection must be bounded and preserve an empty result");
check(recoveryRead.parameters.matchType === "allConditions" && ["runId", "sessionId"].every((key) => recoveryRead.parameters.filters.conditions.some((filter) => filter.keyName === key)), "interrupted-review inspection must use the exact deterministic run and conversation session");
const recoveryClaim = node(importer, "Claim Review Redispatch");
const recoveryClaimKeys = recoveryClaim.parameters.filters.conditions.map((filter) => filter.keyName);
check(["runId", "sessionId", "companionId", "status", "importKey", "reviewRunId", "runUpdatedAt"].every((key) => recoveryClaimKeys.includes(key)), "review redispatch must compare-and-swap the full capture, import, review, and stale-lease identity");
const recoveryOwnershipRead = node(importer, "Read Review Redispatch Ownership");
check(recoveryOwnershipRead.parameters.returnAll === false && recoveryOwnershipRead.parameters.limit === 2 && recoveryOwnershipRead.parameters.matchType === "allConditions" && ["runId", "sessionId", "companionId"].every((key) => recoveryOwnershipRead.parameters.filters.conditions.some((filter) => filter.keyName === key)), "review redispatch ownership must be post-read through the authenticated compound identity");
const recoveryOwnershipCode = node(importer, "Verify Review Redispatch Ownership").parameters.jsCode;
check(recoveryOwnershipCode.includes("captureTenantId") && recoveryOwnershipCode.includes("captureOrganisationName") && recoveryOwnershipCode.includes("recoveryClaimId"), "review redispatch must reverify capture tenant, organisation, and unique claim ownership");
const recoveryInputs = node(importer, "Redispatch Automatic Read-Only Review").parameters.workflowInputs.value;
check(recoveryInputs.runId.includes("recoveryReviewRunId") && recoveryInputs.captureRunId.includes("recoveryRunId") && recoveryInputs.sessionId.includes("sessionId"), "redispatch must retain the same deterministic review, capture, and conversation binding");
check(importer.connections["Inspect Interrupted Review?"].main[1][0].node === "Respond CSV Import" && importer.connections["Redispatch Needed?"].main[1][0].node === "Respond CSV Import" && importer.connections["Redispatch Owned?"].main[1][0].node === "Respond CSV Import", "fresh, existing, and lost-race reviews must return without redispatch");
const recoveryNodes = ["Plan Reviewing Replay Recovery", "Inspect Interrupted Review?", "Read Recovery Review Run", "Plan Review Redispatch", "Redispatch Needed?", "Claim Review Redispatch", "Read Review Redispatch Ownership", "Verify Review Redispatch Ownership", "Redispatch Owned?", "Redispatch Automatic Read-Only Review", "Mark Review Redispatched", "Shape Review Redispatch Response"];
check(recoveryNodes.every((name) => !JSON.stringify(importer.connections[name] ?? {}).includes("Emit Account Scans") && !JSON.stringify(importer.connections[name] ?? {}).includes("Save CSV Lines")), "review recovery must never re-import account scans or statement lines");

const scanColumns = new Set(node(setup, "Create Scan Table").parameters.columns.column.map((column) => column.name));
const lineColumns = new Set(node(setup, "Create Statement Line Table").parameters.columns.column.map((column) => column.name));
const provenanceColumns = ["sessionId", "captureRunId", "captureTenantId", "captureOrganisationName"];
check(node(setup, "Create Scan Table").parameters.tableName === "xero_statement_scans_v2", "new installs must use the tenant-bound scan table instead of silently reusing the legacy schema");
check(node(setup, "Create Statement Line Table").parameters.tableName === "xero_statement_lines_v2", "new installs must use the tenant-bound statement-line table instead of silently reusing the legacy schema");
check(provenanceColumns.every((name) => scanColumns.has(name) && lineColumns.has(name)), "both capture tables must persist conversation, run, tenant, and organisation provenance");
for (const [saveName, allowed] of [["Save CSV Account Scans", scanColumns], ["Save CSV Lines", lineColumns]]) {
  const save = node(importer, saveName);
  const written = Object.keys(save.parameters.columns.value);
  check(written.every((name) => allowed.has(name)), `${saveName} must not assume columns absent from an existing production table`);
  check(provenanceColumns.every((name) => written.includes(name)), `${saveName} must bind every saved row to the authenticated capture provenance`);
  check(save.parameters.dataTableId.value.endsWith("_v2"), `${saveName} must write only to the migrated provenance table`);
}

const capturedLineRead = node(review, "Read Captured Statement Lines");
const captureGateRead = node(review, "Load Capture Gate");
for (const [readNode, table, limit] of [[capturedLineRead, "xero_statement_lines_v2", 5000], [captureGateRead, "xero_statement_scans_v2", 100]]) {
  const keys = readNode.parameters.filters.conditions.map((entry) => entry.keyName);
  check(readNode.parameters.dataTableId.value === table && readNode.parameters.returnAll === false && readNode.parameters.limit === limit, `${readNode.name} must be bounded to the migrated table`);
  check(readNode.parameters.matchType === "allConditions" && ["sessionId", "captureRunId"].every((key) => keys.includes(key)), `${readNode.name} must use the exact conversation and capture-run identity`);
}
const monthlyProfileRead = node(review, "Load Monthly Company Profile");
const monthlyRunRead = node(review, "Load Monthly Update Runs");
const monthlyEvidenceRead = node(review, "Load Monthly Update Evidence");
check(monthlyProfileRead.parameters.returnAll === false && monthlyProfileRead.parameters.limit === 1 && monthlyProfileRead.parameters.filters.conditions[0].keyName === "profileId", "Monthly Update company context must use one explicit profile row");
check(monthlyRunRead.parameters.returnAll === false && monthlyRunRead.parameters.limit === 10 && monthlyRunRead.parameters.orderByColumn === "finishedAt", "Monthly Update run history must be recent and bounded");
check(monthlyEvidenceRead.parameters.returnAll === false && monthlyEvidenceRead.parameters.limit === 200 && monthlyEvidenceRead.parameters.filters.conditions[0].keyName === "runId", "Monthly Update evidence must be bounded to the candidate run");

for (const workflowValue of [start, status, control, bridge, importer]) {
  for (const dataNode of workflowValue.nodes.filter((entry) => entry.type === "n8n-nodes-base.dataTable" && entry.parameters.operation === "get")) {
    check(dataNode.parameters.returnAll !== true, `${workflowValue.name}: ${dataNode.name} must not perform an unbounded DataTable read`);
    const conditionCount = dataNode.parameters.filters?.conditions?.length ?? 0;
    if (conditionCount > 1) check(dataNode.parameters.matchType === "allConditions", `${workflowValue.name}: ${dataNode.name} must AND every compound identity filter`);
  }
}

const fixture = await readFile(join(here, "fixtures", "uncoded-statement-lines.csv"), "utf8");
const run = { runId: "123e4567-e89b-42d3-a456-426614174000", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companionId: "companion-test", organisationName: "MLAI", organisationLegalName: "", dateOrder: "DMY", status: "uploading", importKey: "", importClaimId: "", source: "agent" };
const raw = { schema_version: 1, run_id: run.runId, companion_id: run.companionId, file_name: "Uncoded.csv", csv_text: fixture, all_bank_accounts_requested: true };
const importKey = (envelope) => `xero-import-${createHash("sha256").update(`${envelope.run_id}\0${envelope.file_name}\0${envelope.csv_text}`).digest("hex")}`;
const executeParser = (envelope = raw, verifiedRun = run, header = importKey(envelope)) => new Function("$", "$input", "$json", parseCode)(
  (name) => ({ first: () => ({ json: name === "Raw Authenticated CSV Import" ? { body: envelope, headers: { "idempotency-key": header } } : verifiedRun }) }), {}, {},
)[0].json;
const parsed = executeParser();
check(parsed.valid === true && parsed.accountCount === 2 && parsed.rowCount === 3, "strict n8n parser must accept every grouped fixture row");
check(parsed.idempotencyKey === importKey(raw), "n8n and companion import identities must hash actual NUL separators identically");
const visible = JSON.parse(parsed.lines[1].visibleFieldsJson);
check(visible.combinedNarration.includes("INV-42") && visible.comments === "Duplicate bank line" && visible.yourComments === "Owner note", "combined narration and both comment fields must remain distinct");
check(executeParser(raw, { ...run, organisationName: "Another Organisation" }).response.error.code === "CSV_ORGANISATION_MISMATCH", "parser must bind the report preamble to the live organisation");
check(executeParser(raw, run, "xero-import-not-the-payload").response.error.code === "IDEMPOTENCY_KEY_INVALID", "an import header for different bytes must fail closed");
check(executeParser(raw, { ...run, status: "reviewing", importKey: importKey(raw) }).replay === true, "an exact accepted retry must return the existing state without parsing writes again");
const freshLease = executeParser(raw, { ...run, status: "verifying", importKey: importKey(raw), importClaimId: "old-claim", lastHeartbeatAt: new Date().toISOString() });
check(freshLease.response.error.code === "IMPORT_IN_PROGRESS", "a fresh verifying lease must not be mistaken for a completed replay");
const staleLease = executeParser(raw, { ...run, status: "verifying", importKey: importKey(raw), importClaimId: "old-claim", lastHeartbeatAt: new Date(Date.now() - 181000).toISOString() });
check(staleLease.valid === true && staleLease.recoveringStale === true && staleLease.claimPreviousImportClaimId === "old-claim", "a crashed verifying owner must be recoverable through an exact stale compare-and-swap");
const negativeRaw = { ...raw, csv_text: fixture.replace("120.00,,GST", "-120.00,,GST") };
check(executeParser(negativeRaw).response.error.code === "NEGATIVE_AMOUNT_UNSUPPORTED", "negative Spent or Received cells must never be silently converted to positive amounts");

const executeOwnership = (parsedValue, rows) => new Function("$", "$input", "$json", ownershipNode.parameters.jsCode)(
  () => ({ first: () => ({ json: parsedValue }) }), { all: () => rows.map((json) => ({ json })) }, {},
)[0].json;
const ownedRow = { ...run, status: "verifying", importKey: parsed.idempotencyKey, importClaimId: parsed.importClaimId };
check(executeOwnership(parsed, [ownedRow]).importOwned === true, "the winning import claim may proceed to scans");
check(executeOwnership(parsed, [{ ...ownedRow, importClaimId: "another-claim" }]).response.error.code === "IMPORT_IN_PROGRESS", "a concurrent identical retry must wait for the live owner rather than pretend import completed");
check(executeOwnership(parsed, [{ ...ownedRow, importKey: "xero-import-different" }]).response.error.code === "IMPORT_IDENTITY_CONFLICT", "a concurrent different payload must be rejected");

const recoveryPlanCode = node(importer, "Plan Reviewing Replay Recovery").parameters.jsCode;
const executeRecoveryPlan = (parsedValue, storedValue) => new Function("$input", "$", "$json", recoveryPlanCode)(
  { first: () => ({ json: parsedValue }) },
  () => ({ first: () => ({ json: storedValue }) }),
  {},
)[0].json;
const recoveryReplay = { valid: true, replay: true, runId: run.runId, companionId: run.companionId, idempotencyKey: parsed.idempotencyKey, response: { run: { state: "reviewing" } } };
const staleReviewingRun = { ...run, tenantId: "tenant-mlai", status: "reviewing", importKey: parsed.idempotencyKey, reviewRunId: `csv-review-${run.runId}`, runUpdatedAt: new Date(Date.now() - 301000).toISOString() };
check(executeRecoveryPlan(recoveryReplay, staleReviewingRun).shouldInspectReview === true, "an exact reviewing replay with a stale lease must inspect whether its deterministic review started");
check(executeRecoveryPlan(recoveryReplay, { ...staleReviewingRun, runUpdatedAt: new Date().toISOString() }).shouldInspectReview === false, "a fresh reviewing lease must not race the original review dispatch");
for (const state of ["ready", "failed", "cancelled"]) {
  check(executeRecoveryPlan({ ...recoveryReplay, response: { run: { state } } }, { ...staleReviewingRun, status: state }).shouldInspectReview === false, `${state} capture replays must never redispatch a review`);
}
check(executeRecoveryPlan({ ...recoveryReplay, companionId: "another-companion" }, staleReviewingRun).shouldInspectReview === false, "a replay outside the authenticated companion binding must not inspect or redispatch");
check(executeRecoveryPlan(recoveryReplay, { ...staleReviewingRun, tenantId: "" }).shouldInspectReview === false, "a capture without bound tenant provenance must not redispatch");

const redispatchPlanCode = node(importer, "Plan Review Redispatch").parameters.jsCode;
const executeRedispatchPlan = (plannedValue, rows) => new Function("$", "$input", "$json", redispatchPlanCode)(
  () => ({ first: () => ({ json: plannedValue }) }),
  { all: () => rows.map((json) => ({ json })) },
  {},
)[0].json;
const plannedRecovery = executeRecoveryPlan(recoveryReplay, staleReviewingRun);
check(executeRedispatchPlan(plannedRecovery, []).shouldClaimRedispatch === true, "a stale reviewing capture with no deterministic review row may claim one redispatch");
for (const statusValue of ["running", "complete", "failed"]) {
  const existingReview = { runId: plannedRecovery.recoveryReviewRunId, sessionId: plannedRecovery.sessionId, status: statusValue };
  check(executeRedispatchPlan(plannedRecovery, [existingReview]).shouldClaimRedispatch === false, `an existing ${statusValue} deterministic review must block redispatch`);
}
const executeRecoveryOwnership = (plannedValue, rows) => new Function("$", "$input", "$json", recoveryOwnershipCode)(
  () => ({ first: () => ({ json: plannedValue }) }),
  { all: () => rows.map((json) => ({ json })) },
  {},
)[0].json;
const recoveredCapture = { ...staleReviewingRun, runUpdatedAt: plannedRecovery.recoveryAt, lastHeartbeatAt: plannedRecovery.recoveryAt, reviewStatus: plannedRecovery.recoveryClaimId };
check(executeRecoveryOwnership(plannedRecovery, [recoveredCapture]).recoveryOwned === true, "only the exact stale-review claim owner may redispatch workflow 105");
check(executeRecoveryOwnership(plannedRecovery, [{ ...recoveredCapture, organisationName: "Another Organisation" }]).recoveryOwned === false, "organisation provenance changes must invalidate redispatch ownership");

const reviewText = JSON.stringify(review);
check(reviewText.includes("Load Monthly Company Profile") && reviewText.includes("not receipt evidence or write authority"), "review must consume Monthly Update context only as bounded context");
check(reviewText.includes("captureScanIdsJson") && !reviewText.includes("slice(0,40)"), "review must load every scan in a capture run and save every row");
check(!reviewText.includes("browser-observed-xero-queue"), "new reconciliation review metadata must not claim browser observation");

const suggestionInput = node(suggestions, "Tool Input").parameters.workflowInputs.values.map((entry) => entry.name);
check(["runId", "cursor", "limit"].every((name) => suggestionInput.includes(name)), "suggestion reads must expose an exact optional review target and explicit pagination");
const suggestionValidationCode = node(suggestions, "Validate Read Input").parameters.jsCode;
check(suggestionValidationCode.includes("safeRunId") && suggestionValidationCode.includes("targetRunId"), "suggestion review targets must use a bounded safe identifier");
const suggestionPickCode = node(suggestions, "Pick Run").parameters.jsCode;
check(suggestionPickCode.includes("String(row.runId) === input.targetRunId") && suggestionPickCode.includes("targetMissing"), "an exact requested review must never fall back to a different run in the same conversation");
const suggestionCode = node(suggestions, "Shape Suggestions Result").parameters.jsCode;
check(suggestionCode.includes("hasMore") && suggestionCode.includes("nextCursor") && suggestionCode.includes("totalReturned"), "pagination must be explicit and never a silent slice");
check(suggestionCode.includes("interleave") && suggestionCode.includes("remainingByLane") && suggestionCode.includes("completeSummary"), "the first all-results page must expose complete lane counts, balanced details, and exact remaining details");
check(suggestionValidationCode.includes("limit>50"), "suggestion pages must be bounded at fifty rows");

const selectCode = node(prepare, "Select Executable Rows").parameters.jsCode;
check(selectCode.includes("String(line.scanId)") && selectCode.includes("uncoded_export"), "preparation must re-read the exact scan-scoped exported row");
const catalogueCode = node(prepare, "Recheck Current Catalogue").parameters.jsCode;
check(catalogueCode.includes("BANK_ACCOUNT_RESOLUTION_CHANGED"), "preparation must re-resolve the export label to the same unique active BANK AccountID");
check(node(prepare, "Read Nearby Unreconciled").parameters.url.startsWith("=https://api.xero.com/"), "duplicate safety must use a statically allowlisted Xero URL");
check(node(prepare, "Enforce Live Duplicate Safety").parameters.jsCode.includes("POSSIBLE_DUPLICATE_NOW"), "same-bank amount/date ambiguity must fail closed immediately before create");

console.log(`Xero export workflow contract: ${checks} checks passed.`);
