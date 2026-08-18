import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Read-only Gmail authorisation, held by the chat gateway.
 *
 * This exists so the learner can connect Gmail by clicking a link in their own
 * chat rather than navigating n8n's credential screen. The gateway owns the
 * OAuth dance; n8n workflows ask it for a short-lived access token when they
 * need to read mail.
 *
 * Two things are deliberate:
 *   - The scope is `gmail.readonly` and nothing else, so the token Google
 *     issues physically cannot send, label, or delete a message.
 *   - The refresh token never leaves this machine and is never returned by any
 *     endpoint. `/api/gmail/token` hands out access tokens only.
 */

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const STATE_TTL_MS = 10 * 60 * 1000;
// Refresh a little early so a run that starts now does not expire mid-flight.
const ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GmailConnectionStatus {
  /** Whether the learner has supplied a Google OAuth client at all. */
  configured: boolean;
  connected: boolean;
  emailAddress: string;
  connectedAt: string;
  scope: string;
  /** Set when a previously working connection has started failing. */
  lastError: string;
}

interface StoredConnection {
  schemaVersion: 1;
  refreshToken: string;
  emailAddress: string;
  connectedAt: string;
  scope: string;
  lastError: string;
}

export class GmailOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

function readConfig(environment: NodeJS.ProcessEnv, defaultRedirect: string): GmailOAuthConfig | undefined {
  const clientId = (environment.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (environment.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (clientId === "" || clientSecret === "") {
    return undefined;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: (environment.GOOGLE_OAUTH_REDIRECT_URI ?? "").trim() || defaultRedirect,
  };
}

export class GmailOAuthStore {
  readonly #path: string;
  readonly #config: GmailOAuthConfig | undefined;
  readonly #fetch: typeof fetch;
  /** Signing key for the state parameter; regenerated per process on purpose. */
  readonly #stateKey: Buffer;
  #cachedAccessToken = "";
  #cachedExpiresAt = 0;
  #connection: StoredConnection | undefined;
  #loaded = false;

  constructor(
    directory: string,
    options: {
      environment?: NodeJS.ProcessEnv;
      defaultRedirectUri?: string;
      fetchImplementation?: typeof fetch;
    } = {},
  ) {
    this.#path = join(directory, "gmail-connection.json");
    this.#config = readConfig(
      options.environment ?? process.env,
      options.defaultRedirectUri ?? "http://localhost:3000/api/gmail/callback",
    );
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#stateKey = randomBytes(32);
  }

  get configured(): boolean {
    return this.#config !== undefined;
  }

  get redirectUri(): string {
    return this.#config?.redirectUri ?? "";
  }

  #requireConfig(): GmailOAuthConfig {
    if (this.#config === undefined) {
      throw new GmailOAuthError(
        409,
        "GMAIL_NOT_CONFIGURED",
        "This computer has no Google OAuth client yet. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env, then restart. docs/MONTHLY_UPDATE.md walks through creating them.",
      );
    }
    return this.#config;
  }

  async #load(): Promise<StoredConnection | undefined> {
    if (this.#loaded) {
      return this.#connection;
    }
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as StoredConnection;
      this.#connection = typeof parsed?.refreshToken === "string" && parsed.refreshToken !== ""
        ? parsed
        : undefined;
    } catch {
      this.#connection = undefined;
    }
    this.#loaded = true;
    return this.#connection;
  }

  async #save(connection: StoredConnection | undefined): Promise<void> {
    this.#connection = connection;
    this.#loaded = true;
    this.#cachedAccessToken = "";
    this.#cachedExpiresAt = 0;
    if (connection === undefined) {
      await unlink(this.#path).catch(() => undefined);
      return;
    }
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    // 0600: the refresh token is the most sensitive thing this app holds.
    await writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#path);
  }

  /**
   * A signed, expiring state parameter. Google hands it back on the callback,
   * and a mismatch means the callback did not originate from a link we issued.
   */
  #signState(nonce: string, expiresAt: number): string {
    const payload = `${nonce}.${expiresAt}`;
    const signature = createHmac("sha256", this.#stateKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  #verifyState(state: string): boolean {
    const parts = String(state ?? "").split(".");
    if (parts.length !== 3) {
      return false;
    }
    const [nonce, expiresRaw, signature] = parts as [string, string, string];
    const expiresAt = Number(expiresRaw);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) {
      return false;
    }
    const expected = createHmac("sha256", this.#stateKey).update(`${nonce}.${expiresAt}`).digest("base64url");
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  authorizationUrl(): string {
    const config = this.#requireConfig();
    const state = this.#signState(randomBytes(16).toString("base64url"), Date.now() + STATE_TTL_MS);
    const parameters = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GMAIL_READONLY_SCOPE,
      // offline + consent is what makes Google return a refresh token rather
      // than an access token that dies in an hour with no way to renew it.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${parameters.toString()}`;
  }

  async completeCallback(code: string, state: string): Promise<GmailConnectionStatus> {
    const config = this.#requireConfig();
    if (!this.#verifyState(state)) {
      throw new GmailOAuthError(
        400,
        "GMAIL_STATE_INVALID",
        "That sign-in link has expired or did not come from this app. Ask your agent to connect Gmail again.",
      );
    }
    if (typeof code !== "string" || code.trim() === "") {
      throw new GmailOAuthError(400, "GMAIL_NO_CODE", "Google did not return an authorisation code.");
    }

    const response = await this.#fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code.trim(),
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new GmailOAuthError(
        502,
        "GMAIL_TOKEN_EXCHANGE_FAILED",
        `Google refused the sign-in: ${String(payload.error_description ?? payload.error ?? response.status)}`,
      );
    }

    const refreshToken = String(payload.refresh_token ?? "");
    if (refreshToken === "") {
      throw new GmailOAuthError(
        502,
        "GMAIL_NO_REFRESH_TOKEN",
        "Google did not return a long-lived token. Remove this app from your Google account permissions and connect again.",
      );
    }
    const grantedScope = String(payload.scope ?? "");
    // Belt and braces: refuse a token that carries more than read access, even
    // though the request only ever asks for gmail.readonly.
    if (grantedScope !== "" && !grantedScope.split(" ").every((scope) => scope === GMAIL_READONLY_SCOPE)) {
      throw new GmailOAuthError(
        400,
        "GMAIL_SCOPE_TOO_BROAD",
        `Google granted more than read access (${grantedScope}). Nothing has been saved. Connect again and grant only the view-your-email permission.`,
      );
    }

    const accessToken = String(payload.access_token ?? "");
    const emailAddress = await this.#lookupEmailAddress(accessToken);

    await this.#save({
      schemaVersion: 1,
      refreshToken,
      emailAddress,
      connectedAt: new Date().toISOString(),
      scope: grantedScope || GMAIL_READONLY_SCOPE,
      lastError: "",
    });
    this.#cachedAccessToken = accessToken;
    this.#cachedExpiresAt = Date.now() + Number(payload.expires_in ?? 3600) * 1000;

    return this.status(true);
  }

  async #lookupEmailAddress(accessToken: string): Promise<string> {
    if (accessToken === "") {
      return "";
    }
    try {
      const response = await this.#fetch(GOOGLE_PROFILE_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        return "";
      }
      const profile = (await response.json()) as { emailAddress?: unknown };
      return String(profile.emailAddress ?? "");
    } catch {
      return "";
    }
  }

  async accessToken(): Promise<string> {
    const config = this.#requireConfig();
    const connection = await this.#load();
    if (connection === undefined) {
      throw new GmailOAuthError(
        409,
        "GMAIL_NOT_CONNECTED",
        "Gmail is not connected yet.",
      );
    }
    if (this.#cachedAccessToken !== "" && Date.now() + ACCESS_TOKEN_SKEW_MS < this.#cachedExpiresAt) {
      return this.#cachedAccessToken;
    }

    const response = await this.#fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: connection.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const detail = String(payload.error_description ?? payload.error ?? response.status);
      // invalid_grant means the refresh token is dead: revoked, or expired
      // because the Google consent screen is still in Testing. Record it so
      // the status endpoint can explain rather than just failing.
      await this.#save({ ...connection, lastError: detail });
      throw new GmailOAuthError(
        401,
        "GMAIL_REAUTH_REQUIRED",
        `Google would not renew the connection (${detail}). Connect Gmail again.`,
      );
    }

    this.#cachedAccessToken = String(payload.access_token ?? "");
    this.#cachedExpiresAt = Date.now() + Number(payload.expires_in ?? 3600) * 1000;
    if (connection.lastError !== "") {
      await this.#save({ ...connection, lastError: "" });
      this.#cachedAccessToken = String(payload.access_token ?? "");
      this.#cachedExpiresAt = Date.now() + Number(payload.expires_in ?? 3600) * 1000;
    }
    return this.#cachedAccessToken;
  }

  async status(skipLoad = false): Promise<GmailConnectionStatus> {
    const connection = skipLoad ? this.#connection : await this.#load();
    return {
      configured: this.configured,
      connected: connection !== undefined,
      emailAddress: connection?.emailAddress ?? "",
      connectedAt: connection?.connectedAt ?? "",
      scope: connection?.scope ?? GMAIL_READONLY_SCOPE,
      lastError: connection?.lastError ?? "",
    };
  }

  async disconnect(): Promise<void> {
    await this.#save(undefined);
  }
}

/** The page Google's redirect lands on. Plain, self-closing, no scripts of consequence. */
export function callbackPage(options: { ok: boolean; heading: string; detail: string }): string {
  const escape = (value: string): string =>
    value.replace(/[&<>"']/g, (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.ok ? "Gmail connected" : "Gmail not connected"}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
         display: grid; place-items: center; min-height: 100vh; padding: 24px; }
  main { max-width: 32rem; text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1rem; opacity: .85; }
  .mark { font-size: 2.5rem; line-height: 1; margin-bottom: .5rem; }
</style>
</head>
<body>
<main>
  <div class="mark">${options.ok ? "&#10003;" : "&#9888;"}</div>
  <h1>${escape(options.heading)}</h1>
  <p>${escape(options.detail)}</p>
  <p>You can close this tab and go back to your chat.</p>
</main>
</body>
</html>
`;
}
