#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXPORT_CAPTURE_MODE } from "./xero-export-capture.mjs";

export const SERVICE_LABEL = "com.mlai.xero-export-companion";
export const SERVICE_MARKER = "mlai-managed-xero-export-companion-v1";
const LAUNCHCTL = "/bin/launchctl";
const PLUTIL = "/usr/bin/plutil";

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value) {
  return String(value ?? "").trim();
}

function absolutePath(value, label) {
  const path = clean(value);
  if (!path || !isAbsolute(path) || resolve(path) !== path) {
    throw serviceError("INVALID_PATH", `${label} must be an explicit absolute path without '..' segments.`);
  }
  return path;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeN8nUrl(value) {
  let parsed;
  try { parsed = new URL(clean(value)); } catch {
    throw serviceError("INVALID_N8N_URL", "--n8n-url must be an absolute URL.");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw serviceError("INVALID_N8N_URL", "--n8n-url must not contain credentials, a query, or a fragment.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw serviceError("UNSAFE_N8N_URL", "--n8n-url must use HTTPS, except on loopback.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function parseServiceArguments(argv) {
  const input = [...argv];
  const command = input.shift();
  if (command === "help" || command === "--help" || command === "-h") return { command: "help" };
  if (!new Set(["install", "status", "uninstall"]).has(command)) {
    throw serviceError("INVALID_COMMAND", "Choose install, status, or uninstall.");
  }
  const options = {};
  while (input.length) {
    const flag = input.shift();
    if (!String(flag).startsWith("--") || !input.length) {
      throw serviceError("INVALID_ARGUMENT", "Invalid argument or missing option value.");
    }
    const key = flag.slice(2);
    if (!new Set(["n8n-url", "secret-file", "inbox", "node", "companion"]).has(key)) {
      throw serviceError("INVALID_ARGUMENT", "Unknown lifecycle option.");
    }
    if (Object.hasOwn(options, key)) throw serviceError("DUPLICATE_ARGUMENT", `${flag} may be supplied only once.`);
    options[key] = input.shift();
  }
  if (command !== "install" && Object.keys(options).length) {
    throw serviceError("INVALID_ARGUMENT", `${command} does not accept install options.`);
  }
  if (command === "install" && (!options["n8n-url"] || !options["secret-file"])) {
    throw serviceError("MISSING_ARGUMENT", "install requires --n8n-url and --secret-file.");
  }
  return { command, options };
}

export function servicePaths({ homeDirectory = homedir() } = {}) {
  const home = absolutePath(homeDirectory, "Home directory");
  return {
    home,
    plist: join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
    logDirectory: join(home, "Library", "Logs", "MLAI"),
    stdoutLog: join(home, "Library", "Logs", "MLAI", "xero-export-companion.stdout.log"),
    stderrLog: join(home, "Library", "Logs", "MLAI", "xero-export-companion.stderr.log"),
  };
}

export function renderLaunchAgent({
  nodePath,
  companionPath,
  n8nUrl,
  secretFile,
  inboxDirectory,
  stdoutLog,
  stderrLog,
}) {
  const environment = [
    ["XERO_EXPORT_CAPTURE_ENABLED", EXPORT_CAPTURE_MODE],
    ["XERO_EXPORT_DAEMON", "true"],
    ["XERO_CAPTURE_N8N_URL", n8nUrl],
    ["XERO_CAPTURE_INGEST_SECRET_FILE", secretFile],
    ["XERO_EXPORT_INBOX_DIR", inboxDirectory],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${SERVICE_MARKER} -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(companionPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environment.map(([key, value]) => `    <key>${key}</key>\n    <string>${xml(value)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${xml(stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrLog)}</string>
</dict>
</plist>
`;
}

export function isManagedLaunchAgent(source) {
  const text = String(source || "");
  return text.includes(`<!-- ${SERVICE_MARKER} -->`)
    && text.includes(`<string>${SERVICE_LABEL}</string>`);
}

async function inspectRegular(path, label, {
  privateFile = false,
  executable = false,
  currentUid = typeof process.getuid === "function" ? process.getuid() : null,
  inspect = lstat,
  resolveRealPath = realpath,
} = {}) {
  const explicit = absolutePath(path, label);
  let stats;
  try { stats = await inspect(explicit); } catch {
    throw serviceError("FILE_UNAVAILABLE", `${label} is unavailable.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw serviceError("UNSAFE_FILE", `${label} must be a regular file, not a symlink.`);
  }
  if (executable && (stats.mode & 0o111) === 0) {
    throw serviceError("FILE_NOT_EXECUTABLE", `${label} must be executable.`);
  }
  if (privateFile) {
    if (Number.isInteger(currentUid) && stats.uid !== currentUid) {
      throw serviceError("UNSAFE_FILE_OWNER", `${label} must be owned by the current user.`);
    }
    if ((stats.mode & 0o077) !== 0) {
      throw serviceError("UNSAFE_FILE_MODE", `${label} must not be accessible by group or other users (use chmod 600).`);
    }
    if (stats.size < 24 || stats.size > 4_097) {
      throw serviceError("INVALID_SECRET_FILE", `${label} must contain one bounded secret of at least 24 characters.`);
    }
  }
  const canonical = await resolveRealPath(explicit);
  return { path: canonical, stats };
}

async function ensureDirectory(path, label, { make = mkdir, inspect = lstat } = {}) {
  await make(path, { recursive: true, mode: 0o700 });
  const stats = await inspect(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw serviceError("UNSAFE_DIRECTORY", `${label} must be a real directory, not a symlink.`);
  }
}

async function readExistingPlist(path, { inspect = lstat, openFile = open } = {}) {
  let before;
  try { before = await inspect(path); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw serviceError("UNMANAGED_SERVICE_FILE", "The LaunchAgent path is not a regular MLAI-managed file; it was left unchanged.");
  }
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await openFile(path, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw serviceError("SERVICE_FILE_CHANGED", "The LaunchAgent changed while it was being inspected; it was left unchanged.");
    }
    const source = await handle.readFile("utf8");
    if (!isManagedLaunchAgent(source)) {
      throw serviceError("UNMANAGED_SERVICE_FILE", "An unrelated LaunchAgent already occupies the target path; it was left unchanged.");
    }
    return { source, stats: opened };
  } finally {
    await handle?.close();
  }
}

function defaultRunner(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, stdio: "pipe" });
  if (result.error) return { status: 1, stdout: "", stderr: "" };
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function loadedState(runner, domainTarget) {
  const result = runner(LAUNCHCTL, ["print", domainTarget]);
  return {
    loaded: result.status === 0,
    running: result.status === 0 && /\bstate\s*=\s*running\b/i.test(`${result.stdout}\n${result.stderr}`),
  };
}

function requireCommand(runner, command, args, code, message) {
  const result = runner(command, args);
  if (result.status !== 0) throw serviceError(code, message);
  return result;
}

async function writeNoClobber(path, source, {
  expected,
  inspect = lstat,
  openFile = open,
  makeLink = link,
  remove = unlink,
  setMode = chmod,
  runner = defaultRunner,
} = {}) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await openFile(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    requireCommand(runner, PLUTIL, ["-lint", temporary], "INVALID_PLIST", "The generated LaunchAgent failed macOS plist validation.");

    let current = null;
    try { current = await inspect(path); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (expected) {
      if (!current || current.dev !== expected.dev || current.ino !== expected.ino || current.isSymbolicLink()) {
        throw serviceError("SERVICE_FILE_CHANGED", "The existing LaunchAgent changed before update; it was left unchanged.");
      }
      await remove(path);
    } else if (current) {
      throw serviceError("SERVICE_FILE_EXISTS", "A LaunchAgent appeared at the target path; it was left unchanged.");
    }
    try {
      await makeLink(temporary, path);
      await setMode(path, 0o600);
      return await inspect(path);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw serviceError("SERVICE_FILE_EXISTS", "A LaunchAgent appeared at the target path; it was left unchanged.");
      }
      throw error;
    }
  } finally {
    await handle?.close();
    try { await remove(temporary); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function removeExactFile(path, expected) {
  const current = await lstat(path);
  if (
    !current.isFile()
    || current.isSymbolicLink()
    || current.dev !== expected.dev
    || current.ino !== expected.ino
  ) {
    throw serviceError("SERVICE_FILE_CHANGED", "The LaunchAgent changed before cleanup; it was left unchanged.");
  }
  await unlink(path);
}

function usage() {
  return `Xero export companion service (macOS user LaunchAgent)

Install:
  node xero-export-service.mjs install --n8n-url https://YOUR-N8N-HOST --secret-file /ABSOLUTE/PATH/xero-capture-bridge.secret [--inbox /ABSOLUTE/DOWNLOAD/FOLDER]

Inspect or remove only this managed service:
  node xero-export-service.mjs status
  node xero-export-service.mjs uninstall

The secret file contains the n8n bridge secret, not Xero credentials. Use chmod 600.
`;
}

export async function runServiceCommand(argv, dependencies = {}) {
  const parsed = parseServiceArguments(argv);
  if (parsed.command === "help") return { ok: true, command: "help", message: usage() };
  const operatingSystem = dependencies.operatingSystem || platform();
  if (operatingSystem !== "darwin") {
    throw serviceError("UNSUPPORTED_PLATFORM", "The LaunchAgent lifecycle is supported only on macOS; use the documented manual companion command elsewhere.");
  }
  const paths = servicePaths({ homeDirectory: dependencies.homeDirectory || homedir() });
  const uid = Number.isInteger(dependencies.uid)
    ? dependencies.uid
    : typeof process.getuid === "function" ? process.getuid() : null;
  if (!Number.isInteger(uid) || uid < 0) throw serviceError("UID_UNAVAILABLE", "A macOS user id is required for a user LaunchAgent.");
  const runner = dependencies.runner || defaultRunner;
  const target = `gui/${uid}/${SERVICE_LABEL}`;
  const domain = `gui/${uid}`;
  const existing = await readExistingPlist(paths.plist, dependencies);
  const loaded = loadedState(runner, target);

  if (parsed.command === "status") {
    if (loaded.loaded && !existing) {
      throw serviceError("UNMANAGED_SERVICE_LABEL", "The service label is loaded without this managed plist; no action was taken.");
    }
    return {
      ok: true,
      command: "status",
      installed: Boolean(existing),
      loaded: loaded.loaded,
      running: loaded.running,
      plist: paths.plist,
      logs: { stdout: paths.stdoutLog, stderr: paths.stderrLog },
    };
  }

  if (parsed.command === "uninstall") {
    if (!existing) {
      if (loaded.loaded) {
        throw serviceError("UNMANAGED_SERVICE_LABEL", "The service label is loaded without this managed plist; it was left unchanged.");
      }
      return { ok: true, command: "uninstall", removed: false, alreadyAbsent: true, plist: paths.plist };
    }
    if (loaded.loaded) {
      requireCommand(runner, LAUNCHCTL, ["bootout", domain, paths.plist], "LAUNCHCTL_BOOTOUT_FAILED", "macOS could not stop the managed Xero export companion.");
    }
    const current = await lstat(paths.plist);
    if (current.dev !== existing.stats.dev || current.ino !== existing.stats.ino || current.isSymbolicLink()) {
      throw serviceError("SERVICE_FILE_CHANGED", "The LaunchAgent changed before uninstall; it was left unchanged.");
    }
    await unlink(paths.plist);
    return {
      ok: true,
      command: "uninstall",
      removed: true,
      plist: paths.plist,
      preserved: [paths.stdoutLog, paths.stderrLog, "bridge secret file", "download folder"],
    };
  }

  const options = parsed.options;
  const scriptDefault = fileURLToPath(new URL("./xero-export-companion.mjs", import.meta.url));
  const nodeFile = await inspectRegular(options.node || process.execPath, "Node executable", {
    ...dependencies,
    currentUid: null,
    executable: true,
  });
  const companionFile = await inspectRegular(options.companion || scriptDefault, "Companion script", {
    ...dependencies,
    currentUid: null,
  });
  const secretFile = await inspectRegular(options["secret-file"], "Bridge secret file", {
    ...dependencies,
    currentUid: uid,
    privateFile: true,
  });
  const inboxDirectory = absolutePath(options.inbox || join(paths.home, "Downloads"), "Download folder");
  if (inboxDirectory === paths.home || inboxDirectory === resolve(sep)) {
    throw serviceError("UNSAFE_INBOX", "The download folder must be bounded and cannot be the home or filesystem root.");
  }
  await ensureDirectory(dirname(paths.plist), "LaunchAgents directory", dependencies);
  await ensureDirectory(paths.logDirectory, "MLAI log directory", dependencies);
  await ensureDirectory(inboxDirectory, "Download folder", dependencies);
  const source = renderLaunchAgent({
    nodePath: nodeFile.path,
    companionPath: companionFile.path,
    n8nUrl: safeN8nUrl(options["n8n-url"]),
    secretFile: secretFile.path,
    inboxDirectory,
    stdoutLog: paths.stdoutLog,
    stderrLog: paths.stderrLog,
  });

  if (existing?.source === source) {
    if (!loaded.loaded) {
      requireCommand(runner, LAUNCHCTL, ["bootstrap", domain, paths.plist], "LAUNCHCTL_BOOTSTRAP_FAILED", "macOS could not load the managed Xero export companion.");
    }
    return {
      ok: true,
      command: "install",
      installed: true,
      changed: false,
      loaded: true,
      plist: paths.plist,
      secretStoredInPlist: false,
    };
  }
  if (!existing && loaded.loaded) {
    throw serviceError("UNMANAGED_SERVICE_LABEL", "The service label is already loaded without this managed plist; it was left unchanged.");
  }
  if (existing && loaded.loaded) {
    requireCommand(runner, LAUNCHCTL, ["bootout", domain, paths.plist], "LAUNCHCTL_BOOTOUT_FAILED", "macOS could not stop the managed Xero export companion for update.");
  }
  const previousWasLoaded = loaded.loaded;
  const installedStats = await writeNoClobber(paths.plist, source, {
    ...dependencies,
    expected: existing?.stats,
    runner,
  });
  try {
    requireCommand(runner, LAUNCHCTL, ["bootstrap", domain, paths.plist], "LAUNCHCTL_BOOTSTRAP_FAILED", "macOS could not load the managed Xero export companion.");
  } catch (bootstrapError) {
    try {
      if (loadedState(runner, target).loaded) {
        requireCommand(runner, LAUNCHCTL, ["bootout", domain, paths.plist], "LAUNCHCTL_ROLLBACK_FAILED", "The updated service failed to load cleanly and macOS could not stop the partial service.");
      }
      await removeExactFile(paths.plist, installedStats);
      if (existing) {
        await writeNoClobber(paths.plist, existing.source, { ...dependencies, runner });
        if (previousWasLoaded) {
          requireCommand(runner, LAUNCHCTL, ["bootstrap", domain, paths.plist], "LAUNCHCTL_ROLLBACK_FAILED", "The updated service failed to load and macOS could not restore the previous service.");
        }
      }
    } catch (rollbackError) {
      if (rollbackError?.code === "LAUNCHCTL_ROLLBACK_FAILED") throw rollbackError;
      throw serviceError("SERVICE_ROLLBACK_FAILED", "The updated service failed to load and its previous plist could not be restored safely.");
    }
    throw bootstrapError;
  }
  return {
    ok: true,
    command: "install",
    installed: true,
    changed: true,
    loaded: true,
    plist: paths.plist,
    logs: { stdout: paths.stdoutLog, stderr: paths.stderrLog },
    secretStoredInPlist: false,
  };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  try {
    const result = await runServiceCommand(process.argv.slice(2));
    if (result.command === "help") process.stdout.write(result.message);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: clean(error?.code || "SERVICE_COMMAND_FAILED"), message: clean(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}
