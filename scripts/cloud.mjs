#!/usr/bin/env node
/**
 * Cloud supervisor.
 *
 * `scripts/local.mjs` runs the stack on a learner's own computer: it detaches
 * the services, writes PID files, and returns control to the terminal. A
 * container needs the opposite of all three. This runner stays in the
 * foreground as the single process the platform watches, streams every child's
 * output to stdout where the platform's log viewer can see it, and exits when
 * any service dies so the platform restarts the container.
 *
 * Nothing here is used by the local runner, and the local runner is not used
 * here. A change to one cannot break the other.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigHelp, runSetup, setupIsNeeded } from "./cloud-setup.mjs";
import { primeAgent, syncWorkflows } from "./cloud-workflows.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The persistent volume. Everything the learner would lose on a redeploy lives
// under here and nowhere else.
const dataDir = resolve(process.env.AGENT_DATA_DIR || "/data");

const paths = {
  dataDir,
  n8nUserFolder: join(dataDir, "n8n"),
  chatDataDir: join(dataDir, "chat"),
  documentDataDir: join(dataDir, "documents"),
  profileDataDir: join(dataDir, "profile"),
  skillsDir: join(dataDir, "skills"),
  configDir: join(dataDir, "config"),
  publicUrlsFile: join(dataDir, "config", "public-urls.json"),
  sessionSecretFile: join(dataDir, "config", "session-secret"),
  n8nBin: join(projectRoot, "node_modules", "n8n", "bin", "n8n"),
  workflowsDir: join(projectRoot, "n8n", "workflows"),
  chatServer: join(projectRoot, "apps", "chat", "dist", "server.js"),
  documentWorkerServer: join(
    projectRoot,
    "services",
    "document-worker",
    "src",
    "server.mjs",
  ),
  agentRegistry: join(projectRoot, "apps", "chat", "config", "agents.json"),
  repoSkillsDir: join(projectRoot, "skills"),
  repoOptionalSkillsDir: join(projectRoot, "optional-skills"),
};

const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

/**
 * Learners read these logs when something goes wrong, so a failure gets a
 * framed block with the fix in it rather than a stack trace.
 */
