import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPORT_CAPTURE_MODE,
  OFFICIAL_UNCODED_LINES_URL,
  acquireCompanionLock,
  assertOfficialExportUrl,
  createN8nExportApi,
  defaultInboxDirectory,
  ensureDedicatedInbox,
  openOfficialExportPage,
  parseCsv,
  pollForExportJob,
  preflightXeroUncodedStatementCsv,
  runExportJob,
  snapshotInbox,
  waitForNewStableCsv,
} from "../skill/scripts/xero-export-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "uncoded-statement-lines.csv");
const fixture = await readFile(fixturePath);
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };
const rejects = async (action, pattern, message) => { checks += 1; await assert.rejects(action, pattern, message); };

const parsed = preflightXeroUncodedStatementCsv(fixture, {
  dateOrder: "DMY",
  organisationNames: ["MLAI", "MLAI Pty Ltd"],
});
check(parsed.rowCount === 3 && parsed.accountCount === 2, "the preflight parser should validate every row in an all-account export");
check(parsed.accountLabels.join(",") === "Business Everyday,Business Savings", "preflight should preserve exact bank-account labels for status only");
check(parsed.rows[0].combinedNarration.includes("INV-42") && parsed.rows[0].direction === "debit", "the grouped Xero narration and Spent column should remain intact");
check(parsed.rows[1].comments === "Duplicate bank line" && parsed.rows[1].yourComments === "Owner note", "Xero Discuss comments and offline Your Comments must stay distinct");
check(parsed.rows[0].occurrence === 1 && parsed.rows[1].occurrence === 2 && parsed.rows[0].sourceHash !== parsed.rows[1].sourceHash, "identical bank lines should remain a scan-scoped multiset");
const quoted = parseCsv('a,"b,b","line 1\nline 2"\n');
check(quoted.length === 1 && quoted[0][1] === "b,b" && quoted[0][2] === "line 1\nline 2", "CSV parsing should support quoted commas and newlines");
check(
  defaultInboxDirectory({ operatingSystem: "darwin", homeDirectory: "/Users/test" }) === "/Users/test/Downloads",
  "the zero-move default should watch the browser's normal Downloads folder",
);

