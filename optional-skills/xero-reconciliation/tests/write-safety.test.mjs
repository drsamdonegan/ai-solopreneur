// The write lane is the only thing in this skill that changes the user's Xero
// organisation. Every check here exists because the alternative is a wrong or
// duplicated transaction in somebody's books, found months later by an
// accountant. Run with: node tests/write-safety.test.mjs
import { loadWorkflow, codeOf, runCode, makeChecker } from "./_harness.mjs";
import { readFileSync } from "node:fs";

const { check, done } = makeChecker("write-safety");
const prepare = loadWorkflow("108-tool-prepare-green-matches.json");
const decide = loadWorkflow("104-tool-record-reconciliation-decision.json");

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const minsAgo = (n) => new Date(NOW - n * 60000).toISOString();
const SOURCE_HASH = "a".repeat(64);
const HASH_B = "b".repeat(64);

const validateSrc = codeOf(prepare, "Validate Prepare Input");
const validateConsumedSrc = codeOf(prepare, "Validate Consumed Proposal");
const selectSrc = codeOf(prepare, "Select Executable Rows");
const leaseSrc = codeOf(prepare, "Plan Preparation Lease");
const verifyClaimSrc = codeOf(prepare, "Verify Claim Ownership");
const catalogueSrc = codeOf(prepare, "Recheck Current Catalogue");
const buildReferenceSrc = codeOf(prepare, "Build Reference Queries");
const collectSrc = codeOf(prepare, "Collect Existing");
const readCreateSrc = codeOf(prepare, "Read Create Result");
const emitCreateSrc = codeOf(prepare, "Emit Create Requests");
const evaluateSrc = codeOf(decide, "Evaluate Decisions");
const buildProposalSrc = codeOf(decide, "Build Green Match Proposal");
const readWriteProbeSrc = codeOf(prepare, "Read Write Probe");
const readReadProbeSrc = codeOf(prepare, "Read Read Probe");
const readCustomOrganisationSrc = codeOf(prepare, "Read Custom Organisation");

// A row that passes every gate, so each test can spoil exactly one thing.
const goodRow = (over = {}) => ({
  suggestionId: "s1", runId: "run-1", sessionId: UUID_A, captureRunId: "capture-1",
  captureTenantId: "tenant-1", captureOrganisationName: "Acme", sourceType: "statement-line", sourceId: "sl-1",
  statementLineId: "sl-1", scanId: "scan-1", statementSourceHash: SOURCE_HASH,
  bankAccountId: "bank-1", occurredAt: "2026-07-15", amount: -42.35, direction: "outflow",
  currency: "AUD", contactName: "UBER *TRIP", description: "UBER *TRIP HELP.UBER.COM",
  suggestedContact: "Uber", suggestedContactId: "contact-uber", suggestedAccountCode: "429",
  suggestedAccountName: "Travel - National", suggestedTaxType: "INPUT",
  matchedInvoiceId: "", basis: "model-only", needsHuman: "no", resultLane: "ready_to_prepare",
  identityConfidence: 0.97, accountingConfidence: 0.96, confidence: 0.96,
  likelyDescription: "Local business travel", userDecision: "accepted",
  decidedAt: daysAgo(1), executionStatus: "", xeroBankTransactionId: "",
  acceptedHash: "", ...over,
});

// A fixture's acceptedHash has to be the one 104 would actually stamp, so it
// is produced by running 104's own code rather than restating the format here.
// That way a change to the canonical payload breaks this file loudly instead of
// letting both sides drift together.
const selfHashed = (over = {}) => {
  const row = goodRow(over);
  const stamped = runCode(evaluateSrc, {
    nodes: { "Pick Latest Run": [{ ids: [row.suggestionId], decision: "accepted", hasRun: true, runId: "run-1", sessionId: UUID_A }] },
    input: [row],
  })[0];
  return { ...row, acceptedHash: stamped.acceptedHash ?? "" };
};

