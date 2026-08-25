// The write lane is the only thing in this skill that changes the user's Xero
// organisation. Every check here exists because the alternative is a wrong or
// duplicated transaction in somebody's books, found months later by an
// accountant. Run with: node tests/write-safety.test.mjs
import { loadWorkflow, codeOf, runCode, makeChecker } from "./_harness.mjs";

const { check, done } = makeChecker("write-safety");
const prepare = loadWorkflow("108-tool-prepare-green-matches.json");
const decide = loadWorkflow("104-tool-record-reconciliation-decision.json");

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const minsAgo = (n) => new Date(NOW - n * 60000).toISOString();
const SOURCE_HASH = "a".repeat(64);

const validateSrc = codeOf(prepare, "Validate Prepare Input");
const selectSrc = codeOf(prepare, "Select Executable Rows");
const catalogueSrc = codeOf(prepare, "Recheck Current Catalogue");
const collectSrc = codeOf(prepare, "Collect Existing");
const readCreateSrc = codeOf(prepare, "Read Create Result");
const evaluateSrc = codeOf(decide, "Evaluate Decisions");
const readReadProbeSrc = codeOf(prepare, "Read Read Probe");
const readCustomOrganisationSrc = codeOf(prepare, "Read Custom Organisation");

// A row that passes every gate, so each test can spoil exactly one thing.
const goodRow = (over = {}) => ({
  suggestionId: "s1", runId: "run-1", sourceType: "statement-line", sourceId: "sl-1",
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
    nodes: { "Pick Latest Run": [{ ids: [row.suggestionId], decision: "accepted", hasRun: true, runId: "run-1" }] },
    input: [row],
  })[0];
  return { ...row, acceptedHash: stamped.acceptedHash ?? "" };
};

// The catalogue recheck supports a read-only Custom Connection but still
// proves that it is the same organisation as the separate write credential.
const standardRead = runCode(readReadProbeSrc, {
  nodes: { "Read Write Probe": [{ tenantId: "org-1", toCreate: [] }] },
  input: [{ statusCode: 200, body: [{ tenantId: "org-1", tenantName: "Acme" }] }],
})[0];
check("standard read context must match the write organisation", standardRead.readReady === true && standardRead.connectionType === "standard");
const customRead = runCode(readCustomOrganisationSrc, {
  nodes: { "Read Write Probe": [{ tenantId: "org-1", toCreate: [] }] },
  input: [{ statusCode: 200, body: { Organisations: [{ OrganisationID: "org-1", Name: "Acme" }] } }],
})[0];
check("Custom Connection catalogue recheck can target the same organisation", customRead.readReady === true && customRead.connectionType === "custom");
const wrongCustomRead = runCode(readCustomOrganisationSrc, {
  nodes: { "Read Write Probe": [{ tenantId: "org-1", toCreate: [] }] },
  input: [{ statusCode: 200, body: { Organisations: [{ OrganisationID: "org-2", Name: "Other" }] } }],
})[0];
check("cross-organisation read/write credentials fail closed", wrongCustomRead.readReady === false && wrongCustomRead.readProblem === "organisation-mismatch");
const catalogueFetches = ["Fetch Current Organisation", "Fetch Current Accounts", "Fetch Current Tax Rates", "Fetch Current Contacts"]
  .map((name) => prepare.nodes.find((entry) => entry.name === name));
check("catalogue calls omit explicit tenant headers for a Custom Connection", catalogueFetches.every((entry) => String(entry.parameters.sendHeaders).includes("connectionType !== 'custom'")));
check("the lock-date check reads Organisation with the read-only credential", catalogueFetches[0].parameters.url.endsWith("/Organisation") && catalogueFetches[0].credentials.oAuth2Api.name === "Xero (read-only)");

const select = (rows, ids = ["s1"], scanOver = {}, lineOver = {}) => runCode(selectSrc, {
  nodes: {
    "Pick Latest Run": [{ ids, runId: "run-1", hasRun: true, greenMatchesCreated: 0 }],
    "Read Accepted Suggestions": rows,
    "Read Current Scans": [{ scanId: "scan-current", bankAccountId: "bank-1", completedAt: minsAgo(2), complete: "yes", blockingReasonsJson: "[]", captureSourceHash: "c".repeat(64), ...scanOver }],
  },
  input: rows.map((row) => ({ statementLineId: row.statementLineId, bankAccountId: row.bankAccountId,
    active: "yes", sourceHash: row.statementSourceHash, uiMode: "blank_create", matchedXeroTransactionId: "", ...lineOver })),
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

// 1 — approval is required, and only a real boolean-ish true counts.
for (const [label, value] of [["missing", undefined], ["false", false], ["empty", ""], ["zero", 0]]) {
  const out = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_B, suggestionIds: "s1", confirmApply: value }] })[0];
  check(`confirmApply ${label} is refused`, out.valid === false && out.response.error.code === "APPROVAL_REQUIRED");
}
const okConfirm = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_B, suggestionIds: "s1", confirmApply: true }] })[0];
check("confirmApply true is accepted", okConfirm.valid === true);
const strConfirm = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_B, suggestionIds: "s1", confirmApply: "true" }] })[0];
check("confirmApply 'true' string is accepted", strConfirm.valid === true);
const tooMany = runCode(validateSrc, { input: [{ sessionId: UUID_A, requestId: UUID_B, suggestionIds: Array.from({ length: 21 }, (_, i) => `s${i}`).join(","), confirmApply: true }] })[0];
check("more than 20 ids is refused", tooMany.response?.error?.code === "TOO_MANY_IDS");

