#!/usr/bin/env node
// Cross-platform local runner for AI Solopreneur.
//
// One Node.js script provides the complete local runtime: it installs the
// pinned n8n engine with npm, builds the dependency-free chat
// gateway and document reader, runs all three as background processes, and
// provides the same setup,
// import, diagnose, backup, restore, and reset helpers on macOS and Windows.
//
// Learners normally reach this through setup.command / setup-windows.cmd and
// friends. Technical users can call it directly:
//
//   node scripts/local.mjs help

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import net from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const rootPackage = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
);
const pinnedN8nVersion = rootPackage.dependencies.n8n;
const pinnedNodeVersion = readFileSync(
  join(projectRoot, ".node-version"),
  "utf8",
).trim();
const pinnedNpmVersion = readFileSync(
  join(projectRoot, ".npm-version"),
  "utf8",
).trim();
const runtimeRoot = resolve(
  process.env.AI_SOLO_RUNTIME_DIR || join(projectRoot, ".runtime"),
);
const npmInstallTimeoutMs = 30 * 60 * 1_000;
const npmCommandTimeoutMs = 10 * 60 * 1_000;
const n8nCliTimeoutMs = 5 * 60 * 1_000;

const paths = {
  envFile: join(projectRoot, ".env"),
  dataDir: join(projectRoot, "data"),
  n8nUserFolder: join(projectRoot, "data", "n8n"),
  n8nDataDir: join(projectRoot, "data", "n8n", ".n8n"),
  logsDir: join(projectRoot, "data", "logs"),
  runDir: join(projectRoot, "data", "run"),
  tmpDir: join(projectRoot, "data", "tmp"),
  n8nBin: join(projectRoot, "node_modules", "n8n", "bin", "n8n"),
  n8nPackage: join(projectRoot, "node_modules", "n8n", "package.json"),
  chatDir: join(projectRoot, "apps", "chat"),
  chatServer: join(projectRoot, "apps", "chat", "dist", "server.js"),
  agentRegistry: join(projectRoot, "apps", "chat", "config", "agents.json"),
  chatDataDir: join(projectRoot, "data", "chat"),
  chatDatabase: join(projectRoot, "data", "chat", "chat.sqlite"),
  documentWorkerDir: join(projectRoot, "services", "document-worker"),
  documentWorkerServer: join(
    projectRoot,
    "services",
    "document-worker",
    "src",
    "server.mjs",
  ),
  documentWorkerDependency: join(
    projectRoot,
    "services",
    "document-worker",
    "node_modules",
    "jszip",
    "package.json",
  ),
  documentDataDir: join(projectRoot, "data", "documents"),
  workflowsDir: join(projectRoot, "n8n", "workflows"),
  backupsDir: join(projectRoot, "backups"),
  runtimeDir: runtimeRoot,
  npmCacheDir: join(runtimeRoot, "npm-cache"),
  npmLogsDir: join(runtimeRoot, "npm-logs"),
  n8nInstallStamp: join(runtimeRoot, "n8n-install.json"),
  operationLock: join(projectRoot, "data", "run", "operation.lock"),
};

const workflowIds = {
  main: "phase3StartHere",
  health: "phase3AgentHealth",
  checklist: "phase6LearnerChecklist",
  taskSetup: "phase4TaskSetup",
  skillSync: "phase5SyncEnabledSkills",
  tools: [
    "phase4ListTasks",
    "phase4CreateTask",
    "phase4UpdateTaskStatus",
    "phase5ProposeCreateTask",
    "phase5ProposeTaskStatus",
    "phase5ConfirmTaskWrite",
  ],
};

const exportedWorkflowFiles = [
  ["phase3StartHere", "00-start-here-project-partner.json"],
  ["phase6LearnerChecklist", "01-start-here-learner-checklist.json"],
  ["phase4TaskSetup", "10-setup-local-task-data.json"],
  ["phase5SyncEnabledSkills", "11-setup-sync-enabled-skills.json"],
  ["phase4ListTasks", "20-tool-list-tasks.json"],
  ["phase4CreateTask", "21-tool-create-task.json"],
  ["phase4UpdateTaskStatus", "22-tool-update-task-status.json"],
  ["phase5ProposeCreateTask", "30-tool-propose-create-task.json"],
  ["phase5ProposeTaskStatus", "31-tool-propose-update-task-status.json"],
  ["phase5ConfirmTaskWrite", "40-confirm-task-write.json"],
  ["phase3AgentHealth", "90-debug-agent-health.json"],
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function readEnvFile() {
  const values = new Map();
  if (!existsSync(paths.envFile)) {
    return values;
  }
  for (const line of readFileSync(paths.envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) {
      values.set(match[1], match[2]);
    }
  }
  return values;
}

function systemTimezone() {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Melbourne"
    );
  } catch {
    return "Australia/Melbourne";
  }
}

function config() {
  const file = readEnvFile();
  const value = (key, fallback) => {
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess !== "") {
      return fromProcess;
    }
    const fromFile = file.get(key);
    return fromFile !== undefined && fromFile !== "" ? fromFile : fallback;
  };

  const chatPort = Number(value("CHAT_PORT", "3000"));
  const n8nPort = Number(value("N8N_PORT", "5678"));
  const documentWorkerPort = Number(value("DOCUMENT_WORKER_PORT", "3100"));
  const taskBrokerPort = Number(
    value(
      "N8N_RUNNERS_BROKER_PORT",
      String(n8nPort === 65535 ? n8nPort - 1 : n8nPort + 1),
    ),
  );
  const timezone = value("GENERIC_TIMEZONE", systemTimezone());

  // n8n normally manages its own key inside data/n8n. An explicit key remains
  // supported for controlled backup/restore workflows. The placeholder from
  // .env.example is ignored.
  const envKey = value("N8N_ENCRYPTION_KEY", "");
  const encryptionKey =
    envKey.length >= 32 && !envKey.startsWith("replace-") ? envKey : "";

  return {
    chatPort,
    n8nPort,
    documentWorkerPort,
    taskBrokerPort,
    timezone,
    encryptionKey,
  };
}

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function n8nEnv(cfg) {
  const env = {
    GENERIC_TIMEZONE: cfg.timezone,
    TZ: cfg.timezone,
    N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
    N8N_COMMUNITY_PACKAGES_ENABLED: "false",
    N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES: "268435456",
    N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES: "1000",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_EDITOR_BASE_URL: `http://localhost:${cfg.n8nPort}`,
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
    N8N_HOST: "localhost",
    N8N_LISTEN_ADDRESS: "127.0.0.1",
    N8N_PERSONALIZATION_ENABLED: "false",
    N8N_PORT: String(cfg.n8nPort),
    N8N_PROTOCOL: "http",
    N8N_RUNNERS_TASK_TIMEOUT: "60",
    N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1",
    N8N_RUNNERS_BROKER_PORT: String(cfg.taskBrokerPort),
    N8N_SECURE_COOKIE: "false",
    N8N_UNVERIFIED_PACKAGES_ENABLED: "false",
    N8N_USER_FOLDER: paths.n8nUserFolder,
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_WEBHOOK_URL: `http://localhost:${cfg.n8nPort}/`,
  };
  if (cfg.encryptionKey) {
    env.N8N_ENCRYPTION_KEY = cfg.encryptionKey;
  }
  return env;
}