function fatal(title, ...lines) {
  const width = 72;
  process.stdout.write(`\n${"=".repeat(width)}\n`);
  process.stdout.write(`YOUR AGENT COULD NOT START\n\n${title}\n`);
  if (lines.length > 0) {
    process.stdout.write(`\n${lines.join("\n")}\n`);
  }
  process.stdout.write(`${"=".repeat(width)}\n\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function port(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    fatal(
      `${name} is set to "${raw}", which is not a usable port number.`,
      "Remove that variable in your hosting dashboard and redeploy.",
    );
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function readPublicUrlsFile() {
  try {
    const parsed = JSON.parse(readFileSync(paths.publicUrlsFile, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function asHttpsUrl(value) {
  if (!value) {
    return "";
  }
  const candidate = /^https?:\/\//.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      return "";
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return "";
  }
}

/**
 * The address the outside world uses to reach n8n.
 *
 * This has to be exact. Every webhook address n8n shows in the editor is built
 * from it, and those are the addresses a learner pastes into Slack. A wrong
 * value produces webhooks that look right and never fire.
 *
 * RAILWAY_PUBLIC_DOMAIN is deliberately the last resort: a service with two
 * domains reports only one of them, so on this stack it is as likely to be the
 * chat address as the n8n address.
 */
function resolveN8nPublicUrl(stored) {
  const fromEnv = asHttpsUrl(process.env.N8N_PUBLIC_URL);
  if (fromEnv) {
    return { url: fromEnv, source: "the N8N_PUBLIC_URL variable" };
  }
  const fromFile = asHttpsUrl(stored.n8n);
  if (fromFile) {
    return { url: fromFile, source: "your saved settings" };
  }
  const fromPlatform = asHttpsUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (fromPlatform) {
    return { url: fromPlatform, source: "the hosting platform (unconfirmed)" };
  }
  return { url: "", source: "" };
}

function resolveChatPublicUrl(stored) {
  return (
    asHttpsUrl(process.env.CHAT_PUBLIC_URL) ||
    asHttpsUrl(stored.chat) ||
    asHttpsUrl(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    ""
  );
}

/** Minimum kept in step with MIN_PASSCODE_LENGTH in apps/chat/src/access.ts. */
const minPasscodeLength = 8;

function resolvePasscode() {
  const passcode = process.env.AGENT_PASSCODE ?? "";
  if (passcode === "") {
    fatal(
      "Your agent has no passcode, so anyone could open it.",
      "On your own computer nothing else can reach your agent. On a public",
      "web address anyone who finds it could read your conversations, read",
      "your business facts, and spend your Claude credit.",
      "",
      "To fix it:",
      "  1. In your hosting dashboard, open Variables.",
      `  2. Add AGENT_PASSCODE, and choose at least ${minPasscodeLength} characters.`,
      "  3. Redeploy.",
      "",
      "Do not reuse a password you use anywhere else.",
    );
  }
  if (passcode.length < minPasscodeLength) {
    fatal(
      `Your passcode is too short (${passcode.length} characters).`,
      `Make AGENT_PASSCODE at least ${minPasscodeLength} characters and redeploy.`,
    );
  }
  return passcode;
}

/**
 * Signs the sign-in cookie. It lives on the volume rather than in a variable
 * so that a redeploy does not sign the learner out of their own agent, and so
 * there is one less thing for them to set by hand.
 */
function resolveSessionSecret() {
  try {
    const existing = readFileSync(paths.sessionSecretFile, "utf8").trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch {
    // First boot, or the file was removed. Fall through and make one.
  }
  const secret = randomBytes(32).toString("hex");
  writeFileSync(paths.sessionSecretFile, `${secret}\n`, { mode: 0o600 });
  return secret;
}

/**
 * The port the outside world reaches, on its own. Needed before full config
 * resolves, because the not-ready-yet page has to be served on it.
 */
function chatPort() {
  return port("PORT", port("CHAT_PORT", 3_000));
}

function config() {
  const stored = readPublicUrlsFile();

  // Hosting platforms inject PORT for the service they route to, and they run
  // the healthcheck against that same port, so it has to win. Ignoring it puts
  // the chat app somewhere the platform never looks: the healthcheck fails with
  // "service unavailable", the deploy is never marked healthy, and no domain is
  // routed anywhere.
  //
  // Railway's own default is 8080, which is neither of this agent's two ports,
  // so PORT must be set to the chat port explicitly on the platform. The cloud
  // connector does that. When it is set, the platform's healthcheck, this
  // process and the port-3000 domain all agree on one number.
  const chatPort = port("PORT", port("CHAT_PORT", 3_000));
  const n8nPort = port("N8N_PORT", 5_678);
  const documentWorkerPort = port("DOCUMENT_WORKER_PORT", 3_100);
  const taskBrokerPort = port(
    "N8N_RUNNERS_BROKER_PORT",
    n8nPort === 65_535 ? n8nPort - 1 : n8nPort + 1,
  );

  const n8nPublic = resolveN8nPublicUrl(stored);
  if (!n8nPublic.url) {
    fatal(
      "Your agent does not know its own web address yet.",
      "Your workshop (n8n) needs to know the address people reach it on,",
      "because that is what it prints into every trigger address you copy",
      "into Slack or anywhere else.",
      "",
      "To fix it:",
      "  1. In your hosting dashboard, open Settings and find your domains.",
      "  2. Copy the address that points to port " + n8nPort + ".",
      "  3. Add a variable named N8N_PUBLIC_URL with that address as its value.",
      "  4. Redeploy.",
    );
  }

  const timezone = process.env.GENERIC_TIMEZONE || process.env.TZ || "UTC";

  return {
    passcode: resolvePasscode(),
    sessionSecret: resolveSessionSecret(),
    chatPort,
    n8nPort,
    documentWorkerPort,
    taskBrokerPort,
    timezone,
    n8nPublicUrl: n8nPublic.url,
    n8nPublicUrlSource: n8nPublic.source,
    chatPublicUrl: resolveChatPublicUrl(stored),
  };
}

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------

function n8nEnv(cfg) {
  const host = new URL(cfg.n8nPublicUrl).hostname;
  return {
    GENERIC_TIMEZONE: cfg.timezone,
    TZ: cfg.timezone,

    N8N_USER_FOLDER: paths.n8nUserFolder,
    N8N_LISTEN_ADDRESS: "::",
    N8N_PORT: String(cfg.n8nPort),

    // Public identity. WEBHOOK_URL is the name n8n actually reads; the local
    // runner's N8N_WEBHOOK_URL is not a variable n8n recognises.
    N8N_HOST: host,
    N8N_PROTOCOL: "https",
    N8N_EDITOR_BASE_URL: cfg.n8nPublicUrl,
    WEBHOOK_URL: `${cfg.n8nPublicUrl}/`,

    // Behind the platform's TLS terminator.
    N8N_PROXY_HOPS: process.env.N8N_PROXY_HOPS || "1",
    N8N_SECURE_COOKIE: "true",

    // The task broker is an internal channel between n8n and its Code-node
    // runner. It must never be reachable from outside the container.
    N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1",
    N8N_RUNNERS_BROKER_PORT: String(cfg.taskBrokerPort),
    N8N_RUNNERS_TASK_TIMEOUT: "60",

    // Unbounded execution history is the way a small volume fills up once
    // triggers start firing on a schedule.
    EXECUTIONS_DATA_PRUNE: "true",
    EXECUTIONS_DATA_MAX_AGE: process.env.EXECUTIONS_DATA_MAX_AGE || "336",
    EXECUTIONS_DATA_PRUNE_MAX_COUNT:
      process.env.EXECUTIONS_DATA_PRUNE_MAX_COUNT || "5000",
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: "false",
    N8N_DEFAULT_BINARY_DATA_MODE: "filesystem",

    // Same posture as the local runner.
    N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
    N8N_COMMUNITY_PACKAGES_ENABLED: "false",
    N8N_UNVERIFIED_PACKAGES_ENABLED: "false",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_PERSONALIZATION_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
  };
}

function chatEnv(cfg) {
  return {
    NODE_ENV: "production",
    PORT: String(cfg.chatPort),
    CHAT_LISTEN_ADDRESS: "::",
    CHAT_REQUEST_TIMEOUT_MS: process.env.CHAT_REQUEST_TIMEOUT_MS || "120000",

    // Everything except /health is behind this.
    AGENT_PASSCODE: cfg.passcode,
    AGENT_SESSION_SECRET: cfg.sessionSecret,
    AGENT_COOKIE_SECURE: "true",
    AGENT_PROXY_HOPS: process.env.N8N_PROXY_HOPS || "1",

    AGENT_REGISTRY_PATH: paths.agentRegistry,
    CHAT_DATA_DIRECTORY: paths.chatDataDir,
    DOCUMENT_DATA_DIRECTORY: paths.documentDataDir,
    PROFILE_DATA_DIRECTORY: paths.profileDataDir,
    SKILLS_DIRECTORY: paths.skillsDir,

    // Both internal. Traffic between the three services never leaves the
    // container, so it stays on loopback and out of the public address.
    DOCUMENT_WORKER_URL: `http://127.0.0.1:${cfg.documentWorkerPort}`,
    N8N_CHAT_WEBHOOK_URL: `http://127.0.0.1:${cfg.n8nPort}/webhook/chat`,
  };
}

