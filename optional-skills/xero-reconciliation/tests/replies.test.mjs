// What the agent is handed, and therefore what the learner reads.
//
// These nodes are mostly string-shaping, which makes them look not worth
// testing right up until one of them reads a node that did not execute and the
// whole tool returns nothing. That has happened in this repo before, so the
// branches that skip nodes are exercised here on purpose.
// Run with: node tests/replies.test.mjs
import { loadWorkflow, codeOf, runCode, makeChecker } from "./_harness.mjs";

const { check, done } = makeChecker("replies");
const connection = loadWorkflow("100-tool-check-xero-connection.json");
const profile = loadWorkflow("101-tool-set-bookkeeping-profile.json");
const start = loadWorkflow("102-tool-start-reconciliation-review.json");
const get = loadWorkflow("103-tool-get-reconciliation-suggestions.json");
const decide = loadWorkflow("104-tool-record-reconciliation-decision.json");
const review = loadWorkflow("105-run-reconciliation-review.json");
const receipt = loadWorkflow("109-run-receipt-lookup.json");
const prepare = loadWorkflow("108-tool-prepare-green-matches.json");
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

for (const [workflow, names] of [
  [profile, ["Read Existing Profile"]],
  [start, ["Read Recent Runs", "Read Bookkeeping Profile"]],
  [get, ["Read Recent Runs", "Read Suggestions"]],
]) {
  for (const name of names) {
    check(`${name} preserves an empty-result refusal path`, workflow.nodes.find((entry) => entry.name === name)?.alwaysOutputData === true);
  }
}

// --- the four connection states -------------------------------------------
const probeSrc = codeOf(connection, "Read Xero Probe");
const probe = (input) => runCode(probeSrc, { input: [input] })[0];

const connected = probe({ statusCode: 200, body: [{ tenantId: "t-1", tenantName: "Acme Studio" }] });
check("a live connection names the organisation", connected.state === "connected" && connected.organisationName === "Acme Studio");
check("a live connection carries the tenant id", connected.tenantId === "t-1");
check("401 is a reauth, not a missing credential", probe({ statusCode: 401, body: {} }).state === "needs_reauth");
check("403 is a reauth too", probe({ statusCode: 403, body: {} }).state === "needs_reauth");
check("the reauth message explains the 60-day expiry", /60 days/.test(probe({ statusCode: 401, body: {} }).message));
check("a missing credential is not_connected", probe({ error: { message: "Credentials not found" } }).state === "not_connected");
check("no response at all is not_connected", probe({}).state === "not_connected");
check("an unexpected status is unknown rather than a guess", probe({ statusCode: 503, body: {} }).state === "unknown");
check("200 with no organisations is not a connection", probe({ statusCode: 200, body: [] }).state === "not_connected");
check("the connect steps mention the exact credential name", /Xero \(read-only\)/.test(probe({}).connectSteps));
check("the connect steps warn about the permission screen", /view/i.test(probe({}).connectSteps));

const customProbeSrc = codeOf(connection, "Read Custom Probe");
const customConnected = runCode(customProbeSrc, {
  nodes: { "Read Xero Probe": [probe({ statusCode: 200, body: [] })] },
  input: [{ statusCode: 200, body: { Organisations: [{ OrganisationID: "org-custom", Name: "Custom Studio" }] } }],
})[0];
check("a Custom Connection is discovered through Organisation", customConnected.connected === true && customConnected.organisationName === "Custom Studio");
check("a Custom Connection is labelled explicitly", customConnected.connectionType === "custom" && customConnected.tenantId === "org-custom");
const failedCustom = runCode(customProbeSrc, {
  nodes: { "Read Xero Probe": [probe({ statusCode: 401, body: {} })] }, input: [{ statusCode: 401, body: {} }],
})[0];
check("a failed Custom Connection probe preserves the useful standard error", failedCustom.state === "needs_reauth");