await rejects(
  async () => preflightXeroUncodedStatementCsv("Bank Account,Date,Payee,Amount\nA,2026-08-27,P,10\n", { dateOrder: "DMY", organisationNames: ["MLAI"] }),
  /recognized Xero Uncoded Statement Lines/i,
  "a generic CSV must be rejected without the Xero report marker",
);
await rejects(
  async () => preflightXeroUncodedStatementCsv("Uncoded Statement Lines\nMLAI\nDate,Payee,Amount\n2026-08-27,P,10\n", { dateOrder: "DMY", organisationNames: ["MLAI"] }),
  /repeated Date, Payee, narration, Spent, and Received headers/i,
  "missing Xero grouped-report headers must fail closed",
);
await rejects(
  async () => preflightXeroUncodedStatementCsv(fixture, { organisationNames: ["MLAI"] }),
  /DMY or MDY/i,
  "the companion must not guess the meaning of slash dates",
);
await rejects(
  async () => preflightXeroUncodedStatementCsv(Buffer.from([0, 1, 2]), { dateOrder: "DMY", organisationNames: ["MLAI"] }),
  /plain-text CSV/i,
  "binary input must not reach n8n",
);
await rejects(
  async () => preflightXeroUncodedStatementCsv(
    "Bank Account,Date,Payee,Amount\nEveryday,2026-08-27,Uncoded Statement Lines,-10.00\n",
    { dateOrder: "DMY", organisationNames: ["MLAI"] },
  ),
  /preamble is not a recognized/i,
  "a report-title phrase inside transaction data must not spoof the Xero preamble",
);
await rejects(
  async () => preflightXeroUncodedStatementCsv(fixture, { dateOrder: "DMY", organisationNames: ["Another Organisation"] }),
  /does not name the expected organisation/i,
  "an export from another Xero organisation must fail closed",
);
await rejects(
  async () => preflightXeroUncodedStatementCsv([
    "Xero",
    "Uncoded Statement Lines",
    "Organisation,MLAI",
    "Business Account",
    "DATE,PAYEE,PARTICULARS,REFERENCE,CODE,SPENT,RECEIVED,TAX,COMMENTS,YOUR COMMENTS",
    "27/08/2026,Example Merchant,Office supplies,NEG-1,400,-12.50,,,,",
  ].join("\n"), { dateOrder: "DMY", organisationNames: ["MLAI"] }),
  /positive values/i,
  "negative values in Xero's separate Spent or Received columns must be rejected",
);
const emptyReport = Buffer.from([
  "Xero",
  "Uncoded Statement Lines",
  "Organisation,MLAI",
  "Empty Account",
  "DATE,PAYEE,PARTICULARS,REFERENCE,CODE,SPENT,RECEIVED,TAX,COMMENTS,YOUR COMMENTS",
  "There are no statement lines for this account",
].join("\n"));
const emptyParsed = preflightXeroUncodedStatementCsv(emptyReport, { dateOrder: "DMY", organisationNames: ["MLAI"] });
check(emptyParsed.rowCount === 0 && emptyParsed.accountCount === 1, "an explicit empty Xero account section is a valid zero-work report");
const usReport = Buffer.from([
  "Xero",
  "Uncoded Statement Lines",
  "Organisation,MLAI",
  "Business Account",
  "DATE,PAYEE,PARTICULARS,REFERENCE,CODE,SPENT,RECEIVED,TAX,COMMENTS,YOUR COMMENTS",
  '"Aug 27, 2026",Example Merchant,Office supplies,US-1,400,12.50,,,,'
].join("\n"));
const usParsed = preflightXeroUncodedStatementCsv(usReport, { dateOrder: "MDY", organisationNames: ["MLAI"] });
check(usParsed.rows[0].date === "2026-08-27", "US textual Xero dates should parse without guessing slash-date order");

check(assertOfficialExportUrl(OFFICIAL_UNCODED_LINES_URL).startsWith(OFFICIAL_UNCODED_LINES_URL), "the exact official export URL should be accepted");
check(
  assertOfficialExportUrl("https://go.xero.com/organisationlogin/default.aspx?shortcode=ABC123&redirecturl=%2FBanking%2FStatementLines%2FOffline").includes("organisationlogin"),
  "the official shortcode deep-link form should be accepted",
);
for (const blocked of [
  "https://example.com/Banking/StatementLines/Offline",
  "http://go.xero.com/Banking/StatementLines/Offline",
  "https://go.xero.com/Banking/StatementLines/Offline?next=https://example.com",
  "https://go.xero.com/Bank/BankAccounts",
]) {
  await rejects(async () => assertOfficialExportUrl(blocked), /official Uncoded Statement Lines/i, "non-exact navigation targets must be blocked");
}

const spawned = [];
await openOfficialExportPage(OFFICIAL_UNCODED_LINES_URL, {
  operatingSystem: "darwin",
  spawn(command, args, options) {
    spawned.push({ command, args, options });
    return { unref() {} };
  },
});
check(spawned[0].command === "/usr/bin/open" && spawned[0].args.length === 1, "macOS should use the user's normal browser through the OS opener");
check(spawned[0].options.shell === false && spawned[0].options.stdio === "ignore", "the URL opener must never invoke a shell or capture browser output");
await rejects(
  () => openOfficialExportPage(OFFICIAL_UNCODED_LINES_URL, {
    operatingSystem: "darwin",
    spawn() {
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit("error", new Error("sensitive local opener detail")));
      return child;
    },
  }),
  /could not open Xero/i,
  "an asynchronous operating-system opener error must be observed and redacted",
);
await rejects(
  () => openOfficialExportPage(OFFICIAL_UNCODED_LINES_URL, {
    operatingSystem: "darwin",
    spawnTimeoutMs: 20,
    spawn() {
      const child = new EventEmitter();
      child.unref = () => {};
      return child;
    },
  }),
  /timed out/i,
  "a silent operating-system opener must fail after a bounded wait",
);

