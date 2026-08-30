import { createHash, randomUUID } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export const EXPORT_CAPTURE_MODE = "user-mediated-xero-export";
export const OFFICIAL_UNCODED_LINES_URL = "https://go.xero.com/Banking/StatementLines/Offline";
export const DEFAULT_EXPORT_ROUTES = Object.freeze({
  claim: "/webhook/xero-capture-claim",
  progress: "/webhook/xero-capture-progress",
  import: "/webhook/xero-capture-import",
});
export const DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 5 * 1024 * 1024,
  maximumRows: 5_000,
  maximumAccounts: 100,
  maximumWaitMs: 15 * 60_000,
  scanIntervalMs: 750,
});

const INBOX_MARKER = ".mlai-xero-export-inbox.json";
const COMPANION_LOCK = ".mlai-xero-export-companion.lock";
const REPORT_MARKERS = ["uncoded statement lines", "uncoded bank statement lines"];
const HEADER_ALIASES = Object.freeze({
  date: ["date", "statement date"],
  payee: ["payee", "contact", "name"],
  particulars: ["particulars", "description", "details"],
  combinedNarration: ["particulars reference code"],
  reference: ["reference", "ref"],
  code: ["code"],
  comments: ["comments", "comment"],
  yourComments: ["your comments", "your comment"],
  tax: ["tax", "tax type"],
  spent: ["spent", "money out", "debit"],
  received: ["received", "money in", "credit"],
});