function chatEnv(cfg) {
  return {
    NODE_ENV: "production",
    PORT: String(cfg.chatPort),
    AGENT_REGISTRY_PATH: paths.agentRegistry,
    CHAT_LISTEN_ADDRESS: "127.0.0.1",
    CHAT_REQUEST_TIMEOUT_MS: "120000",
    CHAT_DATA_DIRECTORY: paths.chatDataDir,
    DOCUMENT_DATA_DIRECTORY: paths.documentDataDir,
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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}

function ensureDirs() {
  for (const dir of [
    paths.dataDir,
    paths.n8nUserFolder,
    paths.documentDataDir,
    paths.logsDir,
    paths.runDir,
    paths.tmpDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}

function ensureNpmDirs() {
  for (const dir of [paths.runtimeDir, paths.npmCacheDir, paths.npmLogsDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

async function withOperationLock(label, operation) {
  ensureDirs();
  let descriptor;
  try {
    descriptor = openSync(paths.operationLock, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    try {
      const existing = JSON.parse(readFileSync(paths.operationLock, "utf8"));
      const ageMs = Date.now() - Date.parse(existing.startedAt);
      if (
        Number.isInteger(existing.pid) &&
        pidIsRunning(existing.pid) &&
        Number.isFinite(ageMs) &&
        ageMs >= 0 &&
        ageMs < 2 * 60 * 60 * 1_000
      ) {
        throw new Error(
          `Another ${existing.label || "setup/start"} operation is already running ` +
            `(PID ${existing.pid}). Keep that window open and wait for it to finish.`,
        );
      }
    } catch (existingError) {
      if (existingError.message.startsWith("Another ")) {
        throw existingError;
      }
    }
    rmSync(paths.operationLock, { force: true });
    descriptor = openSync(paths.operationLock, "wx");
  }

  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify({
        pid: process.pid,
        label,
        startedAt: new Date().toISOString(),
      })}\n`,
    );
    return await operation();
  } finally {
    closeSync(descriptor);
    rmSync(paths.operationLock, { force: true });
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function tmpPath(name) {
  ensureDirs();
  return join(paths.tmpDir, name);
}

function timestamp() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function tailOfFile(path, lines = 30) {
  try {
    const content = readFileSync(path, "utf8");
    return content.split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "(no log output captured yet)";
  }
}

async function confirmPhrase(prompt, phrase) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(prompt)).trim();
    return answer === phrase;
  } finally {
    rl.close();
  }
}

function checkPortBinding(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    const finish = (result) => {
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        // The server never reached its listening state.
      }
      resolvePort(result);
    };
    server.once("error", (error) => {
      finish({ available: false, code: error.code ?? "UNKNOWN" });
    });
    server.listen(
      {
        port,
        host: "127.0.0.1",
        exclusive: true,
      },
      () => finish({ available: true, code: null }),
    );
  });
}

function fetchStatus(url, options = {}, timeoutMs = 5_000) {
  return new Promise((resolveStatus) => {
    const body = options.body;
    const headers = { ...(options.headers ?? {}) };
    if (
      body !== undefined &&
      !Object.keys(headers).some((name) => name.toLowerCase() === "content-length")
    ) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolveStatus(value);
      }
    };
    const request = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        headers,
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          finish({
            status,
            ok: status >= 200 && status < 300,
            body: chunks.join(""),
          });
        });
        response.on("error", () => finish(null));
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Local health request timed out"));
    });
    request.on("error", () => finish(null));
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Node and npm checks
// ---------------------------------------------------------------------------

function assertNodeVersion() {
  if (process.versions.node !== pinnedNodeVersion) {
    printError(
      `This project uses the reviewed Node.js ${pinnedNodeVersion} runtime; ` +
        `this command is running with ${process.versions.node}.`,
    );
    printError(
      "Run it through setup.command (macOS) or setup-windows.cmd (Windows) so the project selects the matching private runtime.",
    );
    process.exit(1);
  }
}

function bundledNpmCli() {
  const candidates = isWindows
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
    : [
        join(
          dirname(process.execPath),
          "..",
          "lib",
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function npmEnvironment() {
  ensureNpmDirs();
  const env = { ...process.env };
  const setControlled = (name, value) => {
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === name) {
        delete env[key];
      }
    }
    env[name] = value;
  };
  setControlled("NPM_CONFIG_CACHE", paths.npmCacheDir);
  setControlled("NPM_CONFIG_LOGS_DIR", paths.npmLogsDir);
  setControlled("NPM_CONFIG_FETCH_RETRIES", "5");
  setControlled("NPM_CONFIG_FETCH_RETRY_MINTIMEOUT", "2000");
  setControlled("NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT", "30000");
  setControlled("NPM_CONFIG_FETCH_TIMEOUT", "120000");
  setControlled("NPM_CONFIG_MAXSOCKETS", "16");
  setControlled("NPM_CONFIG_LOGLEVEL", "error");
  return env;
}

function latestNpmLog() {
  try {
    return readdirSync(paths.npmLogsDir)
      .filter((entry) => entry.endsWith(".log"))
      .map((entry) => join(paths.npmLogsDir, entry))
      .sort(
        (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
      )[0];
  } catch {
    return null;
  }
}

function runNpmRaw(args, { cwd, stdio = "inherit", timeout } = {}) {
  const npmCli = bundledNpmCli();
  if (isWindows && npmCli === null) {
    return {
      error: new Error(
        `The npm CLI paired with ${process.execPath} is missing. Rerun setup-windows.cmd so it can repair the private runtime.`,
      ),
      status: null,
    };
  }
  const command = npmCli === null ? "npm" : process.execPath;
  const commandArgs = npmCli === null ? args : [npmCli, ...args];
  return spawnSync(command, commandArgs, {
    cwd,
    stdio,
    encoding: stdio === "pipe" ? "utf8" : undefined,
    timeout,
    env: npmEnvironment(),
  });
}

function runNpm(args, { cwd, label, timeout = npmCommandTimeoutMs }) {
  const result = runNpmRaw(args, { cwd, timeout });
  if (result.error) {
    const log = latestNpmLog();
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(
        `${label} did not finish within ${Math.ceil(timeout / 60_000)} minutes and was stopped.` +
          (log ? `\nDetailed npm log: ${log}` : "") +
          (log ? `\nLast npm log lines:\n${tailOfFile(log, 60)}` : "") +
          "\nCheck the network requirements, free disk space, and whether antivirus or OneDrive is scanning the project, then rerun setup.",
      );
    }
    throw new Error(
      `npm is not available (${result.error.message}). ` +
        "Rerun the command through the supplied project helper so it can use the matching private npm copy.",
    );
  }
  if (result.status !== 0) {
    const log = latestNpmLog();
    const help = isWindows
      ? "\nOn Windows, also check that the project is in a short local folder outside OneDrive, has at least 6 GB free, and can reach registry.npmjs.org, cdn.sheetjs.com, and release-assets.githubusercontent.com."
      : "";
    throw new Error(
      `${label} did not finish successfully (npm exit ${result.status}).` +
        (log ? `\nDetailed npm log: ${log}` : "") +
        help,
    );
  }
}

// ---------------------------------------------------------------------------
// n8n CLI
// ---------------------------------------------------------------------------

function requireLocalInstall() {
  if (!n8nInstallIsCurrent()) {
    throw new Error(
      "The pinned n8n dependency installation is missing, incomplete, or was created by a different Node.js runtime. " +
        "Double-click setup.command (macOS) or setup-windows.cmd (Windows) to repair it.",
    );
  }
}

function ensureDocumentWorkerInstalled() {
  if (existsSync(paths.documentWorkerDependency)) {
    return;
  }
  print("Installing the local document reader...");
  runNpm(
    [
      "ci",
      "--no-audit",
      "--no-fund",
      "--include=optional",
      "--ignore-scripts",
      "--bin-links=true",
    ],
    {
      cwd: paths.documentWorkerDir,
      label: "Installing the local document reader",
    },
  );
}

function chatBuildIsStale() {
  if (!existsSync(paths.chatServer)) {
    return true;
  }
  try {
    const builtAt = statSync(paths.chatServer).mtimeMs;
    const sourceDir = join(paths.chatDir, "src");
    return readdirSync(sourceDir).some(
      (entry) => statSync(join(sourceDir, entry)).mtimeMs > builtAt,
    );
  } catch {
    return true;
  }
}

function ensureChatBuilt() {
  if (!chatBuildIsStale()) {
    return;
  }
  print("Building the local chat app...");
  if (!existsSync(join(paths.chatDir, "node_modules", "typescript"))) {
    runNpm(
      [
        "ci",
        "--no-audit",
        "--no-fund",
        "--include=dev",
        "--include=optional",
        "--ignore-scripts",
        "--bin-links=true",
      ],
      {
        cwd: paths.chatDir,
        label: "Installing the chat build tools",
      },
    );
  }
  runNpm(["run", "build"], {
    cwd: paths.chatDir,
    label: "Building the chat app",
  });
}

function installedN8nVersion() {
  try {
    return JSON.parse(readFileSync(paths.n8nPackage, "utf8")).version;
  } catch {
    return null;
  }
}

function installedNpmVersion() {
  const result = runNpmRaw(["--version"], {
    cwd: projectRoot,
    stdio: "pipe",
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return String(result.stdout ?? "").trim();
}

function n8nInstallSignature() {
  const lockHash = createHash("sha256")
    .update(readFileSync(join(projectRoot, "package-lock.json")))
    .digest("hex");
  return {
    lockHash,
    nodeVersion: process.versions.node,
    nodeArch: process.arch,
    nodeModulesAbi: process.versions.modules,
    npmVersion: installedNpmVersion(),
    platform: process.platform,
  };
}

function n8nNativeDependenciesWork() {
  if (!existsSync(paths.n8nPackage)) {
    return false;
  }
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "require('sqlite3'); require('isolated-vm'); process.stdout.write('ok')",
    ],
    {
      cwd: projectRoot,
      stdio: "ignore",
      timeout: 30_000,
    },
  );
  return !result.error && result.status === 0;
}

function n8nInstallIsCurrent() {
  if (installedN8nVersion() !== pinnedN8nVersion) {
    return false;
  }
  try {
    const recorded = JSON.parse(readFileSync(paths.n8nInstallStamp, "utf8"));
    const expected = n8nInstallSignature();
    return (
      Object.keys(expected).every((key) => recorded[key] === expected[key]) &&
      n8nNativeDependenciesWork()
    );
  } catch {
    return false;
  }
}

function recordSuccessfulN8nInstall() {
  ensureNpmDirs();
  writeFileSync(
    paths.n8nInstallStamp,
    `${JSON.stringify(
      {
        ...n8nInstallSignature(),
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function runN8nCli(args, { capture = false, timeout = n8nCliTimeoutMs } = {}) {
  const cfg = config();
  const result = spawnSync(process.execPath, [paths.n8nBin, ...args], {
    env: { ...process.env, ...n8nEnv(cfg) },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  return result;
}

function n8nCliOrThrow(args, label) {
  const result = runN8nCli(args, { capture: true });
  if (result.error) {
    const timeoutHelp =
      result.error.code === "ETIMEDOUT"
        ? ` The command exceeded ${Math.ceil(n8nCliTimeoutMs / 60_000)} minutes and was stopped.`
        : "";
    throw new Error(`${label} could not run (${result.error.message}).${timeoutHelp}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-8)
      .join("\n");
    throw new Error(`${label} failed.\n${detail}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Background services
// ---------------------------------------------------------------------------

const services = {
  n8n: {
    label: "n8n",
    pidFile: () => join(paths.runDir, "n8n.pid"),
    logFile: () => join(paths.logsDir, "n8n.log"),
    argv: () => [paths.n8nBin],
    env: (cfg) => n8nEnv(cfg),
    healthUrl: (cfg) => `http://127.0.0.1:${cfg.n8nPort}/healthz`,
    port: (cfg) => cfg.n8nPort,
  },
  documentWorker: {
    label: "document reader",
    pidFile: () => join(paths.runDir, "document-worker.pid"),
    logFile: () => join(paths.logsDir, "document-worker.log"),
    argv: () => [paths.documentWorkerServer],
    env: (cfg) => documentWorkerEnv(cfg),
    healthUrl: (cfg) =>
      `http://127.0.0.1:${cfg.documentWorkerPort}/health`,
    port: (cfg) => cfg.documentWorkerPort,
  },
  chat: {
    label: "chat",
    pidFile: () => join(paths.runDir, "chat.pid"),
    logFile: () => join(paths.logsDir, "chat.log"),
    argv: () => [paths.chatServer],
    env: (cfg) => chatEnv(cfg),
    healthUrl: (cfg) => `http://127.0.0.1:${cfg.chatPort}/health`,
    port: (cfg) => cfg.chatPort,
  },
};

function readPidRecord(service) {
  try {
    const record = JSON.parse(readFileSync(service.pidFile(), "utf8"));
    return Number.isInteger(record.pid) && record.pid > 1 ? record : null;
  } catch {
    return null;
  }
}

function pidIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function windowsProcessMatchesService(pid, service) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    "if ($p) {",
    "  [PSCustomObject]@{ ExecutablePath = $p.ExecutablePath; CommandLine = $p.CommandLine } | ConvertTo-Json -Compress",
    "}",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (result.error || result.status !== 0 || !result.stdout?.trim()) {
    return false;
  }
  try {
    const details = JSON.parse(result.stdout.trim());
    const executable = String(details.ExecutablePath ?? "").toLowerCase();
    const commandLine = String(details.CommandLine ?? "").toLowerCase();
    return (
      executable === process.execPath.toLowerCase() &&
      commandLine.includes(service.argv()[0].toLowerCase())
    );
  } catch {
    return false;
  }
}

function serviceIsRunning(service) {
  const record = readPidRecord(service);
  if (record === null || !pidIsRunning(record.pid)) {
    return false;
  }
  return !isWindows || windowsProcessMatchesService(record.pid, service);
}

function serviceOwnsConfiguredPort(service, port, role = "primary") {
  if (!serviceIsRunning(service)) {
    return false;
  }
  const record = readPidRecord(service);
  if (record === null) {
    return false;
  }
  if (role === "taskBroker") {
    const recordedBrokerPort =
      record.taskBrokerPort ??
      (record.port === 65535 ? record.port - 1 : record.port + 1);
    return recordedBrokerPort === port;
  }
  return record.port === port;
}

function rotateLog(path) {
  try {
    if (existsSync(path) && statSync(path).size > 2 * 1024 * 1024) {
      renameSync(path, `${path}.old`);
    }
  } catch {
    // Log rotation is best-effort.
  }
}

function startService(name) {
  const service = services[name];
  const cfg = config();
  if (serviceIsRunning(service)) {
    return false;
  }
  ensureDirs();
  rotateLog(service.logFile());
  const logFd = openSync(service.logFile(), "a");
  // detached keeps the services alive after the setup window closes: a new
  // session on macOS/Linux, and a console-independent process on Windows.
  const child = spawn(process.execPath, service.argv(), {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, ...service.env(cfg) },
  });
  closeSync(logFd);
  writeFileSync(
    service.pidFile(),
    `${JSON.stringify({
      pid: child.pid,
      port: service.port(cfg),
      ...(name === "n8n" ? { taskBrokerPort: cfg.taskBrokerPort } : {}),
      startedAt: new Date().toISOString(),
    })}\n`,
  );
  child.unref();
  return true;
}

async function stopService(name) {
  const service = services[name];
  const record = readPidRecord(service);
  if (
    record === null ||
    !pidIsRunning(record.pid) ||
    (isWindows && !windowsProcessMatchesService(record.pid, service))
  ) {
    rmSync(service.pidFile(), { force: true });
    return false;
  }

  const politeStop = () => {
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(record.pid), "/t"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-record.pid, "SIGTERM");
      } catch {
        try {
          process.kill(record.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    }
  };
  const forceStop = () => {
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(record.pid), "/t", "/f"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-record.pid, "SIGKILL");
      } catch {
        try {
          process.kill(record.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  };

  politeStop();
  // taskkill without /f usually cannot stop console services, so Windows
  // moves to a forced, tree-wide stop quickly. POSIX gives n8n 30 seconds for
  // a graceful shutdown.
  const graceMs = isWindows ? 5_000 : 30_000;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && pidIsRunning(record.pid)) {
    await sleep(250);
  }
  if (pidIsRunning(record.pid)) {
    forceStop();
    const forcedDeadline = Date.now() + 10_000;
    while (Date.now() < forcedDeadline && pidIsRunning(record.pid)) {
      await sleep(250);
    }
  }
  if (
    pidIsRunning(record.pid) &&
    (!isWindows || windowsProcessMatchesService(record.pid, service))
  ) {
    throw new Error(
      `Windows could not stop the ${service.label} process (PID ${record.pid}). ` +
        "Close it in Task Manager, then rerun setup. The PID record was preserved to avoid modifying locked files.",
    );
  }
  rmSync(service.pidFile(), { force: true });
  return true;
}

async function waitForService(name, { timeoutMs = 240_000 } = {}) {
  const service = services[name];
  const cfg = config();
  const url = service.healthUrl(cfg);
  const deadline = Date.now() + timeoutMs;
  let lastNotice = Date.now();

  while (Date.now() < deadline) {
    const response = await fetchStatus(url, {}, 3_000);
    if (response !== null && response.ok) {
      return;
    }
    if (!serviceIsRunning(service)) {
      throw new Error(
        `The ${service.label} service stopped while starting. Last log lines:\n` +
          `${tailOfFile(service.logFile())}\n` +
          `Full log: ${service.logFile()}`,
      );
    }
    if (Date.now() - lastNotice > 15_000) {
      print(`  Still waiting for ${service.label} to become ready...`);
      lastNotice = Date.now();
    }
    await sleep(1_000);
  }
  throw new Error(
    `Timed out waiting for ${service.label} at ${url}. Last log lines:\n` +
      `${tailOfFile(service.logFile())}\n` +
      `Full log: ${service.logFile()}`,
  );
}

async function startStack({
  waitFor = ["n8n", "documentWorker", "chat"],
} = {}) {
  const started = [];
  if (startService("n8n")) {
    started.push("n8n");
  }
  if (waitFor.includes("n8n")) {
    await waitForService("n8n");
  }
  if (startService("documentWorker")) {
    started.push("documentWorker");
  }
  if (waitFor.includes("documentWorker")) {
    await waitForService("documentWorker");
  }
  if (startService("chat")) {
    started.push("chat");
  }
  if (waitFor.includes("chat")) {
    await waitForService("chat");
  }
  return started;
}

async function restartN8n() {
  await stopService("n8n");
  startService("n8n");
  await waitForService("n8n");
}

// ---------------------------------------------------------------------------
// Workflow helpers
// ---------------------------------------------------------------------------

function readExportedRows(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? raw : [raw];
}

function exportedWorkflow(workflowId) {
  const out = tmpPath(`export-${workflowId}.json`);
  try {
    const result = runN8nCli(
      ["export:workflow", `--id=${workflowId}`, `--output=${out}`],
      { capture: true },
    );
    if (result.status !== 0) {
      return null;
    }
    const row = readExportedRows(out).find((entry) => entry.id === workflowId);
    return row ?? null;
  } catch {
    return null;
  } finally {
    rmSync(out, { force: true });
  }
}

function reviewedWorkflowsInstalled() {
  return exportedWorkflow(workflowIds.checklist) !== null;
}

async function postWebhook(pathName, body, { tries = 30 } = {}) {
  const cfg = config();
  const url = `http://127.0.0.1:${cfg.n8nPort}/webhook/${pathName}`;
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    last = await fetchStatus(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      10_000,
    );
    if (last !== null && last.ok) {
      return last;
    }
    await sleep(1_000);
  }
  const detail = last === null ? "no response" : `${last.status} ${last.body}`;
  throw new Error(`POST /webhook/${pathName} failed (${detail}).`);
}

function validateWorkflowFiles() {
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "validate-workflows.mjs")],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("The committed workflow files failed validation.");
  }
}

async function compileSkillBundle() {
  const { compileSkills } = await import(
    new URL("./compile-skills.mjs", import.meta.url)
  );
  return JSON.stringify(await compileSkills());
}

async function importReviewedWorkflows() {
  validateWorkflowFiles();

  if (!serviceIsRunning(services.n8n)) {
    print("\nStarting n8n...");
    startService("n8n");
    await waitForService("n8n");
  }

  print("\nImporting the reviewed workflows as inactive drafts...");
  n8nCliOrThrow(
    ["import:workflow", "--separate", `--input=${paths.workflowsDir}`],
    "Workflow import",
  );

  print("\nPreparing local data, enabled skills, and reviewed tool dependencies...");
  const published = [];
  try {
    for (const id of [workflowIds.taskSetup, workflowIds.skillSync]) {
      n8nCliOrThrow(["publish:workflow", `--id=${id}`], `Publishing ${id}`);
      published.push(id);
    }
    for (const id of workflowIds.tools) {
      n8nCliOrThrow(["publish:workflow", `--id=${id}`], `Publishing ${id}`);
    }

    await restartN8n();

    const setupResponse = await postWebhook("setup-task-data", "{}");
    if (!setupResponse.body.includes('"ok":true')) {
      throw new Error(
        `Local task setup returned an unexpected response: ${setupResponse.body}`,
      );
    }

    const bundle = await compileSkillBundle();
    const skillResponse = await postWebhook("sync-enabled-skills", bundle);
    if (!skillResponse.body.includes('"ok":true')) {
      throw new Error(
        `Enabled skill sync returned an unexpected response: ${skillResponse.body}`,
      );
    }
  } finally {
    for (const id of published) {
      runN8nCli(["unpublish:workflow", `--id=${id}`], { capture: true });
    }
    await restartN8n();
  }

  print("\nWorkflows imported successfully.");
  print("Local task tables and three sample tasks are ready.");
  print("Enabled Markdown skills are synced into the agent.");
  const cfg = config();
  print(`Open http://localhost:${cfg.n8nPort} and follow docs/N8N_AGENT_SETUP.md.`);
  print(
    "The main agent stays inactive until you select your Anthropic credential and publish it.",
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandPreflight() {
  let failures = 0;
  const ok = (message) => print(`  [ok] ${message}`);
  const warning = (message) => print(`  [warn] ${message}`);
  const failure = (message) => {
    printError(`  [!!] ${message}`);
    failures += 1;
  };
  const note = (message) => print(`       ${message}`);

  print("AI Solopreneur local preflight\n");

  if (process.versions.node === pinnedNodeVersion) {
    ok(`Reviewed Node.js ${process.versions.node} is available.`);
  } else {
    failure(
      `Node.js ${pinnedNodeVersion} is required for the pinned native dependencies; found ${process.versions.node}.`,
    );
    note("Run the supplied setup helper to download the verified project-local runtime.");
  }

  const npmVersion = installedNpmVersion();
  if (npmVersion !== pinnedNpmVersion) {
    failure(
      `The matching npm ${pinnedNpmVersion} CLI is required; found ${npmVersion || "no working npm"}.`,
    );
    note("The supplied setup helper selects Node.js and npm as one reviewed pair.");
  } else {
    ok(`Matching npm ${npmVersion} is available.`);
  }

  const writeProbe = join(projectRoot, `.ai-solo-write-test-${process.pid}`);
  try {
    writeFileSync(writeProbe, "ok\n", { flag: "wx" });
    rmSync(writeProbe, { force: true });
    ok("The project folder is writable.");
  } catch (error) {
    rmSync(writeProbe, { force: true });
    failure(`The project folder is not writable (${error.code || error.message}).`);
    note("Move the project to a normal folder owned by this Windows account.");
  }

  try {
    const disk = statfsSync(projectRoot);
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    const dependenciesReady =
      n8nInstallIsCurrent() &&
      existsSync(paths.documentWorkerDependency) &&
      existsSync(join(paths.chatDir, "node_modules", "typescript"));
    const minimumBytes = dependenciesReady
      ? 1 * 1024 ** 3
      : 6 * 1024 ** 3;
    const availableGiB = availableBytes / 1024 ** 3;
    if (availableBytes < minimumBytes) {
      failure(
        `${availableGiB.toFixed(1)} GB is free on this drive; ` +
          `${dependenciesReady ? "1" : "6"} GB is required for ${
            dependenciesReady ? "safe local operation" : "the first dependency install"
          }.`,
      );
    } else {
      ok(`${availableGiB.toFixed(1)} GB of free disk space is available.`);
    }
  } catch (error) {
    warning(`Free disk space could not be checked (${error.message}).`);
  }

  if (isWindows) {
    if (projectRoot.startsWith("\\\\")) {
      failure("The project is on a network/UNC path, which npm native packages do not support reliably.");
      note("Clone it to a short local path such as C:\\ai-workshop\\ai-solopreneur.");
    }
    if (/(^|[\\/])OneDrive([\\/]|$)/i.test(projectRoot)) {
      warning("The project is inside OneDrive, which can lock files during the large npm install.");
      note("If setup reports EPERM or EBUSY, clone to C:\\ai-workshop\\ai-solopreneur.");
    }
    if (projectRoot.length > 80) {
      warning(`The project path is ${projectRoot.length} characters long.`);
      note("A short path such as C:\\ai-workshop\\ai-solopreneur is more reliable for Windows native packages.");
    }
  }

  const cfg = config();
  const configuredPorts = [
    [cfg.chatPort, "chat", "CHAT_PORT"],
    [cfg.n8nPort, "n8n", "N8N_PORT"],
    [cfg.documentWorkerPort, "documentWorker", "DOCUMENT_WORKER_PORT"],
    [cfg.taskBrokerPort, "taskBroker", "N8N_RUNNERS_BROKER_PORT"],
  ];
  const seenPorts = new Map();
  for (const [port, name] of configuredPorts) {
    if (validPort(port) && seenPorts.has(port)) {
      failure(
        `${name} and ${seenPorts.get(port)} are both configured to use port ${port}.`,
      );
      note(
        "Give CHAT_PORT, N8N_PORT, DOCUMENT_WORKER_PORT, and N8N_RUNNERS_BROKER_PORT different values in .env.",
      );
    } else if (validPort(port)) {
      seenPorts.set(port, name);
    }
  }

  for (const [port, name, configName] of configuredPorts) {
    if (!validPort(port)) {
      failure(`${configName} must be a number between 1 and 65535.`);
      continue;
    }
    const ownerService = name === "taskBroker" ? services.n8n : services[name];
    const portLabel =
      name === "taskBroker" ? "n8n task broker" : ownerService.label;
    if (
      serviceOwnsConfiguredPort(
        ownerService,
        port,
        name === "taskBroker" ? "taskBroker" : "primary",
      )
    ) {
      ok(`Port ${port} is owned by the running ${portLabel} service.`);
    } else {
      const binding = await checkPortBinding(port);
      if (binding.available) {
        ok(`Port ${port} is available.`);
      } else if (binding.code === "EADDRINUSE") {
        failure(`Port ${port} is already in use by another application.`);
        note("Close that application or change the matching value in .env.");
      } else {
        failure(`This computer would not allow the project to bind port ${port} (${binding.code}).`);
        note(
          isWindows
            ? "Choose a different matching port in .env; Windows may have reserved this one."
            : "Choose a different matching port in .env or review local network restrictions.",
        );
      }
    }
  }

  const dependenciesReady =
    n8nInstallIsCurrent() &&
    existsSync(paths.documentWorkerDependency) &&
    existsSync(join(paths.chatDir, "node_modules", "typescript"));
  if (!dependenciesReady && npmVersion === pinnedNpmVersion) {
    const registry = runNpmRaw(
      ["ping", "--silent", "--registry=https://registry.npmjs.org"],
      {
        cwd: projectRoot,
        stdio: "pipe",
        timeout: 60_000,
      },
    );
    if (registry.error || registry.status !== 0) {
      failure("The reviewed npm client cannot reach registry.npmjs.org.");
      note("Check the VPN, proxy, certificate, firewall, or managed-device policy before installing.");
    } else {
      ok("The npm package registry is reachable.");
    }
  }

  print("");
  if (failures > 0) {
    printError(`Preflight failed with ${failures} problem(s).`);
    return 1;
  }
  print("Preflight passed. This computer is ready for the local agent.");
  return 0;
}

async function commandSetup() {
  return withOperationLock("setup", commandSetupUnlocked);
}

async function commandSetupUnlocked() {
  print("AI Solopreneur local setup\n");

  const preflightStatus = await commandPreflight();
  if (preflightStatus !== 0) {
    return 1;
  }

  // Stop an existing stack before replacing dependencies or rebuilding the
  // chat so a repeated setup also activates newly pulled project code.
  await stopService("chat");
  await stopService("documentWorker");
  await stopService("n8n");

  ensureDirs();

  if (n8nInstallIsCurrent()) {
    print(`\nThe pinned local n8n engine (${pinnedN8nVersion}) is already installed.`);
  } else {
    print(`\nInstalling the pinned local n8n engine (${pinnedN8nVersion}) with npm...`);
    print("The first download is large; this can take several minutes.");
    rmSync(paths.n8nInstallStamp, { force: true });
    const rootInstallArgs = existsSync(join(projectRoot, "package-lock.json"))
      ? [
          "ci",
          "--no-audit",
          "--no-fund",
          "--include=optional",
          "--ignore-scripts=false",
          "--bin-links=true",
          "--strict-allow-scripts",
        ]
      : [
          "install",
          "--no-audit",
          "--no-fund",
          "--include=optional",
          "--ignore-scripts=false",
          "--bin-links=true",
          "--strict-allow-scripts",
        ];
    runNpm(rootInstallArgs, {
      cwd: projectRoot,
      label: "Installing the local n8n engine",
      timeout: npmInstallTimeoutMs,
    });
    if (!n8nNativeDependenciesWork()) {
      throw new Error(
        "The n8n install completed without working sqlite3 and isolated-vm native modules. " +
          "Rerun setup; if it repeats on Windows, use a short local folder outside OneDrive and check that GitHub release assets are allowed.",
      );
    }
    recordSuccessfulN8nInstall();
  }

  print("\nInstalling the local document reader...");
  runNpm(
    [
      "ci",
      "--no-audit",
      "--no-fund",
      "--include=optional",
      "--ignore-scripts",
      "--bin-links=true",
    ],
    {
      cwd: paths.documentWorkerDir,
      label: "Installing the local document reader",
    },
  );

  print("\nBuilding the local chat app...");
  runNpm(
    [
      "ci",
      "--no-audit",
      "--no-fund",
      "--include=dev",
      "--include=optional",
      "--ignore-scripts",
      "--bin-links=true",
    ],
    {
      cwd: paths.chatDir,
      label: "Installing the chat build tools",
    },
  );
  runNpm(["run", "build"], {
    cwd: paths.chatDir,
    label: "Building the chat app",
  });

  print("\nChecking the workflow exports...");
  validateWorkflowFiles();

  print("\nStarting AI Solopreneur...");
  startService("n8n");
  await waitForService("n8n");
  startService("documentWorker");
  await waitForService("documentWorker");

  if (reviewedWorkflowsInstalled()) {
    print("\nThe reviewed workflows are already installed; keeping local edits unchanged.");
  } else {
    print("\nInstalling the reviewed workflows, sample data, and enabled skills...");
    await importReviewedWorkflows();
  }

  startService("chat");
  await waitForService("chat");

  const cfg = config();
  print("\nLocal stack is healthy.");
  print(`  Chat app:          http://localhost:${cfg.chatPort}`);
  print(`  n8n editor:        http://localhost:${cfg.n8nPort}`);
  print("  Next: create the local n8n owner, then open 01 - START HERE - Learner Checklist.");
  return 0;
}

async function commandStart() {
  return withOperationLock("start", commandStartUnlocked);
}

async function commandStartUnlocked() {
  requireLocalInstall();
  ensureDocumentWorkerInstalled();
  ensureChatBuilt();

  await startStack();

  const cfg = config();
  print("AI Solopreneur is healthy.");
  print(`  Chat app:          http://localhost:${cfg.chatPort}`);
  print(`  n8n editor:        http://localhost:${cfg.n8nPort}`);
  return 0;
}

async function commandStop() {
  const stoppedChat = await stopService("chat");
  const stoppedDocumentWorker = await stopService("documentWorker");
  const stoppedN8n = await stopService("n8n");
  if (stoppedChat || stoppedDocumentWorker || stoppedN8n) {
    print("AI Solopreneur is stopped. Local data is preserved.");
  } else {
    print("AI Solopreneur is not running. Local data is preserved.");
  }
  return 0;
}

async function commandRestart() {
  await commandStop();
  return commandStart();
}

async function commandStatus() {
  const cfg = config();
  print("AI Solopreneur local status\n");
  for (const name of ["n8n", "documentWorker", "chat"]) {
    const service = services[name];
    const record = readPidRecord(service);
    const running = serviceIsRunning(service);
    const health = running
      ? await fetchStatus(service.healthUrl(cfg), {}, 3_000)
      : null;
    const healthText =
      health !== null && health.ok ? "healthy" : running ? "starting or unhealthy" : "stopped";
    print(
      `  ${service.label.padEnd(15)} ${healthText.padEnd(24)} ` +
        `http://localhost:${service.port(cfg)}  ` +
        (running ? `(pid ${record.pid})` : ""),
    );
  }
  print(`\n  Data folder: ${paths.n8nDataDir}`);
  print(`  Logs:        ${paths.logsDir}`);
  return 0;
}

function commandLogs(target = "n8n", lineCount = "100") {
  if (target === "documents") {
    target = "documentWorker";
  }
  const service = services[target];
  if (!service) {
    printError(
      'Usage: node scripts/local.mjs logs [n8n|chat|documents] [lines]',
    );
    return 1;
  }
  print(tailOfFile(service.logFile(), Number(lineCount) || 100));
  return 0;
}

async function commandImportWorkflows() {
  requireLocalInstall();
  await importReviewedWorkflows();
  return 0;
}

async function commandSyncSkills() {
  requireLocalInstall();

  if (!serviceIsRunning(services.n8n)) {
    printError("n8n is not running. Start the local stack first.");
    return 1;
  }

  print("Validating and compiling enabled skills...");
  const bundle = await compileSkillBundle();

  print("Opening the temporary localhost skill-sync endpoint...");
  let publishedSync = false;
  try {
    n8nCliOrThrow(
      ["publish:workflow", `--id=${workflowIds.skillSync}`],
      "Publishing the skill-sync workflow",
    );
    publishedSync = true;
    await restartN8n();

    const response = await postWebhook("sync-enabled-skills", bundle);
    if (!response.body.includes('"ok":true')) {
      throw new Error(
        `Enabled skill sync returned an unexpected response: ${response.body}`,
      );
    }
  } finally {
    if (publishedSync) {
      runN8nCli(["unpublish:workflow", `--id=${workflowIds.skillSync}`], {
        capture: true,
      });
      await restartN8n();
    }
  }

  const cfg = config();
  print("Enabled skills synced successfully.");
  print(`Open http://localhost:${cfg.chatPort} and start a new browser conversation.`);
  return 0;
}

async function commandExportWorkflows() {
  requireLocalInstall();
  if (!serviceIsRunning(services.n8n)) {
    printError("n8n is not running. Start the local stack first.");
    return 1;
  }

  const exportDirectory = join(projectRoot, "n8n", "exports", timestamp());
  await mkdir(exportDirectory, { recursive: true });

  for (const [workflowId, outputName] of exportedWorkflowFiles) {
    const temp = tmpPath(`${workflowId}-export.json`);
    n8nCliOrThrow(
      ["export:workflow", `--id=${workflowId}`, "--pretty", `--output=${temp}`],
      `Exporting ${workflowId}`,
    );
    await copyFile(temp, join(exportDirectory, outputName));
    await rm(temp, { force: true });
  }

  const result = spawnSync(
    process.execPath,
    [
      join(projectRoot, "scripts", "normalise-workflow-exports.mjs"),
      exportDirectory,
      paths.workflowsDir,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("Normalising the exported workflows failed.");
  }

  print("Workflow copies exported to:");
  print(`  ${exportDirectory}`);
  print(
    "This folder is ignored by Git. The copies are normalised for review, but still inspect credential references and every diff before promotion.",
  );
  return 0;
}

function sqliteQuickCheck(databasePath) {
  const script = [
    "const { DatabaseSync } = require('node:sqlite');",
    "const database = new DatabaseSync(process.argv[1], { readOnly: true });",
    "const row = database.prepare('PRAGMA quick_check').get();",
    "const version = database.prepare('PRAGMA user_version').get();",
    "database.close();",
    "if (row.quick_check !== 'ok') process.exit(2);",
    "process.stdout.write(String(version.user_version));",
  ].join(" ");
  const result = spawnSync(process.execPath, ["-e", script, databasePath], {
    encoding: "utf8",
    env: process.env,
  });
  return {
    ok: result.status === 0,
    schemaVersion:
      result.status === 0 && /^\d+$/.test(result.stdout.trim())
        ? Number(result.stdout.trim())
        : null,
  };
}

async function commandBackup() {
  requireLocalInstall();
  if (!existsSync(paths.n8nDataDir)) {
    printError("There is no local n8n data to back up yet. Run setup first.");
    return 1;
  }
  if (!existsSync(paths.chatDatabase)) {
    printError("There is no local chat database to back up yet. Start the local app once, then try again.");
    return 1;
  }

  const backupDir = join(paths.backupsDir, timestamp());
  await mkdir(backupDir, { recursive: true });
  if (!isWindows) {
    await chmod(backupDir, 0o700);
  }

  const wasChatRunning = serviceIsRunning(services.chat);
  const wasN8nRunning = serviceIsRunning(services.n8n);
  if (wasChatRunning) {
    print("Briefly stopping chat for a consistent history backup...");
    await stopService("chat");
  }
  if (wasN8nRunning) {
    print("Briefly stopping n8n for a consistent backup...");
    await stopService("n8n");
  }

  try {
    const archive = join(backupDir, "n8n-data.tar.gz");
    const tar = spawnSync("tar", ["-czf", archive, "-C", paths.n8nDataDir, "."], {
      stdio: "inherit",
    });
    if (tar.error || tar.status !== 0) {
      // tar ships with macOS and Windows 10+; fall back to a plain copy.
      rmSync(archive, { force: true });
      cpSync(paths.n8nDataDir, join(backupDir, "n8n-data"), { recursive: true });
    } else if (!isWindows) {
      await chmod(archive, 0o600);
    }

    if (existsSync(paths.envFile)) {
      await copyFile(paths.envFile, join(backupDir, "env.backup"));
      if (!isWindows) {
        await chmod(join(backupDir, "env.backup"), 0o600);
      }
    }

    cpSync(paths.chatDataDir, join(backupDir, "chat-data"), {
      recursive: true,
    });
    writeFileSync(
      join(backupDir, "backup.json"),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          createdAt: new Date().toISOString(),
          contains: {
            n8n: true,
            chatHistory: true,
            environment: existsSync(paths.envFile),
          },
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } finally {
    if (wasN8nRunning) {
      startService("n8n");
      await waitForService("n8n");
    }
    if (wasChatRunning) {
      startService("chat");
      await waitForService("chat");
    }
  }

  print("Backup created at:");
  print(`  ${backupDir}`);
  print("It contains plaintext chat transcripts, encrypted credentials, and local settings. Keep it private.");
  return 0;
}

async function commandRestore(args) {
  requireLocalInstall();
  const positional = args.filter((arg) => arg !== "--yes");
  const assumeYes = args.includes("--yes");
  const target = positional[0];
  if (!target) {
    printError("Usage: node scripts/local.mjs restore backups/YYYYMMDD-HHMMSS");
    return 1;
  }
  const backupDir = isAbsolute(target) ? target : resolve(process.cwd(), target);
  const archive = join(backupDir, "n8n-data.tar.gz");
  const plainCopy = join(backupDir, "n8n-data");
  const manifestPath = join(backupDir, "backup.json");
  const chatBackupDir = join(backupDir, "chat-data");
  const chatBackupDatabase = join(chatBackupDir, "chat.sqlite");
  if (!existsSync(archive) && !existsSync(plainCopy)) {
    printError("Backup is incomplete. Expected n8n-data.tar.gz (or an n8n-data folder).");
    return 1;
  }

  const hasManifest = existsSync(manifestPath);
  if (hasManifest) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      printError("Backup manifest is invalid. No local data was changed.");
      return 1;
    }
    if (
      manifest.schemaVersion !== 2 ||
      manifest.contains?.n8n !== true ||
      manifest.contains?.chatHistory !== true ||
      !existsSync(chatBackupDatabase)
    ) {
      printError("Backup is incomplete. Expected a version 2 manifest and chat-data/chat.sqlite.");
      return 1;
    }
    const chatCheck = sqliteQuickCheck(chatBackupDatabase);
    if (!chatCheck.ok || chatCheck.schemaVersion !== 1) {
      printError("The backed-up chat database failed its integrity or schema check. No local data was changed.");
      return 1;
    }
  }

  print(
    hasManifest
      ? "This replaces current local chats, n8n users, credentials, workflows, and history."
      : "This is an older n8n-only backup. It replaces n8n users, credentials, workflows, and history, but leaves current saved chats unchanged.",
  );
  if (!assumeYes && !(await confirmPhrase("Type RESTORE to continue: ", "RESTORE"))) {
    print("Restore cancelled.");
    return 0;
  }

  const restoreStagingDir = join(paths.tmpDir, `restore-${timestamp()}`);
  const stagedN8nData = join(restoreStagingDir, "n8n-data");
  const stagedChatData = join(restoreStagingDir, "chat-data");
  rmSync(restoreStagingDir, { recursive: true, force: true });
  mkdirSync(stagedN8nData, { recursive: true });

  if (existsSync(archive)) {
    const tar = spawnSync("tar", ["-xzf", archive, "-C", stagedN8nData], {
      stdio: "inherit",
    });
    if (tar.error || tar.status !== 0) {
      rmSync(restoreStagingDir, { recursive: true, force: true });
      throw new Error("Unpacking the backup archive failed. Current local data was not changed.");
    }
  } else {
    rmSync(stagedN8nData, { recursive: true, force: true });
    cpSync(plainCopy, stagedN8nData, { recursive: true });
  }
  if (hasManifest) {
    cpSync(chatBackupDir, stagedChatData, { recursive: true });
  }

  await stopService("chat");
  await stopService("documentWorker");
  await stopService("n8n");

  rmSync(paths.n8nDataDir, { recursive: true, force: true });
  mkdirSync(paths.n8nUserFolder, { recursive: true });
  renameSync(stagedN8nData, paths.n8nDataDir);

  if (hasManifest) {
    rmSync(paths.chatDataDir, { recursive: true, force: true });
    mkdirSync(dirname(paths.chatDataDir), { recursive: true });
    renameSync(stagedChatData, paths.chatDataDir);
  }
  rmSync(restoreStagingDir, { recursive: true, force: true });

  const envBackup = join(backupDir, "env.backup");
  if (existsSync(envBackup)) {
    await copyFile(envBackup, paths.envFile);
    if (!isWindows) {
      await chmod(paths.envFile, 0o600);
    }
  }

  await startStack();
  print(
    hasManifest
      ? "Backup restored, including saved chats, and the local stack is healthy."
      : "Older n8n backup restored. Current saved chats were preserved and the local stack is healthy.",
  );
  return 0;
}

async function commandReset(args) {
  const assumeYes = args.includes("--yes");
  if (
    !existsSync(paths.n8nDataDir) &&
    !existsSync(paths.chatDataDir) &&
    !existsSync(paths.documentDataDir) &&
    !serviceIsRunning(services.n8n)
  ) {
    print("Nothing to reset because local setup has not created data yet.");
    return 0;
  }

  if (!assumeYes) {
    print(
      "This permanently removes saved chat transcripts, search data, local n8n users, credentials, workflows, execution history, and extracted document context.",
    );
    print("Create a backup first if any of that data matters.");
    if (!(await confirmPhrase("Type RESET to continue: ", "RESET"))) {
      print("Reset cancelled.");
      return 0;
    }
  }

  await stopService("chat");
  await stopService("documentWorker");
  await stopService("n8n");
  rmSync(paths.n8nUserFolder, { recursive: true, force: true });
  rmSync(paths.chatDataDir, { recursive: true, force: true });
  rmSync(paths.documentDataDir, { recursive: true, force: true });
  rmSync(paths.tmpDir, { recursive: true, force: true });

  print(
    "Saved chats, local n8n data, and extracted document data have been removed. The private .env file was preserved.",
  );
  print("Run ./start.command to create a fresh local instance.");
  return 0;
}

async function commandDiagnose() {
  let failures = 0;
  let actions = 0;
  const ok = (message) => print(`  [ok]   ${message}`);
  const action = (message) => {
    print(`  [next] ${message}`);
    actions += 1;
  };
  const failure = (message) => {
    printError(`  [!!]   ${message}`);
    failures += 1;
  };

  print("AI Solopreneur diagnostics");
  print("This check never calls Claude or displays credential values.\n");

  ok(`Node.js ${process.versions.node} is available.`);

  if (existsSync(paths.n8nBin)) {
    const version = installedN8nVersion();
    if (version === pinnedN8nVersion) {
      ok(`The pinned local n8n engine (${pinnedN8nVersion}) is installed.`);
    } else {
      ok(`A local n8n engine (${version}) is installed.`);
    }
  } else {
    failure(
      "Local setup has not run. Double-click setup.command (macOS) or setup-windows.cmd (Windows) first.",
    );
  }

  const cfg = config();
  const n8nRunning = serviceIsRunning(services.n8n);
  if (n8nRunning) {
    ok("The n8n service is running.");
  } else {
    failure("n8n is not running. Double-click start.command or start-windows.cmd, then rerun diagnostics.");
  }
  if (serviceIsRunning(services.chat)) {
    ok("The chat service is running.");
  } else {
    failure("The chat service is not running. Double-click start.command or start-windows.cmd, then rerun diagnostics.");
  }
  if (serviceIsRunning(services.documentWorker)) {
    ok("The document reader is running.");
  } else {
    failure(
      "The document reader is not running. Double-click start.command or start-windows.cmd, then rerun diagnostics.",
    );
  }

  const n8nHealth = await fetchStatus(`http://127.0.0.1:${cfg.n8nPort}/healthz`);
  if (n8nHealth !== null && n8nHealth.ok) {
    ok("n8n health endpoint responds.");
  } else {
    failure(`n8n is not healthy at localhost:${cfg.n8nPort}.`);
  }

  const chatHealth = await fetchStatus(`http://127.0.0.1:${cfg.chatPort}/health`);
  if (chatHealth !== null && chatHealth.ok) {
    ok("Chat health endpoint responds.");
  } else {
    failure(`The chat is not healthy at localhost:${cfg.chatPort}.`);
  }
  if (existsSync(paths.chatDatabase)) {
    const chatDatabaseCheck = sqliteQuickCheck(paths.chatDatabase);
    if (chatDatabaseCheck.ok && chatDatabaseCheck.schemaVersion === 1) {
      ok("The local chat database and search index are ready (schema 1).");
    } else {
      failure(
        "The local chat database failed its integrity or schema check. Create a private backup before troubleshooting it.",
      );
    }
  } else {
    failure("The local chat database is missing. Restart the local stack to create it.");
  }
  const documentHealth = await fetchStatus(
    `http://127.0.0.1:${cfg.documentWorkerPort}/health`,
  );
  if (documentHealth !== null && documentHealth.ok) {
    ok("Document reader health endpoint responds.");
  } else {
    failure("The internal document reader is not healthy.");
  }

  if (n8nRunning && n8nHealth !== null && n8nHealth.ok && existsSync(paths.n8nBin)) {
    if (exportedWorkflow(workflowIds.checklist) !== null) {
      ok("The learner checklist is installed.");
    } else {
      action("Install the reviewed workflows by double-clicking import-workflows.command or import-workflows-windows.cmd.");
    }

    const mainWorkflow = exportedWorkflow(workflowIds.main);
    if (mainWorkflow !== null) {
      ok("The Project Partner workflow is installed.");
    } else {
      action("Install the Project Partner workflow with import-workflows.command or import-workflows-windows.cmd.");
    }

    if (mainWorkflow !== null) {
      if (mainWorkflow.active === true) {
        ok("The Project Partner workflow is published.");
      } else {
        action("Open 00 - START HERE - Project Partner in n8n, select the Claude credential, and publish it.");
      }

      const credentialExport = tmpPath("diagnostic-credentials.json");
      let credentialSelected = false;
      try {
        const result = runN8nCli(
          ["export:credentials", "--all", `--output=${credentialExport}`],
          { capture: true },
        );
        if (result.status === 0) {
          const reference = mainWorkflow.nodes?.find(
            (node) => node.name === "Claude - Sonnet 4.6",
          )?.credentials?.anthropicApi;
          const credentials = readExportedRows(credentialExport);
          credentialSelected = Boolean(
            reference?.id &&
              credentials.some(
                (credential) =>
                  credential.id === reference.id &&
                  credential.type === "anthropicApi",
              ),
          );
        }
      } catch {
        credentialSelected = false;
      } finally {
        rmSync(credentialExport, { force: true });
      }
      if (credentialSelected) {
        ok("An Anthropic credential exists and is selected by the Claude node.");
      } else {
        action("Create an Anthropic credential named Anthropic account and select it in Claude - Sonnet 4.6.");
      }
    }

    const agentHealth = exportedWorkflow(workflowIds.health);
    if (agentHealth?.active === true) {
      ok("The optional agent-health workflow is published.");
    } else {
      action("Publish 90 - DEBUG - Agent Health for the safe local health check.");
    }
  }

  print("");
  if (failures > 0) {
    printError(
      `Diagnostics found ${failures} local service problem(s) and ${actions} setup action(s).`,
    );
    printError("Start with the [!!] lines, then run this helper again.");
    return 1;
  }
  if (actions > 0) {
    print(
      `The local services are healthy. Complete ${actions} [next] action(s), then run diagnostics again.`,
    );
    return 1;
  }
  print("All checks are green. The local agent is ready for a real Claude message.");
  return 0;
}

function commandN8nPassthrough(args) {
  requireLocalInstall();
  const cfg = config();
  const result = spawnSync(process.execPath, [paths.n8nBin, ...args], {
    env: { ...process.env, ...n8nEnv(cfg) },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function commandHelp() {
  print(`AI Solopreneur local runner

Usage: node scripts/local.mjs <command>

Everyday commands (also available as double-click files in the project folder):
  setup              Install the pinned n8n engine, build the chat app, start
                     everything, and import the reviewed workflows once.
  start              Start n8n, the document reader, and chat in the background.
  stop               Stop all local services. Local data is preserved.
  restart            Stop, then start.
  status             Show whether each service is running and healthy.
  diagnose           Friendly readiness checks. Never calls Claude.

Maintenance commands:
  import-workflows   Re-import the reviewed workflows, sample data, and skills.
  sync-skills        Validate and load the enabled Markdown skills.
  export-workflows   Export normalised workflow copies for Git review.
  backup             Save a private copy of chats, n8n data, and settings.
  restore <folder>   Restore chats and n8n data from a saved backup.
  reset [--yes]      Permanently remove chats, local n8n, and document data.
  preflight          Check Node.js, npm, disk, network, and local ports.
  logs [n8n|chat|documents]
                     Show the last lines of a service log.
  n8n <args...>      Run the pinned n8n CLI with this project's settings.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  assertNodeVersion();
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "preflight":
      return commandPreflight();
    case "setup":
      return commandSetup();
    case "start":
      return commandStart();
    case "stop":
      return commandStop();
    case "restart":
      return commandRestart();
    case "status":
      return commandStatus();
    case "logs":
      return commandLogs(rest[0], rest[1]);
    case "import-workflows":
      return commandImportWorkflows();
    case "sync-skills":
      return commandSyncSkills();
    case "export-workflows":
      return commandExportWorkflows();
    case "backup":
      return commandBackup();
    case "restore":
      return commandRestore(rest);
    case "reset":
      return commandReset(rest);
    case "diagnose":
      return commandDiagnose();
    case "n8n":
      return commandN8nPassthrough(rest);
    case "help":
    case "--help":
    case undefined:
      return commandHelp();
    default:
      printError(`Unknown command: ${command}\n`);
      commandHelp();
      return 1;
  }
}

try {
  const status = await main();
  process.exit(typeof status === "number" ? status : 0);
} catch (error) {
  printError(`\n${error.message}`);
  process.exit(1);
}
