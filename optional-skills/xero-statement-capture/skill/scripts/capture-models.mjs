import { createHash } from "node:crypto";

const UI_MODES = new Set(["blank_create", "create_prefilled", "discuss", "green_match", "unknown"]);
const DIRECTIONS = new Set(["debit", "credit"]);
const ENVELOPE_KEYS = new Set([
  "schema_version", "scan_id", "bank_account_id", "started_at", "completed_at",
  "expected_count", "pages", "lines", "capture_error",
]);
const PAGE_KEYS = new Set(["page_number", "page_count", "observed_count", "has_previous", "has_next"]);
const LINE_KEYS = new Set([
  "statement_line_id", "date", "narration", "reference", "direction", "amount", "currency",
  "contact", "account", "description", "tax_type", "event_name", "project_name", "ui_mode",
  "matched_xero_transaction_id", "has_ok_button", "parse_warnings",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unsupported field ${key}`);
}

function text(value, label, maximum, { required = false } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new Error(`${label} must not be blank`);
  if (cleaned.length > maximum) throw new Error(`${label} is too long`);
  return cleaned;
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function timestamp(value, label) {
  const cleaned = text(value, label, 64, { required: true });
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(cleaned) || !Number.isFinite(Date.parse(cleaned))) {
    throw new Error(`${label} must be an ISO timestamp with a timezone`);
  }
  return cleaned;
}

function calendarDate(value, label) {
  const cleaned = text(value, label, 64, { required: true });
  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(cleaned);
  if (match) [, year, month, day] = match;
  if (!match) {
    match = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(cleaned);
    if (match) {
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const index = months.indexOf(match[2].slice(0, 3).toLowerCase());
      if (index !== -1) {
        day = match[1];
        month = String(index + 1);
        year = match[3];
      }
    }
  }
  if (!year) {
    match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(cleaned);
    if (match) [, day, month, year] = match;
  }
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    throw new Error(`${label} must be a real calendar date`);
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parsePage(raw, index) {
  const value = object(raw, `pages[${index}]`);
  exactKeys(value, PAGE_KEYS, `pages[${index}]`);
  return {
    page_number: integer(value.page_number, `pages[${index}].page_number`, 1),
    page_count: integer(value.page_count, `pages[${index}].page_count`, 1),
    observed_count: integer(value.observed_count, `pages[${index}].observed_count`),
    has_previous: boolean(value.has_previous, `pages[${index}].has_previous`),
    has_next: boolean(value.has_next, `pages[${index}].has_next`),
  };
}

function parseLine(raw, index) {
  const value = object(raw, `lines[${index}]`);
  exactKeys(value, LINE_KEYS, `lines[${index}]`);
  const amount = text(value.amount, `lines[${index}].amount`, 64, { required: true }).replaceAll(",", "").replace(/^\$/, "");
  const numericAmount = Number(amount);
  if (!/^\d+(?:\.\d+)?$/.test(amount) || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1e12) throw new Error(`lines[${index}].amount must be finite positive numeric text`);
  const direction = text(value.direction, `lines[${index}].direction`, 8, { required: true }).toLowerCase();
  if (!DIRECTIONS.has(direction)) throw new Error(`lines[${index}].direction is unsupported`);
  const currency = text(value.currency ?? "AUD", `lines[${index}].currency`, 3, { required: true }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`lines[${index}].currency must be a three-letter code`);
  const uiMode = text(value.ui_mode ?? "unknown", `lines[${index}].ui_mode`, 32, { required: true });
  if (!UI_MODES.has(uiMode)) throw new Error(`lines[${index}].ui_mode is unsupported`);
  const matched = text(value.matched_xero_transaction_id, `lines[${index}].matched_xero_transaction_id`, 255);
  if (uiMode === "green_match" && !matched) throw new Error("green_match requires a visible existing Xero transaction ID");
  const warnings = value.parse_warnings ?? [];
  if (!Array.isArray(warnings) || warnings.length > 20) throw new Error(`lines[${index}].parse_warnings is invalid`);
  return {
    statement_line_id: text(value.statement_line_id, `lines[${index}].statement_line_id`, 255, { required: true }),
    date: calendarDate(value.date, `lines[${index}].date`),
    narration: text(value.narration, `lines[${index}].narration`, 4000),
    reference: text(value.reference, `lines[${index}].reference`, 500),
    direction,
    amount,
    currency,
    contact: text(value.contact, `lines[${index}].contact`, 255),
    account: text(value.account, `lines[${index}].account`, 255),
    description: text(value.description, `lines[${index}].description`, 4000),
    tax_type: text(value.tax_type, `lines[${index}].tax_type`, 255),
    event_name: text(value.event_name, `lines[${index}].event_name`, 255),
    project_name: text(value.project_name, `lines[${index}].project_name`, 255),
    ui_mode: uiMode,
    matched_xero_transaction_id: matched,
    has_ok_button: value.has_ok_button === undefined ? false : boolean(value.has_ok_button, `lines[${index}].has_ok_button`),
    parse_warnings: warnings.map((warning, warningIndex) => text(warning, `lines[${index}].parse_warnings[${warningIndex}]`, 300)),
  };
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value), "utf8").digest("hex");
}

export function lineSourceHash(line) {
  const { has_ok_button: _ok, parse_warnings: _warnings, ...stable } = line;
  return sha256(stable);
}

export function validateCaptureEnvelope(raw) {
  const value = object(raw, "capture");
  exactKeys(value, ENVELOPE_KEYS, "capture");
  if (value.schema_version !== 1) throw new Error("schema_version must be 1");
  const startedAt = timestamp(value.started_at, "started_at");
  const completedAt = timestamp(value.completed_at, "completed_at");
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error("completed_at must not precede started_at");
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 500) throw new Error("pages must contain 1 to 500 records");
  if (!Array.isArray(value.lines) || value.lines.length > 5000) throw new Error("lines must contain at most 5000 records");
  const pages = value.pages.map(parsePage);
  const lines = value.lines.map(parseLine);
  const pageNumbers = pages.map((page) => page.page_number);
  if (new Set(pageNumbers).size !== pageNumbers.length) throw new Error("page coverage records must be unique");
  const lineIds = lines.map((line) => line.statement_line_id);
  if (new Set(lineIds).size !== lineIds.length) throw new Error("statement_line_id values must be unique");
  const expectedCount = value.expected_count === null || value.expected_count === undefined
    ? null : integer(value.expected_count, "expected_count");
  const capture = {
    schema_version: 1,
    scan_id: text(value.scan_id, "scan_id", 128, { required: true }),
    bank_account_id: text(value.bank_account_id, "bank_account_id", 255, { required: true }),
    started_at: startedAt,
    completed_at: completedAt,
    expected_count: expectedCount,
    pages,
    lines,
    capture_error: text(value.capture_error, "capture_error", 1000),
  };
  return { ...capture, decision: decideCompleteness(capture) };
}

export function decideCompleteness(capture) {
  const reasons = [];
  const pages = [...capture.pages].sort((left, right) => left.page_number - right.page_number);
  const counts = new Set(pages.map((page) => page.page_count));
  const pageCount = counts.size === 1 ? pages[0].page_count : 0;
  const capturedPages = pages.map((page) => page.page_number);
  const expectedPages = pageCount ? Array.from({ length: pageCount }, (_, index) => index + 1) : [];
  if (capture.capture_error) reasons.push(`browser capture failed: ${capture.capture_error}`);
  if (counts.size !== 1) reasons.push("captured pages disagree about the total page count");
  if (canonical(capturedPages) !== canonical(expectedPages)) reasons.push("pagination coverage is incomplete");
  if (pageCount && pages.some((page) => page.has_previous !== (page.page_number > 1) || page.has_next !== (page.page_number < pageCount))) {
    reasons.push("pagination controls are inconsistent");
  }
  if (pages.reduce((sum, page) => sum + page.observed_count, 0) !== capture.lines.length) {
    reasons.push("page row counts do not equal the unique observed line count");
  }
  if (capture.expected_count === null) reasons.push("the Xero queue's expected statement count was not visible");
  else if (capture.lines.length !== capture.expected_count) reasons.push(`expected ${capture.expected_count} statement lines but observed ${capture.lines.length}`);
  return {
    complete: reasons.length === 0,
    observed_count: capture.lines.length,
    expected_count: capture.expected_count,
    captured_pages: capturedPages,
    expected_pages: expectedPages,
    blocking_reasons: reasons,
  };
}

export function ingestPayload(validated) {
  const { decision, ...capture } = validated;
  const lines = capture.lines.map((line) => ({ ...line, source_hash: lineSourceHash(line) }));
  return {
    ...capture,
    lines,
    derived_complete: decision.complete,
    observed_count: decision.observed_count,
    blocking_reasons: decision.blocking_reasons,
    capture_source_hash: sha256({ ...capture, lines }),
  };
}