export class ExportCaptureError extends Error {
  constructor(code, message, { retryable = false, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "ExportCaptureError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? retryAfterMs
      : 0;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function normalizedHeader(value) {
  return normalized(value).replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

function parseUrl(value, label = "URL") {
  try {
    return new URL(clean(value));
  } catch {
    throw new ExportCaptureError("INVALID_URL", `${label} must be an absolute URL.`);
  }
}

function routePath(value, fallback) {
  const path = clean(value || fallback);
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes("..")) {
    throw new ExportCaptureError("INVALID_ROUTE", "Capture webhook routes must be absolute path-only values.");
  }
  return path;
}

function safeRemoteBase(value) {
  const parsed = parseUrl(value, "n8n base URL");
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new ExportCaptureError("UNSAFE_N8N_URL", "The n8n base URL must use HTTPS, except on loopback.");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

export function assertOfficialExportUrl(value) {
  const parsed = parseUrl(value || OFFICIAL_UNCODED_LINES_URL, "Xero export URL");
  const direct = parsed.origin === "https://go.xero.com"
    && parsed.pathname.replace(/\/$/, "") === "/Banking/StatementLines/Offline"
    && [...parsed.searchParams.keys()].length === 0
    && parsed.hash === "";
  const deepLink = parsed.origin === "https://go.xero.com"
    && parsed.pathname.toLowerCase() === "/organisationlogin/default.aspx"
    && [...parsed.searchParams.keys()].every((key) => new Set(["shortcode", "redirecturl"]).has(key.toLowerCase()))
    && clean(parsed.searchParams.get("shortcode")) !== ""
    && clean(parsed.searchParams.get("redirecturl")).replace(/\/$/, "") === "/Banking/StatementLines/Offline"
    && parsed.hash === "";
  if (!direct && !deepLink) {
    throw new ExportCaptureError("XERO_URL_BLOCKED", "Only Xero's official Uncoded Statement Lines export page may be opened.");
  }
  return parsed.toString();
}

export function defaultInboxDirectory({ operatingSystem = platform(), homeDirectory = homedir(), env = process.env } = {}) {
  // Xero's CSV export normally lands in the browser's Downloads folder with
  // no Save As prompt. Watching that folder lets the normal export complete
  // the hand-off without browser automation or a manual file move. A learner
  // with a custom browser download location can set XERO_EXPORT_INBOX_DIR.
  if (operatingSystem === "win32") return join(clean(env.USERPROFILE) || homeDirectory, "Downloads");
  return join(homeDirectory, "Downloads");
}

export async function ensureDedicatedInbox(directory, {
  make = mkdir,
  inspect = lstat,
  openFile = open,
} = {}) {
  const inbox = resolve(clean(directory));
  if (!inbox || inbox === resolve(homedir()) || inbox === resolve(sep)) {
    throw new ExportCaptureError("UNSAFE_INBOX", "Choose a bounded Xero export watch folder, not a home or filesystem root.");
  }
  await make(inbox, { recursive: true, mode: 0o700 });
  const folder = await inspect(inbox);
  if (!folder.isDirectory() || folder.isSymbolicLink()) {
    throw new ExportCaptureError("UNSAFE_INBOX", "The Xero export watch folder must be a real local directory, not a symlink.");
  }
  const markerPath = join(inbox, INBOX_MARKER);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const readMarker = async () => {
    let before;
    try {
      before = await inspect(markerPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new ExportCaptureError("UNSAFE_INBOX_MARKER", "The Xero export inbox marker must be a regular file, not a symlink.");
    }
    let handle;
    try {
      handle = await openFile(markerPath, constants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new ExportCaptureError("UNSAFE_INBOX_MARKER", "The Xero export inbox marker changed while it was being opened.");
      }
      const source = await handle.readFile("utf8");
      try {
        return JSON.parse(source);
      } catch {
        throw new ExportCaptureError("INBOX_MARKER_INVALID", "The selected import folder has an invalid Xero export inbox marker.");
      }
    } finally {
      await handle?.close();
    }
  };
  let marker = await readMarker();
  if (marker && marker.purpose !== "mlai-xero-user-export-inbox") {
    throw new ExportCaptureError("INBOX_MARKER_MISMATCH", "The selected import folder belongs to another application.");
  }
  if (!marker) {
    let handle;
    try {
      handle = await openFile(
        markerPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
        0o600,
      );
      await handle.writeFile(JSON.stringify({ schemaVersion: 1, purpose: "mlai-xero-user-export-inbox" }) + "\n", "utf8");
      await handle.sync();
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      marker = await readMarker();
      if (!marker || marker.purpose !== "mlai-xero-user-export-inbox") {
        throw new ExportCaptureError("INBOX_MARKER_MISMATCH", "The selected import folder belongs to another application.");
      }
    } finally {
      await handle?.close();
    }
  }
  return inbox;
}

export async function readPrivateBridgeSecret(path, {
  inspect = lstat,
  openFile = open,
  currentUid = typeof process.getuid === "function" ? process.getuid() : null,
} = {}) {
  const requested = clean(path);
  if (!requested || !isAbsolute(requested) || resolve(requested) !== requested) {
    throw new ExportCaptureError(
      "INVALID_SECRET_FILE",
      "XERO_CAPTURE_INGEST_SECRET_FILE must be an explicit absolute path without '..' segments.",
    );
  }
  let before;
  try {
    before = await inspect(requested);
  } catch {
    throw new ExportCaptureError("SECRET_FILE_UNAVAILABLE", "The private Xero capture bridge secret file is unavailable.");
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new ExportCaptureError("UNSAFE_SECRET_FILE", "The Xero capture bridge secret must be a regular file, not a symlink.");
  }
  if (Number.isInteger(currentUid) && before.uid !== currentUid) {
    throw new ExportCaptureError("UNSAFE_SECRET_FILE_OWNER", "The Xero capture bridge secret file must be owned by the current user.");
  }
  if ((before.mode & 0o077) !== 0) {
    throw new ExportCaptureError("UNSAFE_SECRET_FILE_MODE", "The Xero capture bridge secret file must not be accessible by group or other users (use chmod 600)." );
  }
  if (before.size < 24 || before.size > 4_097) {
    throw new ExportCaptureError("INVALID_SECRET_FILE", "The Xero capture bridge secret file must contain one bounded secret of at least 24 characters.");
  }
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await openFile(requested, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
    ) {
      throw new ExportCaptureError("SECRET_FILE_CHANGED", "The Xero capture bridge secret file changed while it was being opened.");
    }
    const raw = await handle.readFile("utf8");
    const secret = raw.trim();
    if (
      secret.length < 24
      || secret.length > 4_096
      || /[\u0000-\u001f\u007f]/.test(secret)
    ) {
      throw new ExportCaptureError("INVALID_SECRET_FILE", "The Xero capture bridge secret file must contain one bounded single-line secret of at least 24 characters.");
    }
    return secret;
  } catch (error) {
    if (error instanceof ExportCaptureError) throw error;
    throw new ExportCaptureError("SECRET_FILE_UNAVAILABLE", "The private Xero capture bridge secret file could not be read safely.");
  } finally {
    await handle?.close();
  }
}

export async function acquireCompanionLock(directory, {
  inspect = lstat,
  openFile = open,
  remove = unlink,
  processId = process.pid,
} = {}) {
  const inbox = resolve(clean(directory));
  const folder = await inspect(inbox);
  if (!folder.isDirectory() || folder.isSymbolicLink()) {
    throw new ExportCaptureError("UNSAFE_INBOX", "The Xero export watch folder must be a real local directory, not a symlink.");
  }
  const lockPath = join(inbox, COMPANION_LOCK);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await openFile(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
      0o600,
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let existing;
    try { existing = await inspect(lockPath); } catch { existing = null; }
    if (existing?.isSymbolicLink?.()) {
      throw new ExportCaptureError("UNSAFE_COMPANION_LOCK", "The Xero export companion lock path is a symlink.");
    }
    throw new ExportCaptureError("COMPANION_ALREADY_RUNNING", "Another Xero export companion is already watching this inbox.");
  }
  const createdIdentity = await handle.stat();
  try {
    await handle.writeFile(JSON.stringify({ schemaVersion: 1, processId, startedAt: new Date().toISOString() }) + "\n", "utf8");
    await handle.sync();
    const identity = await handle.stat();
    let released = false;
    return {
      path: lockPath,
      async release() {
        if (released) return;
        released = true;
        await handle.close();
        let current;
        try { current = await inspect(lockPath); } catch (error) {
          if (error?.code === "ENOENT") return;
          throw error;
        }
        // Never follow or remove a replacement. This also makes cleanup safe
        // if the lock name is swapped while the companion is shutting down.
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return;
        await remove(lockPath);
      },
    };
  } catch (error) {
    await handle.close().catch(() => {});
    let current;
    try { current = await inspect(lockPath); } catch { current = null; }
    if (
      current?.isFile?.()
      && !current.isSymbolicLink?.()
      && current.dev === createdIdentity.dev
      && current.ino === createdIdentity.ino
    ) await remove(lockPath).catch(() => {});
    throw error;
  }
}

export function structuredStatus(event, details = {}, now = () => new Date().toISOString()) {
  const allowed = new Set([
    "runId", "companionId", "state", "message", "code", "accountCount",
    "rowCount", "retryInMs", "current", "total", "requiresUserLogin",
  ]);
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (allowed.has(key) && ["string", "number", "boolean"].includes(typeof value)) safe[key] = value;
  }
  return { schemaVersion: 1, event, at: now(), ...safe };
}

export function parseCsv(text, { maximumRows = DEFAULT_LIMITS.maximumRows + 100 } = {}) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field !== "") throw new ExportCaptureError("CSV_QUOTING", "The Xero CSV contains malformed quoting.");
      quoted = true;
    } else if (character === ",") {
      row.push(field); field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => clean(value) !== "")) rows.push(row);
      row = [];
      if (rows.length > maximumRows) throw new ExportCaptureError("CSV_ROW_LIMIT", "The Xero CSV exceeds the safe row limit.");
    } else field += character;
  }
  if (quoted) throw new ExportCaptureError("CSV_QUOTING", "The Xero CSV ends inside a quoted field.");
  row.push(field);
  if (row.some((value) => clean(value) !== "")) rows.push(row);
  if (rows.length > maximumRows) throw new ExportCaptureError("CSV_ROW_LIMIT", "The Xero CSV exceeds the safe row limit.");
  if (!rows.length) throw new ExportCaptureError("CSV_EMPTY", "The selected CSV is empty.");
  return rows;
}

