import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "seo-writer-upgrade-"));

try {
  for (const directory of ["optional-skills", "n8n", "skills", "tools", "scripts"]) {
    await cp(join(root, directory), join(temporary, directory), { recursive: true });
  }
  const command = join(temporary, "scripts", "upgrade-seo-article-writer.mjs");
  const current = spawnSync(process.execPath, [command], { cwd: temporary, encoding: "utf8" });
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /already current/i);

  const customizedPath = join(temporary, "skills", "seo-article-writer", "SKILL.md");
  const customized = `${await readFile(customizedPath, "utf8")}\nLocal owner edit.\n`;
  await writeFile(customizedPath, customized);
  const rejected = spawnSync(process.execPath, [command], { cwd: temporary, encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /local changes/i);
  assert.equal(await readFile(customizedPath, "utf8"), customized);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("SEO Article Writer upgrade is idempotent and refuses customized installed files.");