function documentWorkerEnv(cfg) {
  return {
    NODE_ENV: "production",
    PORT: String(cfg.documentWorkerPort),
    DOCUMENT_LISTEN_ADDRESS: "127.0.0.1",
  };
}

const services = {
  n8n: {
    label: "workshop",
    tag: "n8n  ",
    argv: () => [paths.n8nBin],
    env: n8nEnv,
    healthUrl: (cfg) => `http://127.0.0.1:${cfg.n8nPort}/healthz`,
    // n8n runs migrations on a cold database, which is the slowest first boot.
    readyTimeoutMs: 300_000,
  },
  documentWorker: {
    label: "document reader",
    tag: "docs ",
    argv: () => [paths.documentWorkerServer],
    env: documentWorkerEnv,
    healthUrl: (cfg) => `http://127.0.0.1:${cfg.documentWorkerPort}/health`,
    readyTimeoutMs: 60_000,
  },
  chat: {
    label: "chat",
    tag: "chat ",
    argv: () => [paths.chatServer],
    env: chatEnv,
    healthUrl: (cfg) => `http://127.0.0.1:${cfg.chatPort}/health`,
    readyTimeoutMs: 60_000,
  },
};

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/**
 * Everything the agent needs before it can start, gathered in one pass.
 *
 * Reporting these one at a time would mean a learner adds storage, waits out a
 * five-minute build, and is then told about a variable. So they are collected
 * and shown together.
 */
