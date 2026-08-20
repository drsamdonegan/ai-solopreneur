import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgentToolScopes } from "./agent-runtime-contract.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "optional-installer-test-"));

async function makeScratch(name) {
  const root = join(temporary, name);
  for (const directory of ["optional-skills", "scripts", "n8n", "skills", "tools"]) {
    await cp(join(projectRoot, directory), join(root, directory), {
      recursive: true,
    });
  }
  return root;
}

function install(root, skillId, expectSuccess = true) {
  const result = spawnSync(
    process.execPath,
    [join(root, "optional-skills", "_installer", "add-skill.mjs"), skillId],
    { cwd: root, encoding: "utf8" },
  );
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `${skillId} install failed:\n${result.stdout}\n${result.stderr}`,
    );
  } else {
    assert.notEqual(result.status, 0, `${skillId} should have been rejected`);
  }
  return result;
}

async function snapshot(root) {
  const result = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        result[path.slice(root.length + 1)] = await readFile(path, "utf8");
      }
    }
  }
  for (const directory of ["n8n", "skills", "tools"]) {
    await walk(join(root, directory));
  }
  return result;
}

try {
  const freeFirstRoot = await makeScratch("free-first-seo");
  // This release checkout may have the paid upgrade installed for integration
  // testing. Remove only its installed skill copy so this fixture still proves
  // that adding the free researcher and writer does not pull it in.
  await rm(join(freeFirstRoot, "skills", "paid-domain-research"), {
    recursive: true,
    force: true,
  });
  install(freeFirstRoot, "domain-research");
  install(freeFirstRoot, "seo-article-writer");
  await assert.rejects(
    readFile(
      join(freeFirstRoot, "skills", "paid-domain-research", "SKILL.md"),
      "utf8",
    ),
    /ENOENT/,
    "SEO article writing must not install or require paid domain research",
  );
  assert.match(
    await readFile(
      join(freeFirstRoot, "skills", "seo-article-writer", "SKILL.md"),
      "utf8",
    ),
    /call the free `start_domain_research` tool once/i,
    "the installed SEO writer must use free domain research first",
  );

  const root = await makeScratch("valid");
  const installed = [
    "linkedin-profile-lookup",
    "domain-research",
    "paid-domain-research",
    "seo-article-writer",
    "funding-radar",
    "monthly-update",
    "scheduler",
  ];
  for (const skillId of installed) {
    install(root, skillId);
  }

  const linkedInCatalogueSkill = await readFile(
    join(
      root,
      "optional-skills",
      "linkedin-profile-lookup",
      "skill",
      "SKILL.md",
    ),
    "utf8",
  );
  const installedLinkedInSkill = await readFile(
    join(root, "skills", "linkedin-profile-lookup", "SKILL.md"),
    "utf8",
  );
  assert.equal(
    installedLinkedInSkill,
    linkedInCatalogueSkill,
    "installed LinkedIn instructions must remain byte-identical to the catalogue",
  );
  assert(
    installedLinkedInSkill.trim().length < 7200,
    "LinkedIn instructions must retain maintenance headroom",
  );
  assert.doesNotMatch(
    installedLinkedInSkill,
    /profile_matcher\.py|free mode:|fall back to free public search/i,
    "the n8n agent must not be told to run the removed public-search fallback",
  );
  assert.match(
    installedLinkedInSkill,
    /live profile lookup is unavailable in this agent/i,
    "the skill must fail honestly when its provider tool is unavailable",
  );

  const workflow = JSON.parse(
    await readFile(
      join(root, "n8n", "workflows", "00-start-here-project-partner.json"),
      "utf8",
    ),
  );
  const ownership = new Map([
    ["list_tasks", "project-manager"],
    ["create_task", "project-manager"],
    ["update_task_status", "project-manager"],
  ]);
  for (const skillId of installed) {
    const manifest = JSON.parse(
      await readFile(
        join(root, "optional-skills", skillId, "manifest.json"),
        "utf8",
      ),
    );
    for (const tool of manifest.agentTools ?? []) {
      ownership.set(tool.name, manifest.agent);
    }
  }
  assert.deepEqual(validateAgentToolScopes(workflow, ownership), []);
  const validation = spawnSync(
    process.execPath,
    [join(root, "scripts", "validate-workflows.mjs")],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    validation.status,
    0,
    `full optional install failed validation:\n${validation.stdout}\n${validation.stderr}`,
  );

  const beforeSecondInstall = await snapshot(root);
  for (const skillId of installed) {
    install(root, skillId);
  }
  assert.deepEqual(
    await snapshot(root),
    beforeSecondInstall,
    "a second install must be a content no-op",
  );

  const invalidRoot = await makeScratch("invalid");
  const manifestPath = join(
    invalidRoot,
    "optional-skills",
    "linkedin-profile-lookup",
    "manifest.json",
  );
  const invalidManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  invalidManifest.agent = "bookkeeping";
  await writeFile(manifestPath, `${JSON.stringify(invalidManifest, null, 2)}\n`);
  // The evidence below is that the copy never happened, so the destination has
  // to be absent first. This skill ships installed now, and without clearing it
  // the check passes on a file that was already there.
  await rm(join(invalidRoot, "skills", "linkedin-profile-lookup"), {
    recursive: true,
    force: true,
  });
  install(invalidRoot, "linkedin-profile-lookup", false);
  await assert.rejects(
    readFile(
      join(invalidRoot, "skills", "linkedin-profile-lookup", "SKILL.md"),
      "utf8",
    ),
    /ENOENT/,
    "manifest/metadata mismatch must fail before copying",
  );

  process.stdout.write("Optional installer ownership and idempotency checks passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
