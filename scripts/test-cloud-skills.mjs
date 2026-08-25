import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
assert.deepEqual(second, { directories: [], enabled: [] });
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

console.log("Cloud skill seeding preserves edits and enables source installs.");
