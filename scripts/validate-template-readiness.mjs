import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const lfsPointerMarker = [
  "version https://git-lfs.github.com",
  "spec/v1",
].join("/");

const requiredFiles = [
  "README.md",
  "VERSION",
  "CHANGELOG.md",
  ".node-version",
  "package.json",
  "package-lock.json",
  "scripts/local.mjs",
  "scripts/node-runtime.sh",
  "scripts/run-local.sh",
  "scripts/windows/NodeRuntime.ps1",
  "services/document-worker/package.json",
  "services/document-worker/package-lock.json",
  "services/document-worker/src/server.mjs",
  "apps/chat/config/agents.json",
  ".env.example",
  ".gitignore",
  "setup.command",
  "setup-windows.cmd",
  "diagnose.command",
  "diagnose-windows.cmd",
  "evaluate-pilot.command",
  "evaluate-pilot-windows.cmd",
  "backup.command",
  "backup-windows.cmd",
  "reset.command",
  "reset-windows.cmd",
  "prepare-instructor-pack.command",
  "prepare-instructor-pack-windows.cmd",
  "docs/GETTING_STARTED.md",
  "docs/COURSE_GUIDE.md",
  "docs/RELEASE.md",
  "docs/FEEDBACK_AND_CHANGE_CONTROL.md",
  "docs/GITHUB_DESKTOP.md",
  "docs/INSTRUCTOR_CHECKLIST.md",
  "docs/PILOT_RUNBOOK.md",
  "docs/PILOT_FINDINGS.md",
  "docs/USABILITY_FIXES.md",
  "docs/GO_NO_GO.md",
  "docs/TEMPLATE_RELEASE.md",
  "docs/WORKFLOW_DEVELOPMENT.md",
  "docs/LOCAL_OPERATIONS.md",
  "docs/TROUBLESHOOTING.md",
  "docs/DOCUMENT_UPLOADS.md",
  "docs/ADD_AN_AGENT.md",
  "docs/images/01-n8n-owner-setup.png",
  "docs/images/02-n8n-learner-checklist.png",
  "docs/images/03-chat-confirmation.png",
  "examples/finished-solo-project-assistant/README.md",
  "examples/finished-solo-project-assistant/agent.config.js",
  "examples/finished-solo-project-assistant/PROJECT_ASSISTANT_SKILL.md",
  "n8n/workflows/01-start-here-learner-checklist.json",
  "scripts/diagnose.sh",
  "scripts/normalise-workflow-exports.mjs",
  "scripts/windows/diagnose.ps1",
  "scripts/test-phase5.sh",
  "scripts/test-phase6.sh",
  "scripts/test-phase7.sh",
  "scripts/evaluate-pilot.mjs",
  "scripts/evaluate-pilot.sh",
  "scripts/prepare-instructor-pack.sh",
  "scripts/windows/prepare-instructor-pack.ps1",
  "scripts/validate-release.mjs",
  "scripts/test-phase8.sh",
  "scripts/windows/evaluate-pilot.ps1",
  "pilot/README.md",
  "pilot/results.json",
  "pilot/session-template.json",
  "tests/phase7/browser-widths.mjs",
  "tests/phase7/package-lock.json",
  "tests/phase7/package.json",
  "tests/phase7/test-pilot-evaluator.mjs",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/learner-feedback.yml",
  ".github/ISSUE_TEMPLATE/improvement.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
];

const executableFiles = [
  "setup.command",
  "diagnose.command",
  "backup.command",
  "reset.command",
  "scripts/local.mjs",
  "scripts/node-runtime.sh",
  "scripts/run-local.sh",
  "scripts/setup.sh",
  "scripts/diagnose.sh",
  "scripts/test-phase5.sh",
  "scripts/test-phase6.sh",
  "scripts/test-phase7.sh",
  "scripts/evaluate-pilot.mjs",
  "scripts/evaluate-pilot.sh",
  "evaluate-pilot.command",
  "prepare-instructor-pack.command",
  "scripts/prepare-instructor-pack.sh",
  "scripts/validate-release.mjs",
  "scripts/test-phase8.sh",
];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory, ignoredNames = new Set()) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, ignoredNames)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

for (const file of requiredFiles) {
  check(await exists(join(projectRoot, file)), `Missing template file: ${file}`);
}

