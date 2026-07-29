import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const version = (
  await readFile(join(projectRoot, "VERSION"), "utf8")
).trim();
const n8nImage =
  "docker.n8n.io/n8nio/n8n:2.30.5@sha256:450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f";
const nodeImage =
  "node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a";
const playwrightImage =
  "mcr.microsoft.com/playwright:v1.61.0-noble@sha256:57b65fdc9ceabe0ef613124c7bbe2babcf9362c4d85e382fe3b03604e84b428a";

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

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "instructor-pack"].includes(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function everyReferenceIsDigestLocked(source, tag) {
  let cursor = 0;
  while (true) {
    const index = source.indexOf(tag, cursor);
    if (index === -1) {
      return true;
    }
    if (!source.startsWith("@sha256:", index + tag.length)) {
      return false;
    }
    cursor = index + tag.length;
  }
}

check(/^\d+\.\d+\.\d+$/.test(version), "VERSION must contain semantic version X.Y.Z");

for (const file of [
  "CHANGELOG.md",
  "docs/GETTING_STARTED.md",
  "docs/COURSE_GUIDE.md",
  "docs/RELEASE.md",
  "docs/FEEDBACK_AND_CHANGE_CONTROL.md",
  "prepare-instructor-pack.command",
  "prepare-instructor-pack-windows.cmd",
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
  n8nImage.includes(`:${rootPackageJson.dependencies?.n8n}@`),
  "Root package.json must pin the same n8n version as the locked image digest",
);
check(
  rootPackageLock.packages?.["node_modules/n8n"]?.version ===
    rootPackageJson.dependencies?.n8n,
  "Root lockfile must pin the exact n8n version",
);

const compose = await readFile(join(projectRoot, "compose.yaml"), "utf8");
check(compose.includes(n8nImage), "compose.yaml must use the locked n8n digest");
check(
  compose.includes(`image: ai-solopreneur-chat:${version}`),
  "compose.yaml chat image must match VERSION",
);
check(
  compose.includes(`image: ai-solopreneur-document-worker:${version}`),
  "compose.yaml document reader image must match VERSION",
);

const chatDockerfile = await readFile(
  join(projectRoot, "apps/chat/Dockerfile"),
  "utf8",
);
check(
  chatDockerfile.split(nodeImage).length - 1 === 2,
  "Chat build and runtime stages must use the locked Node digest",
);
const documentDockerfile = await readFile(
  join(projectRoot, "services/document-worker/Dockerfile"),
  "utf8",
);
check(
  documentDockerfile.split(nodeImage).length - 1 === 1,
  "Document reader runtime must use the locked Node digest",
);
const browserDockerfile = await readFile(
  join(projectRoot, "tests/phase7/Dockerfile.browser"),
  "utf8",
);
check(
  browserDockerfile.includes(playwrightImage),
  "Browser tests must use the locked Playwright digest",
);

for (const root of ["apps", "scripts", "tests"]) {
  for (const path of await collectFiles(join(projectRoot, root))) {
    const name = basename(path);
    const extension = extname(path);
    if (path === join(projectRoot, "scripts/validate-release.mjs")) {
      continue;
    }
    if (
      ![
        ".cmd",
        ".md",
        ".mjs",
        ".ps1",
        ".sh",
        ".yaml",
        ".yml",
      ].includes(extension) &&
      !name.startsWith("Dockerfile")
    ) {
      continue;
    }
    const source = await readFile(path, "utf8");
    check(
      everyReferenceIsDigestLocked(source, "node:24.16.0-alpine3.22"),
      `${path.slice(projectRoot.length)} contains an unlocked Node image`,
    );
    check(
      everyReferenceIsDigestLocked(
        source,
        "docker.n8n.io/n8nio/n8n:2.30.5",
      ),
      `${path.slice(projectRoot.length)} contains an unlocked n8n image`,
    );
    check(
      everyReferenceIsDigestLocked(
        source,
        "mcr.microsoft.com/playwright:v1.61.0-noble",
      ),
      `${path.slice(projectRoot.length)} contains an unlocked Playwright image`,
    );
  }
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
  `Release validation passed for v${version}: locked images, beginner journey, eight exercises, instructor kit, and feedback controls.`,
);
