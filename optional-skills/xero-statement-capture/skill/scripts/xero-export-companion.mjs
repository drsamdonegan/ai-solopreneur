#!/usr/bin/env node
import {
  EXPORT_CAPTURE_MODE,
  ExportCaptureError,
  acquireCompanionLock,
  createN8nExportApi,
  defaultInboxDirectory,
  ensureDedicatedInbox,
  pollForExportJob,
  readPrivateBridgeSecret,
  runExportJob,
  structuredStatus,
} from "./xero-export-capture.mjs";

const env = process.env;
const controller = new AbortController();
let api;
let activeRunId = "";
let companionLock;

function print(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function parseDirectJob(value) {
  if (!String(value || "").trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* shaped below */ }
  throw new ExportCaptureError("INVALID_DIRECT_JOB", "XERO_EXPORT_DIRECT_JOB_JSON must be a JSON object.");
}

async function reportFailure(error, runId = "") {
  const event = structuredStatus(error?.code === "CANCELLED" ? "cancelled" : "failed", {
    runId,
    code: String(error?.code || "EXPORT_CAPTURE_FAILED"),
    state: "xero_untouched",
    message: String(error?.message || error).slice(0, 500),
  });
  print(event);
  try { await api?.progress?.(event); } catch { /* local status still explains the failure */ }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => controller.abort());

try {
  if (String(env.XERO_EXPORT_CAPTURE_ENABLED || "").trim() !== EXPORT_CAPTURE_MODE) {
    throw new ExportCaptureError("FEATURE_DISABLED", `Set XERO_EXPORT_CAPTURE_ENABLED=${EXPORT_CAPTURE_MODE} to enable the private user-mediated export companion.`);
  }
  const directBridgeSecret = String(env.XERO_CAPTURE_INGEST_SECRET || "").trim();
  const bridgeSecretFile = String(env.XERO_CAPTURE_INGEST_SECRET_FILE || "").trim();
  if (directBridgeSecret && bridgeSecretFile) {
    throw new ExportCaptureError(
      "AMBIGUOUS_BRIDGE_SECRET",
      "Configure either XERO_CAPTURE_INGEST_SECRET or XERO_CAPTURE_INGEST_SECRET_FILE, not both.",
    );
  }
  const bridgeSecret = bridgeSecretFile
    ? await readPrivateBridgeSecret(bridgeSecretFile)
    : directBridgeSecret;
  api = createN8nExportApi({
    baseUrl: env.XERO_CAPTURE_N8N_URL,
    secret: bridgeSecret,
    headerName: env.XERO_CAPTURE_HEADER_NAME || "X-Xero-Capture-Key",
    routes: {
      claim: env.XERO_CAPTURE_CLAIM_PATH,
      progress: env.XERO_CAPTURE_PROGRESS_PATH,
      import: env.XERO_CAPTURE_IMPORT_PATH,
    },
  });
  const inboxDirectory = await ensureDedicatedInbox(env.XERO_EXPORT_INBOX_DIR || defaultInboxDirectory({ env }));
  companionLock = await acquireCompanionLock(inboxDirectory);
  const direct = parseDirectJob(env.XERO_EXPORT_DIRECT_JOB_JSON);
  const daemon = env.XERO_EXPORT_DAEMON === "true" && !direct;
  print(structuredStatus("preflight", { companionId: api.companionId, state: direct ? "direct_job_ready" : "waiting_for_n8n_job" }));
  do {
    const job = direct || await pollForExportJob(api, { signal: controller.signal });
    activeRunId = String(job?.run_id || job?.runId || "");
    try {
      await runExportJob({ job, api, inboxDirectory, signal: controller.signal });
      activeRunId = "";
    } catch (error) {
      if (!daemon) throw error;
      await reportFailure(error, activeRunId);
      activeRunId = "";
    }
  } while (daemon && !controller.signal.aborted);
} catch (error) {
  await reportFailure(error, activeRunId);
  process.exitCode = 1;
} finally {
  try { await companionLock?.release(); } catch (error) {
    print(structuredStatus("failed", {
      runId: activeRunId,
      code: "COMPANION_LOCK_CLEANUP_FAILED",
      state: "xero_untouched",
      message: "The local companion lock could not be cleaned up safely.",
    }));
    process.exitCode = 1;
  }
}