// The catalogue recheck supports a read-only Custom Connection but still
// proves that it is the same organisation as the separate write credential.
const standardRead = runCode(readReadProbeSrc, {
  nodes: { "Read Write Probe": [{ tenantId: "org-1", captureTenantId: "org-1", captureOrganisationName: "Acme", toCreate: [] }] },
  input: [{ statusCode: 200, body: [{ tenantId: "org-1", tenantName: "Acme" }] }],
})[0];
check("standard read context must match the write organisation", standardRead.readReady === true && standardRead.connectionType === "standard");
const customRead = runCode(readCustomOrganisationSrc, {
  nodes: { "Read Write Probe": [{ tenantId: "org-1", captureTenantId: "org-1", captureOrganisationName: "Acme", toCreate: [] }] },
  input: [{ statusCode: 200, body: { Organisations: [{ OrganisationID: "org-1", Name: "Acme" }] } }],
})[0];
check("Custom Connection catalogue recheck can target the same organisation", customRead.readReady === true && customRead.connectionType === "custom");
const wrongCustomRead = runCode(readCustomOrganisationSrc, {
  nodes: { "Read Write Probe": [{ tenantId: "org-1", captureTenantId: "org-1", captureOrganisationName: "Acme", toCreate: [] }] },
  input: [{ statusCode: 200, body: { Organisations: [{ OrganisationID: "org-2", Name: "Other" }] } }],
})[0];
check("cross-organisation read/write credentials fail closed", wrongCustomRead.readReady === false && wrongCustomRead.readProblem === "organisation-mismatch");
const matchingWrite = runCode(readWriteProbeSrc, {
  nodes: { "Select Executable Rows": [{ captureTenantId: "tenant-1", captureOrganisationName: "Acme", toCreate: [] }] },
  input: [{ statusCode: 200, body: [{ tenantId: "tenant-1", tenantName: "Acme" }] }],
})[0];
check("write credential must expose the captured tenant and organisation", matchingWrite.writeConnected === true && matchingWrite.tenantId === "tenant-1");
const switchedWrite = runCode(readWriteProbeSrc, {
  nodes: { "Select Executable Rows": [{ captureTenantId: "tenant-1", captureOrganisationName: "Acme", toCreate: [] }] },
  input: [{ statusCode: 200, body: [{ tenantId: "tenant-2", tenantName: "Other" }] }],
})[0];
check("a write credential connected to another organisation is refused", switchedWrite.writeConnected === false && switchedWrite.writeState === "organisation_mismatch");
const catalogueFetches = ["Fetch Current Organisation", "Fetch Current Accounts", "Fetch Current Tax Rates", "Fetch Current Contacts"]
  .map((name) => prepare.nodes.find((entry) => entry.name === name));
check("catalogue calls omit explicit tenant headers for a Custom Connection", catalogueFetches.every((entry) => String(entry.parameters.sendHeaders).includes("connectionType !== 'custom'")));
check("the lock-date check reads Organisation with the read-only credential", catalogueFetches[0].parameters.url.endsWith("/Organisation") && catalogueFetches[0].credentials.oAuth2Api.name === "Xero (read-only)");

const select = (rows, ids = ["s1"], scanOver = {}, lineOver = {}) => runCode(selectSrc, {
  nodes: {
    "Pick Latest Run": [{ ids, approvedHashes: Object.fromEntries(rows.map((row) => [row.suggestionId, row.acceptedHash])), confirmedActionId: UUID_B,
      runId: "run-1", sessionId: UUID_A, captureRunId: "capture-1", captureTenantId: "tenant-1", captureOrganisationName: "Acme", hasRun: true, greenMatchesCreated: 0 }],
    "Read Accepted Suggestions": rows,
    "Read Capture Provenance": [{ runId: "capture-1", sessionId: UUID_A, tenantId: "tenant-1", organisationName: "Acme" }],
    "Read Current Scans": [{ scanId: "scan-1", bankAccountId: "bank-1", completedAt: minsAgo(2), complete: "yes", blockingReasonsJson: "[]", captureSourceHash: "c".repeat(64),
      sessionId: UUID_A, captureRunId: "capture-1", captureTenantId: "tenant-1", captureOrganisationName: "Acme", ...scanOver }],
  },
  input: rows.map((row) => ({ statementLineId: row.statementLineId, scanId: row.scanId, bankAccountId: row.bankAccountId,
    active: "yes", sourceHash: row.statementSourceHash, uiMode: "blank_create", matchedXeroTransactionId: "",
    sessionId: UUID_A, captureRunId: "capture-1", captureTenantId: "tenant-1", captureOrganisationName: "Acme", ...lineOver })),
})[0];