function findConfigProblems() {
  const problems = [];

  try {
    mkdirSync(paths.dataDir, { recursive: true });
    const probe = join(paths.dataDir, ".write-test");
    writeFileSync(probe, String(startedAt));
    statSync(probe);
    rmSync(probe, { force: true });
  } catch {
    problems.push({
      title: "Somewhere to keep your work",
      steps: [
        "Open your service and choose <strong>Settings</strong>.",
        "Find <strong>Volumes</strong> and choose <strong>Add Volume</strong>.",
        `Set the mount path to exactly <code>${paths.dataDir}</code>.`,
      ],
      log: [
        `Your agent cannot save anything to ${paths.dataDir}.`,
        "Settings, then Volumes, then Add Volume, mount path exactly:",
        `    ${paths.dataDir}`,
        "Without it every conversation and credential would be erased on the",
        "next deploy.",
      ],
    });
  }

  if ((process.env.AGENT_PASSCODE ?? "").length < minPasscodeLength) {
    const tooShort = (process.env.AGENT_PASSCODE ?? "") !== "";
    problems.push({
      title: tooShort ? "A longer passcode" : "A passcode, so only you can open it",
      steps: [
        "Open your service and choose <strong>Variables</strong>.",
        `Add one named <code>AGENT_PASSCODE</code>, at least ${minPasscodeLength} characters.`,
        "Do not reuse a password you use anywhere else.",
      ],
      log: [
        tooShort
          ? `AGENT_PASSCODE is shorter than ${minPasscodeLength} characters.`
          : "There is no AGENT_PASSCODE, so anyone who found the address could open your agent.",
      ],
    });
  }

  if (resolveN8nPublicUrl(readPublicUrlsFile()).url === "") {
    problems.push({
      title: "The address of your workshop",
      steps: [
        "Open <strong>Settings</strong>, then <strong>Networking</strong>.",
        "Generate a domain for port <strong>5678</strong> if you have not already.",
        "Under <strong>Variables</strong>, add <code>N8N_PUBLIC_URL</code> set to that address.",
      ],
      log: [
        "Your agent does not know the address people reach its workshop on,",
        "which is what it prints into every trigger address you copy elsewhere.",
      ],
    });
  }

  return problems;
}

/**
 * The credential key lives on the volume, put there either by n8n on a fresh
 * start or by a restored pack. Setting N8N_ENCRYPTION_KEY by hand can only
 * disagree with it, and disagreeing means every saved credential is
 * unreadable.
 */
function assertEncryptionKeyAgrees() {
  const fromEnv = process.env.N8N_ENCRYPTION_KEY ?? "";
  if (fromEnv === "") {
    return;
  }
  let onDisk = "";
  try {
    onDisk = JSON.parse(
      readFileSync(join(paths.n8nUserFolder, ".n8n", "config"), "utf8"),
    ).encryptionKey;
  } catch {
    // No key stored yet, so there is nothing to disagree with.
    return;
  }
  if (onDisk === fromEnv) {
    return;
  }
  fatal(
    "Your agent has two different credential keys and cannot open your credentials.",
    "Your saved credentials are locked with a key that came across with your",
    "agent. Something has set a different one, so none of them can be read.",
    "",
    "To fix it:",
    "  1. In your hosting dashboard, open Variables.",
    "  2. Delete the variable named N8N_ENCRYPTION_KEY.",
    "  3. Redeploy.",
    "",
    "You never need to set that variable. Your key travels inside your agent",
    "pack, which is why your credentials work without you retyping them.",
  );
}

