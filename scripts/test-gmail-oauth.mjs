// Exercises the Gmail OAuth endpoints against a real server instance, with a
// stubbed Google. No network, no real credentials.
import { createChatServer } from "../apps/chat/dist/app.js";
import { GmailOAuthStore } from "../apps/chat/dist/gmail-oauth.js";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const dir = await mkdtemp(join(tmpdir(), "mu-gmail-"));

// A stand-in Google: token exchange, refresh, and the profile lookup.
let refreshCalls = 0;
const fakeGoogle = async (url, init) => {
  const target = String(url);
  if (target.startsWith("https://oauth2.googleapis.com/token")) {
    const body = new URLSearchParams(init.body);
    if (body.get("grant_type") === "refresh_token") {
      refreshCalls += 1;
      return new Response(JSON.stringify({ access_token: "access-refreshed", expires_in: 3600 }), { status: 200 });
    }
    if (body.get("code") === "too-broad") {
      return new Response(JSON.stringify({
        refresh_token: "r", access_token: "a", expires_in: 3600,
        scope: "https://mail.google.com/",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      refresh_token: "refresh-abc", access_token: "access-abc", expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    }), { status: 200 });
  }
  if (target.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/profile")) {
    return new Response(JSON.stringify({ emailAddress: "founder@acme.com" }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${target}`);
};

const store = new GmailOAuthStore(dir, {
  environment: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "secret" },
  defaultRedirectUri: "http://localhost:3000/api/gmail/callback",
  fetchImplementation: fakeGoogle,
});

const server = createChatServer({
  publicDirectory: fileURLToPath(new URL('../apps/chat/public', import.meta.url)),
  upstreamUrl: "http://127.0.0.1:5678/webhook/chat",
  gmailOAuthStore: store,
  logError: () => {},
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = (path, init) => fetch(`${base}${path}`, { redirect: "manual", ...init });

// --- unconfigured install --------------------------------------------------
const bare = new GmailOAuthStore(dir, { environment: {}, fetchImplementation: fakeGoogle });
check((await bare.status()).configured === false, "an install with no client ID reported itself configured");

// --- status before connecting ---------------------------------------------
let body = await (await get("/api/gmail/status")).json();
check(body.configured === true && body.connected === false, `status before connecting: ${JSON.stringify(body)}`);

// --- the connect redirect --------------------------------------------------
const redirect = await get("/api/gmail/connect");
check(redirect.status === 302, `connect returned ${redirect.status}`);
const authUrl = new URL(redirect.headers.get("location"));
check(authUrl.origin === "https://accounts.google.com", `redirect went to ${authUrl.origin}`);
check(authUrl.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.readonly",
  `scope requested was "${authUrl.searchParams.get("scope")}"`);
check(authUrl.searchParams.get("access_type") === "offline", "offline access not requested");
const state = authUrl.searchParams.get("state");
check(typeof state === "string" && state.split(".").length === 3, "state is not a signed triple");

// --- token endpoint before connecting -------------------------------------
const early = await get("/api/gmail/token", { headers: { "x-requested-by": "monthly-update" } });
check(early.status === 409, `token before connecting returned ${early.status}`);

// --- a forged callback -----------------------------------------------------
const forged = await get("/api/gmail/callback?code=abc&state=not.a.real");
check(forged.status === 400, `forged state returned ${forged.status}`);
check((await forged.text()).includes("Gmail was not connected"), "forged callback did not render the failure page");

// --- the real callback -----------------------------------------------------
const done = await get(`/api/gmail/callback?code=abc&state=${encodeURIComponent(state)}`);
const donePage = await done.text();
check(done.status === 200, `callback returned ${done.status}`);
check(donePage.includes("founder@acme.com"), "callback page does not name the mailbox");
check(donePage.includes("cannot send"), "callback page does not state it is read-only");

body = await (await get("/api/gmail/status")).json();
check(body.connected === true && body.emailAddress === "founder@acme.com", `status after connecting: ${JSON.stringify(body)}`);

// --- the stored file -------------------------------------------------------
const stored = JSON.parse(await readFile(join(dir, "gmail-connection.json"), "utf8"));
check(stored.refreshToken === "refresh-abc", "the refresh token was not stored");
const mode = (await stat(join(dir, "gmail-connection.json"))).mode & 0o777;
check(mode === 0o600, `token file mode is ${mode.toString(8)}, expected 600`);

// --- the token endpoint ----------------------------------------------------
const noHeader = await get("/api/gmail/token");
check(noHeader.status === 403, `token without the header returned ${noHeader.status}`);

const token = await (await get("/api/gmail/token", { headers: { "x-requested-by": "monthly-update" } })).json();
check(token.accessToken === "access-abc", `token endpoint returned "${token.accessToken}"`);
check(!JSON.stringify(token).includes("refresh-abc"), "the refresh token leaked out of /api/gmail/token");

// --- a token grant that came back too broad --------------------------------
const wide = new GmailOAuthStore(await mkdtemp(join(tmpdir(), "mu-wide-")), {
  environment: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "secret" },
  fetchImplementation: fakeGoogle,
});
const wideUrl = new URL(wide.authorizationUrl());
let rejected = false;
try {
  await wide.completeCallback("too-broad", wideUrl.searchParams.get("state"));
} catch (error) {
  rejected = /more than read access/.test(error.publicMessage ?? "");
}
check(rejected, "a token granting full mailbox access was accepted");
check((await wide.status()).connected === false, "the over-broad grant was still stored");

// --- disconnect ------------------------------------------------------------
await get("/api/gmail/disconnect", { method: "POST" });
body = await (await get("/api/gmail/status")).json();
check(body.connected === false, "disconnect did not clear the connection");

server.close();
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All Gmail OAuth endpoint checks passed.");