const reasonFor = (out, id = "s1") => (out.refusals.find((r) => r.suggestionId === id) ?? {}).reason;
const catalogue = (selected = clean, over = {}) => runCode(catalogueSrc, { nodes: {
  "Read Write Probe": [{ ...selected, tenantId: "tenant-1" }],
  "Fetch Current Organisation": [{ statusCode: over.organisationStatus ?? 200, body: { Organisations: over.organisations ?? [{
    OrganisationID: "tenant-1", Name: "Acme", OrganisationStatus: "ACTIVE",
    ...(over.periodLockDate === undefined ? {} : { PeriodLockDate: over.periodLockDate }),
    ...(over.endOfYearLockDate === undefined ? {} : { EndOfYearLockDate: over.endOfYearLockDate }),
  }] } }],
  "Fetch Current Accounts": [{ statusCode: over.accountStatus ?? 200, body: { Accounts: over.accounts ?? [
    { AccountID: "bank-1", Code: "090", Name: "Business Account", Type: "BANK", Status: "ACTIVE" },
    { AccountID: "expense-429", Code: "429", Name: "Travel - National", Type: "EXPENSE", Status: "ACTIVE" },
  ] } }],
  "Fetch Current Tax Rates": [{ statusCode: over.taxStatus ?? 200, body: { TaxRates: over.taxRates ?? [
    { TaxType: "INPUT", Status: "ACTIVE" },
  ] } }],
  "Fetch Current Contacts": [{ statusCode: over.contactStatus ?? 200, body: { Contacts: over.contacts ?? [
    { ContactID: "contact-uber", Name: "Uber", ContactStatus: "ACTIVE" },
  ] } }],
}, input: [{}] })[0];

// 1 — the worker accepts only a consumed exact-confirmation action, never AI-supplied ids or booleans.
const missingAction = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_B }] })[0];
check("a missing confirmed action is refused", missingAction.valid === false && missingAction.response.error.code === "INVALID_CONFIRMED_ACTION");
const mismatchedAction = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_A, confirmedActionId: UUID_B }] })[0];
check("request and consumed action must be identical", mismatchedAction.valid === false && mismatchedAction.response.error.code === "CONFIRMED_ACTION_MISMATCH");
const validAction = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_B, confirmedActionId: UUID_B, suggestionIds: "injected", confirmApply: true }] })[0];
check("the strict internal action input is accepted", validAction.valid === true && !("ids" in validAction) && !("confirmApply" in validAction));

const consumedProposal = {
  schemaVersion: 1, sessionId: UUID_A, runId: "run-1",
  captureRunId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  captureTenantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  captureOrganisationName: "Acme",
  suggestions: [{ suggestionId: "s1", acceptedHash: SOURCE_HASH }],
};
const validateConsumed = (proposal = consumedProposal, over = {}) => runCode(validateConsumedSrc, {
  nodes: { "Validate Prepare Input": [validAction] },
  input: [{ id: 1, actionId: UUID_B, sessionId: UUID_A, actionType: "prepare_green_matches", status: "consumed",
    consumedAt: minsAgo(1), proposedInput: JSON.stringify(proposal), ...over }],
})[0];
check("one recent consumed proposal unlocks the worker", validateConsumed().valid === true && validateConsumed().approvedHashes.s1 === SOURCE_HASH);
check("an absent consumed proposal is refused", runCode(validateConsumedSrc, { nodes: { "Validate Prepare Input": [validAction] }, input: [{}] })[0].response.error.code === "CONSUMED_PROPOSAL_REQUIRED");
check("a stale consumed proposal is refused", validateConsumed(consumedProposal, { consumedAt: minsAgo(11) }).response.error.code === "CONSUMED_PROPOSAL_STALE");
check("unsorted proposal tuples are refused", validateConsumed({ ...consumedProposal, suggestions: [
  { suggestionId: "s2", acceptedHash: HASH_B }, { suggestionId: "s1", acceptedHash: SOURCE_HASH },
] }).response.error.code === "INVALID_STORED_PROPOSAL");
check("a cross-session proposal is refused", validateConsumed({ ...consumedProposal, sessionId: UUID_B }).response.error.code === "INVALID_STORED_PROPOSAL");

// 2 — a row nobody accepted is never created.
for (const decision of ["", "rejected", "changed"]) {
  const out = select([selfHashed({ userDecision: decision })]);
  check(`userDecision '${decision || "(blank)"}' is refused`, reasonFor(out) === "NOT_ACCEPTED", `got ${reasonFor(out)}`);
}

