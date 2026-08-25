import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestPayload, lineSourceHash, validateCaptureEnvelope } from "../skill/scripts/capture-models.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(here, "fixtures/xero-statement-capture.json"), "utf8"));
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

const full = validateCaptureEnvelope(fixture.full);
check(full.decision.complete, "complete two-page evidence should be usable");
check(full.decision.observed_count === 5, "all unique lines should be counted");
check(full.lines[0].date === "2026-07-14", "visible Xero date text should normalize to ISO");
check(full.lines.map((line) => line.ui_mode).join(",") === "blank_create,create_prefilled,discuss,green_match,unknown", "UI modes should survive validation");

const imported = ingestPayload(full);
check(imported.derived_complete === true, "ingest payload should carry the derived completeness decision");
check(/^[a-f0-9]{64}$/.test(imported.capture_source_hash), "capture source hash should be SHA-256");
check(imported.lines.every((line) => /^[a-f0-9]{64}$/.test(line.source_hash)), "every line should carry a SHA-256 source hash");
check(lineSourceHash({ ...full.lines[0], has_ok_button: true }) === lineSourceHash(full.lines[0]), "OK-button visibility must not alter source identity");
check(lineSourceHash({ ...full.lines[0], narration: "changed" }) !== lineSourceHash(full.lines[0]), "financial source changes must alter the line hash");

const partial = validateCaptureEnvelope(fixture.partial);
check(partial.decision.complete === false, "partial pagination must fail closed");
check(partial.decision.blocking_reasons.some((reason) => reason.includes("pagination")), "partial evidence should name its pagination blocker");
const mismatch = validateCaptureEnvelope(fixture.count_mismatch);
check(mismatch.decision.complete === false, "count mismatch must fail closed");
check(mismatch.decision.blocking_reasons.some((reason) => reason.includes("expected 6")), "count mismatch should be explicit");

const missingExpected = structuredClone(fixture.full);
missingExpected.expected_count = null;
check(validateCaptureEnvelope(missingExpected).decision.complete === false, "missing expected count must fail closed");

const invalidGreen = structuredClone(fixture.full);
invalidGreen.lines[3].matched_xero_transaction_id = "";
assert.throws(() => validateCaptureEnvelope(invalidGreen), /green_match requires/);
checks += 1;

const duplicate = structuredClone(fixture.full);
duplicate.lines[1].statement_line_id = duplicate.lines[0].statement_line_id;
assert.throws(() => validateCaptureEnvelope(duplicate), /must be unique/);
checks += 1;

const extra = structuredClone(fixture.full);
extra.cookie = "should never be accepted";
assert.throws(() => validateCaptureEnvelope(extra), /unsupported field cookie/);
checks += 1;

const impossibleDate = structuredClone(fixture.full);
impossibleDate.lines[0].date = "31 Feb 2026";
assert.throws(() => validateCaptureEnvelope(impossibleDate), /real calendar date/);
checks += 1;

const impossibleAmount = structuredClone(fixture.full);
impossibleAmount.lines[0].amount = "1000000000001";
assert.throws(() => validateCaptureEnvelope(impossibleAmount), /finite positive numeric text/);
checks += 1;

process.stdout.write(`Xero capture model: ${checks} checks passed.\n`);
