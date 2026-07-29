import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const launchers = [
  "setup-windows.cmd",
  "start-windows.cmd",
  "stop-windows.cmd",
  "preflight-windows.cmd",
  "diagnose-windows.cmd",
  "import-workflows-windows.cmd",
  "export-workflows-windows.cmd",
  "sync-skills-windows.cmd",
  "backup-windows.cmd",
  "restore-windows.cmd",
  "reset-windows.cmd",
  "evaluate-pilot-windows.cmd",
  "prepare-instructor-pack-windows.cmd",
];

test("every Windows launcher is automation-safe and preserves failures", async () => {
  for (const launcher of launchers) {
    const source = await readFile(join(projectRoot, launcher), "utf8");
    assert.match(source, /\bsetlocal\b/i, `${launcher} must localise variables`);
    assert.match(source, /cd \/d "%~dp0"/i, `${launcher} must use its project folder`);
    assert.match(source, /%[*]/, `${launcher} must forward arguments`);
    assert.match(
      source,
      /set "AI_SOLO_STATUS=%ERRORLEVEL%"/i,
      `${launcher} must capture the PowerShell exit code immediately`,
    );
    assert.match(
      source,
      /AI_SOLO_NO_PAUSE/i,
      `${launcher} must support non-interactive Claude Code and CI use`,
    );
    assert.match(
      source,
      /exit \/b %AI_SOLO_STATUS%/i,
      `${launcher} must return the captured status`,
    );
  }
});

test("the dependency install policy covers every lifecycle script", async () => {
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const packageLock = JSON.parse(
    await readFile(join(projectRoot, "package-lock.json"), "utf8"),
  );
  const scriptedPackages = new Set();
  for (const [path, details] of Object.entries(packageLock.packages)) {
    if (!details.hasInstallScript && !details.gypfile) {
      continue;
    }
    const name = path.split("node_modules/").at(-1);
    scriptedPackages.add(`${name}@${details.version}`);
  }

  assert.deepEqual(
    new Set(Object.keys(packageJson.allowScripts)),
    scriptedPackages,
    "allowScripts must explicitly approve or deny every locked lifecycle script",
  );
  assert.equal(packageJson.allowScripts["isolated-vm@6.1.2"], true);
  assert.equal(packageJson.allowScripts["sqlite3@5.1.7"], true);
  for (const [name, allowed] of Object.entries(packageJson.allowScripts)) {
    if (!["isolated-vm@6.1.2", "sqlite3@5.1.7"].includes(name)) {
      assert.equal(allowed, false, `${name} should remain explicitly denied`);
    }
  }
});

test("all application manifests constrain native installs to Node.js 24", async () => {
  for (const manifest of [
    "package.json",
    "apps/chat/package.json",
    "services/document-worker/package.json",
  ]) {
    const source = JSON.parse(
      await readFile(join(projectRoot, manifest), "utf8"),
    );
    assert.equal(source.engines.node, "24.x", `${manifest} must require Node 24.x`);
  }
  assert.equal(
    (await readFile(join(projectRoot, ".npm-version"), "utf8")).trim(),
    "11.16.0",
  );
});

test("the native runner isolates n8n's internal task-broker port", async () => {
  const source = await readFile(
    join(projectRoot, "scripts", "local.mjs"),
    "utf8",
  );
  assert.match(source, /N8N_RUNNERS_BROKER_PORT/);
  assert.match(source, /taskBrokerPort/);
  assert.match(source, /serviceOwnsConfiguredPort/);
});
