import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [html, source, styles, server, agentWorkflowSource] = await Promise.all([
  readFile("apps/chat/public/index.html", "utf8"),
  readFile("apps/chat/public/app.js", "utf8"),
  readFile("apps/chat/public/styles.css", "utf8"),
  readFile("apps/chat/src/server.ts", "utf8"),
  readFile("n8n/workflows/00-start-here-project-partner.json", "utf8"),
]);
const agentWorkflow = JSON.parse(agentWorkflowSource);

const syntax = spawnSync(process.execPath, ["--check", "apps/chat/public/app.js"], {
  encoding: "utf8",
});
assert.equal(syntax.status, 0, syntax.stderr);

assert.match(html, /id="xero-capture-launch"[^>]*[\s\S]*?hidden/);
assert.match(html, /id="xero-capture-start"/);
assert.match(html, /full date range you need, then export CSV to Downloads/i);
assert.match(source, /https:\/\/go\.xero\.com\/Banking\/StatementLines\/Offline/);
assert.match(source, /choose All bank accounts and a date range covering/i);
assert.match(source, /\/api\/xero-capture\/runs/);
assert.match(source, /run\.source === "agent"/);
assert.match(source, /started by Bookkeeping/);
assert.match(source, /method: "POST"/);
assert.match(source, /method: "DELETE"/);
assert.match(source, /XERO_CAPTURE_TERMINAL_STATES/);
assert.match(source, /xeroCaptureStatusInFlight/);
assert.match(source, /xeroCapturePollFailures <= 3/);
assert.match(source, /XERO_CAPTURE_POLL_MS \* 2 \*\*/);
assert.match(source, /window\.setTimeout/);
assert.match(source, /!run[\s\S]{0,220}stopXeroCapturePolling\(\)/);
assert.match(source, /incomingUpdatedAtMs < activeXeroCaptureUpdatedAtMs/);
assert.match(source, /Show suggestions/);
assert.match(source, /Use filter: all/);
assert.match(source, /exact remaining count and next cursor/i);
assert.match(source, /never claim every detail was shown/i);
assert.match(source, /Read exactly reviewRunId/);
assert.match(source, /function scheduleXeroSuggestionDelivery/);
assert.match(
  source,
  /run\.state === "ready" && reviewRunId[\s\S]{0,240}sessionId: statusSessionId[\s\S]{0,120}captureRunId: run\.runId[\s\S]{0,120}reviewRunId/,
);
assert.match(source, /xeroSuggestionsDeliveredThisPage\.has\(deliveryId\)/);
assert.match(source, /alreadyDelivered\(deliveryId\)/);
assert.match(
  source,
  /markDelivered\(deliveryId\)[\s\S]{0,520}sendMessage\(xeroCaptureResultPrompt\(binding\.reviewRunId\), true\)/,
);

const deliveryStart = source.indexOf("async function deliverXeroSuggestions");
const deliveryEnd = source.indexOf("function ensureXeroCapturePolling", deliveryStart);
assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart);
const deliverySource = source.slice(deliveryStart, deliveryEnd);
assert.match(deliverySource, /XERO_SUGGESTION_BUSY_RETRY_DELAYS_MS\[busyAttempt\]/);
assert.match(
  deliverySource,
  /retryDelay === undefined[\s\S]{0,360}markDelivered\(deliveryId\)/,
);
assert.doesNotMatch(deliverySource, /forgetDelivered\(deliveryId\)/);
const attemptedSend = deliverySource.indexOf("await sendMessage(");
assert.ok(attemptedSend >= 0);
assert.equal(
  deliverySource.indexOf("scheduleXeroSuggestionDelivery", attemptedSend),
  -1,
  "an attempted automatic send must never be replayed ambiguously",
);