for (const file of executableFiles) {
  const path = join(projectRoot, file);
  if (await exists(path)) {
    const details = await stat(path);
    check(
      (details.mode & 0o111) !== 0,
      `${file} must remain executable for macOS and technical contributors`,
    );
  }
}

for (const image of [
  "docs/images/01-n8n-owner-setup.png",
  "docs/images/02-n8n-learner-checklist.png",
  "docs/images/03-chat-confirmation.png",
]) {
  const path = join(projectRoot, image);
  if (await exists(path)) {
    check((await stat(path)).size >= 20_000, `${image} is not a real screenshot`);
  }
}

const readme = await readFile(join(projectRoot, "README.md"), "utf8");
for (const requiredText of [
  "Use this template",
  "GitHub Desktop",
  "setup.command",
  "setup-windows.cmd",
  "import-workflows.command",
  "diagnose.command",
  "diagnose-windows.cmd",
  "CONFIRM XXXXXXXX",
  "backup.command",
  "reset.command",
  "No manual Node.js install",
  "Complete beginner getting-started guide",
  "Eight-exercise course guide",
  "v0.2.0",
]) {
  check(readme.includes(requiredText), `README must mention "${requiredText}"`);
}

const localRunner = await readFile(
  join(projectRoot, "scripts/local.mjs"),
  "utf8",
);
check(
  localRunner.includes("phase6LearnerChecklist") &&
    localRunner.includes("keeping local edits unchanged"),
  "The local runner must automatically import only when the reviewed workflow marker is missing",
);
check(
  localRunner.includes("documentWorkerServer") &&
    localRunner.includes("DOCUMENT_WORKER_URL") &&
    localRunner.includes('"data", "documents"') &&
    localRunner.includes("documentWorkerPort"),
  "The native runner must start and configure the local document reader",
);

const setupShell = await readFile(join(projectRoot, "scripts/setup.sh"), "utf8");
const setupWindows = await readFile(
  join(projectRoot, "scripts/windows/setup.ps1"),
  "utf8",
);
check(
  setupShell.includes("run-local.sh"),
  "macOS setup must delegate through the project-local Node.js launcher",
);
check(
  setupWindows.includes("NodeRuntime.ps1") &&
    setupWindows.includes("Invoke-ProjectLocalRunner"),
  "Windows setup must delegate through the project-local Node.js launcher",
);

const nodeVersion = (
  await readFile(join(projectRoot, ".node-version"), "utf8")
).trim();
const nodeRuntimeShell = await readFile(
  join(projectRoot, "scripts/node-runtime.sh"),
  "utf8",
);
const nodeRuntimeWindows = await readFile(
  join(projectRoot, "scripts/windows/NodeRuntime.ps1"),
  "utf8",
);
for (const runtimeSource of [nodeRuntimeShell, nodeRuntimeWindows]) {
  check(
    runtimeSource.includes(".node-version") &&
      runtimeSource.includes("nodejs.org") &&
      runtimeSource.includes("SHA-256"),
    "Each project-local Node.js bootstrap must use the pinned version, official download host, and SHA-256 verification",
  );
}
check(
  /^24\.\d+\.\d+$/.test(nodeVersion),
  `.node-version must pin a Node.js 24 patch release, found "${nodeVersion}"`,
);

const learnerLaunchers = [
  "setup.command",
  "setup-windows.cmd",
  "start.command",
  "start-windows.cmd",
  "stop.command",
  "stop-windows.cmd",
  "diagnose.command",
  "diagnose-windows.cmd",
  "import-workflows.command",
  "import-workflows-windows.cmd",
  "backup.command",
  "backup-windows.cmd",
  "reset.command",
  "reset-windows.cmd",
  "sync-skills.command",
  "sync-skills-windows.cmd",
  "scripts/setup.sh",
  "scripts/start.sh",
  "scripts/stop.sh",
  "scripts/diagnose.sh",
  "scripts/preflight.sh",
  "scripts/import-workflows.sh",
  "scripts/export-workflows.sh",
  "scripts/backup.sh",
  "scripts/restore.sh",
  "scripts/reset.sh",
  "scripts/sync-skills.sh",
  "scripts/windows/setup.ps1",
  "scripts/windows/start.ps1",
  "scripts/windows/stop.ps1",
  "scripts/windows/diagnose.ps1",
  "scripts/windows/preflight.ps1",
  "scripts/windows/import-workflows.ps1",
  "scripts/windows/export-workflows.ps1",
  "scripts/windows/backup.ps1",
  "scripts/windows/restore.ps1",
  "scripts/windows/reset.ps1",
  "scripts/windows/sync-skills.ps1",
];
for (const launcher of learnerLaunchers) {
  const source = await readFile(join(projectRoot, launcher), "utf8");
  check(
    !/\bdocker(?:\.exe)?\b|\bdocker\s+compose\b/i.test(source),
    `${launcher} must not invoke a container engine`,
  );
}

