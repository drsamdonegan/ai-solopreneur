/**
 * Passcode gate for the chat gateway.
 *
 * On a learner's own computer the chat app is reachable only from that
 * computer, and that is the whole of its protection. On a public address it
 * has none: anyone who finds the URL can talk to the agent, read every saved
 * conversation and every business fact in it, and spend the learner's Anthropic
 * credit. n8n ships its own owner login. This is the equivalent for the chat.
 *
 * The gate is inert unless a passcode is configured, so nothing about the
 * local install changes.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const MIN_PASSCODE_LENGTH = 8;

const COOKIE_NAME = "agent_session";
const SESSION_VERSION = "v1";
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_LOGIN_BODY_BYTES = 1_024;

/**
 * A wrong passcode always costs this much wall-clock time. It is invisible to
 * someone typing a passcode and ruinous to anyone trying thousands.
 */
const FAILURE_DELAY_MS = 400;

/** Attempts before lockouts begin, then how long each subsequent failure costs. */
const FREE_ATTEMPTS = 3;
const LOCKOUT_LADDER_MS = [5_000, 15_000, 60_000, 300_000];
const LONGEST_LOCKOUT_MS = 300_000;
const MAX_TRACKED_CLIENTS = 2_048;

const GATE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export interface AccessGateOptions {
  /** The passcode a learner types. Must be at least MIN_PASSCODE_LENGTH. */
  passcode: string;
  /**
   * Signs session cookies. Keep it on the persistent volume so that a redeploy
   * does not sign every learner out.
   */
  sessionSecret: string;
  sessionTtlMs?: number;
  /** Set false only for plain-HTTP local testing. */
  secureCookie?: boolean;
  /** Number of trusted proxies in front. Railway terminates TLS, so 1. */
  proxyHops?: number;
  now?: () => number;
}