function ensureDataDirs() {
  for (const dir of [
    paths.n8nUserFolder,
    paths.chatDataDir,
    paths.documentDataDir,
    paths.profileDataDir,
    paths.skillsDir,
    paths.configDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Skills ship in the image but are edited by the learner, so the working copy
 * has to live on the volume. Seeding only fills gaps: an existing folder is
 * the learner's and is never overwritten by a deploy.
 */
function seedSkills() {
  if (!existsSync(paths.repoSkillsDir)) {
    return [];
  }
  const seeded = [];
  for (const entry of readdirSync(paths.repoSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const target = join(paths.skillsDir, entry.name);
    if (existsSync(target)) {
      continue;
    }
    cpSync(join(paths.repoSkillsDir, entry.name), target, { recursive: true });
    seeded.push(entry.name);
  }
  return seeded;
}

/**
 * Fills in metadata keys that a volume's skills predate.
 *
 * Seeding above deliberately never overwrites a learner's skill folder. That is
 * right for their edits, and wrong for a key that only became required later:
 * when skills gained an owning agent, every deployment that already existed had
 * skill.yaml files without one, and the agent then refused to start while
 * naming a file inside a volume the learner cannot open.
 *
 * So copy across just the missing line, from the version that shipped in this
 * image. Everything the learner wrote is left exactly as it is.
 */
function migrateSkillMetadata() {
  if (!existsSync(paths.skillsDir)) {
    return [];
  }
  const migrated = [];
  for (const entry of readdirSync(paths.skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const saved = join(paths.skillsDir, entry.name, "skill.yaml");
    // A base skill sits at skills/<name>/skill.yaml. An installable one keeps
    // its own copy a level deeper, at optional-skills/<name>/skill/skill.yaml.
    // A volume can hold either, so look in both before giving up: a learner who
    // installed an optional skill before it gained an owning agent has a saved
    // copy that only the catalogue can repair.
    const shipped = join(paths.repoSkillsDir, entry.name, "skill.yaml");
    const optional = join(
      paths.repoOptionalSkillsDir,
      entry.name,
      "skill",
      "skill.yaml",
    );
    const source = existsSync(shipped) ? shipped : optional;
    if (!existsSync(saved) || !existsSync(source)) {
      continue;
    }
    const current = readFileSync(saved, "utf8");
    if (/^agent:/m.test(current)) {
      continue;
    }
    const line = readFileSync(source, "utf8").match(/^agent:.*$/m);
    if (!line) {
      continue;
    }
    // Straight after the id, so the file still reads the way it shipped.
    const updated = /^id:.*$/m.test(current)
      ? current.replace(/^(id:.*)$/m, `$1\n${line[0]}`)
      : `${line[0]}\n${current}`;
    writeFileSync(saved, updated);
    migrated.push(entry.name);
  }
  return migrated;
}


// ---------------------------------------------------------------------------
// Process supervision
// ---------------------------------------------------------------------------

const children = new Map();
let shuttingDown = false;

function streamOutput(tag, stream) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`[${tag}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      process.stdout.write(`[${tag}] ${buffer}\n`);
    }
  });
}

function startService(name, cfg) {
  const service = services[name];
  const child = spawn(process.execPath, service.argv(), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...service.env(cfg) },
  });

  streamOutput(service.tag, child.stdout);
  streamOutput(service.tag, child.stderr);
  children.set(name, child);

  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) {
      return;
    }
    // One dead service means a half-working agent, which is harder for a
    // learner to diagnose than a restart. Take the whole container down and
    // let the platform bring back a clean one.
    print("");
    print(
      `The ${service.label} service stopped unexpectedly ` +
        `(${signal ? `signal ${signal}` : `exit code ${code}`}).`,
    );
    print("Restarting your whole agent. The lines above show why it stopped.");
    void shutdown(1);
  });

  child.on("error", (error) => {
    fatal(
      `The ${service.label} service could not be started.`,
      error.message,
    );
  });

  return child;
}

function fetchStatus(url, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForService(name, cfg) {
  const service = services[name];
  const url = service.healthUrl(cfg);
  const waitingSince = Date.now();
  const deadline = waitingSince + service.readyTimeoutMs;
  let lastNotice = waitingSince;

  while (Date.now() < deadline) {
    if (!children.has(name)) {
      // The exit handler has already explained why and started shutdown.
      await sleep(1_000);
      return false;
    }
    if (await fetchStatus(url)) {
      print(`  ${service.label} is ready.`);
      return true;
    }
    if (Date.now() - lastNotice > 20_000) {
      const waited = Math.round((Date.now() - waitingSince) / 1_000);
      print(`  still waiting for ${service.label} (${waited}s)...`);
      lastNotice = Date.now();
    }
    await sleep(1_000);
  }

  fatal(
    `The ${service.label} service did not become ready in time.`,
    `Nothing answered at ${url}.`,
    "The lines above, tagged with the service name, show what it was doing.",
  );
  return false;
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  // Chat first, n8n last: stop accepting new work before stopping the thing
  // that is doing it, so an in-flight run has a chance to finish.
  for (const name of ["chat", "documentWorker", "n8n"]) {
    const child = children.get(name);
    if (child) {
      child.kill("SIGTERM");
    }
  }

  const deadline = Date.now() + 25_000;
  while (children.size > 0 && Date.now() < deadline) {
    await sleep(200);
  }
  for (const child of children.values()) {
    child.kill("SIGKILL");
  }

  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Holds the chat port while the services behind it start.
 *
 * Answers the platform's health check so a slow start is not read as a crash,
 * and tells anyone who arrives early what is happening rather than letting the
 * platform show them a generic failure page. Returns null if the port cannot be
 * held, because that is never worth stopping a deploy over.
 */
function holdChatPort(cfg) {
  const server = createServer((request, response) => {
    if ((request.url ?? "/") === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", starting: true }));
      return;
    }
    response.writeHead(503, {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "15",
    });
    response.end(
      `<!doctype html><meta charset="utf-8">` +
        `<meta http-equiv="refresh" content="10">` +
        `<title>Starting your agent</title>` +
        `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:18vh auto;padding:0 1.5rem;color:#111}` +
        `h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:0 0 .75rem;color:#444}</style>` +
        `<h1>Starting your agent</h1>` +
        `<p>Your workshop is waking up. This takes a minute or two the first time.</p>` +
        `<p>This page checks by itself and will show your agent when it is ready — ` +
        `there is nothing you need to do, and nothing has gone wrong.</p>`,
    );
  });
  server.on("error", () => undefined);
  try {
    server.listen(cfg.chatPort, "::");
    // Never the reason this process stays alive. If a service fails to start,
    // the supervisor shuts down and the container must be free to exit and be
    // restarted — a placeholder page holding the event loop open would turn a
    // clean restart into a hang that looks like a working agent.
    server.unref();
  } catch {
    return null;
  }
  return server;
}

/** Steps aside so the real chat app can take the port. */
function releasePort(server) {
  if (!server) {
    return Promise.resolve();
  }
  return new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections?.();
    // Never let a lingering socket stall the deploy.
    setTimeout(done, 2_000);
  });
}

