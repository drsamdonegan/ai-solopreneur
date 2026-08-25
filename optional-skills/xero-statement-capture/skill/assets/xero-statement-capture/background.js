"use strict";

const CONFIG_KEY = "xeroCaptureConfig";
const DRAFT_KEY = "xeroCaptureDraft";

const sessionGet = async (key) => (await chrome.storage.session.get(key))[key] || null;
const sessionSet = async (key, value) => chrome.storage.session.set({ [key]: value });
const normalize = (value) => String(value || "").trim();

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function annotationLine(line) {
  const { has_ok_button: _ok, parse_warnings: _warnings, ...stable } = line;
  return { statement_line_id: line.statement_line_id, source_hash: await sha256(stable) };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !normalize(tab.url).startsWith("https://go.xero.com/")) {
    throw new Error("Open the Xero bank reconciliation page in this tab first.");
  }
  return tab;
}

async function captureVisiblePage() {
  const tab = await activeTab();
  const response = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_XERO_PAGE" });
  if (!response || !response.ok) throw new Error(response?.error || "Xero page capture failed.");
  return { tab, capture: response.capture };
}

function newDraft(page) {
  return {
    schema_version: 1,
    scan_id: `scan-${crypto.randomUUID()}`,
    bank_account_id: page.bank_account_id,
    started_at: new Date().toISOString(),
    expected_count: page.expected_count,
    pages: {},
    errors: [],
    layout: page.layout || "unknown",
  };
}

function addPage(draft, page) {
  if (draft.bank_account_id !== page.bank_account_id) draft.errors.push("bank account changed during capture");
  if (draft.expected_count !== page.expected_count) draft.errors.push("expected statement count changed during capture");
  if (page.capture_error) draft.errors.push(page.capture_error);
  draft.pages[String(page.page.page_number)] = { evidence: page.page, lines: page.lines };
  draft.layout = page.layout || draft.layout;
  return draft;
}

function summary(draft) {
  const pages = Object.values(draft?.pages || {});
  const rows = pages.flatMap((page) => page.lines);
  return {
    scan_id: draft?.scan_id || "",
    bank_account_id: draft?.bank_account_id || "",
    expected_count: draft?.expected_count ?? null,
    observed_count: rows.length,
    captured_pages: pages.map((page) => page.evidence.page_number).sort((a, b) => a - b),
    errors: draft?.errors || [],
    layout: draft?.layout || "unknown",
  };
}

function envelope(draft) {
  const pages = Object.values(draft.pages).sort((a, b) => a.evidence.page_number - b.evidence.page_number);
  const lines = new Map();
  const errors = [...draft.errors];
  for (const page of pages) {
    for (const line of page.lines) {
      const prior = lines.get(line.statement_line_id);
      if (prior && canonical(prior) !== canonical(line)) errors.push(`statement line ${line.statement_line_id} changed between pages`);
      else lines.set(line.statement_line_id, line);
    }
  }
  return {
    schema_version: 1,
    scan_id: draft.scan_id,
    bank_account_id: draft.bank_account_id,
    started_at: draft.started_at,
    completed_at: new Date().toISOString(),
    expected_count: draft.expected_count,
    pages: pages.map((page) => page.evidence),
    lines: [...lines.values()],
    capture_error: [...new Set(errors.filter(Boolean))].join("; "),
  };
}

async function saveConfig(raw) {
  const endpoint = normalize(raw.endpoint);
  if (endpoint !== "http://127.0.0.1:8461/capture") throw new Error("The receiver must be http://127.0.0.1:8461/capture");
  const token = normalize(raw.token);
  if (token.length < 32) throw new Error("Paste the one-use token printed by the capture helper.");
  await sessionSet(CONFIG_KEY, { endpoint, token });
}

async function oneShotPost(path, body) {
  const config = await sessionGet(CONFIG_KEY);
  if (!config) throw new Error("Paste a new one-use receiver token first.");
  try {
    const response = await fetch(config.endpoint.replace(/\/capture$/, path), {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Receiver returned ${response.status}`);
    return payload;
  } finally {
    await chrome.storage.session.remove(CONFIG_KEY);
  }
}

async function captureCurrentPage() {
  const first = await captureVisiblePage();
  const second = await captureVisiblePage();
  const stableFields = (capture) => ({
    bank_account_id: capture.bank_account_id,
    expected_count: capture.expected_count,
    page: capture.page,
    lines: capture.lines,
  });
  const capture = second.capture;
  if (canonical(stableFields(first.capture)) !== canonical(stableFields(second.capture))) {
    capture.capture_error = [capture.capture_error, "page changed between repeated observations"].filter(Boolean).join("; ");
  }
  const current = await sessionGet(DRAFT_KEY);
  const draft = addPage(current || newDraft(capture), capture);
  await sessionSet(DRAFT_KEY, draft);
  return summary(draft);
}

async function submitCapture() {
  const draft = await sessionGet(DRAFT_KEY);
  if (!draft) throw new Error("Capture at least one visible Xero page first.");
  try {
    return await oneShotPost("/capture", envelope(draft));
  } finally {
    await chrome.storage.session.remove(DRAFT_KEY);
  }
}

async function captureAndSubmit(config) {
  await saveConfig(config);
  await chrome.storage.session.remove(DRAFT_KEY);
  await captureCurrentPage();
  return submitCapture();
}

async function refreshAnnotations(config) {
  await saveConfig(config);
  const { tab, capture } = await captureVisiblePage();
  const payload = await oneShotPost("/annotations", {
    bank_account_id: capture.bank_account_id,
    statement_lines: await Promise.all(capture.lines.map(annotationLine)),
  });
  const applied = await chrome.tabs.sendMessage(tab.id, {
    type: "APPLY_XERO_ANNOTATIONS",
    annotations: payload.annotations || [],
  });
  return { ...payload, applied: Number(applied?.applied || 0) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "CAPTURE_AND_SUBMIT": return captureAndSubmit(message.config || {});
      case "CAPTURE_PAGE": return captureCurrentPage();
      case "SUBMIT_CAPTURE": { await saveConfig(message.config || {}); return submitCapture(); }
      case "RESET_CAPTURE": await chrome.storage.session.remove(DRAFT_KEY); return { reset: true };
      case "REFRESH_ANNOTATIONS": return refreshAnnotations(message.config || {});
      case "GET_STATUS": return { draft: summary(await sessionGet(DRAFT_KEY)) };
      default: throw new Error("Unknown extension request.");
    }
  };
  run().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: String(error?.message || error) }),
  );
  return true;
});