// 3 — the hash is what makes the earlier yes mean anything.
const consistent = selfHashed();
const clean = select([consistent]);
check("a self-consistent accepted row is executable", clean.anythingToCreate === true && clean.toCreate.length === 1, JSON.stringify(clean.refusals));
check("a suggestion from another conversation is refused", reasonFor(select([{ ...consistent, sessionId: UUID_B }])) === "STALE_RUN");
check("a suggestion with switched capture provenance is refused", reasonFor(select([{ ...consistent, captureTenantId: "tenant-2" }])) === "PROVENANCE_MISMATCH");
const tampered = select([{ ...consistent, suggestedAccountCode: "400" }]);
check("changing the account code after acceptance is refused", reasonFor(tampered) === "CONFIRMATION_MISMATCH", `got ${reasonFor(tampered)}`);
const tamperedAmount = select([{ ...consistent, amount: -99.99 }]);
check("changing the amount after acceptance is refused", reasonFor(tamperedAmount) === "CONFIRMATION_MISMATCH");
const tamperedTax = select([{ ...consistent, suggestedTaxType: "NONE" }]);
check("changing the tax type after acceptance is refused", reasonFor(tamperedTax) === "CONFIRMATION_MISMATCH");
const tamperedDescription = select([{ ...consistent, likelyDescription: "A different description" }]);
check("changing the Xero line description after acceptance is refused", reasonFor(tamperedDescription) === "CONFIRMATION_MISMATCH");
const again = select([consistent]);
check("the hash is deterministic across runs", JSON.stringify(again.toCreate) === JSON.stringify(clean.toCreate));

const planLease = (row, selected = clean) => runCode(leaseSrc, {
  nodes: { "Enforce Live Duplicate Safety": [selected], "Read Accepted Suggestions": [row] },
  input: [{}],
})[0];
const freshLeaseRow = { ...consistent, executionStatus: `preparing:${UUID_B}`, executedAt: minsAgo(1), executionError: "lease-existing" };
const freshLease = planLease(freshLeaseRow);
check("a fresh lease for the same exact action is not stolen", freshLease.toCreate.length === 0 && reasonFor(freshLease) === "PREPARATION_IN_PROGRESS");
const staleLeaseRow = { ...consistent, executionStatus: `preparing:${UUID_B}`, executedAt: minsAgo(3), executionError: "lease-crashed" };
const recoveredLease = planLease(staleLeaseRow);
check("the same exact action can recover a stale preparation lease", recoveredLease.toCreate.length === 1
  && recoveredLease.toCreate[0].recoveringClaim === true && recoveredLease.toCreate[0].claimRecoveryCount === 1);
check("lease recovery compare-and-sets the exact crashed owner state", recoveredLease.toCreate[0].previousExecutionStatus === `preparing:${UUID_B}`
  && recoveredLease.toCreate[0].previousExecutedAt === staleLeaseRow.executedAt
  && recoveredLease.toCreate[0].previousExecutionError === "lease-crashed"
  && recoveredLease.claimLeaseToken !== "lease-crashed");
const initialLease = planLease(consistent);
check("a new preparation gets a timestamped unique lease token", initialLease.toCreate.length === 1
  && initialLease.toCreate[0].recoveringClaim === false
  && /^lease-/.test(initialLease.claimLeaseToken)
  && Number.isFinite(Date.parse(initialLease.claimLeaseAt)));
const emittedRecovery = { ...recoveredLease, ...recoveredLease.toCreate[0] };
const ownedRecovery = runCode(verifyClaimSrc, {
  nodes: { "Plan Preparation Lease": [recoveredLease], "Emit Claim Rows": [emittedRecovery] },
  input: [{ id: 1, suggestionId: "s1", executionStatus: recoveredLease.claimStatus,
    executedAt: recoveredLease.claimLeaseAt, executionError: recoveredLease.claimLeaseToken }],
})[0];
check("recovery proceeds only after exact lease ownership is returned", ownedRecovery.toCreate.length === 1 && ownedRecovery.refusals.length === 0);
const lostRecovery = runCode(verifyClaimSrc, {
  nodes: { "Plan Preparation Lease": [recoveredLease], "Emit Claim Rows": [emittedRecovery] },
  input: [{ id: 1, suggestionId: "s1", executionStatus: recoveredLease.claimStatus,
    executedAt: recoveredLease.claimLeaseAt, executionError: "lease-someone-else" }],
})[0];
check("a mismatched lease token loses ownership before any Xero lookup or write", lostRecovery.toCreate.length === 0 && reasonFor(lostRecovery) === "PREPARATION_CLAIM_LOST");

// 4 — single use.
check("an already-created row is refused", reasonFor(select([selfHashed({ executionStatus: "created" })])) === "ALREADY_CREATED");
check("a row carrying a Xero id is refused", reasonFor(select([selfHashed({ xeroBankTransactionId: "x-1" })])) === "ALREADY_CREATED");

// 5 — acceptance expires, and a replaced review is not actionable.
check("an acceptance 8 days old is refused", reasonFor(select([selfHashed({ decidedAt: daysAgo(8) })])) === "APPROVAL_EXPIRED");
check("an acceptance 6 days old still works", select([selfHashed({ decidedAt: daysAgo(6) })]).toCreate.length === 1);
check("an id absent from the latest run is refused", reasonFor(select([selfHashed()], ["s-other"]), "s-other") === "STALE_RUN");

