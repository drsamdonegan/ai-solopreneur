import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccessGate } from "../apps/chat/dist/access.js";
import { DEFAULT_AGENTS } from "../apps/chat/dist/agents.js";
import { createChatServer } from "../apps/chat/dist/app.js";
import { ChatStore } from "../apps/chat/dist/chat-store.js";

const temporary = await mkdtemp(join(tmpdir(), "xero-capture-api-test-"));
const publicDirectory = join(temporary, "public");
await mkdir(publicDirectory, { recursive: true });
await Promise.all([
  writeFile(join(publicDirectory, "index.html"), "<!doctype html><title>test</title>"),
  writeFile(join(publicDirectory, "app.js"), ""),
  writeFile(join(publicDirectory, "agent.config.js"), ""),
  writeFile(join(publicDirectory, "styles.css"), ""),
]);

const controlSecret = "control-secret-with-at-least-24-characters";
const passcode = "correct-horse-battery-staple";
const sessionId = "11111111-1111-4111-8111-111111111111";
const nonBookkeepingSessionId = "22222222-2222-4222-8222-222222222222";
const webhookCalls = [];
const redirectReceiverCalls = [];
let latestRun = null;
let redirectStatusTo = "";
let reuseExistingStart = false;
let oversizedStatus = false;

const redirectReceiver = createServer((request, response) => {
  redirectReceiverCalls.push({
    path: request.url,
    control: request.headers["x-xero-capture-control"],
  });
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ schemaVersion: 1, run: latestRun }));
});
redirectReceiver.listen(0, "127.0.0.1");
await once(redirectReceiver, "listening");
const redirectReceiverAddress = redirectReceiver.address();
assert(redirectReceiverAddress && typeof redirectReceiverAddress === "object");

