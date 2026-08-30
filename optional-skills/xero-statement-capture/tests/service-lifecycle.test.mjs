import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrivateBridgeSecret } from "../skill/scripts/xero-export-capture.mjs";
import {
  SERVICE_LABEL,
  SERVICE_MARKER,
  isManagedLaunchAgent,
  parseServiceArguments,
  renderLaunchAgent,
  runServiceCommand,
  servicePaths,
} from "../skill/scripts/xero-export-service.mjs";

let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };
const rejects = async (action, pattern, message) => { checks += 1; await assert.rejects(action, pattern, message); };

check(parseServiceArguments(["status"]).command === "status", "status should parse without install options");
check(parseServiceArguments(["uninstall"]).command === "uninstall", "uninstall should parse without install options");
check(
  parseServiceArguments(["install", "--n8n-url", "https://n8n.example.test", "--secret-file", "/private/bridge.secret"]).options["secret-file"] === "/private/bridge.secret",
  "install should accept only a secret-file path, never a raw secret option",
);
await rejects(
  async () => parseServiceArguments(["install", "--n8n-url", "https://n8n.example.test", "--secret", "must-not-be-an-argument"]),
  /unknown.*option/i,
  "the lifecycle CLI must not accept a bridge secret on the command line",
);
await rejects(
  async () => parseServiceArguments(["status", "--inbox", "/tmp/inbox"]),
  /does not accept/i,
  "status should not silently reinterpret install options",
);

const rendered = renderLaunchAgent({
  nodePath: "/opt/node/bin/node",
  companionPath: "/Users/student/MLAI/xero-export-companion.mjs",
  n8nUrl: "https://n8n.example.test",
  secretFile: "/Users/student/.config/mlai/xero-capture-bridge.secret",
  inboxDirectory: "/Users/student/Downloads",
  stdoutLog: "/Users/student/Library/Logs/MLAI/xero.stdout.log",
  stderrLog: "/Users/student/Library/Logs/MLAI/xero.stderr.log",
});
check(isManagedLaunchAgent(rendered), "a generated LaunchAgent should carry the exact MLAI ownership marker and label");
check(rendered.includes(SERVICE_MARKER) && rendered.includes(SERVICE_LABEL), "the managed plist should be self-identifying");
check(rendered.includes("XERO_CAPTURE_INGEST_SECRET_FILE") && !rendered.includes("must-not-be-an-argument"), "the plist should hold only the secret-file path, not a raw secret");
check(rendered.includes("<key>KeepAlive</key>") && rendered.includes("<key>RunAtLoad</key>"), "the user service should remain available across login and transient failures");

