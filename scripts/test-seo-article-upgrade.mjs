import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "seo-writer-upgrade-"));

try {
  for (const directory of ["apps", "optional-skills", "n8n", "skills", "tools", "scripts"]) {
    await cp(join(root, directory), join(temporary, directory), { recursive: true });
  }
  const command = join(temporary, "scripts", "upgrade-seo-article-writer.mjs");
  const current = spawnSync(process.execPath, [command], { cwd: temporary, encoding: "utf8" });
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /already current/i);
  const installedSkill = await readFile(
    join(temporary, "skills", "seo-article-writer", "SKILL.md"),
    "utf8",
  );
  assert.match(installedSkill, /Never call `get_seo_article` again in the same turn/i);
  const installedWriter = JSON.parse(
    await readFile(
      join(temporary, "n8n", "workflows", "57-internal-write-seo-article.json"),
      "utf8",
    ),
  );
  assert.equal(
    installedWriter.nodes.find((node) => node.name === "Save Article Version")
      .parameters.jsonBody,
    "={{ JSON.stringify($json.saveBody) }}",
  );

  const hostPath = join(temporary, "apps", "chat", "src", "app.ts");
  const currentHost = await readFile(hostPath, "utf8");
  const writerPath = join(
    temporary,
    "n8n",
    "workflows",
    "57-internal-write-seo-article.json",
  );
  const skillPath = join(temporary, "skills", "seo-article-writer", "SKILL.md");
  const writerBeforeRejectedUpgrade = await readFile(writerPath, "utf8");
  const skillBeforeRejectedUpgrade = await readFile(skillPath, "utf8");
  await writeFile(
    hostPath,
    currentHost.replace("/api/seo-article/validate", "/api/seo-article/quality-disabled"),
  );
  const incompatibleHost = spawnSync(process.execPath, [command], {
    cwd: temporary,
    encoding: "utf8",
  });
  assert.notEqual(incompatibleHost.status, 0);
  assert.match(incompatibleHost.stderr, /matching core chat-host changes/i);
  assert.match(incompatibleHost.stderr, /stopped before writing anything/i);
  assert.equal(await readFile(writerPath, "utf8"), writerBeforeRejectedUpgrade);
  assert.equal(await readFile(skillPath, "utf8"), skillBeforeRejectedUpgrade);
  await writeFile(hostPath, currentHost);

  const agentPath = join(temporary, "n8n", "workflows", "00-start-here-project-partner.json");
  const priorAgent = JSON.parse(await readFile(agentPath, "utf8"));
  priorAgent.nodes.find((node) => node.name === "get_seo_article").parameters.description =
    "Read-only source of truth for an SEO article job in this conversation. Use when the user asks whether the background article is ready, asks for the latest draft for a domain, or wants its download link. Pass the exact job ID when available; otherwise pass the saved business domain. It makes no model call, no paid call, and never changes or publishes an article.";
  await writeFile(agentPath, `${JSON.stringify(priorAgent, null, 2)}\n`);
  const upgradedGetTool = spawnSync(process.execPath, [command], {
    cwd: temporary,
    encoding: "utf8",
  });
  assert.equal(upgradedGetTool.status, 0, upgradedGetTool.stderr);
  assert.match(upgradedGetTool.stdout, /upgraded safely/i);
  const updatedAgent = JSON.parse(await readFile(agentPath, "utf8"));
  assert.match(
    updatedAgent.nodes.find((node) => node.name === "get_seo_article")
      .parameters.description,
    /later user message/i,
  );

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