const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  webhookCalls.push({
    path: request.url,
    method: request.method,
    control: request.headers["x-xero-capture-control"],
    body,
  });
  if (request.url === "/webhook/xero-capture-status" && redirectStatusTo) {
    response.statusCode = 302;
    response.setHeader("location", redirectStatusTo);
    redirectStatusTo = "";
    response.end();
    return;
  }
  if (request.url === "/webhook/xero-capture-status" && oversizedStatus) {
    oversizedStatus = false;
    response.setHeader("content-type", "application/json");
    response.write('{"padding":"');
    for (let index = 0; index < 80; index += 1) {
      response.write("x".repeat(16_384));
    }
    response.end('"}');
    return;
  }
  response.setHeader("content-type", "application/json");
  const timestamp = "2026-08-27T01:02:03.000Z";
  if (request.url === "/webhook/xero-capture-start") {
    if (reuseExistingStart && latestRun) {
      response.end(JSON.stringify({
        schemaVersion: 1,
        status: "already-running",
        run: latestRun,
      }));
      return;
    }
    latestRun = {
      runId: body.runId,
      source: body.source,
      state: "awaiting_export",
      // Must never cross the chat proxy into the browser.
      note: "ACME CUSTOMER PAID $12,345 — private statement detail",
      financialLines: [{ narration: "private", amount: "12345" }],
      current: 0,
      total: 3,
      accountCount: 3,
      capturedCount: 0,
      expectedCount: 41,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    response.end(JSON.stringify({ schemaVersion: 1, run: latestRun }));
    return;
  }
  if (request.url === "/webhook/xero-capture-status") {
    response.end(JSON.stringify({ schemaVersion: 1, run: latestRun }));
    return;
  }
  if (request.url === "/webhook/xero-capture-cancel") {
    latestRun = {
      ...latestRun,
      state: "cancelled",
      note: "private cancellation detail",
      errorCode: "CANCELLED",
      updatedAt: timestamp,
    };
    response.end(JSON.stringify({ schemaVersion: 1, run: latestRun }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const upstreamAddress = upstream.address();
assert(upstreamAddress && typeof upstreamAddress === "object");
const upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}/webhook/chat`;

async function startGateway({ enabled, secret, gated = false }) {
  const chatStore = new ChatStore(":memory:");
  chatStore.createConversation(sessionId, "bookkeeping");
  chatStore.createConversation(nonBookkeepingSessionId, "project-manager");
  const server = createChatServer({
    agents: DEFAULT_AGENTS,
    chatStore,
    publicDirectory,
    upstreamUrl,
    xeroCaptureEnabled: enabled,
    ...(secret === undefined ? {} : { xeroCaptureControlSecret: secret }),
    ...(gated
      ? {
          accessGate: createAccessGate({
            passcode,
            sessionSecret: "a".repeat(64),
            secureCookie: false,
            proxyHops: 1,
          }),
        }
      : {}),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      chatStore.close();
    },
  };
}

async function jsonRequest(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  const body = await response.json();
  return { response, body, raw: JSON.stringify(body) };
}

let gateway;
try {
  // The feature is fail-closed by default, and also when the independent
  // control secret is missing. Neither case contacts n8n.
  for (const configuration of [
    { enabled: undefined, secret: undefined },
    { enabled: true, secret: undefined },
  ]) {
    gateway = await startGateway(configuration);
    const before = webhookCalls.length;
    let result = await jsonRequest(
      gateway.origin,
      `/api/xero-capture/runs?sessionId=${sessionId}`,
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.body.enabled, false);
    assert.equal(result.body.readOnly, true);
    assert.equal(result.body.run, null);
    result = await jsonRequest(gateway.origin, "/api/xero-capture/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, source: "user" }),
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error.code, "XERO_CAPTURE_DISABLED");
    assert.equal(webhookCalls.length, before);
    await gateway.close();
    gateway = undefined;
  }

  gateway = await startGateway({ enabled: true, secret: controlSecret, gated: true });
  const proxyHeaders = { "x-forwarded-for": "203.0.113.42" };

  // All capture control routes sit behind the same passcode gate as chat.
  let result = await jsonRequest(gateway.origin, "/api/xero-capture/runs", {
    method: "POST",
    headers: { ...proxyHeaders, "content-type": "application/json" },
    body: JSON.stringify({ sessionId, source: "user" }),
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error.code, "NOT_SIGNED_IN");

  const login = await fetch(`${gateway.origin}/access`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...proxyHeaders,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ passcode }),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie);
  const authenticatedHeaders = {
    ...proxyHeaders,
    cookie,
  };

  // With no prior run the authenticated status route stays available and
  // returns a clean null, so the first-run CTA remains usable.
  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs?sessionId=${sessionId}`,
    { headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.available, true);
  assert.equal(result.body.run, null);

  // A general browser command cannot be smuggled into the narrow start API.
  result = await jsonRequest(gateway.origin, "/api/xero-capture/runs", {
    method: "POST",
    headers: { ...authenticatedHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      source: "user",
      url: "https://example.test",
      click: "button",
    }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "INVALID_REQUEST");

  // Runs are available only from a Bookkeeping conversation.
  result = await jsonRequest(gateway.origin, "/api/xero-capture/runs", {
    method: "POST",
    headers: { ...authenticatedHeaders, "content-type": "application/json" },
    body: JSON.stringify({ sessionId: nonBookkeepingSessionId, source: "user" }),
  });
  assert.equal(result.response.status, 404);
  assert.equal(result.body.error.code, "XERO_CAPTURE_NOT_FOUND");

  result = await jsonRequest(gateway.origin, "/api/xero-capture/runs", {
    method: "POST",
    headers: { ...authenticatedHeaders, "content-type": "application/json" },
    body: JSON.stringify({ sessionId, source: "user" }),
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.readOnly, true);
  assert.equal(result.body.run.state, "awaiting_export");
  assert.match(result.body.run.note, /All bank accounts/);
  assert.doesNotMatch(result.raw, /ACME|12,345|private|financialLines|amount/i);
  assert.equal(Object.hasOwn(result.body, "captureGrant"), false);
  const runId = result.body.run.runId;
  assert.match(runId, /^[0-9a-f-]{36}$/i);

  const startCall = webhookCalls.at(-1);
  assert.equal(startCall.path, "/webhook/xero-capture-start");
  assert.equal(startCall.method, "POST");
  assert.equal(startCall.control, controlSecret);
  assert.equal(startCall.body.sessionId, sessionId);
  assert.equal(startCall.body.runId, runId);
  assert.match(startCall.body.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(startCall.body.readOnly, true);
  assert.equal(Object.hasOwn(startCall.body, "grantHash"), false);
  assert.equal(Object.hasOwn(startCall.body, "xeroCredential"), false);
  assert.doesNotMatch(result.raw, new RegExp(controlSecret));

  // Starting again in another tab should return the already-running capture
  // that the authenticated workflow bound to this same conversation, rather
  // than fail because the gateway proposed a fresh idempotency ID.
  reuseExistingStart = true;
  result = await jsonRequest(gateway.origin, "/api/xero-capture/runs", {
    method: "POST",
    headers: { ...authenticatedHeaders, "content-type": "application/json" },
    body: JSON.stringify({ sessionId, source: "user" }),
  });
  reuseExistingStart = false;
  assert.equal(result.response.status, 201);
  assert.equal(result.body.run.runId, runId);

  // A compromised or misconfigured n8n endpoint cannot redirect the proxy's
  // private control header to a second origin.
  redirectStatusTo = `http://127.0.0.1:${redirectReceiverAddress.port}/steal`;
  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs?sessionId=${sessionId}`,
    { headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error.code, "XERO_CAPTURE_UNAVAILABLE");
  assert.deepEqual(redirectReceiverCalls, []);

  // A compromised upstream cannot make the public host buffer an unbounded
  // status response, even when it streams without a Content-Length header.
  oversizedStatus = true;
  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs?sessionId=${sessionId}`,
    { headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error.code, "XERO_CAPTURE_UNAVAILABLE");

  // A run started by the Bookkeeping tool is returned by the collection
  // status route and can therefore be represented by the same progress UI.
  latestRun = {
    ...latestRun,
    source: "agent",
    state: "reviewing",
    reviewRunId: `csv-review-${runId}`,
    current: 2,
    total: 3,
  };
  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs?sessionId=${sessionId}`,
    { headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.run.source, "agent");
  assert.equal(result.body.run.state, "reviewing");
  assert.equal(result.body.run.reviewRunId, `csv-review-${runId}`);
  assert.equal(result.body.run.current, 2);
  assert.equal(webhookCalls.at(-1).path, "/webhook/xero-capture-status");
  assert.match(webhookCalls.at(-1).body.requestId, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(result.raw, /ACME|12,345|private|financialLines|amount/i);

  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs/${runId}?sessionId=${sessionId}`,
    { headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.run.runId, runId);
  assert.equal(result.body.run.expectedCount, 41);
  assert.equal(result.body.run.reviewRunId, `csv-review-${runId}`);
  assert.equal(webhookCalls.at(-1).path, "/webhook/xero-capture-status");
  assert.equal(webhookCalls.at(-1).control, controlSecret);
  assert.match(webhookCalls.at(-1).body.requestId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(webhookCalls.at(-1).body.requestId, startCall.body.requestId);
  assert.doesNotMatch(result.raw, /ACME|12,345|private|financialLines|amount/i);

  // The public status payload may bind only to the deterministic review that
  // belongs to this capture. A compromised upstream cannot redirect the UI to
  // a different saved review in the same conversation.
  latestRun = {
    ...latestRun,
    reviewRunId: `csv-review-${nonBookkeepingSessionId}`,
  };
  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs/${runId}?sessionId=${sessionId}`,
    { headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error.code, "XERO_CAPTURE_UNAVAILABLE");
  latestRun = {
    ...latestRun,
    reviewRunId: `csv-review-${runId}`,
  };

  result = await jsonRequest(
    gateway.origin,
    `/api/xero-capture/runs/${runId}?sessionId=${sessionId}`,
    { method: "DELETE", headers: authenticatedHeaders },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.run.state, "cancelled");
  assert.equal(result.body.run.errorCode, "CANCELLED");
  assert.equal(webhookCalls.at(-1).path, "/webhook/xero-capture-cancel");
  assert.equal(webhookCalls.at(-1).control, controlSecret);
  assert.match(webhookCalls.at(-1).body.requestId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(webhookCalls.at(-1).body.requestId, startCall.body.requestId);
  assert.doesNotMatch(result.raw, new RegExp(controlSecret));

  process.stdout.write(
    "Authenticated Xero CSV-export run proxy, state redaction, and control-secret checks passed.\n",
  );
} finally {
  if (gateway) await gateway.close();
  await new Promise((resolve) => upstream.close(() => resolve()));
  await new Promise((resolve) => redirectReceiver.close(() => resolve()));
  await rm(temporary, { recursive: true, force: true });
}