const temporary = await mkdtemp(join(tmpdir(), "xero-service-lifecycle-"));
try {
  const home = join(temporary, "student-home");
  const bin = join(temporary, "bin");
  const nodePath = join(bin, "node");
  const companionPath = join(bin, "xero-export-companion.mjs");
  const secretPath = join(home, ".config", "mlai", "xero-capture-bridge.secret");
  const inbox = join(home, "Downloads");
  await mkdir(join(home, ".config", "mlai"), { recursive: true, mode: 0o700 });
  await mkdir(bin, { recursive: true, mode: 0o700 });
  await writeFile(nodePath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await writeFile(companionPath, "export {};\n", { mode: 0o600 });
  const bridgeSecret = "bridge-secret-kept-out-of-the-launchagent-123456";
  await writeFile(secretPath, `${bridgeSecret}\n`, { mode: 0o600 });
  const secretStats = await lstat(secretPath);
  const commands = [];
  let loaded = false;
  let running = false;
  let failNextBootstrap = false;
  const runner = (command, args) => {
    commands.push({ command, args: [...args] });
    if (command === "/usr/bin/plutil") return { status: 0, stdout: "OK", stderr: "" };
    if (command !== "/bin/launchctl") return { status: 1, stdout: "", stderr: "" };
    if (args[0] === "print") {
      return loaded
        ? { status: 0, stdout: running ? "state = running" : "state = waiting", stderr: "" }
        : { status: 113, stdout: "", stderr: "" };
    }
    if (args[0] === "bootstrap") {
      if (failNextBootstrap) { failNextBootstrap = false; return { status: 5, stdout: "", stderr: "" }; }
      loaded = true; running = true; return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "bootout") { loaded = false; running = false; return { status: 0, stdout: "", stderr: "" }; }
    return { status: 1, stdout: "", stderr: "" };
  };
  const dependencies = {
    operatingSystem: "darwin",
    homeDirectory: home,
    uid: secretStats.uid,
    runner,
  };
  const installArgs = [
    "install",
    "--n8n-url", "https://n8n.example.test",
    "--secret-file", secretPath,
    "--inbox", inbox,
    "--node", nodePath,
    "--companion", companionPath,
  ];
  const installed = await runServiceCommand(installArgs, dependencies);
  const paths = servicePaths({ homeDirectory: home });
  const plist = await readFile(paths.plist, "utf8");
  const plistStats = await lstat(paths.plist);
  check(installed.changed === true && installed.loaded === true, "first install should create and load the service");
  check((plistStats.mode & 0o077) === 0, "the managed LaunchAgent file should not be group- or world-readable");
  check(plist.includes(nodePath) && plist.includes(companionPath) && plist.includes(inbox), "the LaunchAgent should persist resolved explicit executable, script, and inbox paths");
  check(plist.includes(secretPath) && !plist.includes(bridgeSecret), "the LaunchAgent must reference the private secret file without copying its contents");
  check(commands.some(({ command, args }) => command === "/bin/launchctl" && args[0] === "bootstrap"), "install should use launchctl bootstrap in the current user's GUI domain");

  const commandCount = commands.length;
  const repeated = await runServiceCommand(installArgs, dependencies);
  check(repeated.changed === false && commands.length === commandCount + 1, "an identical install should be idempotent and perform only a read-only launchctl status check");

  const status = await runServiceCommand(["status"], dependencies);
  check(status.installed === true && status.loaded === true && status.running === true, "status should distinguish installed, loaded, and running state");

  const updated = await runServiceCommand([
    ...installArgs.slice(0, 2),
    "https://n8n-updated.example.test",
    ...installArgs.slice(3),
  ], dependencies);
  check(updated.changed === true, "changing non-secret service configuration should update this managed service");
  check(
    commands.some(({ command, args }) => command === "/bin/launchctl" && args[0] === "bootout")
      && (await readFile(paths.plist, "utf8")).includes("n8n-updated.example.test"),
    "a managed update should stop only the exact service, replace its plist, and reload it",
  );

  failNextBootstrap = true;
  await rejects(
    () => runServiceCommand([
      ...installArgs.slice(0, 2),
      "https://n8n-must-rollback.example.test",
      ...installArgs.slice(3),
    ], dependencies),
    /could not load/i,
    "a failed updated-service bootstrap should be reported",
  );
  const rolledBackPlist = await readFile(paths.plist, "utf8");
  check(
    loaded && rolledBackPlist.includes("n8n-updated.example.test") && !rolledBackPlist.includes("n8n-must-rollback.example.test"),
    "a failed update should restore and reload the last working managed plist",
  );

  const removed = await runServiceCommand(["uninstall"], dependencies);
  check(removed.removed === true && !loaded, "uninstall should stop and remove the exact managed service");
  check((await readFile(secretPath, "utf8")).trim() === bridgeSecret, "uninstall must preserve the bridge secret file");
  const alreadyAbsent = await runServiceCommand(["uninstall"], dependencies);
  check(alreadyAbsent.alreadyAbsent === true, "uninstall should be idempotent when the managed service is already absent");

  const unrelatedHome = join(temporary, "unrelated-home");
  const unrelatedPaths = servicePaths({ homeDirectory: unrelatedHome });
  await mkdir(join(unrelatedHome, "Library", "LaunchAgents"), { recursive: true });
  const unrelated = "<?xml version=\"1.0\"?><plist><dict><key>Label</key><string>someone.elses.service</string></dict></plist>\n";
  await writeFile(unrelatedPaths.plist, unrelated, { mode: 0o600 });
  await rejects(
    () => runServiceCommand(installArgs, { ...dependencies, homeDirectory: unrelatedHome }),
    /unrelated LaunchAgent/i,
    "install must not overwrite an unrelated service at the managed path",
  );
  check(await readFile(unrelatedPaths.plist, "utf8") === unrelated, "a rejected install must leave an unrelated plist byte-for-byte unchanged");

  const publicSecret = join(home, ".config", "mlai", "public.secret");
  await writeFile(publicSecret, "public-secret-that-is-long-enough-for-the-test\n", { mode: 0o644 });
  await rejects(
    () => readPrivateBridgeSecret(publicSecret, { currentUid: secretStats.uid }),
    /chmod 600/i,
    "the runtime should reject a group- or world-readable bridge secret",
  );
  await chmod(publicSecret, 0o600);
  check(
    await readPrivateBridgeSecret(publicSecret, { currentUid: secretStats.uid }) === "public-secret-that-is-long-enough-for-the-test",
    "the runtime should safely read one private single-line bridge secret",
  );
  const linkedSecret = join(home, ".config", "mlai", "linked.secret");
  await symlink(publicSecret, linkedSecret);
  await rejects(
    () => readPrivateBridgeSecret(linkedSecret, { currentUid: secretStats.uid }),
    /regular file, not a symlink/i,
    "the runtime should never follow a bridge-secret symlink",
  );

  await rejects(
    () => runServiceCommand(installArgs, { ...dependencies, operatingSystem: "linux" }),
    /only on macOS/i,
    "non-macOS systems should receive the manual companion fallback instead of a partial service install",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(`Xero export service lifecycle checks passed (${checks}).\n`);