const shapeConnSrc = codeOf(connection, "Shape Connection Result");
const shapeConn = (p, w) => runCode(shapeConnSrc, {
  nodes: { "Validate Connection Input": [{ sessionId: "s", requestId: "r", proposedInput: {} }], "Read Xero Probe": [p] },
  input: [w],
})[0].response;

const notConnected = shapeConn(probe({}), { writeState: "not_connected", writeConnected: false, writeConnectSteps: "x", writeScope: "y" });
check("a disconnected reply offers the clickable credential address", notConnected.connectSteps.length > 0);
check("a disconnected reply tells the agent it cannot do it itself", /cannot complete.*for them/i.test(notConnected.nextStep));
const multi = shapeConn(probe({ statusCode: 200, body: [{ tenantId: "t-1", tenantName: "A" }, { tenantId: "t-2", tenantName: "B" }] }),
  { writeState: "connected", writeConnected: true, writeConnectSteps: "", writeScope: "" });
check("more than one organisation is disclosed", multi.multipleOrganisations === true && /first one/i.test(multi.message));
check("the write credential state is reported separately", multi.writeConnected === true);

// --- the profile merge discipline ------------------------------------------
const mergeSrc = codeOf(profile, "Validate And Merge");
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const merge = (input, existing = {}) => runCode(mergeSrc, {
  nodes: { "Tool Input": [{ sessionId: UUID, requestId: UUID, ...input }] },
  input: [{ profileId: "default", ...existing }],
})[0];

const kept = merge({ organisationName: "" }, { organisationName: "Acme", accountCodeNotes: "Uber is 429" });
check("a blank field keeps the previous value", kept.organisationName === "Acme");
check("an untouched field is kept too", kept.accountCodeNotes === "Uber is 429");
check("a supplied field overwrites", merge({ organisationName: "New Co" }, { organisationName: "Acme" }).organisationName === "New Co");
check("the threshold parses from digits", merge({ neverGuessAbove: "2000" }).neverGuessAbove === 2000);
check("the threshold tolerates a dollar sign and commas", merge({ neverGuessAbove: "$2,000" }).neverGuessAbove === 2000);
check("a negative threshold is refused", merge({ neverGuessAbove: "-5" }).response?.error?.code === "INVALID_THRESHOLD");
check("a nonsense threshold is refused", merge({ neverGuessAbove: "lots" }).response?.error?.code === "INVALID_THRESHOLD");
check("a blank threshold keeps the previous one", merge({ neverGuessAbove: "" }, { neverGuessAbove: 500 }).neverGuessAbove === 500);
check("the currency is upper-cased", merge({ baseCurrency: "aud" }).baseCurrency === "AUD");
check("a bad session is refused", runCode(mergeSrc, { nodes: { "Tool Input": [{ sessionId: "no", requestId: "no" }] }, input: [{}] })[0].valid === false);
check("tenantId is never taken from the model", merge({ tenantId: "injected" }, { tenantId: "real" }).tenantId === "real");

const shapeProfileSrc = codeOf(profile, "Shape Profile Result");
const shaped = runCode(shapeProfileSrc, { nodes: { "Validate And Merge": [merge({ organisationName: "Acme" })] }, input: [{}] })[0].response;
check("the saved values are read back", shaped.savedProfile.organisationName === "Acme");
check("what is still missing is named", shaped.stillMissing.length > 0);
check("the threshold is asked for by name", shaped.stillMissing.some((item) => /decide yourself/i.test(item)));
check("the reply tells the agent to read it back", /read the saved values back/i.test(shaped.message));

// --- the refusals before spending anything ---------------------------------
const checkProfileSrc = codeOf(start, "Check Profile Exists");
const noProfile = runCode(checkProfileSrc, {
  nodes: { "Decide Run": [{ shouldQueue: true, runId: "r" }] }, input: [],
})[0];
check("no profile refuses the run", noProfile.shouldQueue === false && noProfile.response.error.code === "NO_PROFILE");
check("the refusal says what to collect first", /always want to decide themselves/i.test(noProfile.response.nextStep));
const withProfile = runCode(checkProfileSrc, {
  nodes: { "Decide Run": [{ shouldQueue: true, runId: "r" }] },
  input: [{ profileId: "default", organisationName: "Acme", neverGuessAbove: 2000 }],
})[0];
check("a saved profile lets the run proceed", withProfile.shouldQueue !== false);

