import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const asset = join(here, "../skill/assets/xero-statement-capture");
const manifest = JSON.parse(await readFile(join(asset, "manifest.json"), "utf8"));
const background = await readFile(join(asset, "background.js"), "utf8");
const content = await readFile(join(asset, "content.js"), "utf8");
const serverSource = await readFile(join(here, "../skill/scripts/capture-server.mjs"), "utf8");
const fixture = JSON.parse(await readFile(join(here, "fixtures/xero-statement-capture.json"), "utf8"));
let checks = 0;
const equal = (actual, expected, message) => { checks += 1; assert.deepEqual(actual, expected, message); };
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

equal(manifest.permissions, ["activeTab", "storage"], "extension permissions should stay minimal");
equal(manifest.host_permissions, ["https://go.xero.com/*", "http://127.0.0.1:8461/*"], "extension hosts should be exact");
for (const forbidden of ["cookies", "webRequest", "downloads", "history", "alarms"]) {
  check(!JSON.stringify(manifest).includes(`\"${forbidden}\"`), `${forbidden} permission must stay absent`);
}
for (const forbidden of [".click(", "chrome.tabs.create", "chrome.tabs.reload", "setInterval("]) {
  check(!content.includes(forbidden) && !background.includes(forbidden), `${forbidden} automation must stay absent`);
}
check(!/\.value\s*=/.test(content), "content script must never fill a Xero field");
check(background.includes("chrome.storage.session"), "one-use configuration should use session-only storage");
check(background.includes("page changed between repeated observations"), "each page must be stable across two observations");
check(background.includes("source_hash: await sha256(stable)"), "annotation requests must bind each visible line to its source hash");
check(content.includes("Prepared in Xero — check Match or Find & Match"), "ready overlay should direct the final Xero action");
check(content.includes("item.reviewQuestion"), "likely overlay should display the useful review question");
check(serverSource.includes('server.listen(port, "127.0.0.1"'), "receiver must bind to loopback only");
check(serverSource.includes("randomBytes(32)"), "receiver token must have 32 random bytes");
check(serverSource.indexOf("consumed = true") < serverSource.indexOf("await bodyOf(request)"), "token must be consumed before request processing");

const upstreamRequests = [];
const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  upstreamRequests.push({ url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks)) });
  const result = JSON.stringify({ complete: true, observedCount: 5, expectedCount: 5, blockingReasons: [] });
  response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(result) });
  response.end(result);
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
const receiverPort = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [join(here, "../skill/scripts/capture-server.mjs")], {
  env: {
    ...process.env,
    XERO_CAPTURE_PORT: String(receiverPort),
    XERO_CAPTURE_N8N_URL: `http://127.0.0.1:${upstreamPort}`,
    XERO_CAPTURE_INGEST_SECRET: "test-ingest-secret-with-at-least-24-chars",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let expiredChild = null;
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
for (let attempt = 0; attempt < 100 && !stdout.includes("One-use token:"); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
try {
  check(stdout.includes("One-use token:"), `receiver should start (${stderr})`);
  const token = stdout.match(/One-use token: (\S+)/)?.[1];
  check(token?.length >= 43, "printed token should encode at least 32 bytes");
  const url = `http://127.0.0.1:${receiverPort}/capture`;
  const noOrigin = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(fixture.full) });
  equal(noOrigin.status, 403, "website and originless submissions should be rejected");
  const accepted = await fetch(url, { method: "POST", headers: { Origin: "chrome-extension://abcdefghijklmnop", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(fixture.full) });
  equal(accepted.status, 200, "extension submission should be accepted once");
  const replay = await fetch(url, { method: "POST", headers: { Origin: "chrome-extension://abcdefghijklmnop", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(fixture.full) });
  equal(replay.status, 409, "token replay should be rejected");
  equal(upstreamRequests.length, 1, "only one request should reach n8n");
  equal(upstreamRequests[0].headers["x-xero-capture-key"], "test-ingest-secret-with-at-least-24-chars", "secret should be added only by companion");
  check(upstreamRequests[0].body.derived_complete === true, "companion should forward derived completeness");
  check(/^[a-f0-9]{64}$/.test(upstreamRequests[0].body.capture_source_hash), "companion should hash the source");

  let expiredStdout = "";
  expiredChild = spawn(process.execPath, [join(here, "../skill/scripts/capture-server.mjs")], {
    env: {
      ...process.env,
      XERO_CAPTURE_PORT: String(receiverPort + 1),
      XERO_CAPTURE_TOKEN_TTL_SECONDS: "1",
      XERO_CAPTURE_N8N_URL: `http://127.0.0.1:${upstreamPort}`,
      XERO_CAPTURE_INGEST_SECRET: "test-ingest-secret-with-at-least-24-chars",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  expiredChild.stdout.on("data", (chunk) => { expiredStdout += chunk; });
  for (let attempt = 0; attempt < 100 && !expiredStdout.includes("One-use token:"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const expiredToken = expiredStdout.match(/One-use token: (\S+)/)?.[1];
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await fetch(`http://127.0.0.1:${receiverPort + 1}/capture`, {
    method: "POST",
    headers: { Origin: "chrome-extension://abcdefghijklmnop", Authorization: `Bearer ${expiredToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(fixture.full),
  });
  equal(expired.status, 401, "expired token should be rejected");
} finally {
  child.kill("SIGTERM");
  if (expiredChild) expiredChild.kill("SIGTERM");
  await new Promise((resolve) => upstream.close(resolve));
}

process.stdout.write(`Xero capture security: ${checks} checks passed.\n`);
