#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { ingestPayload, validateCaptureEnvelope } from "./capture-models.mjs";

const env = process.env;
const port = Number(env.XERO_CAPTURE_PORT || 8461);
const ttlMs = Math.min(300, Math.max(1, Number(env.XERO_CAPTURE_TOKEN_TTL_SECONDS || 300))) * 1000;
const n8nBase = String(env.XERO_CAPTURE_N8N_URL || "").replace(/\/$/, "");
const ingestSecret = String(env.XERO_CAPTURE_INGEST_SECRET || "");
const headerName = String(env.XERO_CAPTURE_HEADER_NAME || "X-Xero-Capture-Key");
const token = randomBytes(32).toString("base64url");
const expiresAt = Date.now() + ttlMs;
let consumed = false;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function allowedRemoteUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname));
  } catch {
    return false;
  }
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("XERO_CAPTURE_PORT must be between 1024 and 65535");
if (!allowedRemoteUrl(n8nBase)) throw new Error("XERO_CAPTURE_N8N_URL must be HTTPS, except for a loopback n8n instance");
if (ingestSecret.length < 24) throw new Error("XERO_CAPTURE_INGEST_SECRET must contain at least 24 characters");
if (!/^[A-Za-z0-9-]+$/.test(headerName)) throw new Error("XERO_CAPTURE_HEADER_NAME is invalid");

function json(response, status, body, origin = "") {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    ...(origin.startsWith("chrome-extension://") ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  });
  response.end(data);
}

async function bodyOf(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 5 * 1024 * 1024) throw new Error("request is larger than 5 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorise(request) {
  const supplied = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (consumed) return { ok: false, status: 409, detail: "capture token has already been used" };
  if (Date.now() > expiresAt) return { ok: false, status: 401, detail: "capture token has expired" };
  if (!safeEqual(supplied, token)) return { ok: false, status: 401, detail: "invalid capture token" };
  consumed = true;
  return { ok: true };
}

async function forward(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${n8nBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [headerName]: ingestSecret },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.detail || `n8n returned ${response.status}`);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

const server = createServer(async (request, response) => {
  const origin = String(request.headers.origin || "");
  if (request.method === "OPTIONS") {
    if (!origin.startsWith("chrome-extension://")) return json(response, 403, { detail: "extension origin required" });
    response.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Max-Age": "300",
      "Vary": "Origin",
    });
    return response.end();
  }
  if (request.method === "GET" && request.url === "/healthz") {
    return json(response, 200, { ready: !consumed && Date.now() <= expiresAt, loopback_only: true, xero_credentials: false, xero_writes: false });
  }
  if (request.method !== "POST" || !["/capture", "/annotations"].includes(request.url || "")) {
    return json(response, 404, { detail: "not found" }, origin);
  }
  if (!origin.startsWith("chrome-extension://")) return json(response, 403, { detail: "extension origin required" }, origin);
  const auth = authorise(request);
  if (!auth.ok) return json(response, auth.status, { detail: auth.detail }, origin);
  try {
    const raw = await bodyOf(request);
    if (request.url === "/capture") {
      const payload = ingestPayload(validateCaptureEnvelope(raw));
      const result = await forward("/webhook/xero-statement-scan", payload);
      return json(response, 200, { ...result, xero_writes: false, final_match_ok_untouched: true }, origin);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("annotation request must be an object");
    if (Object.keys(raw).some((key) => !["bank_account_id", "statement_lines"].includes(key))) throw new Error("annotation request has unsupported fields");
    const bankAccountId = typeof raw.bank_account_id === "string" ? raw.bank_account_id.trim() : "";
    const sourceLines = Array.isArray(raw.statement_lines) ? raw.statement_lines.slice(0, 501) : [];
    const statementLines = sourceLines.map((line) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) throw new Error("annotation statement line must be an object");
      if (Object.keys(line).some((key) => !["statement_line_id", "source_hash"].includes(key))) throw new Error("annotation statement line has unsupported fields");
      const statementLineId = typeof line.statement_line_id === "string" ? line.statement_line_id.trim() : "";
      const sourceHash = typeof line.source_hash === "string" ? line.source_hash.trim() : "";
      if (!statementLineId || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("annotation statement lines require an ID and SHA-256 source hash");
      return { statement_line_id: statementLineId, source_hash: sourceHash };
    });
    if (!bankAccountId || !statementLines.length || statementLines.length > 500) throw new Error("bank_account_id and up to 500 statement_lines are required");
    if (new Set(statementLines.map((line) => line.statement_line_id)).size !== statementLines.length) throw new Error("annotation statement line IDs must be unique");
    return json(response, 200, await forward("/webhook/xero-annotations", { bank_account_id: bankAccountId, statement_lines: statementLines }), origin);
  } catch (error) {
    return json(response, /n8n returned|fetch|abort/i.test(String(error)) ? 502 : 400, { detail: String(error?.message || error) }, origin);
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Xero capture receiver: http://127.0.0.1:${port}/capture\n`);
  process.stdout.write(`One-use token: ${token}\n`);
  process.stdout.write(`Expires: ${new Date(expiresAt).toISOString()}\n`);
  process.stdout.write("The receiver has no Xero credential and cannot click or write in Xero.\n");
});

const expiryTimer = setTimeout(() => server.close(), ttlMs + 1000);
expiryTimer.unref();