function headerIndex(row, aliases) {
  const values = row.map(normalizedHeader);
  for (const alias of aliases) {
    const index = values.indexOf(alias);
    if (index !== -1) return index;
  }
  return -1;
}

function recognizeHeader(row) {
  const indexes = {};
  for (const [name, aliases] of Object.entries(HEADER_ALIASES)) indexes[name] = headerIndex(row, aliases);
  const narrationShape = indexes.combinedNarration >= 0
    || indexes.particulars >= 0
    || indexes.reference >= 0
    || indexes.code >= 0;
  const valid = indexes.date >= 0
    && indexes.payee >= 0
    && indexes.spent >= 0
    && indexes.received >= 0
    && narrationShape;
  return valid ? indexes : null;
}

function resolveDateOrder(rows, configuredOrder) {
  const configured = clean(configuredOrder).toUpperCase();
  if (new Set(["DMY", "MDY"]).has(configured)) return configured;
  let indexes = null;
  let inferred = "";
  for (const row of rows) {
    const header = recognizeHeader(row);
    if (header) {
      indexes = header;
      continue;
    }
    if (!indexes) continue;
    const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(
      clean(row[indexes.date]),
    );
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const candidate = first > 12 && second <= 12
      ? "DMY"
      : second > 12 && first <= 12
        ? "MDY"
        : "";
    if (candidate && inferred && candidate !== inferred) {
      throw new ExportCaptureError(
        "DATE_ORDER_CONFLICT",
        "The Xero CSV contains conflicting slash-date formats.",
      );
    }
    if (candidate) inferred = candidate;
  }
  return inferred || configured;
}

function parseDate(value, dateOrder) {
  const raw = clean(value);
  let year; let month; let day;
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
  if (match) [, year, month, day] = match;
  if (!match) {
    match = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw);
    if (match) {
      const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].slice(0, 3).toLowerCase());
      if (index >= 0) { day = match[1]; month = String(index + 1); year = match[3]; }
    }
  }
  if (!year) {
    match = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
    if (match) {
      const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase());
      if (index >= 0) { month = String(index + 1); day = match[2]; year = match[3]; }
    }
  }
  if (!year) {
    match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(raw);
    if (match && !new Set(["DMY", "MDY"]).has(dateOrder)) {
      throw new ExportCaptureError("DATE_ORDER_REQUIRED", "Slash dates require the job to specify DMY or MDY; the companion will not guess.");
    }
    if (match) {
      year = match[3];
      if (dateOrder === "DMY") { day = match[1]; month = match[2]; }
      else { month = match[1]; day = match[2]; }
    }
  }
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (!year || parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
    throw new ExportCaptureError("INVALID_DATE", `The Xero CSV contains an invalid date '${raw.slice(0, 40)}'.`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function amountNumber(value, label) {
  const raw = clean(value);
  if (!raw) return null;
  const negative = /^-/.test(raw) || /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,$£€¥\s()]/g, "").replace(/^\+/, "").replace(/^-/, "");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) throw new ExportCaptureError("INVALID_AMOUNT", `${label} contains a non-numeric amount.`);
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new ExportCaptureError("INVALID_AMOUNT", `${label} must contain a finite positive amount.`);
  return { amount: amount.toFixed(2), negative };
}

function parseAmount(row, indexes) {
  const spent = amountNumber(row[indexes.spent], "Spent");
  const received = amountNumber(row[indexes.received], "Received");
  if (Boolean(spent) === Boolean(received)) throw new ExportCaptureError("AMBIGUOUS_AMOUNT", "Each statement row must contain exactly one of Spent or Received.");
  if (spent?.negative || received?.negative) {
    throw new ExportCaptureError(
      "AMBIGUOUS_AMOUNT",
      "Spent and Received must be positive values in their respective Xero columns.",
    );
  }
  return spent ? { direction: "debit", amount: spent.amount } : { direction: "credit", amount: received.amount };
}

function field(row, index) {
  return index >= 0 ? clean(row[index]) : "";
}

function exactReportTitle(row) {
  const cells = row.map(clean).filter(Boolean);
  return cells.length === 1 && REPORT_MARKERS.includes(normalized(cells[0]));
}

function expectedOrganisationNames(values) {
  const source = Array.isArray(values) ? values : [values];
  const names = [...new Set(source.map(clean).filter(Boolean).map(normalized))];
  if (!names.length || names.length > 4 || names.some((name) => name.length > 200)) {
    throw new ExportCaptureError(
      "ORGANISATION_REQUIRED",
      "The capture job must provide the expected Xero organisation name before a CSV can be trusted.",
    );
  }
  return names;
}

function rowMatchesOrganisation(row, expectedNames) {
  const cells = row.map(clean).filter(Boolean);
  if (cells.length === 1 && expectedNames.includes(normalized(cells[0]))) return true;
  if (cells.length === 1) {
    const match = /^(?:organisation|organization)\s*:\s*(.+)$/i.exec(cells[0]);
    if (match && expectedNames.includes(normalized(match[1]))) return true;
  }
  return cells.length === 2
    && /^(?:organisation|organization)$/i.test(cells[0])
    && expectedNames.includes(normalized(cells[1]));
}

function accountHeading(row) {
  const cells = row.map(clean).filter(Boolean);
  if (cells.length === 2 && /^(?:bank )?account$/i.test(cells[0])) return cells[1];
  if (cells.length !== 1) return "";
  const value = cells[0];
  const prefixed = /^(?:bank )?account\s*:\s*(.+)$/i.exec(value);
  if (prefixed) return clean(prefixed[1]);
  if (
    exactReportTitle(row)
    || /^xero$/i.test(value)
    || /^(?:organisation|organization|from|to|date range|generated|report date)\s*:/i.test(value)
    || /^there (?:are|is) no (?:uncoded )?statement lines/i.test(value)
  ) return "";
  return value;
}

function canonicalSourceHash(row) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