const authSrc = codeOf(start, "Shape Auth Needed");
const auth = runCode(authSrc, { nodes: { "Read Start Probe": [{ xeroProblem: "not_connected" }] }, input: [{}] })[0].response;
check("no Xero connection refuses before spending", auth.ok === false && auth.error.code === "XERO_NOT_CONNECTED");
check("the refusal carries the deployment-safe connection path", auth.credentialUrl === "/api/xero/connect");
check("the refusal tells the agent to emit that exact path", /\/api\/xero\/connect/.test(auth.linkInstruction));
check("the refusal forbids asking for a password", /never ask the user for a xero password/i.test(auth.nextStep));

const customStartSrc = codeOf(start, "Read Custom Start Probe");
const customStart = runCode(customStartSrc, {
  nodes: { "Read Start Probe": [{ runId: "r-custom", xeroConnected: false, xeroProblem: "unknown" }] },
  input: [{ statusCode: 200, body: { Organisations: [{ OrganisationID: "org-custom", Name: "Custom Studio" }] } }],
})[0];
check("a Custom Connection can pass the start gate", customStart.xeroConnected === true && customStart.connectionType === "custom");

const startShapeSrc = codeOf(start, "Shape Start Result");
const started = runCode(startShapeSrc, { nodes: { "Read Start Probe": [{ runId: "r-1", period: "90d", replacing: null }] }, input: [{}] })[0].response;
check("starting reports a run id", started.runId === "r-1" && started.status === "started");
check("starting never claims findings", !/found|suggest/i.test(started.message));
const restarted = runCode(startShapeSrc, {
  nodes: { "Read Start Probe": [{ runId: "r-2", period: "", replacing: { reason: "interrupted", age: 44 } }] }, input: [{}],
})[0].response;
check("an interrupted predecessor is explained honestly", /stopped 44 minutes ago/.test(restarted.message));

// --- what the learner reads back -------------------------------------------
const validateSuggestSrc = codeOf(get, "Validate Read Input");
const validateSuggestionRead = (filter, extra = {}) => runCode(validateSuggestSrc, {
  input: [{ sessionId: SESSION_ID, requestId: SESSION_ID, filter, ...extra }],
})[0];
check("a complete suggestion read is the safe default", validateSuggestionRead("").filter === "all");
check("an unknown suggestion filter falls back to all", validateSuggestionRead("surprise").filter === "all");
check("an explicit uncertain-only read stays available", validateSuggestionRead("uncertain").filter === "uncertain");
const CAPTURE_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REVIEW_RUN_ID = `csv-review-${CAPTURE_RUN_ID}`;
const boundRead = validateSuggestionRead("all", { runId: REVIEW_RUN_ID });
check("a capture review ID is accepted as an exact target", boundRead.valid === true && boundRead.targetRunId === REVIEW_RUN_ID);
check("the exact target is preserved in the audited input", boundRead.proposedInput.runId === REVIEW_RUN_ID);
check("an unsafe review ID is rejected", validateSuggestionRead("all", { runId: "review id with spaces" }).response?.error?.code === "INVALID_RUN_ID");