// 6 — classes that must never be auto-created.
check("an invoice match is refused", reasonFor(select([selfHashed({ matchedInvoiceId: "inv-9" })])) === "MATCH_IN_XERO");
check("an existing bank transaction is refused", reasonFor(select([selfHashed({ sourceType: "bank-transaction" })])) === "MATCH_IN_XERO");
check("a needs-a-person row is refused", reasonFor(select([selfHashed({ needsHuman: "yes", resultLane: "likely" })])) === "NOT_HIGH_CERTAINTY");
check("a row with no account code is refused", reasonFor(select([selfHashed({ suggestedAccountCode: "" })])) === "CATALOGUE_REQUIRED");
check("a row with no existing ContactID is refused", reasonFor(select([selfHashed({ suggestedContactId: "" })])) === "CONTACT_ID_REQUIRED");
check("a stale capture is refused", reasonFor(select([selfHashed()], ["s1"], { completedAt: minsAgo(31) })) === "CAPTURE_NOT_FRESH");
check("an incomplete capture is refused", reasonFor(select([selfHashed()], ["s1"], { complete: "no" })) === "CAPTURE_NOT_FRESH");
check("a malformed aggregate capture hash is refused", reasonFor(select([selfHashed()], ["s1"], { captureSourceHash: "bad" })) === "CAPTURE_HASH_MISSING");
check("a changed statement hash is refused", reasonFor(select([selfHashed()], ["s1"], {}, { sourceHash: "b".repeat(64) })) === "SOURCE_CHANGED");
check("a new Xero match state is refused", reasonFor(select([selfHashed()], ["s1"], {}, { uiMode: "green_match", matchedXeroTransactionId: "bt-1" })) === "XERO_STATE_CHANGED");

// 7 — payload construction.
const payload = clean.toCreate[0].payload;
check("outflow becomes SPEND", payload.Type === "SPEND");
check("amount is absolute, to the cent", payload.LineItems[0].UnitAmount === 42.35);
check("bank amounts are GST inclusive", payload.LineAmountTypes === "Inclusive");
check("reference is derived from the source hash", payload.Reference === `AI-${SOURCE_HASH.slice(0, 24)}`);
check("contact always goes by existing ContactID", payload.Contact.ContactID === "contact-uber" && !payload.Contact.Name);
const withId = select([selfHashed({ suggestedContactId: "c-1" })]);
check("another existing contact goes by id", withId.toCreate[0].payload.Contact.ContactID === "c-1" && !withId.toCreate[0].payload.Contact.Name);
const inflow = select([selfHashed({ direction: "inflow", amount: 120 })]);
check("inflow becomes RECEIVE", inflow.toCreate[0].payload.Type === "RECEIVE");

// The exact Xero catalogue and existing contact are re-read after approval and before create.
const currentCatalogue = catalogue();
check("current catalogue recheck preserves an unchanged item", currentCatalogue.anythingToCreate === true && currentCatalogue.toCreate.length === 1);
check("current account name change refuses the item", reasonFor(catalogue(clean, { accounts: [
  { AccountID: "bank-1", Code: "090", Name: "Business Account", Type: "BANK", Status: "ACTIVE" },
  { AccountID: "expense-429", Code: "429", Name: "Renamed Travel", Type: "EXPENSE", Status: "ACTIVE" },
] })) === "ACCOUNT_CHANGED");
check("archived tax type refuses the item", reasonFor(catalogue(clean, { taxRates: [{ TaxType: "INPUT", Status: "DELETED" }] })) === "TAX_CHANGED");
check("missing current ContactID refuses the item", reasonFor(catalogue(clean, { contacts: [] })) === "CONTACT_CHANGED");
check("archived bank account refuses the item", reasonFor(catalogue(clean, { accounts: [
  { AccountID: "bank-1", Code: "090", Name: "Business Account", Type: "BANK", Status: "ARCHIVED" },
  { AccountID: "expense-429", Code: "429", Name: "Travel - National", Type: "EXPENSE", Status: "ACTIVE" },
] })) === "BANK_ACCOUNT_CHANGED");
check("unavailable current catalogue refuses closed", reasonFor(catalogue(clean, { accountStatus: 503 })) === "CURRENT_CATALOGUE_UNAVAILABLE");
check("unavailable organisation details refuse closed", reasonFor(catalogue(clean, { organisationStatus: 503 })) === "CURRENT_CATALOGUE_UNAVAILABLE");
check("an inactive organisation refuses the item", reasonFor(catalogue(clean, { organisations: [{ OrganisationID: "tenant-1", OrganisationStatus: "SUSPENDED" }] })) === "ORGANISATION_UNAVAILABLE");
check("switching the live organisation after approval refuses the item", reasonFor(catalogue(clean, { organisations: [{ OrganisationID: "tenant-2", Name: "Other", OrganisationStatus: "ACTIVE" }] })) === "CURRENT_ORGANISATION_MISMATCH");
check("a transaction on the period lock date is refused", reasonFor(catalogue(clean, { periodLockDate: "/Date(1784073600000+0000)/" })) === "LOCKED_PERIOD");
check("a transaction before the period lock date is refused", reasonFor(catalogue(clean, { periodLockDate: "2026-07-31" })) === "LOCKED_PERIOD");
check("the later end-of-year lock date also blocks", reasonFor(catalogue(clean, { periodLockDate: "2026-06-30", endOfYearLockDate: "2026-07-31" })) === "LOCKED_PERIOD");
check("a transaction after every lock date remains eligible", catalogue(clean, { periodLockDate: "2026-06-30", endOfYearLockDate: "2026-05-31" }).toCreate.length === 1);
check("an unreadable lock date fails closed", reasonFor(catalogue(clean, { periodLockDate: "not-a-date" })) === "LOCK_DATE_UNREADABLE");