export function preflightXeroUncodedStatementCsv(source, {
  dateOrder,
  organisationNames,
  maximumRows = DEFAULT_LIMITS.maximumRows,
  maximumAccounts = DEFAULT_LIMITS.maximumAccounts,
} = {}) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(String(source || ""), "utf8");
  if (buffer.length > DEFAULT_LIMITS.maximumBytes) throw new ExportCaptureError("CSV_SIZE_LIMIT", "The Xero CSV exceeds the 5 MB safety limit.");
  if (buffer.includes(0)) throw new ExportCaptureError("CSV_BINARY", "The selected file is not a plain-text CSV.");
  // The bound applies to statement lines. A valid all-account report also has
  // a heading, a repeated header, and sometimes an empty-state row per bank
  // account, so reserve bounded structural overhead rather than accidentally
  // rejecting a report at the advertised limits.
  const rows = parseCsv(buffer.toString("utf8"), {
    maximumRows: maximumRows + (maximumAccounts * 3) + 50,
  });
  const expectedNames = expectedOrganisationNames(organisationNames);
  const firstHeader = rows.findIndex((row) => recognizeHeader(row));
  const preambleLimit = firstHeader === -1 ? Math.min(rows.length, 50) : firstHeader;
  const preamble = rows.slice(0, preambleLimit);
  if (!preamble.some(exactReportTitle)) {
    throw new ExportCaptureError(
      "REPORT_MARKER_MISSING",
      "The CSV preamble is not a recognized Xero Uncoded Statement Lines report.",
    );
  }
  if (!preamble.some((row) => rowMatchesOrganisation(row, expectedNames))) {
    throw new ExportCaptureError(
      "ORGANISATION_MISMATCH",
      "The Xero report does not name the expected organisation.",
    );
  }
  if (firstHeader === -1) {
    throw new ExportCaptureError(
      "XERO_HEADERS_MISSING",
      "The CSV does not contain Xero's repeated Date, Payee, narration, Spent, and Received headers.",
    );
  }

  const groups = new Map();
  const canonicalRows = [];
  const occurrences = new Map();
  const resolvedDateOrder = resolveDateOrder(rows, dateOrder);
  let dataRows = 0;
  let pendingAccount = "";
  let currentAccount = "";
  let indexes = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const header = recognizeHeader(row);
    if (header) {
      if (!pendingAccount) {
        throw new ExportCaptureError(
          "ACCOUNT_SECTION_MISSING",
          `Xero header row ${index + 1} is not preceded by a bank-account section heading.`,
        );
      }
      currentAccount = pendingAccount;
      pendingAccount = "";
      indexes = header;
      const accountKey = normalized(currentAccount);
      if (!groups.has(accountKey)) groups.set(accountKey, { label: currentAccount, rowCount: 0 });
      continue;
    }
    const heading = accountHeading(row);
    if (heading) {
      pendingAccount = heading;
      indexes = null;
      currentAccount = "";
      continue;
    }
    if (!indexes || !currentAccount) continue;
    const populated = row.map(clean).filter(Boolean);
    if (!populated.length) continue;
    if (populated.length === 1 && /^there (?:are|is) no (?:uncoded )?statement lines/i.test(populated[0])) continue;
    if (/^total\b/i.test(field(row, 0)) && !field(row, indexes.date)) continue;
    const dateRaw = field(row, indexes.date);
    const payee = field(row, indexes.payee);
    const amountRaw = `${field(row, indexes.spent)}${field(row, indexes.received)}`;
    if (!dateRaw || !amountRaw) throw new ExportCaptureError("AMBIGUOUS_ROW", `CSV row ${index + 1} is partly populated and cannot be interpreted safely.`);
    const particulars = field(row, indexes.particulars);
    const reference = field(row, indexes.reference);
    const combinedNarration = field(row, indexes.combinedNarration);
    const code = field(row, indexes.code);
    if (!payee && !particulars && !reference && !combinedNarration) throw new ExportCaptureError("ROW_IDENTITY_MISSING", `CSV row ${index + 1} has no payee or narration.`);
    const date = parseDate(dateRaw, resolvedDateOrder);
    const amount = parseAmount(row, indexes);
    const accountKey = normalized(currentAccount);
    const group = groups.get(accountKey);
    if (!group) throw new ExportCaptureError("ACCOUNT_SECTION_MISSING", "A statement row appeared outside a bank-account section.");
    group.rowCount += 1;
    dataRows += 1;
    if (dataRows > maximumRows) throw new ExportCaptureError("CSV_ROW_LIMIT", `The Xero export contains more than ${maximumRows} statement lines.`);
    const signature = [accountKey, date, payee, particulars, reference, combinedNarration, code, amount.direction, amount.amount].map(normalized).join("\u001f");
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    const canonical = {
      bankAccountLabel: currentAccount,
      date,
      payee,
      particulars,
      reference,
      code,
      combinedNarration,
      direction: amount.direction,
      amount: amount.amount,
      tax: field(row, indexes.tax),
      comments: field(row, indexes.comments),
      yourComments: field(row, indexes.yourComments),
      rawRowIndex: index + 1,
      occurrence,
    };
    canonicalRows.push({ ...canonical, sourceHash: canonicalSourceHash(canonical) });
  }
  if (!groups.size) throw new ExportCaptureError("ACCOUNT_SECTION_MISSING", "The Xero report contains no recognized bank-account sections.");
  if (groups.size > maximumAccounts) throw new ExportCaptureError("ACCOUNT_LIMIT", `The Xero export contains more than ${maximumAccounts} bank accounts.`);
  return {
    rowCount: dataRows,
    accountCount: groups.size,
    accountLabels: [...groups.values()].map((group) => group.label).sort(),
    rows: canonicalRows,
  };
}