async function main() {
  print("Starting your agent...");
  print("");

  // A hosting platform builds and deploys the moment a project is created, so
  // the first deploy of every agent lands here before anyone could have added
  // storage or settings. Holding the door open beats exiting: exiting shows
  // the learner "healthcheck failure" and hides the reason in a log.
  const problems = findConfigProblems();
  if (problems.length > 0) {
    const width = 72;
    print(`${"=".repeat(width)}`);
    print("YOUR AGENT IS NOT READY YET\n");
    for (const problem of problems) {
      print(`${problem.title}`);
      for (const line of problem.log) {
        print(`  ${line}`);
      }
      print("");
    }
    print("Add these in your hosting dashboard, then deploy again.");
    print(`${"=".repeat(width)}`);
    await runConfigHelp({ port: chatPort(), problems, log: print });
    return;
  }

  ensureDataDirs();
  const seeded = seedSkills();
  if (seeded.length > 0) {
    print(`  Installed skills for the first time: ${seeded.join(", ")}`);
  }
  const migrated = migrateSkillMetadata();
  if (migrated.length > 0) {
    print(`  Updated saved skills to the current format: ${migrated.join(", ")}`);
  }

  const cfg = config();
  print(`  Storage:  ${paths.dataDir}`);
  print(`  Workshop: ${cfg.n8nPublicUrl}  (from ${cfg.n8nPublicUrlSource})`);
  if (cfg.chatPublicUrl) {
    print(`  Chat:     ${cfg.chatPublicUrl}`);
  }
  if (cfg.n8nPublicUrlSource.includes("unconfirmed")) {
    print("");
    print("  NOTE: this address was guessed from the hosting platform, and a");
    print("  service with two addresses reports only one of them. If your");
    print("  trigger addresses do not work, set N8N_PUBLIC_URL explicitly.");
  }
  print("");

  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));

  // Deliberately before any service starts. Nothing has the databases open
  // yet, so a restored pack is written straight into place — no staging area,
  // no restart, and no moment where a half-restored agent is serving.
  if (setupIsNeeded(paths)) {
    const outcome = await runSetup({
      port: cfg.chatPort,
      passcode: cfg.passcode,
      paths,
      log: print,
    });
    print(
      outcome.restored
        ? `  Your agent was brought across: ${outcome.files.length} files restored.`
        : "  Starting a new, empty agent.",
    );
    print("");
  }

  // From here until the chat app is listening, n8n has to start and publish
  // eighteen workflows, which takes the best part of a minute. Nothing is bound
  // to the chat port during that time, so the platform serves its own
  // "Application failed to respond" page — to a learner who has just handed
  // over a file containing every credential they own. This holds the address
  // with something that says so instead, and steps aside when the real app is
  // ready. It also covers the same gap on every ordinary redeploy.
  const holding = holdChatPort(cfg);

  // n8n refuses to start if N8N_ENCRYPTION_KEY disagrees with the key on the
  // volume, which is correct but arrives as a crash loop and a link to the
  // docs. Nobody needs to set this variable — the key travels inside the pack
  // — so catching it here turns a confusing loop into an instruction.
  assertEncryptionKeyAgrees();

  // Also before n8n starts. The CLI works straight on the database, so the
  // workflows are already correct when n8n first reads them and nothing needs
  // restarting to pick them up.
  try {
    const sync = syncWorkflows({ paths, n8nEnv: n8nEnv(cfg), log: print });
    if (!sync.skipped) {
      print(
        `  ${sync.imported} workflows updated, ${sync.published} turned on` +
          (sync.mainPublished ? ", and your agent is live." : "."),
      );
      if (!sync.mainPublished) {
        print(
          "  Your agent itself stays off until its Anthropic credential is in place.",
        );
      }
    }
  } catch (error) {
    // A workflow problem should not cost the learner their whole agent: n8n,
    // the editor and their credentials are all still worth having.
    print(`  ${String(error.message ?? error)}`);
    print("  Starting anyway. Open your workshop to see what is there.");
  }
  print("");

  // Strict order: n8n owns the database and both other services talk to it.
  startService("n8n", cfg);
  if (!(await waitForService("n8n", cfg))) return;

  await primeAgent({ paths, n8nPort: cfg.n8nPort, log: print });

  startService("documentWorker", cfg);
  if (!(await waitForService("documentWorker", cfg))) return;

  await releasePort(holding);
  startService("chat", cfg);
  if (!(await waitForService("chat", cfg))) return;

  const seconds = Math.round((Date.now() - startedAt) / 1_000);
  print("");
  print(`Your agent is running. Started in ${seconds}s.`);
  if (cfg.chatPublicUrl) {
    print(`  Talk to it:   ${cfg.chatPublicUrl}`);
  }
  print(`  Workshop:     ${cfg.n8nPublicUrl}`);
  print("");
}

main().catch((error) => {
  fatal("Something unexpected went wrong while starting.", String(error));
});