// 8 — a reference already in Xero is adopted, never posted again.
const claimedClean = { ...clean, claimStatus: `preparing:${UUID_B}`, toCreate: clean.toCreate };
const referenceQuery = runCode(buildReferenceSrc, { nodes: { "Verify Claim Ownership": [claimedClean] }, input: [claimedClean] })[0];
check("reference builder drives the exact Xero where expression", referenceQuery.where === `Reference=="${payload.Reference}"`
  && referenceQuery.lookupUrl.includes(encodeURIComponent(referenceQuery.where)));
const collected = runCode(collectSrc, {
  nodes: { "Verify Claim Ownership": [claimedClean], "Build Reference Queries": [{ suggestionId: "s1" }] },
  input: [{ statusCode: 200, body: { BankTransactions: [{ Reference: payload.Reference, BankTransactionID: "existing-1" }] } }],
})[0];
check("a duplicate reference is skipped", collected.skippedDuplicates.length === 1 && collected.stillToCreate.length === 0);
check("the existing Xero id is adopted", collected.skippedDuplicates[0].xeroBankTransactionId === "existing-1");
check("a skipped row is excluded from create requests", collected.anyLeft === false);
const lookupUnavailable = runCode(collectSrc, {
  nodes: { "Verify Claim Ownership": [claimedClean], "Build Reference Queries": [{ suggestionId: "s1" }] },
  input: [{ statusCode: 503, body: {} }],
})[0];
check("an unavailable deterministic lookup fails closed", lookupUnavailable.stillToCreate.length === 0 && lookupUnavailable.preflightFailed.length === 1);

// 9 — partial failure, and the rule that a non-answer is never treated as a failure.
const secondSourceHash = "b".repeat(64);
const twoRows = select([selfHashed(), selfHashed({ suggestionId: "s2", sourceId: "sl-2", statementLineId: "sl-2", statementSourceHash: secondSourceHash })], ["s1", "s2"]);
check("two eligible rows both queue", twoRows.toCreate.length === 2);
check("different source hashes always produce different deterministic references", new Set(twoRows.toCreate.map((entry) => entry.reference)).size === 2);
const fresh = runCode(collectSrc, {
  nodes: { "Verify Claim Ownership": [{ ...twoRows, claimStatus: `preparing:${UUID_B}` }],
    "Build Reference Queries": [{ suggestionId: "s1" }, { suggestionId: "s2" }] },
  input: [{ statusCode: 200, body: { BankTransactions: [] } }, { statusCode: 200, body: { BankTransactions: [] } }],
})[0];
const createRequests = runCode(emitCreateSrc, { nodes: { "Collect Existing": [fresh] }, input: [fresh] });
check("one Xero request is emitted per BankTransaction", createRequests.length === 2 && createRequests.every((entry) => JSON.parse(entry.createBody).BankTransactions.length === 1));
check("every Xero idempotency key is stable and within 128 characters", createRequests.every((entry) => entry.idempotencyKey.length <= 128 && entry.idempotencyKey.includes(entry.statementSourceHash)));
const partial = runCode(readCreateSrc, {
  nodes: { "Collect Existing": [fresh], "Emit Create Requests": createRequests },
  input: [
    { statusCode: 200, body: { BankTransactions: [{ BankTransactionID: "new-1" }] } },
    { statusCode: 200, body: { BankTransactions: [{ ValidationErrors: [{ Message: "Account code 429 is archived" }] }] } },
  ],
});
check("the good element is created", partial.some((r) => r.suggestionId === "s1" && r.executionStatus === "created" && r.xeroBankTransactionId === "new-1"));
check("the bad element fails with Xero's own words", partial.some((r) => r.suggestionId === "s2" && r.executionStatus === "failed" && r.error.includes("archived")));