export async function openOfficialExportPage(url = OFFICIAL_UNCODED_LINES_URL, {
  operatingSystem = platform(),
  spawn = nodeSpawn,
  spawnTimeoutMs = 5_000,
} = {}) {
  const target = assertOfficialExportUrl(url);
  const command = operatingSystem === "darwin" ? "/usr/bin/open" : operatingSystem === "win32" ? "rundll32.exe" : "xdg-open";
  const args = operatingSystem === "win32" ? ["url.dll,FileProtocolHandler", target] : [target];
  let child;
  try {
    child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  } catch {
    throw new ExportCaptureError("XERO_OPEN_FAILED", "The operating system could not open Xero's official export page.");
  }
  if (!child || typeof child !== "object") {
    throw new ExportCaptureError("XERO_OPEN_FAILED", "The operating system did not start a URL opener.");
  }
  if (typeof child.once === "function") {
    const timeout = Math.min(10_000, Math.max(50, Number(spawnTimeoutMs) || 5_000));
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener?.("spawn", onSpawn);
        child.removeListener?.("error", onError);
        child.removeListener?.("exit", onExit);
        if (error) rejectPromise(error);
        else resolvePromise();
      };
      const onSpawn = () => finish();
      const onError = () => finish(new ExportCaptureError("XERO_OPEN_FAILED", "The operating system could not open Xero's official export page."));
      const onExit = (code) => {
        if (code !== 0) finish(new ExportCaptureError("XERO_OPEN_FAILED", "The operating-system URL opener exited before opening Xero."));
      };
      const timer = setTimeout(
        () => finish(new ExportCaptureError("XERO_OPEN_TIMEOUT", "Timed out waiting for the operating system to start the Xero export page.")),
        timeout,
      );
      child.once("spawn", onSpawn);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  }
  child.unref?.();
  return { command, args };
}

export async function snapshotInbox(inbox, { list = readdir, inspect = lstat } = {}) {
  const entries = new Map();
  for (const name of await list(inbox)) {
    if (!/\.csv$/i.test(name)) continue;
    const path = join(inbox, name);
    try {
      const stats = await inspect(path);
      if (stats.isFile() && !stats.isSymbolicLink()) {
        entries.set(name, {
          dev: stats.dev,
          ino: stats.ino,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          birthtimeMs: stats.birthtimeMs,
        });
      }
    } catch { /* a concurrently removed file is not a candidate */ }
  }
  return entries;
}

async function readRegularCsv(path, inbox, maximumBytes, expected) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new ExportCaptureError("CSV_NOT_REGULAR", "The selected CSV must be a regular file, not a symlink.");
  if (stats.size <= 0 || stats.size > maximumBytes) throw new ExportCaptureError("CSV_SIZE_LIMIT", "The selected CSV is empty or exceeds the 5 MB safety limit.");
  const resolvedInbox = await realpath(inbox);
  const resolvedFile = await realpath(path);
  const location = relative(resolvedInbox, resolvedFile);
  if (!location || location.startsWith("..") || resolve(resolvedInbox, location) !== resolvedFile) {
    throw new ExportCaptureError("CSV_OUTSIDE_INBOX", "The selected CSV resolves outside the dedicated import folder.");
  }
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(resolvedFile, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== stats.dev
      || opened.ino !== stats.ino
      || opened.size !== stats.size
      || opened.mtimeMs !== stats.mtimeMs
      || (expected && (
        opened.dev !== expected.dev
        || opened.ino !== expected.ino
        || opened.size !== expected.size
        || opened.mtimeMs !== expected.mtimeMs
      ))
    ) {
      throw new ExportCaptureError("CSV_CHANGED", "The selected CSV changed while it was being opened.");
    }
    return { name: basename(resolvedFile), path: resolvedFile, stats: opened, buffer: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

export async function waitForNewStableCsv({
  inbox,
  baseline = new Map(),
  claimedAt,
  signal,
  control = async () => ({ cancelled: false }),
  limits = {},
  pause = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  snapshot = snapshotInbox,
} = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const claimedMs = Date.parse(clean(claimedAt));
  if (!Number.isFinite(claimedMs)) throw new ExportCaptureError("INVALID_CLAIM_TIME", "The capture job requires a valid claimedAt timestamp.");
  const deadline = Date.now() + config.maximumWaitMs;
  const stable = new Map();
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ExportCaptureError("CANCELLED", "The Xero export capture was cancelled locally.");
    const state = await control();
    if (state?.cancelled === true || state?.cancel === true || state?.status === "cancelled") {
      throw new ExportCaptureError("CANCELLED", "The Xero export capture was cancelled from n8n.");
    }
    const entries = await snapshot(inbox);
    const candidates = [...entries.entries()].filter(([name, info]) => {
      const before = baseline.get(name);
      const changedSinceBaseline = !before
        || before.dev !== info.dev
        || before.ino !== info.ino
        || before.size !== info.size
        || before.mtimeMs !== info.mtimeMs;
      const modifiedAfterClaim = info.mtimeMs >= claimedMs - 2_000;
      const newlyCreatedAfterClaim = Boolean(before)
        || !Number.isFinite(info.birthtimeMs)
        || info.birthtimeMs <= 0
        || info.birthtimeMs >= claimedMs - 2_000;
      return changedSinceBaseline
        && modifiedAfterClaim
        && newlyCreatedAfterClaim
        && !/\.(?:crdownload|download|part|tmp)$/i.test(name);
    });
    if (candidates.length > 1) throw new ExportCaptureError("MULTIPLE_NEW_CSVS", "More than one new CSV appeared in the import folder; remove the extras and run again.");
    if (candidates.length === 1) {
      const [name, info] = candidates[0];
      const prior = stable.get(name);
      if (
        prior
        && prior.dev === info.dev
        && prior.ino === info.ino
        && prior.size === info.size
        && prior.mtimeMs === info.mtimeMs
      ) {
        return readRegularCsv(join(inbox, name), inbox, config.maximumBytes, info);
      }
      stable.clear();
      stable.set(name, info);
    } else stable.clear();
    await pause(config.scanIntervalMs);
  }
  throw new ExportCaptureError("EXPORT_TIMEOUT", "Timed out waiting for a newly exported Xero CSV in the configured browser download folder.");
}

