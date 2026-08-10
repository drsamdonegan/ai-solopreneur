import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const version = (
  await readFile(join(projectRoot, "VERSION"), "utf8")
).trim();

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

check(/^\d+\.\d+\.\d+$/.test(version), "VERSION must contain semantic version X.Y.Z");

for (const file of [
  "CHANGELOG.md",
  ".node-version",
  ".npm-version",
  "docs/GETTING_STARTED.md",
  "docs/COURSE_GUIDE.md",
  "docs/RELEASE.md",
  "docs/FEEDBACK_AND_CHANGE_CONTROL.md",
  "prepare-instructor-pack.command",
  "prepare-instructor-pack-windows.cmd",
  "preflight-windows.cmd",
  "export-workflows-windows.cmd",
  "restore-windows.cmd",
  "scripts/prepare-instructor-pack.sh",
  "scripts/windows/prepare-instructor-pack.ps1",
  ".github/ISSUE_TEMPLATE/learner-feedback.yml",
  ".github/ISSUE_TEMPLATE/improvement.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
]) {
  check(await exists(join(projectRoot, file)), `Missing release artifact: ${file}`);
}

const changelog = await readFile(join(projectRoot, "CHANGELOG.md"), "utf8");
check(
  changelog.includes(`## ${version} `),
  `CHANGELOG.md must contain a ${version} release heading`,
);

const packageJson = JSON.parse(
  await readFile(join(projectRoot, "apps/chat/package.json"), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(join(projectRoot, "apps/chat/package-lock.json"), "utf8"),
);
const documentPackageJson = JSON.parse(
  await readFile(
    join(projectRoot, "services/document-worker/package.json"),
    "utf8",
  ),
);
const documentPackageLock = JSON.parse(
  await readFile(
    join(projectRoot, "services/document-worker/package-lock.json"),
    "utf8",
  ),
);
check(packageJson.version === version, "Chat package version must match VERSION");
check(packageLock.version === version, "Chat lockfile version must match VERSION");
check(
  packageLock.packages?.[""]?.version === version,
  "Chat lockfile root package version must match VERSION",
);
check(
  documentPackageJson.version === version,
  "Document reader package version must match VERSION",
);
check(
  documentPackageLock.version === version &&
    documentPackageLock.packages?.[""]?.version === version,
  "Document reader lockfile version must match VERSION",
);

const rootPackageJson = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const rootPackageLock = JSON.parse(
  await readFile(join(projectRoot, "package-lock.json"), "utf8"),
);
check(
  rootPackageJson.version === version,
  "Root package version must match VERSION",
);
check(
  /^\d+\.\d+\.\d+$/.test(rootPackageJson.dependencies?.n8n ?? ""),
  "Root package.json must pin an exact n8n version",
);
check(
  rootPackageLock.packages?.["node_modules/n8n"]?.version ===
    rootPackageJson.dependencies?.n8n,
  "Root lockfile must pin the exact n8n version",
);
const reviewedNodeVersion = (
  await readFile(join(projectRoot, ".node-version"), "utf8")
).trim();
const reviewedNpmVersion = (
  await readFile(join(projectRoot, ".npm-version"), "utf8")
).trim();
check(
  reviewedNodeVersion === "24.18.0" &&
    reviewedNpmVersion === "11.16.0" &&
    rootPackageJson.engines?.node === "24.x",
  "Release must keep the reviewed Node.js 24.18.0/npm 11.16.0 runtime contract",
);

for (const removedArtifact of [
  "compose.yaml",
  "apps/chat/Dockerfile",
  "services/document-worker/Dockerfile",
  "services/document-worker/.dockerignore",
  "scripts/windows/Common.ps1",
]) {
  check(
    !(await exists(join(projectRoot, removedArtifact))),
    `Obsolete container artifact must stay removed: ${removedArtifact}`,
  );
}

const gettingStarted = await readFile(
  join(projectRoot, "docs/GETTING_STARTED.md"),
  "utf8",
);
for (const requiredText of [
  "You do not need to know how to code",
  "setup.command",
  "setup-windows.cmd",
  "diagnose.command",
  "diagnose-windows.cmd",
  "CONFIRM XXXXXXXX",
  "stop.command",
  "start.command",
  "When something does not work",
]) {
  check(
    gettingStarted.includes(requiredText),
    `Getting-started guide must mention "${requiredText}"`,
  );
}

const course = await readFile(join(projectRoot, "docs/COURSE_GUIDE.md"), "utf8");
for (let exercise = 1; exercise <= 8; exercise += 1) {
  check(
    course.includes(`## Exercise ${exercise} `),
    `Course guide must contain Exercise ${exercise}`,
  );
}

const decision = await readFile(join(projectRoot, "docs/GO_NO_GO.md"), "utf8");
check(
  decision.includes("owner waiver") &&
    decision.includes("Phase 8 authorised") &&
    decision.includes("Yes"),
  "GO_NO_GO.md must transparently record the owner waiver and Phase 8 authorisation",
);

const gitignore = await readFile(join(projectRoot, ".gitignore"), "utf8");
check(
  gitignore.includes("instructor-pack/"),
  ".gitignore must exclude generated instructor packs",
);

const workflows = (
  await readdir(join(projectRoot, "n8n/workflows"), { withFileTypes: true })
).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
check(workflows.length === 11, `Release must contain 11 workflows, found ${workflows.length}`);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  throw new Error(`Release validation failed with ${failures.length} issue(s)`);
}

console.log(
  `Release validation passed for v${version}: pinned native runtime, beginner journey, eight exercises, instructor kit, and feedback controls.`,
);