for (const status of [429, 500, 0]) {
  const noAnswer = runCode(readCreateSrc, { nodes: { "Collect Existing": [fresh], "Emit Create Requests": createRequests },
    input: createRequests.map(() => ({ statusCode: status, body: {} })) });
  check(`status ${status} marks every row failed`, noAnswer.length === 2 && noAnswer.every((r) => r.executionStatus === "failed"));
  check(`status ${status} creates nothing`, noAnswer.every((r) => !r.xeroBankTransactionId));
  check(`status ${status} says a fresh attempt checks first`, noAnswer.every((r) => /fresh confirmed attempt.*deterministic reference/i.test(r.error)));
}

// 10 — accepted decisions bind exact hashes and provenance into a five-minute proposal.
const boundProposal = runCode(buildProposalSrc, {
  nodes: { "Evaluate Decisions": [{
    decision: "accepted", sessionId: UUID_A, runId: "run-1",
    captureRunId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    captureTenantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    captureOrganisationName: "Acme", nothingToRecord: false, refused: [],
    recorded: [
      { suggestionId: "s2", acceptedHash: HASH_B, line: "L2" },
      { suggestionId: "s1", acceptedHash: SOURCE_HASH, line: "L1" },
    ],
  }] },
  input: [{ id: 2, suggestionId: "s2" }, { id: 1, suggestionId: "s1" }],
})[0];
check("accepted proposal is exact-confirmation ready", boundProposal.proposalReady === true && /^CONFIRM [A-F0-9]{8}$/.test(boundProposal.confirmationText));
check("proposal tuples are sorted and hash-bound", JSON.stringify(boundProposal.proposedInput.suggestions) === JSON.stringify([
  { suggestionId: "s1", acceptedHash: SOURCE_HASH }, { suggestionId: "s2", acceptedHash: HASH_B },
]));
check("proposal binds session, run, capture tenant, and organisation", boundProposal.proposedInput.sessionId === UUID_A
  && boundProposal.proposedInput.runId === "run-1" && boundProposal.proposedInput.captureOrganisationName === "Acme");
check("proposal expires in about five minutes", Date.parse(boundProposal.expiresAt) - Date.now() > 290000
  && Date.parse(boundProposal.expiresAt) - Date.now() <= 300000);

// 11 — structural wiring keeps the write worker outside the model and behind consume-once + CAS.
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const main = JSON.parse(readFileSync(new URL("../../../n8n/workflows/00-start-here-project-partner.json", import.meta.url), "utf8"));
const confirmation = JSON.parse(readFileSync(new URL("../../../n8n/workflows/40-confirm-task-write.json", import.meta.url), "utf8"));
const policy = JSON.parse(readFileSync(new URL("../../../tools/policy.json", import.meta.url), "utf8"));
const installedPrepare = JSON.parse(readFileSync(new URL("../../../n8n/workflows/108-tool-prepare-green-matches.json", import.meta.url), "utf8"));
check("prepare_green_matches is absent from installed AI tools", !manifest.agentTools.some((tool) => tool.name === "prepare_green_matches")
  && !main.nodes.some((node) => node.name === "prepare_green_matches") && !("prepare_green_matches" in main.connections));
const preparePolicy = manifest.policyEntries.find((entry) => entry.id === "prepare_green_matches");
check("manifest marks the worker internal-confirmed only", preparePolicy?.modelCallable === false && preparePolicy?.mode === "internal_confirmed_only");
const globalPreparePolicy = policy.tools.find((entry) => entry.id === "prepare_green_matches");
check("global policy marks the worker internal-confirmed only", globalPreparePolicy?.modelCallable === false && globalPreparePolicy?.mode === "internal_confirmed_only");
check("confirmation workflow dispatches the internal worker only after single-use verification", confirmation.nodes.some((node) => node.name === "Execute Confirmed Green Matches")
  && confirmation.connections["Proposal Was Consumed?"].main[0][0].node === "Create Task Action?"
  && confirmation.connections["Prepare Green Matches Action?"].main[0][0].node === "Execute Confirmed Green Matches");