function validateJob(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const mode = clean(value.mode || value.source || EXPORT_CAPTURE_MODE);
  if (mode !== EXPORT_CAPTURE_MODE) throw new ExportCaptureError("JOB_MODE_BLOCKED", "Only a user-mediated Xero export job is accepted.");
  const runId = clean(value.run_id || value.runId);
  const claimedAt = clean(value.claimed_at || value.claimedAt);
  const claimedMs = Date.parse(claimedAt);
  if (!runId || runId.length > 100) throw new ExportCaptureError("INVALID_JOB", "The export job requires a bounded runId.");
  if (!Number.isFinite(claimedMs) || claimedMs > Date.now() + 60_000 || claimedMs < Date.now() - 60 * 60_000) {
    throw new ExportCaptureError("INVALID_JOB_TIME", "The export job claim time is invalid or too old.");
  }
  const dateOrder = clean(value.date_order || value.dateOrder).toUpperCase();
  if (!new Set(["DMY", "MDY", "YMD"]).has(dateOrder)) throw new ExportCaptureError("DATE_ORDER_REQUIRED", "The export job must specify DMY, MDY, or YMD.");
  const organisationNames = [
    value.organisation_name ?? value.organisationName,
    value.organisation_legal_name ?? value.organisationLegalName,
    ...(Array.isArray(value.expected_organisation_names) ? value.expected_organisation_names : []),
  ].map(clean).filter(Boolean);
  expectedOrganisationNames(organisationNames);
  return {
    runId,
    claimedAt,
    exportUrl: assertOfficialExportUrl(value.export_url || value.exportUrl || OFFICIAL_UNCODED_LINES_URL),
    dateOrder,
    organisationNames,
  };
}

