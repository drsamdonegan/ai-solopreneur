import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Builds the learner-facing "what can my agent do" list.
//
// Two very different things both answer that question, and until now neither was
// visible anywhere: Markdown skills change how the agent writes, and tool
// workflows change what it can do. A learner does not care about that
// distinction, so this merges them into one list with a plain status.

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseSkillYaml(source, location) {
  const metadata = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }
  if (!metadata.id || !metadata.name || !metadata.description) {
    throw new Error(`${location}: needs id, name and description`);
  }
  return metadata;
}

async function readEnabledIds(skillsDirectory) {
  const path = join(skillsDirectory, "enabled.txt");
  if (!(await exists(path))) {
    return new Set();
  }
  const raw = await readFile(path, "utf8");
  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

export async function buildSkillList({
  skillsDirectory = join(projectRoot, "skills"),
  manifestPath = join(projectRoot, "n8n", "tools.manifest.json"),
  workflowsDirectory = join(projectRoot, "n8n", "workflows"),
} = {}) {
  const rows = [];

  // Markdown skills. Every folder is listed, not just the enabled ones — a skill
  // sitting on disk with no enabled.txt line is the exact silent failure this
  // table exists to make visible.
  const enabled = await readEnabledIds(skillsDirectory);
  const entries = await readdir(skillsDirectory, { withFileTypes: true });
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const yamlPath = join(skillsDirectory, entry.name, "skill.yaml");
    if (!(await exists(yamlPath))) {
      continue;
    }
    const metadata = parseSkillYaml(
      await readFile(yamlPath, "utf8"),
      `skills/${entry.name}/skill.yaml`,
    );
    rows.push({
      skillKey: `skill:${metadata.id}`,
      name: metadata.name,
      description: metadata.description,
      status: enabled.has(metadata.id) ? "On" : "Off",
      setup: enabled.has(metadata.id)
        ? ""
        : `Add "${metadata.id}" to skills/enabled.txt, then run sync-skills`,
    });
  }

  // Tool capabilities, described in plain language by the manifest.
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const capability of manifest.capabilities ?? []) {
      const missing = [];
      for (const file of capability.workflows ?? []) {
        if (!(await exists(join(workflowsDirectory, file)))) {
          missing.push(file);
        }
      }
      rows.push({
        skillKey: `tool:${capability.id}`,
        name: capability.name,
        description: capability.description,
        // "On" here means the workflow is installed, which is all this can honestly
        // know. Whether a credential is attached lives in n8n's own store and is
        // not readable from here, so it is reported as a setup step instead of a
        // status that would go stale the moment the learner fixed it.
        status: missing.length === 0 ? "On" : "Missing",
        setup:
          missing.length > 0
            ? `Re-run import-workflows (missing ${missing.join(", ")})`
            : (capability.needs ?? ""),
      });
    }
  }

  rows.sort((left, right) => left.name.localeCompare(right.name));
  return { schemaVersion: 1, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = await buildSkillList();
  if (process.argv.includes("--table")) {
    const width = Math.max(...list.rows.map((row) => row.name.length));
    for (const row of list.rows) {
      const suffix = row.setup ? `  — ${row.setup}` : "";
      process.stdout.write(
        `  ${row.status === "On" ? "on " : "OFF"}  ${row.name.padEnd(width)}  ${row.description}${suffix}\n`,
      );
    }
  } else {
    process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
  }
}