// 2 — a row nobody accepted is never created.
for (const decision of ["", "rejected", "changed"]) {
  const out = select([selfHashed({ userDecision: decision })]);
  check(`userDecision '${decision || "(blank)"}' is refused`, reasonFor(out) === "NOT_ACCEPTED", `got ${reasonFor(out)}`);
}

// 3 — the hash is what makes the earlier yes mean anything.
const consistent = selfHashed();
const clean = select([consistent]);
check("a self-consistent accepted row is executable", clean.anythingToCreate === true && clean.toCreate.length === 1, JSON.stringify(clean.refusals));
const tampered = select([{ ...consistent, suggestedAccountCode: "400" }]);
check("changing the account code after acceptance is refused", reasonFor(tampered) === "CHANGED_SINCE_ACCEPTED", `got ${reasonFor(tampered)}`);
const tamperedAmount = select([{ ...consistent, amount: -99.99 }]);
check("changing the amount after acceptance is refused", reasonFor(tamperedAmount) === "CHANGED_SINCE_ACCEPTED");
const tamperedTax = select([{ ...consistent, suggestedTaxType: "NONE" }]);
check("changing the tax type after acceptance is refused", reasonFor(tamperedTax) === "CHANGED_SINCE_ACCEPTED");
const tamperedDescription = select([{ ...consistent, likelyDescription: "A different description" }]);
check("changing the Xero line description after acceptance is refused", reasonFor(tamperedDescription) === "CHANGED_SINCE_ACCEPTED");
const again = select([consistent]);
check("the hash is deterministic across runs", JSON.stringify(again.toCreate) === JSON.stringify(clean.toCreate));

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
check("a transaction on the period lock date is refused", reasonFor(catalogue(clean, { periodLockDate: "/Date(1784073600000+0000)/" })) === "LOCKED_PERIOD");
check("a transaction before the period lock date is refused", reasonFor(catalogue(clean, { periodLockDate: "2026-07-31" })) === "LOCKED_PERIOD");
check("the later end-of-year lock date also blocks", reasonFor(catalogue(clean, { periodLockDate: "2026-06-30", endOfYearLockDate: "2026-07-31" })) === "LOCKED_PERIOD");
check("a transaction after every lock date remains eligible", catalogue(clean, { periodLockDate: "2026-06-30", endOfYearLockDate: "2026-05-31" }).toCreate.length === 1);
check("an unreadable lock date fails closed", reasonFor(catalogue(clean, { periodLockDate: "not-a-date" })) === "LOCK_DATE_UNREADABLE");

// 8 — a reference already in Xero is adopted, never posted again.
const collected = runCode(collectSrc, {
  nodes: { "Recheck Current Catalogue": [{ ...clean, toCreate: clean.toCreate, tenantId: "t-1" }] },
  input: [{ statusCode: 200, body: { BankTransactions: [{ Reference: payload.Reference, BankTransactionID: "existing-1" }] } }],
})[0];
check("a duplicate reference is skipped", collected.skippedDuplicates.length === 1 && collected.stillToCreate.length === 0);
check("the existing Xero id is adopted", collected.skippedDuplicates[0].xeroBankTransactionId === "existing-1");
check("a skipped row is excluded from the create body", !collected.createBody.includes(payload.Reference));

// 9 — partial failure, and the rule that a non-answer is never treated as a failure.
const secondSourceHash = "b".repeat(64);
const twoRows = select([selfHashed(), selfHashed({ suggestionId: "s2", sourceId: "sl-2", statementLineId: "sl-2", statementSourceHash: secondSourceHash })], ["s1", "s2"]);
check("two eligible rows both queue", twoRows.toCreate.length === 2);
check("different source hashes always produce different deterministic references", new Set(twoRows.toCreate.map((entry) => entry.reference)).size === 2);
const fresh = runCode(collectSrc, {
  nodes: { "Recheck Current Catalogue": [{ ...twoRows, tenantId: "t-1" }] },
  input: [{ statusCode: 200, body: { BankTransactions: [] } }],
})[0];
const partial = runCode(readCreateSrc, {
  nodes: { "Collect Existing": [fresh] },
  input: [{ statusCode: 200, body: { BankTransactions: [
    { BankTransactionID: "new-1" },
    { ValidationErrors: [{ Message: "Account code 429 is archived" }] },
  ] } }],
});
check("the good element is created", partial.some((r) => r.suggestionId === "s1" && r.executionStatus === "created" && r.xeroBankTransactionId === "new-1"));
check("the bad element fails with Xero's own words", partial.some((r) => r.suggestionId === "s2" && r.executionStatus === "failed" && r.error.includes("archived")));

for (const status of [429, 500, 0]) {
  const noAnswer = runCode(readCreateSrc, { nodes: { "Collect Existing": [fresh] }, input: [{ statusCode: status, body: {} }] });
  check(`status ${status} marks every row failed`, noAnswer.length === 2 && noAnswer.every((r) => r.executionStatus === "failed"));
  check(`status ${status} creates nothing`, noAnswer.every((r) => !r.xeroBankTransactionId));
  check(`status ${status} says to check before retrying`, noAnswer.every((r) => /ask me to check again/i.test(r.error)));
}

// 10 — 104 refuses to "accept" a row that has nothing to accept.
const blank = runCode(evaluateSrc, {
  nodes: { "Pick Latest Run": [{ ids: ["s1"], decision: "accepted", hasRun: true, runId: "run-1" }] },
  input: [goodRow({ suggestedAccountCode: "", needsHuman: "yes", resultLane: "likely" })],
})[0];
check("accepting a needs-a-person row is refused", (blank.refused ?? []).some((r) => r.reason === "NOTHING_TO_ACCEPT"));

done();