const triggerNames = prepare.nodes.find((node) => node.name === "Tool Input").parameters.workflowInputs.values.map((entry) => entry.name);
check("internal worker trigger has only strict confirmation identifiers", JSON.stringify(triggerNames) === JSON.stringify(["sessionId", "requestId", "confirmedActionId"]));
const claimNode = prepare.nodes.find((node) => node.name === "Claim Suggestion Rows");
const claimKeys = claimNode.parameters.filters.conditions.map((condition) => condition.keyName);
check("each pre-write claim compare-and-sets the accepted hash and full prior lease state", ["acceptedHash", "executionStatus", "executedAt", "executionError", "userDecision"].every((key) => claimKeys.includes(key)));
check("the atomic claim stores its exact lease timestamp and token", claimNode.parameters.columns.value.executedAt.includes("claimLeaseAt")
  && claimNode.parameters.columns.value.executionError.includes("claimLeaseToken"));
const persistNode = prepare.nodes.find((node) => node.name === "Persist Outcomes");
const persistFilters = persistNode.parameters.filters.conditions;
check("only the exact current lease owner can persist an outcome", ["executionStatus", "executedAt", "executionError"].every((key) => persistFilters.some((condition) => condition.keyName === key))
  && persistFilters.some((condition) => condition.keyName === "executionStatus" && String(condition.keyValue).includes("claimStatus"))
  && persistFilters.some((condition) => condition.keyName === "executedAt" && String(condition.keyValue).includes("claimLeaseAt"))
  && persistFilters.some((condition) => condition.keyName === "executionError" && String(condition.keyValue).includes("claimLeaseToken")));
check("lease planning sits after live duplicate checks and before the atomic claim", prepare.connections["Enforce Live Duplicate Safety"].main[0][0].node === "Plan Preparation Lease"
  && prepare.connections["Plan Preparation Lease"].main[0][0].node === "Anything After Duplicate Check?"
  && prepare.connections["Anything After Duplicate Check?"].main[0][0].node === "Emit Claim Rows");
check("every owned or recovered claim reruns deterministic Xero reference recovery before create", prepare.connections["Anything Claimed?"].main[0][0].node === "Build Reference Queries");
const installedClaim = installedPrepare.nodes.find((node) => node.name === "Claim Suggestion Rows");
const installedPersist = installedPrepare.nodes.find((node) => node.name === "Persist Outcomes");
check("the installed workflow carries the same lease/recovery contract", installedPrepare.nodes.some((node) => node.name === "Plan Preparation Lease")
  && JSON.stringify(installedClaim.parameters.filters.conditions) === JSON.stringify(claimNode.parameters.filters.conditions)
  && JSON.stringify(installedPersist.parameters.filters.conditions) === JSON.stringify(persistNode.parameters.filters.conditions)
  && installedPrepare.connections["Anything Claimed?"].main[0][0].node === "Build Reference Queries");
const createNode = prepare.nodes.find((node) => node.name === "Create Bank Transactions");
check("Xero create sends the bounded idempotency key", createNode.parameters.headerParameters.parameters.some((header) => header.name === "Idempotency-Key"));
for (const name of ["Read Recent Runs", "Read Accepted Suggestions", "Read Capture Provenance", "Read Current Scans", "Read Current Statement Lines", "Read Consumed Proposal"]) {
  check(`${name} fails forward on zero rows`, prepare.nodes.find((node) => node.name === name)?.alwaysOutputData === true);
}
check("108 reads only provenance-bound v2 scan and line tables", ["Read Current Scans", "Read Current Statement Lines"].every((name) => {
  const node = prepare.nodes.find((entry) => entry.name === name);
  const keys = node.parameters.filters.conditions.map((condition) => condition.keyName);
  return String(node.parameters.dataTableId.value).endsWith("_v2") && keys.includes("sessionId") && keys.includes("captureRunId") && node.parameters.limit <= 5000;
}));

// 12 — 104 refuses to "accept" a row that has nothing to accept.
const blank = runCode(evaluateSrc, {
  nodes: { "Pick Latest Run": [{ ids: ["s1"], decision: "accepted", hasRun: true, runId: "run-1", sessionId: UUID_A }] },
  input: [goodRow({ suggestedAccountCode: "", needsHuman: "yes", resultLane: "likely" })],
})[0];
check("accepting a needs-a-person row is refused", (blank.refused ?? []).some((r) => r.reason === "NOTHING_TO_ACCEPT"));

done();