export function createN8nExportApi({
  baseUrl,
  secret,
  headerName = "X-Xero-Capture-Key",
  routes = {},
  fetchImplementation = fetch,
  companionId = `companion-${randomUUID()}`,
  stdout = process.stdout,
  requestTimeoutMs = 10_000,
  requestRetryAttempts = 3,
  requestRetryBaseMs = 250,
  requestRetryMaximumMs = 1_000,
  importRequestTimeoutMs = 90_000,
  importRetryAttempts = 4,
  importRetryBaseMs = 1_000,
  importRetryMaximumMs = 8_000,
  retryPause = (milliseconds, signal) => new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new ExportCaptureError("CANCELLED", "The n8n capture request was cancelled."));
      return;
    }
    const timer = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      rejectPromise(new ExportCaptureError("CANCELLED", "The n8n capture request was cancelled."));
    }, { once: true });
  }),
} = {}) {
  const base = safeRemoteBase(baseUrl);
  const credential = clean(secret);
  if (credential.length < 24) throw new ExportCaptureError("BRIDGE_SECRET_REQUIRED", "The Xero Capture Bridge secret must contain at least 24 characters.");
  if (!/^[A-Za-z0-9-]+$/.test(headerName)) throw new ExportCaptureError("INVALID_HEADER", "The bridge header name is invalid.");
  const paths = {
    claim: routePath(routes.claim, DEFAULT_EXPORT_ROUTES.claim),
    progress: routePath(routes.progress, DEFAULT_EXPORT_ROUTES.progress),
    import: routePath(routes.import, DEFAULT_EXPORT_ROUTES.import),
  };
  const timeoutMs = Math.min(30_000, Math.max(50, Number(requestTimeoutMs) || 10_000));
  const retryAttempts = Math.min(4, Math.max(1, Math.trunc(Number(requestRetryAttempts) || 3)));
  const retryBaseMs = Math.min(2_000, Math.max(50, Number(requestRetryBaseMs) || 250));
  const retryMaximumMs = Math.min(5_000, Math.max(retryBaseMs, Number(requestRetryMaximumMs) || 1_000));
  const importTimeoutMs = Math.min(180_000, Math.max(timeoutMs, Number(importRequestTimeoutMs) || 90_000));
  const importAttempts = Math.min(5, Math.max(1, Math.trunc(Number(importRetryAttempts) || 4)));
  const importBaseMs = Math.min(5_000, Math.max(100, Number(importRetryBaseMs) || 1_000));
  const importMaximumMs = Math.min(15_000, Math.max(importBaseMs, Number(importRetryMaximumMs) || 8_000));
  const retryAfterMilliseconds = (response) => {
    const value = clean(response?.headers?.get?.("retry-after"));
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Number(value) * 1_000;
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
  };
  const invalidEndpointResponse = (endpoint) => new ExportCaptureError(
    "N8N_INVALID_RESPONSE",
    `The n8n ${endpoint} endpoint returned an invalid response.`,
  );
  const request = async (path, body, {
    empty = false,
    signal,
    extraHeaders = {},
    timeoutOverrideMs = timeoutMs,
  } = {}) => {
    if (signal?.aborted) throw new ExportCaptureError("CANCELLED", "The n8n capture request was cancelled.");
    const requestController = new AbortController();
    const timeoutFailure = new ExportCaptureError(
      "N8N_REQUEST_TIMEOUT",
      "The n8n capture bridge did not respond before the bounded request timeout.",
      { retryable: true },
    );
    const cancelledFailure = new ExportCaptureError("CANCELLED", "The n8n capture request was cancelled.");
    let timer;
    const timeout = new Promise((resolvePromise, rejectPromise) => {
      timer = setTimeout(() => {
        requestController.abort();
        rejectPromise(timeoutFailure);
      }, timeoutOverrideMs);
    });
    let rejectCancelled;
    const cancelled = new Promise((resolvePromise, rejectPromise) => { rejectCancelled = rejectPromise; });
    const abortFromCaller = () => {
      requestController.abort(signal?.reason);
      rejectCancelled(cancelledFailure);
    };
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    const bounded = (operation) => Promise.race([Promise.resolve(operation), timeout, cancelled]);
    try {
      let response;
      try {
        response = await bounded(fetchImplementation(new URL(path, base), {
          method: "POST",
          headers: { "Content-Type": "application/json", [headerName]: credential, ...extraHeaders },
          body: JSON.stringify(body),
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: requestController.signal,
        }));
      } catch (error) {
        if (error === timeoutFailure || error === cancelledFailure) throw error;
        if (signal?.aborted) throw cancelledFailure;
        if (error?.name === "AbortError") throw timeoutFailure;
        throw new ExportCaptureError(
          "N8N_TEMPORARILY_UNAVAILABLE",
          "The n8n capture bridge is temporarily unavailable.",
          { retryable: true },
        );
      }
      if (empty && response.status === 204) return null;
      let result;
      try {
        result = await bounded(response.json());
      } catch (error) {
        if (error === timeoutFailure || error === cancelledFailure) throw error;
        if (response.ok) {
          throw new ExportCaptureError("N8N_INVALID_RESPONSE", "The n8n capture bridge returned an invalid response.");
        }
        result = {};
      }
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        throw new ExportCaptureError(
          retryable ? "N8N_TEMPORARILY_UNAVAILABLE" : "N8N_REQUEST_REJECTED",
          retryable
            ? "The n8n capture bridge is temporarily unavailable."
            : `The n8n capture bridge rejected the request (${response.status}).`,
          { retryable, retryAfterMs: retryAfterMilliseconds(response) },
        );
      }
      if (result !== null && (typeof result !== "object" || Array.isArray(result))) {
        throw new ExportCaptureError("N8N_INVALID_RESPONSE", "The n8n capture bridge returned an invalid response shape.");
      }
      if (result?.ok === false) {
        throw new ExportCaptureError("N8N_REQUEST_REJECTED", "The n8n capture bridge rejected the request.");
      }
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  };
  const requestWithRetry = async (path, body, {
    signal,
    extraHeaders,
    timeoutOverrideMs = timeoutMs,
    attempts = retryAttempts,
    baseDelayMs = retryBaseMs,
    maximumDelayMs = retryMaximumMs,
  } = {}) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await request(path, body, { signal, extraHeaders, timeoutOverrideMs });
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error?.code === "CANCELLED") throw error;
        if (error?.retryable !== true || attempt >= attempts) throw error;
        const exponential = baseDelayMs * (2 ** (attempt - 1));
        const requested = Number(error?.retryAfterMs || 0);
        const delay = Math.min(maximumDelayMs, Math.max(exponential, requested));
        await retryPause(delay, signal);
      }
    }
    throw lastError;
  };
  return {
    companionId,
    localStatus(event) { stdout.write(`${JSON.stringify(event)}\n`); },
    progress(event, { signal } = {}) {
      const status = clean(event?.event);
      const runId = clean(event?.runId);
      const allowedStatuses = new Set(["preflight", "opening", "awaiting_login", "awaiting_export", "discovering", "capturing", "verifying", "uploading", "reviewing", "ready", "failed", "cancelled"]);
      if (!allowedStatuses.has(status)) throw new ExportCaptureError("INVALID_PROGRESS", `Progress status '${status}' is not in the companion contract.`);
      return requestWithRetry(paths.progress, {
        schema_version: 1,
        run_id: runId,
        companion_id: companionId,
        status,
        current: Number(event.current || 0),
        total: Number(event.total || 0),
        message: clean(event.message || event.state).slice(0, 500),
        ...(event.requiresUserLogin === true ? { requires_user_login: true } : {}),
        ...(Number.isInteger(event.accountCount) ? { bank_accounts_found: event.accountCount } : {}),
        ...(Number.isInteger(event.rowCount) ? { statement_lines_observed: event.rowCount } : {}),
      }, { signal }).then((result) => {
        const valid = result?.ok === true
          && result.run_id === runId
          && (
            result.cancelled === true
            || (result.cancelled === false && result.status === status)
          );
        if (!valid) throw invalidEndpointResponse("capture-progress");
        return result;
      });
    },
    importCsv({ runId, fileName, csvText }, { signal } = {}) {
      const boundedRunId = clean(runId);
      const source = String(csvText || "");
      // Retrying an upload after a timeout is safe only when every attempt has
      // the same idempotency identity. The import endpoint is expected to
      // deduplicate this key (and the already-bound runId + companionId) before
      // creating scans or starting a review.
      const idempotencyKey = `xero-import-${createHash("sha256")
        .update(`${boundedRunId}\u0000${clean(fileName)}\u0000${source}`)
        .digest("hex")}`;
      return requestWithRetry(paths.import, {
        schema_version: 1,
        run_id: boundedRunId,
        companion_id: companionId,
        file_name: clean(fileName).slice(0, 255),
        csv_text: source,
        all_bank_accounts_requested: true,
      }, {
        signal,
        extraHeaders: { "Idempotency-Key": idempotencyKey },
        timeoutOverrideMs: importTimeoutMs,
        attempts: importAttempts,
        baseDelayMs: importBaseMs,
        maximumDelayMs: importMaximumMs,
      }).then((result) => {
        const valid = result?.ok === true
          && result.run?.runId === boundedRunId
          && new Set(["reviewing", "ready"]).has(result.run?.state)
          && typeof result.reviewRunId === "string"
          && result.reviewRunId.length > 0
          && result.reviewRunId.length <= 160;
        if (!valid) throw invalidEndpointResponse("capture-import");
        return result;
      });
    },
    claim(signal) {
      return request(paths.claim, {
        schema_version: 1,
        companion_id: companionId,
        app_version: "xero-export-companion/1",
      }, { empty: true, signal }).then((result) => {
        if (result === null) return null;
        const job = result?.job;
        const retryInMs = result?.retryInMs;
        const validRetry = retryInMs === undefined
          || (Number.isInteger(retryInMs) && retryInMs >= 250 && retryInMs <= 30_000);
        const validJob = job === null
          || (
            job
            && typeof job === "object"
            && !Array.isArray(job)
            && clean(job.mode) === EXPORT_CAPTURE_MODE
            && clean(job.run_id || job.runId) !== ""
          );
        if (result?.ok !== true || !Object.hasOwn(result, "job") || !validRetry || !validJob) {
          throw invalidEndpointResponse("capture-claim");
        }
        return result;
      });
    },
  };
}

