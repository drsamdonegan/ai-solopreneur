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

const validateSrc = codeOf(prepare, "Validate Prepare Input");
const selectSrc = codeOf(prepare, "Select Executable Rows");
const collectSrc = codeOf(prepare, "Collect Existing");
const readCreateSrc = codeOf(prepare, "Read Create Result");
const evaluateSrc = codeOf(decide, "Evaluate Decisions");

// A row that passes every gate, so each test can spoil exactly one thing.
const goodRow = (over = {}) => ({
  suggestionId: "s1", runId: "run-1", sourceType: "statement-line", sourceId: "sl-1",
  bankAccountId: "bank-1", occurredAt: "2026-07-15", amount: -42.35, direction: "outflow",
  currency: "AUD", contactName: "UBER *TRIP", description: "UBER *TRIP HELP.UBER.COM",
  suggestedContact: "Uber", suggestedContactId: "", suggestedAccountCode: "429",
  suggestedAccountName: "Travel - National", suggestedTaxType: "INPUT",
  matchedInvoiceId: "", needsHuman: "no", userDecision: "accepted",
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

const select = (rows, ids = ["s1"]) => runCode(selectSrc, {
  nodes: { "Pick Latest Run": [{ ids, runId: "run-1", hasRun: true, greenMatchesCreated: 0 }] },
  input: rows,
})[0];

const reasonFor = (out, id = "s1") => (out.refusals.find((r) => r.suggestionId === id) ?? {}).reason;

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
check("an existing bank transaction is refused", reasonFor(select([selfHashed({ sourceType: "bank-transaction" })])) === "ALREADY_IN_XERO");
check("a needs-a-person row is refused", reasonFor(select([selfHashed({ needsHuman: "yes" })])) === "NEEDS_A_PERSON");
check("a row with no account code is refused", reasonFor(select([selfHashed({ suggestedAccountCode: "" })])) === "INCOMPLETE");

// 7 — payload construction.
const payload = clean.toCreate[0].payload;
check("outflow becomes SPEND", payload.Type === "SPEND");
check("amount is absolute, to the cent", payload.LineItems[0].UnitAmount === 42.35);
check("bank amounts are GST inclusive", payload.LineAmountTypes === "Inclusive");
check("reference is derived from the source id", payload.Reference === "AI-sl-1");
check("an unmatched contact goes by name", payload.Contact.Name === "Uber" && !payload.Contact.ContactID);
const withId = select([selfHashed({ suggestedContactId: "c-1" })]);
check("a matched contact goes by id", withId.toCreate[0].payload.Contact.ContactID === "c-1" && !withId.toCreate[0].payload.Contact.Name);
const inflow = select([selfHashed({ direction: "inflow", amount: 120 })]);
check("inflow becomes RECEIVE", inflow.toCreate[0].payload.Type === "RECEIVE");

// 8 — a reference already in Xero is adopted, never posted again.
const collected = runCode(collectSrc, {
  nodes: { "Read Write Probe": [{ ...clean, toCreate: clean.toCreate, tenantId: "t-1" }] },
  input: [{ statusCode: 200, body: { BankTransactions: [{ Reference: "AI-sl-1", BankTransactionID: "existing-1" }] } }],
})[0];
check("a duplicate reference is skipped", collected.skippedDuplicates.length === 1 && collected.stillToCreate.length === 0);
check("the existing Xero id is adopted", collected.skippedDuplicates[0].xeroBankTransactionId === "existing-1");
check("a skipped row is excluded from the create body", !collected.createBody.includes("AI-sl-1"));

// 9 — partial failure, and the rule that a non-answer is never treated as a failure.
const twoRows = select([selfHashed(), selfHashed({ suggestionId: "s2", sourceId: "sl-2" })], ["s1", "s2"]);
check("two eligible rows both queue", twoRows.toCreate.length === 2);
const fresh = runCode(collectSrc, {
  nodes: { "Read Write Probe": [{ ...twoRows, tenantId: "t-1" }] },
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
  input: [goodRow({ suggestedAccountCode: "", needsHuman: "yes" })],
})[0];
check("accepting a needs-a-person row is refused", (blank.refused ?? []).some((r) => r.reason === "NOTHING_TO_ACCEPT"));

done();