const ciWorkflow = await readFile(
  join(projectRoot, ".github/workflows/ci.yml"),
  "utf8",
);
check(
  ciWorkflow.includes('AI_SOLO_FORCE_PORTABLE_NODE = "1"') &&
    ciWorkflow.includes("Resolve-ProjectNode") &&
    ciWorkflow.includes("macos-latest") &&
    ciWorkflow.includes("Native agent and resilience smoke") &&
    ciWorkflow.includes("windows-latest"),
  "CI must exercise the native runtime on macOS, Windows, and the integration runner",
);

for (const removedArtifact of [
  "compose.yaml",
  "apps/chat/Dockerfile",
  "services/document-worker/Dockerfile",
  "services/document-worker/.dockerignore",
  "tests/phase3/compose.mock.yaml",
  "tests/phase4/compose.mock.yaml",
  "tests/phase5/compose.mock.yaml",
  "tests/phase7/Dockerfile.browser",
  "scripts/windows/Common.ps1",
]) {
  check(
    !(await exists(join(projectRoot, removedArtifact))),
    `Obsolete container artifact must stay removed: ${removedArtifact}`,
  );
}

check(
  !localRunner.includes("--decrypted"),
  "scripts/local.mjs must never decrypt credentials",
);
check(
  localRunner.includes("phase3StartHere") &&
    localRunner.includes("phase6LearnerChecklist") &&
    localRunner.includes("Anthropic"),
  "scripts/local.mjs diagnostics must inspect the checklist, main workflow, and Anthropic selection",
);

const gitignore = await readFile(join(projectRoot, ".gitignore"), "utf8");
for (const ignored of [".env", "backups/*", "n8n/exports/", "data/", ".runtime/"]) {
  check(gitignore.includes(ignored), `.gitignore must protect ${ignored}`);
}

const markdownRoots = [
  join(projectRoot, "README.md"),
  ...(await collectFiles(join(projectRoot, "docs"))).filter(
    (path) => extname(path) === ".md",
  ),
  ...(await collectFiles(join(projectRoot, "n8n"))).filter(
    (path) => extname(path) === ".md",
  ),
  ...(await collectFiles(join(projectRoot, "examples"))).filter(
    (path) => extname(path) === ".md",
  ),
];

const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const markdownPath of markdownRoots) {
  const source = await readFile(markdownPath, "utf8");
  for (const match of source.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }
    const fileTarget = rawTarget.split("#", 1)[0];
    if (!fileTarget) {
      continue;
    }
    const resolved = resolve(dirname(markdownPath), fileTarget);
    check(
      await exists(resolved),
      `${relative(projectRoot, markdownPath)} links to missing ${rawTarget}`,
    );
  }
}

const projectFiles = await collectFiles(
  projectRoot,
  new Set([
    ".git",
    ".env",
    "backups",
    "data",
    "node_modules",
    "dist",
    "coverage",
    "exports",
  ]),
);
for (const path of projectFiles) {
  const extension = extname(path).toLowerCase();
  if (
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".gz", ".ico"].includes(
      extension,
    )
  ) {
    continue;
  }
  const source = await readFile(path, "utf8");
  check(
    !source.includes(lfsPointerMarker),
    `${relative(projectRoot, path)} is a Git LFS pointer; templates cannot include LFS files`,
  );
  if (
    relative(projectRoot, path) !== "scripts/validate-workflows.mjs" &&
    relative(projectRoot, path) !==
      "scripts/validate-template-readiness.mjs"
  ) {
    check(
      !/sk-ant-api03-[a-zA-Z0-9_-]{20,}/.test(source),
      `${relative(projectRoot, path)} appears to contain an Anthropic API key`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  throw new Error(`Template readiness failed with ${failures.length} issue(s)`);
}

console.log(
  `Template readiness passed: ${requiredFiles.length} required artifacts and ${markdownRoots.length} Markdown files checked.`,
);