export async function pollForExportJob(api, {
  signal,
  intervalMs = 2_500,
  maximumIntervalMs = 30_000,
  pause = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
} = {}) {
  const baseWait = Math.max(250, Number(intervalMs) || 2_500);
  const waitCap = Math.min(30_000, Math.max(baseWait, Number(maximumIntervalMs) || 30_000));
  let wait = baseWait;
  let transientFailures = 0;
  while (!signal?.aborted) {
    let response;
    try {
      response = await api.claim(signal);
      transientFailures = 0;
    } catch (error) {
      if (signal?.aborted || error?.code === "CANCELLED" || error?.name === "AbortError") {
        throw new ExportCaptureError("CANCELLED", "Export-job polling was cancelled.");
      }
      if (error?.retryable !== true) throw error;
      transientFailures += 1;
      wait = Math.min(waitCap, baseWait * (2 ** Math.min(transientFailures - 1, 10)));
      api.localStatus?.(structuredStatus("preflight", {
        companionId: api.companionId,
        state: "waiting_for_n8n",
        code: "N8N_TEMPORARILY_UNAVAILABLE",
        message: "The capture service is temporarily unavailable; retrying without exposing response details.",
        retryInMs: wait,
      }));
      await pause(wait);
      continue;
    }
    const job = response?.job ?? response;
    if (job && typeof job === "object" && (job.run_id || job.runId)) return job;
    const hinted = Number(response?.retryInMs || 0);
    wait = Math.min(waitCap, hinted >= 250 ? hinted : baseWait);
    api.localStatus?.(structuredStatus("preflight", { companionId: api.companionId, state: "waiting_for_job", retryInMs: wait }));
    await pause(wait);
  }
  throw new ExportCaptureError("CANCELLED", "Export-job polling was cancelled.");
}

export async function runExportJob({
  job: rawJob,
  api,
  inboxDirectory,
  signal,
  openExportPage = openOfficialExportPage,
  waitForCsv = waitForNewStableCsv,
} = {}) {
  const job = validateJob(rawJob);
  const emit = async (event) => {
    api.localStatus?.(event);
    return api.progress?.(event, { signal });
  };
  const inbox = await ensureDedicatedInbox(inboxDirectory || defaultInboxDirectory());
  const baseline = await snapshotInbox(inbox);
  // Claiming already advances the server-side run to `opening`. Keep this
  // explanatory preflight event local so a backward heartbeat cannot race the
  // monotonic state machine and make a correctly claimed job look invalid.
  api.localStatus?.(structuredStatus("preflight", { runId: job.runId, state: "user_export_required", current: 0, total: 4 }));
  await emit(structuredStatus("opening", { runId: job.runId, state: "opening_official_xero_export", current: 1, total: 4 }));
  await openExportPage(job.exportUrl);
  await emit(structuredStatus("awaiting_login", { runId: job.runId, state: "manual_login_or_mfa", message: "Log in to Xero in your normal browser if requested. The companion cannot read or type credentials.", requiresUserLogin: true, current: 1, total: 4 }));
  await emit(structuredStatus("awaiting_export", { runId: job.runId, state: "select_all_accounts_and_export_csv", message: "In Xero, select All bank accounts and a date range covering the unreconciled history you need, then export CSV. Leave the file in the browser's configured download folder.", current: 1, total: 4 }));
  let lastControl = 0;
  const csv = await waitForCsv({
    inbox,
    baseline,
    claimedAt: job.claimedAt,
    signal,
    control: async () => {
      if (Date.now() - lastControl < 2_500) return { cancelled: false };
      lastControl = Date.now();
      const result = await api.progress?.(
        structuredStatus("awaiting_export", { runId: job.runId, state: "waiting_for_new_csv", current: 1, total: 4 }),
        { signal },
      );
      return { cancelled: result?.cancel === true || result?.cancelled === true || result?.status === "cancelled" };
    },
  });
  await emit(structuredStatus("discovering", { runId: job.runId, state: "new_csv_detected", current: 2, total: 4 }));
  await emit(structuredStatus("verifying", { runId: job.runId, state: "validating_xero_csv", current: 2, total: 4 }));
  const parsed = preflightXeroUncodedStatementCsv(csv.buffer, {
    dateOrder: job.dateOrder,
    organisationNames: job.organisationNames,
  });
  const coverageNote = `All bank accounts requested; ${parsed.accountCount} account labels present in export. Completeness is not independently confirmed.`;
  await emit(structuredStatus("verifying", { runId: job.runId, state: "recognized_xero_export", message: coverageNote, rowCount: parsed.rowCount, accountCount: parsed.accountCount, current: 3, total: 4 }));
  if (signal?.aborted) throw new ExportCaptureError("CANCELLED", "The export capture was cancelled before upload.");
  await emit(structuredStatus("uploading", { runId: job.runId, state: "sending_csv_to_n8n", rowCount: parsed.rowCount, accountCount: parsed.accountCount, current: 3, total: 4 }));
  const result = await api.importCsv(
    { runId: job.runId, fileName: csv.name, csvText: csv.buffer.toString("utf8") },
    { signal },
  );
  // Import acceptance is not review completion. n8n owns the background
  // classification run and is the only component allowed to transition this
  // job to ready after its saved suggestions are actually complete.
  // Keep this last event local: the import webhook has already made the
  // authoritative transition. Posting another progress heartbeat here could
  // race a fast review and downgrade a terminal `ready` run to `reviewing`.
  api.localStatus?.(structuredStatus("reviewing", { runId: job.runId, state: "xero_untouched_review_started", message: coverageNote, rowCount: parsed.rowCount, accountCount: parsed.accountCount, current: 4, total: 4 }));
  return {
    runId: job.runId,
    rowCount: parsed.rowCount,
    accountCount: parsed.accountCount,
    allBankAccountsRequested: true,
    coverageConfirmed: false,
    coverageNote,
    result,
  };
}