const pickRunSrc = codeOf(get, "Pick Run");
const exactPicked = runCode(pickRunSrc, {
  nodes: { "Validate Read Input": [{ ...boundRead, targetRunId: REVIEW_RUN_ID }] },
  input: [
    { runId: "newer-review", sessionId: SESSION_ID, status: "completed", startedAt: "2026-08-30T02:00:00.000Z" },
    { runId: REVIEW_RUN_ID, sessionId: SESSION_ID, status: "completed", startedAt: "2026-08-30T01:00:00.000Z" },
    { runId: REVIEW_RUN_ID, sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "completed", startedAt: "2026-08-30T03:00:00.000Z" },
  ],
})[0];
check("an exact review target cannot be replaced by a newer run", exactPicked.hasRun === true && exactPicked.runId === REVIEW_RUN_ID);
const missingExact = runCode(pickRunSrc, {
  nodes: { "Validate Read Input": [{ ...boundRead, targetRunId: REVIEW_RUN_ID }] },
  input: [{ runId: "newer-review", sessionId: SESSION_ID, status: "completed", startedAt: "2026-08-30T02:00:00.000Z" }],
})[0];
check("a missing exact target does not fall back to another review", missingExact.hasRun === false && missingExact.targetMissing === true);

const suggestSrc = codeOf(get, "Shape Suggestions Result");
const row = (over = {}) => ({ suggestionId: "sug-1", runId: "run-1", sessionId: SESSION_ID, occurredAt: "2026-07-15", amount: -42.35,
  contactName: "UBER *TRIP", suggestedContact: "Uber", description: "UBER", needsHuman: "no",
  basis: "user-rule", suggestedAccountCode: "429", suggestedAccountName: "Travel - National",
  suggestedTaxType: "INPUT", suggestedContactId: "contact-uber", matchedInvoiceId: "",
  userDecision: "", executionStatus: "", resultLane: "ready_to_prepare", readyInXero: "no",
  confidence: 0.98, whatToCheck: "", likelyDescription: "Local business travel",
  evidenceSummary: "Existing contact and saved context.", reviewQuestion: "", ...over });

const noRun = runCode(suggestSrc, { nodes: { "Pick Run": [{ hasRun: false, running: false, interrupted: false, filter: "all" }] }, input: [] })[0].response;
check("no finished review says so plainly", noRun.hasRun === false && /offer to capture.*run one/i.test(noRun.message));
const running = runCode(suggestSrc, { nodes: { "Pick Run": [{ hasRun: false, running: true, runningMinutes: 3, filter: "all" }] }, input: [] })[0].response;
check("a running review is reported as running", /running for 3 minutes/.test(running.message));
const interrupted = runCode(suggestSrc, { nodes: { "Pick Run": [{ hasRun: false, running: false, interrupted: true, interruptedMinutes: 44, filter: "all" }] }, input: [] })[0].response;
check("an interrupted review is not called running", /never finished/i.test(interrupted.message));

const full = runCode(suggestSrc, {
  nodes: { "Pick Run": [{ hasRun: true, runId: "run-1", sessionId: SESSION_ID, filter: "all", run: { status: "completed", reportText: "REPORT", errorSummary: "" } }] },
  input: [
    row({ suggestionId: "ready-1" }),
    row({ suggestionId: "uncertain-1", needsHuman: "yes", resultLane: "likely", suggestedAccountCode: "", reviewQuestion: "Who is 8841?" }),
    row({ suggestionId: "match-1", resultLane: "existing_match", basis: "exact-invoice", matchedInvoiceId: "inv-1", matchedInvoiceNumber: "INV-0042" }),
    row({ suggestionId: "done-1", resultLane: "ready_to_prepare", readyInXero: "yes", executionStatus: "created" }),
    row({ suggestionId: "accepted-1", userDecision: "accepted" }),
  ],
})[0].response;
check("every group is separated", full.needsYou.length === 1 && full.readyToApprove.length === 1
  && full.matchInXero.length === 1 && full.readyInXero.length === 1 && full.alreadyAccepted.length === 1,
  JSON.stringify(full.counts));
