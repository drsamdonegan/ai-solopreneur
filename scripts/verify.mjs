import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const optionalRoot = join(projectRoot, "optional-skills");

function run(label, command, args, cwd = projectRoot) {
  const printable = [command, ...args].join(" ");
  process.stdout.write(`\n[verify] ${label}\n$ ${printable}\n`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(
      `\n[verify] FAILED: ${label} (${printable}, exit ${result.status ?? "unknown"})\n`,
    );
    process.exit(result.status ?? 1);
  }
}

async function declaredOptionalTests() {
  const entries = await readdir(optionalRoot, { withFileTypes: true });
  const tests = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const manifestPath = join(optionalRoot, entry.name, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const declared = manifest.tests ?? [];
    if (!Array.isArray(declared)) {
      throw new Error(`${manifestPath}: tests must be an array`);
    }

    for (const relativePath of declared) {
      if (
        typeof relativePath !== "string" ||
        !/^tests\/[a-z0-9][a-z0-9._-]*\.test\.mjs$/.test(relativePath)
      ) {
        throw new Error(
          `${manifestPath}: invalid test path ${JSON.stringify(relativePath)}`,
        );
      }
      tests.push({
        label: `${entry.name}: ${relativePath}`,
        path: join(optionalRoot, entry.name, relativePath),
      });
    }
  }

  return tests.sort((left, right) => left.path.localeCompare(right.path));
}

run("workflow validation", process.execPath, ["scripts/validate-workflows.mjs"]);
run("agent runtime isolation", process.execPath, ["scripts/test-agent-runtime.mjs"]);
run("agent-aware optional installer", process.execPath, [
  "scripts/test-optional-installer.mjs",
]);
run("release validation", process.execPath, ["scripts/validate-release.mjs"]);
run("skill compilation", process.execPath, ["scripts/compile-skills.mjs"]);

for (const test of await declaredOptionalTests()) {
  run(test.label, process.execPath, [test.path]);
}

run("chat TypeScript build", process.execPath, [
  "apps/chat/node_modules/typescript/bin/tsc",
  "--project",
  "apps/chat/tsconfig.json",
]);
run("agent card and settings API", process.execPath, [
  "scripts/test-agent-card-api.mjs",
]);
run("agent-scoped skill bundle", process.execPath, [
  "scripts/test-agent-scoped-skills.mjs",
]);
run("SEO article integration test", process.execPath, [
  "scripts/test-seo-article.mjs",
]);

process.stdout.write("\n[verify] All release checks passed.\n");