assert.match(
  source,
  /xero-review:\$\{binding\.sessionId\}:\$\{binding\.captureRunId\}:\$\{binding\.reviewRunId\}/,
);
assert.match(
  source,
  /sessionId === binding\.sessionId[\s\S]{0,180}activeXeroCaptureSessionId === binding\.sessionId[\s\S]{0,180}activeXeroCaptureRunId === binding\.captureRunId[\s\S]{0,180}activeXeroReviewRunId === binding\.reviewRunId/,
);
assert.match(source, /run\.reviewRunId \?\? payload\?\.reviewRunId/);
assert.match(source, /XERO_SUGGESTION_DELIVER_WITHIN_MS = 12 \* 60 \* 60 \* 1000/);
assert.match(
  source,
  /xeroSuggestionTimestampIsFresh\(binding\.resultUpdatedAtMs\)/,
);
assert.match(
  source,
  /const resultUpdatedAtMs = Math\.max\([\s\S]{0,160}incomingUpdatedAtMs[\s\S]{0,120}incomingCreatedAtMs/,
);
assert.match(
  source,
  /captureRunId: run\.runId[\s\S]{0,120}reviewRunId,[\s\S]{0,120}resultUpdatedAtMs/,
);
assert.match(
  source,
  /xeroSuggestionDeliveryTimerId === deliveryId[\s\S]{0,120}stopXeroSuggestionDelivery\(\)/,
);

const loadStart = source.indexOf("async function loadConversation(");
const loadEnd = source.indexOf("async function loadOlderMessages", loadStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart);
const loadSource = source.slice(loadStart, loadEnd);
assert.ok(
  loadSource.indexOf("clearXeroCaptureForConversationSwitch()") <
    loadSource.indexOf("await fetch("),
  "old capture delivery must be cleared before a conversation fetch starts",
);
assert.match(loadSource, /loadGeneration !== conversationLoadGeneration/);
assert.match(
  source,
  /function clearXeroCaptureForConversationSwitch\(\)[\s\S]{0,320}stopXeroCapturePolling\(\)[\s\S]{0,160}hideXeroCaptureProgress\(\)/,
);
assert.match(
  source,
  /function clearXeroCaptureForConversationSwitch\(\)[\s\S]{0,420}xeroCaptureAvailable = false[\s\S]{0,120}syncXeroCaptureButtons\(\)/,
);
assert.match(
  source,
  /async function startXeroCapture[\s\S]{0,220}switchingConversation/,
);
assert.match(
  source,
  /async function createConversation[\s\S]{0,900}beginConversationSwitch\(\);[\s\S]{0,120}clearXeroCaptureForConversationSwitch\(\);/,
);
assert.match(
  source,
  /if \(xeroCaptureStatusInFlight\)[\s\S]{0,500}xeroCaptureStatusRefreshPending = true/,
);
assert.match(
  source,
  /xeroCaptureStatusInFlight = false;[\s\S]{0,240}refreshPending[\s\S]{0,240}refreshXeroCaptureStatus\(\)/,
);
assert.match(source, /\\bCONFIRM \[A-F0-9\]\{8\}\\b/);
assert.match(source, /message__confirm-action/);
assert.match(source, /sendMessage\(confirmationText, true\)/);
assert.match(source, /stopXeroCapturePolling\(\)/);
assert.match(source, /local companion will open Xero after it is ready/i);
assert.match(source, /leave it in Downloads/i);
for (const state of [
  "preflight",
  "opening",
  "awaiting_login",
  "awaiting_export",
  "discovering",
  "capturing",
  "verifying",
  "uploading",
  "reviewing",
  "ready",
  "failed",
  "cancelled",
]) {
  assert.match(source, new RegExp(`\\b${state}:`), `missing UI state ${state}`);
}

// This hosted flow opens a fixed report for the user; it has no website
// scraping, selector execution, browser-extension, or generic control API.
assert.doesNotMatch(source, /playwright|puppeteer|chrome\.runtime|connectOverCDP/i);
assert.doesNotMatch(
  source,
  /querySelector\([^)]*(?:bank-reconciliation|statement-line|go\.xero)/i,
);
assert.doesNotMatch(source, /CAPTURE_XERO_PAGE|CAPTURE_AND_SUBMIT/);
assert.doesNotMatch(source, /captureGrant|X-Xero-Capture-Control/);
assert.doesNotMatch(source, /window\.open\(XERO_UNCODED_REPORT_URL/);
assert.match(styles, /\.xero-capture-launch/);
assert.match(styles, /\.xero-capture-progress__actions/);

// Public deployments do not get the flow merely by deploying this code.
assert.match(server, /XERO_CAPTURE_RUNS_ENABLED/);
assert.match(server, /XERO_CAPTURE_CONTROL_SECRET/);
assert.match(server, /=== "true"/);

const suggestionsTool = agentWorkflow.nodes.find(
  (node) => node.name === "get_reconciliation_suggestions",
);
assert.equal(
  Object.hasOwn(suggestionsTool.parameters.workflowInputs.value, "cursor"),
  true,
);
assert.equal(
  Object.hasOwn(suggestionsTool.parameters.workflowInputs.value, "limit"),
  true,
);
assert.match(suggestionsTool.parameters.description, /nextCursor/);
assert.match(suggestionsTool.parameters.description, /exact reviewRunId/i);
assert.match(suggestionsTool.parameters.description, /filter all/i);
assert.equal(
  Object.hasOwn(suggestionsTool.parameters.workflowInputs.value, "runId"),
  true,
);
assert.match(
  suggestionsTool.parameters.workflowInputs.value.runId,
  /exact reviewRunId returned by the completed Xero capture/i,
);
assert.match(
  suggestionsTool.parameters.workflowInputs.value.filter,
  /Use all for a newly completed capture or complete review/,
);
assert.match(
  suggestionsTool.parameters.workflowInputs.value.filter,
  /use uncertain only when the user specifically asks/,
);
assert.match(suggestionsTool.parameters.workflowInputs.value.filter, /\|\| 'all'/);
assert.ok(
  agentWorkflow.nodes.find((node) => node.name === "Bookkeeping Agent")
    .parameters.options.maxIterations >= 12,
  "Bookkeeping needs enough tool iterations to traverse ordinary multi-page reviews",
);

process.stdout.write(
  "User-mediated Xero export CTA, progress states, and no-browser-control checks passed.\n",
);