check("the saved report is returned verbatim", full.reportText === "REPORT");
check("the amount is not rounded", full.readyToApprove[0].amount === "-$42.35");
check("each line names date, amount and counterparty", /2026-07-15/.test(full.readyToApprove[0].line) && /42\.35/.test(full.readyToApprove[0].line));
check("an uncertain row carries its question", full.needsYou[0].reviewQuestion === "Who is 8841?");
check("an uncertain row carries its likely description", full.needsYou[0].likelyDescription === "Local business travel");
check("an uncertain row shows no account", full.needsYou[0].account === "");
check("ready rows expose an existing ContactID", full.readyToApprove[0].contactId === "contact-uber");
check("the agent is told to surface the uncertain ones first", /needsYou and blocked first/i.test(full.nextStep));
check("the agent is told final Xero clicks remain", /nothing is reconciled.*clicks OK/i.test(full.nextStep));
const crossSession = runCode(suggestSrc, {
  nodes: { "Pick Run": [{ hasRun: true, runId: "run-1", sessionId: SESSION_ID, filter: "all", run: { status: "completed" } }] },
  input: [row({ sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
})[0].response;
check("suggestions from another conversation are never returned", crossSession.counts.total === 0 && crossSession.readyToApprove.length === 0);
const uncertainOnly = runCode(suggestSrc, {
  nodes: { "Pick Run": [{ hasRun: true, runId: "run-1", sessionId: SESSION_ID, filter: "uncertain", run: { status: "completed", reportText: "", errorSummary: "" } }] },
  input: [row({ suggestionId: "ready-1" }), row({ suggestionId: "u-1", needsHuman: "yes", resultLane: "likely" })],
})[0].response;
const groups = [full.needsYou, full.blocked, full.readyToApprove, full.matchInXero, full.alreadyAccepted, full.readyInXero];
const shownIds = groups.flatMap((group) => group.map((entry) => entry.suggestionId));
check("no transaction appears in two groups", new Set(shownIds).size === shownIds.length, shownIds.join(","));
check("every transaction appears somewhere", new Set(shownIds).size === full.counts.total);
check("the uncertain filter hides the rest", uncertainOnly.readyToApprove.length === 0 && uncertainOnly.needsYou.length === 1);

const manyUncertain = Array.from({ length: 60 }, (_, index) => row({
  suggestionId: `uncertain-${String(index).padStart(2, "0")}`,
  resultLane: "likely",
  needsHuman: "yes",
  suggestedAccountCode: "",
}));
const balanced = runCode(suggestSrc, {
  nodes: { "Pick Run": [{ hasRun: true, runId: REVIEW_RUN_ID, sessionId: SESSION_ID, filter: "all", cursor: 0, limit: 20, run: { status: "completed" } }] },
  input: [
    ...manyUncertain,
    row({ suggestionId: "ready-visible", runId: REVIEW_RUN_ID }),
    row({ suggestionId: "match-visible", runId: REVIEW_RUN_ID, resultLane: "existing_match" }),
  ].map((entry) => ({ ...entry, runId: REVIEW_RUN_ID })),
})[0].response;
check("complete counts include rows beyond the bounded page", balanced.counts.needsYou === 60 && balanced.counts.readyToApprove === 1 && balanced.counts.matchInXero === 1);
check("a large uncertain lane cannot hide ready and match lanes on page one", balanced.readyToApprove[0]?.suggestionId === "ready-visible" && balanced.matchInXero[0]?.suggestionId === "match-visible");
check("pagination discloses the exact omitted detail count", balanced.pagination.hasMore === true && balanced.pagination.remaining === 42 && balanced.pagination.nextCursor === "20");
check("remaining counts are broken down by lane", balanced.pagination.remainingByLane.needsYou === 42 && balanced.pagination.remainingByLane.readyToApprove === 0);
check("the tool forbids implying omitted details were shown", /never imply omitted details were shown/i.test(balanced.nextStep));

// --- the report itself ------------------------------------------------------
const reportSrc = codeOf(review, "Compose Report");
const composed = runCode(reportSrc, {
  nodes: { "Merge All Suggestions": [{ runId: "run-1", receiptsSearched: 6, receiptsFound: 2, truncated: false,
    problems: [], maxLines: 200, rows: [
      row({ suggestionId: "a" }),
      row({ suggestionId: "b", needsHuman: "yes", resultLane: "likely", suggestedAccountCode: "", likelyDescription: "Unknown direct debit", reviewQuestion: "Who is 8841?" }),
      row({ suggestionId: "c", resultLane: "existing_match", basis: "exact-invoice", whatToCheck: "This looks like invoice INV-0042." }),
    ] }] },
  input: [{}],
})[0];
check("the headline names the user-exported source", /I checked 3 transactions from a fresh, complete Xero Uncoded Statement Lines export\. 1 are ready for you to approve for preparation; 1 need your help\./.test(composed.reportText), composed.reportText.split("\n")[0]);
check("a ready line carries its evidence", /Existing contact and saved context/.test(composed.reportText));
check("an uncertain line has a likely description and question", /likely Unknown direct debit\. Who is 8841\?/.test(composed.reportText));
check("the mailbox search is disclosed", /looked in your mailbox for receipts on 6 of these and found 2/.test(composed.reportText));
check("the closing line is always there", composed.reportText.trim().endsWith("Nothing here is reconciled. After you explicitly approve prepared items, you still use Match or Find & Match and click OK in Xero."));
check("no markdown table is emitted", !composed.reportText.includes("|"));
check("no markdown heading is emitted", !/^#/m.test(composed.reportText));
const truncated = runCode(reportSrc, {
  nodes: { "Merge All Suggestions": [{ runId: "r", receiptsSearched: 0, receiptsFound: 0, truncated: true, maxLines: 200,
    problems: ["the tax rates did not answer (500)"], rows: [row()] }] }, input: [{}],
})[0];
check("reviews never silently claim a most-recent slice", !/most recent|more than 200 captured lines/.test(truncated.reportText));
check("a partial failure is disclosed", /context did not come back cleanly/.test(truncated.reportText));
check("the closing line survives a partial run", truncated.reportText.trim().endsWith("and click OK in Xero."));

// --- the write-lane reply, including the branch where nothing ran -----------
const prepShapeSrc = codeOf(prepare, "Shape Prepare Result");
const created = runCode(prepShapeSrc, {
  nodes: {
    "Summarise Outcomes": [{ counts: { created: 2, skipped: 1, failed: 0 },
      createdRows: [{ suggestionId: "a", line: "L1", xeroBankTransactionId: "x1" }, { suggestionId: "b", line: "L2", xeroBankTransactionId: "x2" }],
      failedRows: [] }],
    "Select Executable Rows": [{ refusals: [{ suggestionId: "z", reason: "NOT_ACCEPTED", message: "no" }] }],
  }, input: [{}],
})[0].response;
check("the created count is reported", created.created === 2);
check("the reply says the learner still reconciles it", /ready for Match or Find & Match/.test(created.message));
check("the reply does not promise a green match", !/shows as a green match/i.test(created.message));
check("the reply names Find & Match", /Find & Match/.test(created.message));
check("the reply leaves OK to the user", /click OK yourself/.test(created.message));
check("duplicates are disclosed", /already in Xero from a previous run/.test(created.message));
check("refusals are carried back", created.refused.length === 1);
check("the agent is told never to retry a refusal", /never retry one/i.test(created.nextStep));
// The path where Summarise Outcomes never executed: reading it must not throw.
const nothingRan = runCode(prepShapeSrc, {
  nodes: { "Select Executable Rows": [{ refusals: [{ suggestionId: "z", reason: "MATCH_IN_XERO", message: "no" }] }] },
  input: [{}],
})[0].response;
check("an unexecuted summarise node does not kill the reply", nothingRan.ok === true && nothingRan.created === 0);
check("the nothing-created reply still explains itself", /did not create anything in Xero/i.test(nothingRan.message));

const connectNeededSrc = codeOf(prepare, "Shape Connect Needed");
const needsWrite = runCode(connectNeededSrc, { nodes: { "Read Write Probe": [{ writeState: "not_connected" }] }, input: [{}] })[0].response;
check("a missing write credential creates nothing", needsWrite.ok === false && needsWrite.error.code === "WRITE_NOT_CONNECTED");
check("it says the acceptances are still saved", /still saved/i.test(needsWrite.nextStep));
check("it warns the consent screen differs", /view AND update/.test(needsWrite.nextStep));

// --- decisions --------------------------------------------------------------
const validateDecisionSrc = codeOf(decide, "Validate Decision Input");
const vd = (input) => runCode(validateDecisionSrc, { input: [{ sessionId: UUID, requestId: UUID, ...input }] })[0];
check("an unknown decision word is refused", vd({ suggestionIds: "a", decision: "maybe" }).response.error.code === "INVALID_DECISION");
check("no ids is refused", vd({ suggestionIds: "", decision: "accepted" }).response.error.code === "NO_SUGGESTIONS");
check("more than twenty ids is refused", vd({ suggestionIds: Array.from({ length: 21 }, (_, i) => `s${i}`).join(","), decision: "accepted" }).response.error.code === "TOO_MANY_IDS");
check("changed needs exactly one id", vd({ suggestionIds: "a,b", decision: "changed", userAccountCode: "429" }).response.error.code === "INVALID_DECISION");
check("changed needs an account code", vd({ suggestionIds: "a", decision: "changed" }).response.error.code === "INVALID_ACCOUNT_CODE");
check("a valid change is accepted", vd({ suggestionIds: "a", decision: "changed", userAccountCode: "429" }).valid === true);
check("ids are trimmed and split", JSON.stringify(vd({ suggestionIds: " a , b ", decision: "accepted" }).ids) === '["a","b"]');

const decisionShapeSrc = codeOf(decide, "Shape Decision Result");
const decisionProposal = { decision: "accepted", recorded: [{ suggestionId: "a", line: "L1" }], refused: [],
  proposalReady: true, proposedInput: { suggestions: [{ suggestionId: "a", acceptedHash: "a".repeat(64) }] },
  confirmationText: "CONFIRM ABCD1234", expiresAt: new Date(Date.now() + 300000).toISOString() };
const recorded = runCode(decisionShapeSrc, {
  nodes: { "Build Green Match Proposal": [decisionProposal] },
  input: [{ id: 7 }],
})[0].response;
check("recording says nothing reached Xero", /nothing has been sent to Xero yet/i.test(recorded.message));
check("recording returns the exact confirmation phrase", recorded.confirmationRequired === true && recorded.confirmation.phrase === "CONFIRM ABCD1234");
check("recording points at the deterministic next step", /send it as a separate message within five minutes/i.test(recorded.nextStep));
check("recording does not tell the model to call the writer", !/call prepare_green_matches|confirmApply/i.test(recorded.nextStep));

// --- the mailbox query ------------------------------------------------------
const querySrc = codeOf(receipt, "Build Gmail Query");
const query = runCode(querySrc, { input: [{ sourceId: "s", amountText: "42.35", occurredAt: "2026-07-15",
  merchantHint: "UBER *TRIP HELP.UBER.COM", referenceHint: "" }] })[0];
check("the exact amount is quoted in the query", query.queries[0].includes('"42.35"'));
check("card noise is stripped from the merchant", query.merchant === "uber trip", query.merchant);
check("spam and promotions are excluded", /-in:spam/.test(query.queries[0]) && /-category:promotions/.test(query.queries[0]));
check("the search is bounded by date", /after:\d+/.test(query.queries[0]) && /before:\d+/.test(query.queries[0]));
check("there is a fallback query", query.queries.length === 2);
const noMerchant = runCode(querySrc, { input: [{ sourceId: "s", amountText: "", occurredAt: "", merchantHint: "12345", referenceHint: "" }] })[0];
check("nothing searchable means no query", noMerchant.hasQuery === false);

done();
