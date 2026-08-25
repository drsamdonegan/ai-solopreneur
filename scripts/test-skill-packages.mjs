import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillPacks } from "./skill-packages.mjs";

const packs = await loadSkillPacks();
let optionalCataloguePresent = true;
try {
  optionalCataloguePresent = (await readdir("optional-skills", { withFileTypes: true }))
    .some((entry) => entry.isDirectory() && !entry.name.startsWith("_"));
} catch {
  optionalCataloguePresent = false;
}
const byAgent = Object.fromEntries(
  ["project-manager", "sales", "marketing", "investment", "bookkeeping"].map(
    (agent) => [agent, packs.filter((pack) => pack.agent === agent).map((pack) => pack.id)],
  ),
);

assert.deepEqual(
  Object.fromEntries(Object.entries(byAgent).map(([agent, values]) => [agent, values.length])),
  { "project-manager": 1, sales: 2, marketing: 2, investment: 1, bookkeeping: 0 },
);
assert.deepEqual(byAgent["project-manager"], ["meeting-to-actions"]);
assert.deepEqual(byAgent.sales, ["linkedin-profile-lookup", "linkedin-prospect-search"]);
assert.deepEqual(byAgent.marketing, ["domain-research", "seo-aeo-article-writer"]);
assert.deepEqual(byAgent.investment, ["funding-and-investor-updates"]);

for (const pack of packs) {
  for (const module of pack.modules) {
    if (module.source === "optional" && !optionalCataloguePresent) continue;
    const directory =
      module.source === "base"
        ? join("skills", module.id)
        : join("optional-skills", module.id);
    await access(directory);
  }
}

const invalidDirectory = await mkdtemp(join(tmpdir(), "skill-pack-contract-"));
try {
  for (const [id, requirement] of [["cycle-a", "cycle-b"], ["cycle-b", "cycle-a"]]) {
    const directory = join(invalidDirectory, id);
    await mkdir(directory);
    await writeFile(
      join(directory, "pack.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id,
        agent: "sales",
        name: id,
        description: `${id} package used to test dependency validation.`,
        icon: "search",
        installable: true,
        requires: [requirement],
        modules: [
          { id, name: id, role: "core", source: "optional" },
        ],
      }, null, 2)}\n`,
    );
  }
  await assert.rejects(loadSkillPacks(invalidDirectory), /cyclic package dependency/);
} finally {
  await rm(invalidDirectory, { recursive: true, force: true });
}

process.stdout.write("Six public packages map to the full internal module inventory. Checks passed.\n");
