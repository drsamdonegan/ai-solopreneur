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
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    return { directories: [], enabled: [] };
  }

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
    return { directories, enabled: [] };
  }

  const shippedSource = readFileSync(shippedEnabledPath, "utf8");
  const shippedIds = enabledIds(shippedSource).filter((id) =>
    existsSync(join(repoSkillsDir, id, "skill.yaml")),
  );
  const savedEnabledPath = join(skillsDir, "enabled.txt");

  if (!existsSync(savedEnabledPath)) {
    cpSync(shippedEnabledPath, savedEnabledPath);
    return { directories, enabled: shippedIds };
  }

  const savedSource = readFileSync(savedEnabledPath, "utf8");
  const savedIds = new Set(enabledIds(savedSource));
  const missingIds = shippedIds.filter((id) => !savedIds.has(id));
  if (missingIds.length === 0) {
    return { directories, enabled: [] };
  }

  const separator = savedSource.length > 0 && !savedSource.endsWith("\n")
    ? "\n"
    : "";
  writeFileSync(
    savedEnabledPath,
    `${savedSource}${separator}${missingIds.join("\n")}\n`,
  );
  return { directories, enabled: missingIds };
}
