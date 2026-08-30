/**
 * Keeps the editable skill working copy on the cloud volume in step with the
 * skills installed in the deployed image.
 *
 * Skill folders and enabled.txt live on the volume so a learner's edits survive
 * redeploys. A deploy used to seed only missing folders, though, which meant a
 * skill installed in Git could have its workflows and tool wiring deployed
 * while the persistent enabled list still called it "not installed". Merging
 * only missing enabled IDs preserves volume edits while making source installs
 * effective in the cloud.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// These are one-time, signature-gated migrations for repository packages that
// shipped an unsafe or retired implementation. Cloud skill folders normally
// belong to the learner and are never overwritten. A migration runs only when
// both the old shipped version and its distinctive instruction markers are
// still present, so an unrelated or already-updated skill remains untouched.
// The previous folder is copied outside SKILLS_DIRECTORY before replacement.
const SHIPPED_SKILL_UPGRADES = Object.freeze([
  {
    id: "xero-statement-capture",
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    markers: ["loopback endpoint", "extension popup", "get_xero_queue_status"],
  },
  {
    id: "xero-reconciliation",
    fromVersion: "1.0.0",
    toVersion: "1.2.0",
    markers: ["get_xero_queue_status", "complete browser capture", "prepare_green_matches"],
  },
]);

function metadataVersion(path) {
  try {
    const source = readFileSync(path, "utf8");
    return /^version:\s*([^\s#]+)\s*$/m.exec(source)?.[1] ?? "";
  } catch {
    return "";
  }
}

function replaceShippedSkill({ repoSkillsDir, skillsDir, upgrade }) {
  const source = join(repoSkillsDir, upgrade.id);
  const target = join(skillsDir, upgrade.id);
  if (!existsSync(source) || !existsSync(target)) return null;
  if (
    metadataVersion(join(source, "skill.yaml")) !== upgrade.toVersion ||
    metadataVersion(join(target, "skill.yaml")) !== upgrade.fromVersion
  ) {
    return null;
  }

  let instructions;
  try {
    instructions = readFileSync(join(target, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  if (!upgrade.markers.every((marker) => instructions.includes(marker))) {
    return null;
  }

  const dataDir = dirname(skillsDir);
  const backupDir = join(dataDir, "skill-upgrade-backups");
  const backup = join(
    backupDir,
    `${upgrade.id}-pre-${upgrade.toVersion}`,
  );
  const stage = join(dataDir, `.skill-upgrade-${upgrade.id}-${upgrade.toVersion}`);
  const rollback = join(dataDir, `.skill-rollback-${upgrade.id}-${upgrade.toVersion}`);

  mkdirSync(backupDir, { recursive: true });
  if (!existsSync(backup)) {
    cpSync(target, backup, { recursive: true, errorOnExist: true });
  }

  rmSync(stage, { recursive: true, force: true });
  rmSync(rollback, { recursive: true, force: true });
  cpSync(source, stage, { recursive: true, errorOnExist: true });
  renameSync(target, rollback);
  try {
    renameSync(stage, target);
    rmSync(rollback, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(target) && existsSync(rollback)) {
      renameSync(rollback, target);
    }
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }

  return { id: upgrade.id, backup };
}

function enabledIds(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("#") && SKILL_ID.test(line),
    );
}

export function seedCloudSkills({ repoSkillsDir, skillsDir }) {
  if (!existsSync(repoSkillsDir)) {
    return { directories: [], enabled: [], upgraded: [] };
  }

  const upgraded = SHIPPED_SKILL_UPGRADES
    .map((upgrade) => replaceShippedSkill({ repoSkillsDir, skillsDir, upgrade }))
    .filter(Boolean);

  const directories = [];
  for (const entry of readdirSync(repoSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const target = join(skillsDir, entry.name);
    if (existsSync(target)) {
      continue;
    }
    cpSync(join(repoSkillsDir, entry.name), target, { recursive: true });
    directories.push(entry.name);
  }

  const shippedEnabledPath = join(repoSkillsDir, "enabled.txt");
  if (!existsSync(shippedEnabledPath)) {
    return { directories, enabled: [], upgraded };
  }

  const shippedSource = readFileSync(shippedEnabledPath, "utf8");
  const shippedIds = enabledIds(shippedSource).filter((id) =>
    existsSync(join(repoSkillsDir, id, "skill.yaml")),
  );
  const savedEnabledPath = join(skillsDir, "enabled.txt");

  if (!existsSync(savedEnabledPath)) {
    cpSync(shippedEnabledPath, savedEnabledPath);
    return { directories, enabled: shippedIds, upgraded };
  }

  const savedSource = readFileSync(savedEnabledPath, "utf8");
  const savedIds = new Set(enabledIds(savedSource));
  const missingIds = shippedIds.filter((id) => !savedIds.has(id));
  if (missingIds.length === 0) {
    return { directories, enabled: [], upgraded };
  }

  const separator = savedSource.length > 0 && !savedSource.endsWith("\n")
    ? "\n"
    : "";
  writeFileSync(
    savedEnabledPath,
    `${savedSource}${separator}${missingIds.join("\n")}\n`,
  );
  return { directories, enabled: missingIds, upgraded };
}