export interface AccessGate {
  /** True when the gate has answered the request and no further routing applies. */
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Comparison and signing
// ---------------------------------------------------------------------------

/**
 * Hashing both sides first makes the comparison constant-time regardless of
 * length, which a raw timingSafeEqual on the passcodes cannot be.
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function issueSession(secret: string, expiresAt: number): string {
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

function sessionIsValid(
  cookie: string | undefined,
  secret: string,
  now: number,
): boolean {
  if (cookie === undefined) {
    return false;
  }
  const parts = cookie.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const [version, expiresAtRaw, signature] = parts;
  if (
    version !== SESSION_VERSION ||
    expiresAtRaw === undefined ||
    signature === undefined
  ) {
    return false;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return false;
  }
  return sameSecret(signature, sign(`${version}.${expiresAtRaw}`, secret));
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== "string") {
    return undefined;
  }
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) {
      continue;
    }
    if (pair.slice(0, index).trim() === name) {
      return decodeURIComponent(pair.slice(index + 1).trim());
    }
  }
  return undefined;
}

/**
 * Identifies the caller for rate limiting.
 *
 * The leftmost X-Forwarded-For entry is whatever the client claimed, so using
 * it would let an attacker sidestep the lockout entirely by varying a header.
 * The entry a trusted proxy appended is the last one, so with one proxy in
 * front that is the value to key on.
 */
/**
 * n8n and the document reader live in this same container and call the API over
 * loopback, where there is no browser to carry a session cookie. Their calls are
 * let through, but only when the connection genuinely is local AND carries none
 * of the headers a proxy adds. Railway's edge always stamps a forwarded header,
 * so a request from outside cannot pass even if its source address somehow
 * looked local; both locks have to open, never one.
 *
 * On a learner's own computer there is no passcode, so no gate, and this is
 * never consulted.
 */
function isSameContainer(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  const local =
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";
  const proxied =
    request.headers["x-forwarded-for"] !== undefined ||
    request.headers["x-forwarded-host"] !== undefined ||
    request.headers["x-real-ip"] !== undefined;
  return local && !proxied;
}

function clientKey(request: IncomingMessage, proxyHops: number): string {
  if (proxyHops > 0) {
    const header = request.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header.join(",") : header;
    if (typeof raw === "string") {
      const hops = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const atHop = hops[hops.length - proxyHops];
      if (atHop !== undefined) {
        return atHop;
      }
      const last = hops[hops.length - 1];
      if (last !== undefined) {
        return last;
      }
    }
  }
  return request.socket.remoteAddress ?? "unknown";
}

function wantsHtml(request: IncomingMessage): boolean {
  const accept = request.headers.accept;
  return typeof accept === "string" && accept.includes("text/html");
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.length;
    if (total > MAX_LOGIN_BODY_BYTES) {
      throw new Error("Sign-in request was too large.");
    }
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

type PageState = "prompt" | "wrong" | "locked" | "signedOut";

const MESSAGES: Readonly<Record<PageState, string>> = {
  prompt: "",
  wrong: "That passcode is not right. Try again.",
  locked:
    "Too many attempts. Wait a little while, then try once more. If you have forgotten your passcode, change it in your hosting dashboard and redeploy.",
  signedOut: "You are signed out.",
};

function loginPage(state: PageState): string {
  const message = MESSAGES[state];
  const banner =
    message === ""
      ? ""
      : `\n      <p class="notice ${state === "signedOut" ? "calm" : "warn"}">${message}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Your agent</title>
    <link rel="stylesheet" href="/access.css" />
  </head>
  <body>
    <main>
      <h1>Your agent</h1>
      <p class="lead">This agent is yours. Enter your passcode to open it.</p>${banner}
      <form method="post" action="/access">
        <label for="passcode">Passcode</label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autocomplete="current-password"
          autofocus
          required
        />
        <button type="submit">Open my agent</button>
      </form>
      <p class="footnote">
        The passcode stops other people reading your conversations and spending
        your Claude credit. It is set in your hosting dashboard.
      </p>
    </main>
  </body>
</html>
`;
}

const LOGIN_STYLESHEET = `:root {
  color-scheme: light dark;
  --ink: #16181d;
  --muted: #5c6270;
  --line: #d8dbe2;
  --paper: #ffffff;
  --page: #f4f5f7;
  --accent: #1f5eff;
  --warn: #8a2b12;
  --warn-bg: #fdece7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #f2f3f5;
    --muted: #a0a6b4;
    --line: #343841;
    --paper: #1c1f26;
    --page: #121419;
    --accent: #7ba1ff;
    --warn: #ffb4a0;
    --warn-bg: #3a1d16;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: var(--page);
  color: var(--ink);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main {
  width: 100%;
  max-width: 26rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 2rem;
}
h1 { margin: 0 0 0.35rem; font-size: 1.4rem; }
.lead { margin: 0 0 1.25rem; color: var(--muted); }
.notice {
  margin: 0 0 1.1rem;
  padding: 0.7rem 0.85rem;
  border-radius: 9px;
  font-size: 0.94rem;
}
.notice.warn { background: var(--warn-bg); color: var(--warn); }
.notice.calm { background: var(--page); color: var(--muted); }
label { display: block; font-weight: 600; margin-bottom: 0.4rem; }
input {
  width: 100%;
  padding: 0.7rem 0.8rem;
  font-size: 1rem;
  color: var(--ink);
  background: var(--page);
  border: 1px solid var(--line);
  border-radius: 9px;
}
input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  width: 100%;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 9px;
  cursor: pointer;
}
button:hover { filter: brightness(1.07); }
.footnote {
  margin: 1.4rem 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
`;

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

interface FailureRecord {
  count: number;
  blockedUntil: number;
  lastFailureAt: number;
}

/**
 * A quiet spell wipes the tally. Without this the ladder is cumulative for
 * ever, and a learner who mistypes their passcode a few times a week would
 * eventually meet a five-minute lockout for the first mistake of the day.
 */
const FAILURE_MEMORY_MS = 15 * 60 * 1_000;

export function createAccessGate(options: AccessGateOptions): AccessGate {
  const passcode = options.passcode;
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    throw new Error(
      `The passcode must be at least ${MIN_PASSCODE_LENGTH} characters.`,
    );
  }
  const sessionSecret =
    options.sessionSecret.length >= 32
      ? options.sessionSecret
      : randomBytes(32).toString("hex");
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const secureCookie = options.secureCookie ?? true;
  const proxyHops = options.proxyHops ?? 1;
  const now = options.now ?? (() => Date.now());

  const failures = new Map<string, FailureRecord>();

  function pruneFailures(): void {
    if (failures.size <= MAX_TRACKED_CLIENTS) {
      return;
    }
    const current = now();
    for (const [key, record] of failures) {
      if (record.blockedUntil <= current) {
        failures.delete(key);
      }
    }
  }

  function lockoutRemaining(key: string): number {
    const record = failures.get(key);
    if (record === undefined) {
      return 0;
    }
    return Math.max(0, record.blockedUntil - now());
  }

  function recordFailure(key: string): void {
    const current = now();
    const previous = failures.get(key);
    const record: FailureRecord =
      previous !== undefined &&
      current - previous.lastFailureAt < FAILURE_MEMORY_MS
        ? previous
        : { count: 0, blockedUntil: 0, lastFailureAt: current };
    record.lastFailureAt = current;
    record.count += 1;
    const step = record.count - FREE_ATTEMPTS;
    if (step > 0) {
      const penalty =
        LOCKOUT_LADDER_MS[Math.min(step, LOCKOUT_LADDER_MS.length) - 1] ??
        LONGEST_LOCKOUT_MS;
      record.blockedUntil = now() + penalty;
    }
    failures.set(key, record);
    pruneFailures();
  }

  function sendPage(
    response: ServerResponse,
    status: number,
    state: PageState,
  ): void {
    const body = loginPage(state);
    response.writeHead(status, {
      ...GATE_HEADERS,
      "Content-Length": Buffer.byteLength(body).toString(),
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(body);
  }

  function cookieValue(value: string, maxAgeSeconds: number): string {
    const attributes = [
      `${COOKIE_NAME}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (secureCookie) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }

  function redirect(
    response: ServerResponse,
    location: string,
    cookie?: string,
  ): void {
    const headers: Record<string, string> = {
      ...GATE_HEADERS,
      Location: location,
      "Content-Length": "0",
    };
    if (cookie !== undefined) {
      headers["Set-Cookie"] = cookie;
    }
    response.writeHead(303, headers);
    response.end();
  }

  function isAuthorised(request: IncomingMessage): boolean {
    return sessionIsValid(
      readCookie(request, COOKIE_NAME),
      sessionSecret,
      now(),
    );
  }

  return {
    async handle(request, response, url) {
      // Above everything, so a tool workflow reaching the business memory API
      // is not answered with a sign-in page it cannot read.
      if (isSameContainer(request)) {
        return false;
      }

      if (url.pathname === "/access.css") {
        response.writeHead(200, {
          ...GATE_HEADERS,
          "Cache-Control": "public, max-age=3600",
          "Content-Length": Buffer.byteLength(LOGIN_STYLESHEET).toString(),
          "Content-Type": "text/css; charset=utf-8",
        });
        response.end(LOGIN_STYLESHEET);
        return true;
      }

      if (url.pathname === "/access") {
        if (request.method === "GET" || request.method === "HEAD") {
          if (isAuthorised(request)) {
            redirect(response, "/");
            return true;
          }
          const state: PageState =
            url.searchParams.get("state") === "signed-out"
              ? "signedOut"
              : "prompt";
          sendPage(response, 200, state);
          return true;
        }

        if (request.method !== "POST") {
          response.writeHead(405, { ...GATE_HEADERS, Allow: "GET, HEAD, POST" });
          response.end();
          return true;
        }

        const key = clientKey(request, proxyHops);
        if (lockoutRemaining(key) > 0) {
          sendPage(response, 429, "locked");
          return true;
        }

        let submitted = "";
        try {
          submitted = (await readFormBody(request)).get("passcode") ?? "";
        } catch {
          submitted = "";
        }

        if (submitted.length > 0 && sameSecret(submitted, passcode)) {
          failures.delete(key);
          const expiresAt = now() + sessionTtlMs;
          redirect(
            response,
            "/",
            cookieValue(
              issueSession(sessionSecret, expiresAt),
              Math.floor(sessionTtlMs / 1_000),
            ),
          );
          return true;
        }

        recordFailure(key);
        await sleep(FAILURE_DELAY_MS);
        sendPage(
          response,
          lockoutRemaining(key) > 0 ? 429 : 401,
          lockoutRemaining(key) > 0 ? "locked" : "wrong",
        );
        return true;
      }

      if (url.pathname === "/access/logout") {
        if (request.method !== "POST") {
          response.writeHead(405, { ...GATE_HEADERS, Allow: "POST" });
          response.end();
          return true;
        }
        redirect(response, "/access?state=signed-out", cookieValue("", 0));
        return true;
      }

      if (isAuthorised(request)) {
        return false;
      }

      // A person gets the passcode page; a script gets a status code it can
      // act on rather than a page of HTML it will fail to parse.
      if (
        wantsHtml(request) &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        redirect(response, "/access");
        return true;
      }

      const body = JSON.stringify({
        error: {
          code: "NOT_SIGNED_IN",
          message: "Enter your passcode to use this agent.",
        },
      });
      response.writeHead(401, {
        ...GATE_HEADERS,
        "Content-Length": Buffer.byteLength(body).toString(),
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(body);
      return true;
    },
  };
}
