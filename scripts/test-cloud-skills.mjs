import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedCloudSkills } from "./cloud-skills.mjs";

const temporary = await mkdtemp(join(tmpdir(), "ai-solopreneur-cloud-skills-"));
const repoSkillsDir = join(temporary, "repo-skills");
const skillsDir = join(temporary, "saved-skills");
await mkdir(repoSkillsDir, { recursive: true });
await mkdir(skillsDir, { recursive: true });

for (const id of ["base-skill", "new-skill"]) {
  await mkdir(join(repoSkillsDir, id), { recursive: true });
  await writeFile(join(repoSkillsDir, id, "skill.yaml"), `id: ${id}\n`);
}
await writeFile(
  join(repoSkillsDir, "enabled.txt"),
  "# Shipped skills\nbase-skill\nnew-skill\n",
);

await mkdir(join(skillsDir, "base-skill"), { recursive: true });
await writeFile(
  join(skillsDir, "base-skill", "skill.yaml"),
  "id: base-skill\ncustom: kept\n",
);
await writeFile(
  join(skillsDir, "enabled.txt"),
  "# Saved by the learner\nbase-skill\nlearner-only",
);

const first = seedCloudSkills({ repoSkillsDir, skillsDir });
assert.deepEqual(first.directories, ["new-skill"]);
assert.deepEqual(first.enabled, ["new-skill"]);
assert.deepEqual(first.upgraded, []);
assert.equal(
  await readFile(join(skillsDir, "base-skill", "skill.yaml"), "utf8"),
  "id: base-skill\ncustom: kept\n",
  "an existing skill edit must not be overwritten",
);
assert.equal(
  await readFile(join(skillsDir, "enabled.txt"), "utf8"),
  "# Saved by the learner\nbase-skill\nlearner-only\nnew-skill\n",
  "the shipped install must be appended without removing volume-only entries",
);

const second = seedCloudSkills({ repoSkillsDir, skillsDir });
assert.deepEqual(second, { directories: [], enabled: [], upgraded: [] });
assert.equal(
  (await readFile(join(skillsDir, "enabled.txt"), "utf8"))
    .split("\n")
    .filter((line) => line === "new-skill").length,
  1,
  "repeated deploys must not duplicate an enabled ID",
);

const emptySkillsDir = join(temporary, "empty-saved-skills");
await mkdir(emptySkillsDir, { recursive: true });
const fresh = seedCloudSkills({ repoSkillsDir, skillsDir: emptySkillsDir });
assert.deepEqual(fresh.enabled, ["base-skill", "new-skill"]);
assert.equal(
  await readFile(join(emptySkillsDir, "enabled.txt"), "utf8"),
  "# Shipped skills\nbase-skill\nnew-skill\n",
  "a fresh volume must receive the shipped enabled file byte-for-byte",
);

const upgradeRepo = join(temporary, "upgrade-repo");
const upgradeSaved = join(temporary, "upgrade-saved");
await mkdir(upgradeRepo, { recursive: true });
await mkdir(upgradeSaved, { recursive: true });

for (const [id, fromVersion, toVersion, oldInstructions] of [
  [
    "xero-statement-capture",
    "1.0.0",
    "1.1.0",
    "Use the loopback endpoint with the extension popup, then call get_xero_queue_status.\n",
  ],
  [
    "xero-reconciliation",
    "1.0.0",
    "1.2.0",
    "Call get_xero_queue_status after a complete browser capture; prepare_green_matches needs approval.\n",
  ],
]) {
  await mkdir(join(upgradeRepo, id), { recursive: true });
  await mkdir(join(upgradeSaved, id), { recursive: true });
  await writeFile(join(upgradeRepo, id, "skill.yaml"), `id: ${id}\nversion: ${toVersion}\n`);
  await writeFile(join(upgradeRepo, id, "SKILL.md"), `new ${id}\n`);
  await writeFile(join(upgradeSaved, id, "skill.yaml"), `id: ${id}\nversion: ${fromVersion}\n`);
  await writeFile(join(upgradeSaved, id, "SKILL.md"), oldInstructions);
  await writeFile(join(upgradeSaved, id, "learner-note.txt"), "recoverable\n");
}
await writeFile(join(upgradeRepo, "enabled.txt"), "xero-statement-capture\nxero-reconciliation\n");
await writeFile(join(upgradeSaved, "enabled.txt"), "xero-statement-capture\nxero-reconciliation\n");

const upgraded = seedCloudSkills({ repoSkillsDir: upgradeRepo, skillsDir: upgradeSaved });
assert.deepEqual(upgraded.directories, []);
assert.deepEqual(upgraded.enabled, []);
assert.deepEqual(
  upgraded.upgraded.map(({ id }) => id),
  ["xero-statement-capture", "xero-reconciliation"],
);
assert.equal(
  await readFile(join(upgradeSaved, "xero-statement-capture", "SKILL.md"), "utf8"),
  "new xero-statement-capture\n",
);
await access(
  join(
    temporary,
    "skill-upgrade-backups",
    "xero-statement-capture-pre-1.1.0",
    "learner-note.txt",
  ),
);
assert.deepEqual(
  seedCloudSkills({ repoSkillsDir: upgradeRepo, skillsDir: upgradeSaved }).upgraded,
  [],
  "the migration must be one-time after the target version is installed",
);

const customizedSaved = join(temporary, "customized-saved");
await mkdir(join(customizedSaved, "xero-statement-capture"), { recursive: true });
await writeFile(
  join(customizedSaved, "xero-statement-capture", "skill.yaml"),
  "id: xero-statement-capture\nversion: 1.0.0\n",
);
await writeFile(
  join(customizedSaved, "xero-statement-capture", "SKILL.md"),
  "A learner-authored capture process with no retired markers.\n",
);
await writeFile(join(customizedSaved, "enabled.txt"), "xero-statement-capture\n");
assert.deepEqual(
  seedCloudSkills({ repoSkillsDir: upgradeRepo, skillsDir: customizedSaved }).upgraded,
  [],
  "a version number alone must never overwrite learner-authored instructions",
);
assert.match(
  await readFile(join(customizedSaved, "xero-statement-capture", "SKILL.md"), "utf8"),
  /learner-authored/,
);

console.log("Cloud skill seeding preserves edits, enables source installs, and upgrades retired shipped Xero packages safely.");