const temporary = await mkdtemp(join(tmpdir(), "xero-export-companion-"));
try {
  const inbox = await ensureDedicatedInbox(join(temporary, "inbox"));
  const baseline = await snapshotInbox(inbox);
  const jobClaimedAt = new Date().toISOString();
  const waiting = waitForNewStableCsv({
    inbox,
    baseline,
    claimedAt: jobClaimedAt,
    limits: { scanIntervalMs: 5, maximumWaitMs: 1_000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(join(inbox, "UncodedStatementLines.csv"), fixture);
  const detected = await waiting;
  check(detected.name === "UncodedStatementLines.csv" && detected.buffer.equals(fixture), "only a new stable CSV should be read from the dedicated inbox");

  const existingName = "UncodedStatementLines-existing.csv";
  await writeFile(join(inbox, existingName), "old export");
  const overwriteBaseline = await snapshotInbox(inbox);
  const overwriteClaimedAt = new Date().toISOString();
  const waitingForOverwrite = waitForNewStableCsv({
    inbox,
    baseline: overwriteBaseline,
    claimedAt: overwriteClaimedAt,
    limits: { scanIntervalMs: 5, maximumWaitMs: 1_000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(join(inbox, existingName), fixture);
  const overwritten = await waitingForOverwrite;
  check(overwritten.name === existingName && overwritten.buffer.equals(fixture), "a browser overwrite using an existing filename should be accepted only after its identity, size, or mtime changes");

  await writeFile(join(inbox, "first-existing.csv"), "old first");
  await writeFile(join(inbox, "second-existing.csv"), "old second");
  // Re-baseline the two existing names, then change both after the claim.
  const twoExistingBaseline = await snapshotInbox(inbox);
  const twoExistingClaim = new Date().toISOString();
  const twoChanged = waitForNewStableCsv({
    inbox,
    baseline: twoExistingBaseline,
    claimedAt: twoExistingClaim,
    limits: { scanIntervalMs: 5, maximumWaitMs: 1_000 },
  });
  // Attach the expected-rejection observer before both writes. Under load the
  // polling promise can reject between Promise.all resolving and the next
  // statement, which would otherwise look like an unhandled rejection.
  const expectedMultipleCsvRejection = rejects(
    () => twoChanged,
    /More than one new CSV/i,
    "multiple changed baseline filenames must still fail closed",
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await Promise.all([
    writeFile(join(inbox, "first-existing.csv"), "changed first export"),
    writeFile(join(inbox, "second-existing.csv"), "changed second export"),
  ]);
  await expectedMultipleCsvRejection;

  const current = await snapshotInbox(inbox);
  await rejects(
    () => waitForNewStableCsv({
      inbox,
      baseline: current,
      claimedAt: new Date().toISOString(),
      control: async () => ({ cancelled: true }),
      limits: { scanIntervalMs: 1, maximumWaitMs: 50 },
    }),
    /cancelled from n8n/i,
    "an n8n cancellation should stop the local wait",
  );

  const target = join(temporary, "real-inbox");
  await ensureDedicatedInbox(target);
  const linked = join(temporary, "linked-inbox");
  await symlink(target, linked, "dir");
  await rejects(() => ensureDedicatedInbox(linked), /not a symlink/i, "the import inbox itself must never be a symlink");

  const markerTrapInbox = join(temporary, "marker-trap-inbox");
  await mkdir(markerTrapInbox, { mode: 0o700 });
  const markerTarget = join(temporary, "marker-target.json");
  await writeFile(markerTarget, "do not overwrite");
  await symlink(markerTarget, join(markerTrapInbox, ".mlai-xero-export-inbox.json"));
  await rejects(() => ensureDedicatedInbox(markerTrapInbox), /marker.*symlink/i, "the inbox marker must be inspected without following a symlink");
  check(await readFile(markerTarget, "utf8") === "do not overwrite", "marker setup must never overwrite a symlink target");

  const lockInbox = await ensureDedicatedInbox(join(temporary, "lock-inbox"));
  const firstLock = await acquireCompanionLock(lockInbox, { processId: 111 });
  await rejects(() => acquireCompanionLock(lockInbox, { processId: 222 }), /already watching/i, "only one companion may watch the same per-user inbox");
  await firstLock.release();
  const secondLock = await acquireCompanionLock(lockInbox, { processId: 222 });
  await secondLock.release();
  await rejects(() => lstat(secondLock.path), /ENOENT/, "normal companion shutdown should remove its exclusive lock");

  const replacementLock = await acquireCompanionLock(lockInbox, { processId: 333 });
  const replacementTarget = join(temporary, "replacement-lock-target");
  await writeFile(replacementTarget, "replacement");
  await unlink(replacementLock.path);
  await symlink(replacementTarget, replacementLock.path);
  await replacementLock.release();
  const replacementStats = await lstat(replacementLock.path);
  check(replacementStats.isSymbolicLink(), "lock cleanup must not follow or delete a replacement symlink");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const requests = [];
const api = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "bridge-secret-at-least-twenty-four-characters",
  companionId: "companion-redacted",
  stdout: { write() {} },
  async fetchImplementation(url, options) {
    const requestBody = JSON.parse(options.body);
    requests.push({ url: String(url), options, body: requestBody });
    const path = new URL(url).pathname;
    const responseBody = path.endsWith("claim")
      ? { ok: true, job: { mode: EXPORT_CAPTURE_MODE, run_id: "run-redacted", claimed_at: new Date().toISOString(), date_order: "DMY" } }
      : path.endsWith("progress")
        ? { ok: true, cancelled: false, run_id: requestBody.run_id, status: requestBody.status }
        : { ok: true, run: { runId: requestBody.run_id, state: "reviewing" }, reviewRunId: "review-run-redacted" };
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
const claimed = await api.claim();
await api.progress({ event: "awaiting_export", runId: "run-redacted", state: "waiting", current: 1, total: 4, requiresUserLogin: true });
await api.importCsv({ runId: "run-redacted", fileName: "Uncoded.csv", csvText: fixture.toString("utf8") });
check(claimed.job.run_id === "run-redacted", "the companion should claim work from n8n");
check(requests.map((request) => new URL(request.url).pathname).join(",") === "/webhook/xero-capture-claim,/webhook/xero-capture-progress,/webhook/xero-capture-import", "bridge calls should use only the settled n8n routes");
check(requests.every((request) => request.options.headers["X-Xero-Capture-Key"] === "bridge-secret-at-least-twenty-four-characters"), "every bridge call should use the named header secret");
check(
  JSON.stringify(requests[0].body) === JSON.stringify({ schema_version: 1, companion_id: "companion-redacted", app_version: "xero-export-companion/1" }),
  "claim should use the exact companion contract",
);
check(requests[1].body.status === "awaiting_export" && requests[1].body.requires_user_login === true, "progress should use the exact snake-case bridge contract");
check(
  requests[2].body.schema_version === 1
    && requests[2].body.run_id === "run-redacted"
    && requests[2].body.file_name === "Uncoded.csv"
    && requests[2].body.csv_text === fixture.toString("utf8")
    && requests[2].body.all_bank_accounts_requested === true
    && !("all_bank_accounts_confirmed" in requests[2].body),
  "import should send the raw CSV once so n8n remains the sole canonical envelope parser",
);
check(/^xero-import-[a-f0-9]{64}$/.test(requests[2].options.headers["Idempotency-Key"]), "every import should carry a deterministic bounded idempotency key");

const retryEvents = [];
const retryWaits = [];
let transientClaims = 0;
const restartingApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "another-bridge-secret-at-least-twenty-four-characters",
  companionId: "companion-redacted",
  stdout: { write(line) { retryEvents.push(JSON.parse(line)); } },
  async fetchImplementation() {
    transientClaims += 1;
    if (transientClaims === 1) throw new Error("sensitive network failure detail");
    if (transientClaims < 4) return new Response("sensitive upstream 503 detail", { status: 503 });
    return new Response(JSON.stringify({ ok: true, job: { mode: EXPORT_CAPTURE_MODE, run_id: "run-after-restart" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
const recoveredJob = await pollForExportJob(restartingApi, {
  intervalMs: 250,
  maximumIntervalMs: 300,
  async pause(milliseconds) { retryWaits.push(milliseconds); },
});
check(recoveredJob.run_id === "run-after-restart" && transientClaims === 4, "transient claim failures should not terminate the always-on companion");
check(retryWaits.join(",") === "250,300,300", "claim retry delays should use bounded backoff");
check(
  retryEvents.every((event) => event.code === "N8N_TEMPORARILY_UNAVAILABLE" && !JSON.stringify(event).includes("sensitive")),
  "claim retry events should remain structured and redact upstream failure details",
);
const invalidContractApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "contract-bridge-secret-at-least-twenty-four-characters",
  stdout: { write() {} },
  async fetchImplementation() { return new Response("not JSON", { status: 200 }); },
});
await rejects(
  () => pollForExportJob(invalidContractApi, { intervalMs: 1, async pause() {} }),
  /invalid response/i,
  "non-retryable configuration and contract failures should fail fast",
);
for (const endpoint of ["claim", "progress", "import"]) {
  const invalidSuccessApi = createN8nExportApi({
    baseUrl: "https://n8n.example.test",
    secret: `invalid-${endpoint}-success-secret-long-enough`,
    stdout: { write() {} },
    async fetchImplementation() {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await rejects(
    () => endpoint === "claim"
      ? invalidSuccessApi.claim()
      : endpoint === "progress"
        ? invalidSuccessApi.progress({ event: "preflight", runId: "run-invalid-shape", state: "checking" })
        : invalidSuccessApi.importCsv({ runId: "run-invalid-shape", fileName: "Uncoded.csv", csvText: "invalid" }),
    /invalid response/i,
    `a nominally successful ${endpoint} response must still match its exact endpoint contract`,
  );
}
const rejectedImportApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "rejected-import-secret-at-least-twenty-four-characters",
  stdout: { write() {} },
  async fetchImplementation() {
    return new Response(JSON.stringify({ ok: false, error: { code: "CSV_INVALID" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
await rejects(
  () => rejectedImportApi.importCsv({ runId: "run-redacted", fileName: "Uncoded.csv", csvText: "invalid" }),
  /rejected the request|rejected the Xero export/i,
  "an application-level import rejection must not be mistaken for review acceptance",
);

for (const endpoint of ["claim", "progress"]) {
  const rejectedApi = createN8nExportApi({
    baseUrl: "https://n8n.example.test",
    secret: `structured-${endpoint}-rejection-secret-long-enough`,
    stdout: { write() {} },
    async fetchImplementation() {
      return new Response(JSON.stringify({ ok: false, error: { code: "REJECTED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await rejects(
    () => endpoint === "claim"
      ? rejectedApi.claim()
      : rejectedApi.progress({ event: "preflight", runId: "run-redacted", state: "checking" }),
    /rejected the request/i,
    `a structured ok:false ${endpoint} response must be rejected`,
  );
}

const retryBodies = [];
const retrySignals = [];
const retryIdempotencyKeys = [];
let progressAttempts = 0;
let importAttempts = 0;
const resilientApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "bounded-retry-secret-at-least-twenty-four-characters",
  companionId: "companion-retry-tests",
  stdout: { write() {} },
  requestRetryAttempts: 3,
  requestRetryBaseMs: 1,
  requestRetryMaximumMs: 1,
  async retryPause() {},
  async fetchImplementation(url, options) {
    const path = new URL(url).pathname;
    retrySignals.push(options.signal);
    retryBodies.push(JSON.parse(options.body));
    if (path.endsWith("progress")) {
      progressAttempts += 1;
      if (progressAttempts < 3) return new Response("temporary", { status: 503 });
    } else {
      importAttempts += 1;
      retryIdempotencyKeys.push(options.headers["Idempotency-Key"]);
      if (importAttempts < 3) return new Response("temporary", { status: 503 });
    }
    const responseBody = path.endsWith("progress")
      ? { ok: true, cancelled: false, run_id: "run-retry", status: "uploading" }
      : { ok: true, run: { runId: "run-retry", state: "reviewing" }, reviewRunId: "review-run-retry" };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
const resilientController = new AbortController();
await resilientApi.progress({ event: "uploading", runId: "run-retry", state: "uploading" }, { signal: resilientController.signal });
await resilientApi.importCsv({ runId: "run-retry", fileName: "Uncoded.csv", csvText: fixture.toString("utf8") }, { signal: resilientController.signal });
check(progressAttempts === 3 && importAttempts === 3, "progress and import should use bounded retry attempts for transient failures");
check(retrySignals.every((value) => value instanceof AbortSignal), "every retry attempt should receive a composed AbortSignal");
check(new Set(retryIdempotencyKeys).size === 1, "all ambiguous import retry attempts must carry the same idempotency key");
check(retryBodies.filter((body) => body.csv_text).every((body) => body.run_id === "run-retry"), "import retries must preserve the same run-bound request body");

const leaseRetryWaits = [];
const leaseRetryKeys = [];
let leaseAttempts = 0;
const leaseApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "import-lease-retry-secret-at-least-twenty-four-characters",
  companionId: "companion-import-lease",
  stdout: { write() {} },
  importRetryAttempts: 3,
  importRetryBaseMs: 100,
  importRetryMaximumMs: 1_500,
  async retryPause(milliseconds) { leaseRetryWaits.push(milliseconds); },
  async fetchImplementation(url, options) {
    leaseAttempts += 1;
    leaseRetryKeys.push(options.headers["Idempotency-Key"]);
    if (leaseAttempts < 3) {
      return new Response(JSON.stringify({ ok: false, error: { code: "IMPORT_LEASE_BUSY" } }), {
        status: 425,
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      run: { runId: "run-lease", state: "reviewing" },
      reviewRunId: "review-run-lease",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
await leaseApi.importCsv({ runId: "run-lease", fileName: "Uncoded.csv", csvText: fixture.toString("utf8") });
check(leaseAttempts === 3 && leaseRetryWaits.join(",") === "1000,1000", "HTTP 425 import lease contention should use bounded Retry-After-aware backoff");
check(new Set(leaseRetryKeys).size === 1, "lease retries must retain one deterministic import idempotency key");

let timedOutSignal;
const timeoutApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "bounded-timeout-secret-at-least-twenty-four-characters",
  stdout: { write() {} },
  requestTimeoutMs: 20,
  requestRetryAttempts: 1,
  fetchImplementation(url, options) {
    timedOutSignal = options.signal;
    return new Promise(() => {});
  },
});
await rejects(
  () => timeoutApi.progress({ event: "preflight", runId: "run-timeout", state: "checking" }),
  /bounded request timeout/i,
  "each bridge request must fail after a bounded timeout even if the transport ignores abort",
);
check(timedOutSignal.aborted === true, "request timeout should abort the underlying transport signal");

let longImportAttempts = 0;
const longerImportApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "longer-import-timeout-secret-at-least-twenty-four-characters",
  stdout: { write() {} },
  requestTimeoutMs: 20,
  importRequestTimeoutMs: 100,
  importRetryAttempts: 1,
  fetchImplementation(url, options) {
    longImportAttempts += 1;
    const body = JSON.parse(options.body);
    return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({
      ok: true,
      run: { runId: body.run_id, state: "reviewing" },
      reviewRunId: "review-run-longer-timeout",
    }), { status: 200, headers: { "Content-Type": "application/json" } })), 50));
  },
});
await longerImportApi.importCsv({ runId: "run-long-timeout", fileName: "Uncoded.csv", csvText: fixture.toString("utf8") });
check(longImportAttempts === 1, "imports should get a bounded longer response window than ordinary bridge calls");

let propagatedSignal;
const abortingApi = createN8nExportApi({
  baseUrl: "https://n8n.example.test",
  secret: "abort-propagation-secret-at-least-twenty-four-characters",
  stdout: { write() {} },
  requestRetryAttempts: 1,
  fetchImplementation(url, options) {
    propagatedSignal = options.signal;
    return new Promise(() => {});
  },
});
const externalAbort = new AbortController();
const abortedProgress = abortingApi.progress({ event: "preflight", runId: "run-abort", state: "checking" }, { signal: externalAbort.signal });
externalAbort.abort();
await rejects(() => abortedProgress, /cancelled/i, "caller cancellation must immediately stop a bridge request");
check(propagatedSignal.aborted === true, "caller cancellation must propagate to the underlying fetch signal");

const runDirectory = await mkdtemp(join(tmpdir(), "xero-export-run-"));
await rejects(
  () => runExportJob({
    job: {
      mode: "xero-uncoded-statement-lines-export",
      run_id: "run-legacy-mode",
      claimed_at: new Date().toISOString(),
      date_order: "DMY",
      organisation_name: "MLAI",
    },
    api: {},
    inboxDirectory: join(runDirectory, "legacy-mode-inbox"),
  }),
  /Only a user-mediated Xero export job/i,
  "the companion should accept only the canonical user-mediated export mode literal",
);
try {
  const statuses = [];
  const remoteStatuses = [];
  const propagatedRunSignals = [];
  let opened = "";
  let imported = null;
  const runController = new AbortController();
  const run = await runExportJob({
    job: {
      mode: EXPORT_CAPTURE_MODE,
      run_id: "run-user-mediated",
      claimed_at: new Date().toISOString(),
      date_order: "DMY",
      organisation_name: "MLAI",
    },
    inboxDirectory: join(runDirectory, "inbox"),
    signal: runController.signal,
    api: {
      localStatus(event) { statuses.push(event.event); },
      async progress(event, options) { remoteStatuses.push(event.event); propagatedRunSignals.push(options?.signal); return {}; },
      async importCsv(value, options) { imported = value; propagatedRunSignals.push(options?.signal); return { ok: true }; },
    },
    async openExportPage(url) { opened = url; },
    async waitForCsv() { return { name: "Uncoded.csv", buffer: fixture }; },
  });
  check(opened === OFFICIAL_UNCODED_LINES_URL, "a run should open only the official report URL");
  check(statuses.join(",") === "preflight,opening,awaiting_login,awaiting_export,discovering,verifying,verifying,uploading,reviewing", "import acceptance should hand off to background review rather than claim suggestions are already ready");
  check(!remoteStatuses.includes("reviewing"), "the companion must not race n8n's authoritative reviewing or ready transition");
  check(propagatedRunSignals.every((value) => value === runController.signal), "the job-level AbortSignal should propagate through progress, control, and import calls");
  check(imported.runId === "run-user-mediated" && imported.csvText === fixture.toString("utf8"), "the validated raw export should be uploaded exactly once");
  check(run.rowCount === 3 && run.accountCount === 2, "the ready result should report locally verified counts without transaction content");
  check(run.allBankAccountsRequested === true && run.coverageConfirmed === false, "the result must distinguish requesting all accounts from proving complete coverage");
  check(run.coverageNote.includes("2 account labels present") && run.coverageNote.includes("not independently confirmed"), "coverage wording should report only what the export proves");
} finally {
  await rm(runDirectory, { recursive: true, force: true });
}

const implementation = await readFile(join(here, "../skill/scripts/xero-export-capture.mjs"), "utf8");
const cli = await readFile(join(here, "../skill/scripts/xero-export-companion.mjs"), "utf8");
for (const forbidden of ["playwright", "puppeteer", "chromium.launch", ".click(", "storageState", "cookies(", "document.querySelector"]) {
  check(!implementation.includes(forbidden) && !cli.includes(forbidden), `${forbidden} browser automation must remain absent`);
}
check(implementation.includes("shell: false"), "the user-mediated companion should have no shell-injection path");
check(!implementation.includes("Xero password") && !implementation.includes("verification code"), "the companion should not accept credential fields");

process.stdout.write(`Xero export companion: ${checks} checks passed.\n`);
