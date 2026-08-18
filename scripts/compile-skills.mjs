import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const defaultSkillsDirectory = join(projectRoot, "skills");
const defaultProfileDirectory = join(projectRoot, "data", "profile");

export const AGENT_IDS = Object.freeze([
  "project-manager",
  "sales",
  "marketing",
  "investment",
  "bookkeeping",
]);

const validSkillAgents = new Set([...AGENT_IDS, "global"]);
const allowedMetadataKeys = new Set([
  "id",
  "agent",
  "name",
  "version",
  "description",
]);

// Runaway guards rather than design budgets. These limits are also enforced by
// the n8n skill-sync workflow; change both sides together.
const maxCompiledBlock = 200_000;

function parseScalar(value, location) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${location}: values cannot be empty`);
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function parseSkillMetadata(source, location) {
  const metadata = {};

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/.exec(line);
    if (!match) {
      throw new Error(
        `${location}:${index + 1}: use one plain "key: value" entry per line`,
      );
    }

    const [, key, value] = match;
    if (!allowedMetadataKeys.has(key)) {
      throw new Error(`${location}:${index + 1}: unsupported key "${key}"`);
    }
    if (Object.hasOwn(metadata, key)) {
      throw new Error(`${location}:${index + 1}: duplicate key "${key}"`);
    }
    metadata[key] = parseScalar(value, `${location}:${index + 1}`);
  }

  for (const key of allowedMetadataKeys) {
    if (!metadata[key]) {
      throw new Error(`${location}: missing required "${key}"`);
    }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.id)) {
    throw new Error(`${location}: id must use lowercase kebab-case`);
  }
  if (!validSkillAgents.has(metadata.agent)) {
    throw new Error(
      `${location}: agent must be one of ${[...validSkillAgents].join(", ")}`,
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) {
    throw new Error(`${location}: version must use semantic versioning`);
  }
  if (metadata.name.length > 80 || metadata.description.length > 240) {
    throw new Error(`${location}: name or description is too long`);
  }

  return metadata;
}

async function readEnabledIds(skillsDirectory) {
  const source = await readFile(join(skillsDirectory, "enabled.txt"), "utf8");
  const ids = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (ids.length === 0) {
    throw new Error("skills/enabled.txt must enable at least one skill");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("skills/enabled.txt contains a duplicate skill ID");
  }
  for (const id of ids) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`skills/enabled.txt contains invalid skill ID "${id}"`);
    }
  }

  return ids;
}

async function readOptionalText(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function skillBlocks(skills) {
  return skills.map(
    (skill) =>
      `## ${skill.name} (${skill.id}@${skill.version})\n${skill.instructions}`,
  );
}

function joinBlocks(blocks) {
  return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}

function assertBounded(value, label) {
  if (value.length > maxCompiledBlock) {
    throw new Error(`${label} exceeds ${maxCompiledBlock} characters`);
  }
}

export async function compileSkills(
  skillsDirectory = defaultSkillsDirectory,
  { profileDirectory = defaultProfileDirectory } = {},
) {
  const resolvedDirectory = resolve(skillsDirectory);
  const resolvedProfileDirectory = resolve(profileDirectory);
  const enabledIds = await readEnabledIds(resolvedDirectory);
  const directoryEntries = await readdir(resolvedDirectory, {
    withFileTypes: true,
  });
  const availableIds = new Set(
    directoryEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  const enabledSkills = [];
  for (const id of enabledIds) {
    if (!availableIds.has(id)) {
      throw new Error(`Enabled skill "${id}" does not have a directory`);
    }

    const skillDirectory = join(resolvedDirectory, id);
    const metadataLocation = join(skillDirectory, "skill.yaml");
    const metadata = parseSkillMetadata(
      await readFile(metadataLocation, "utf8"),
      metadataLocation,
    );
    if (metadata.id !== id) {
      throw new Error(
        `${metadataLocation}: id "${metadata.id}" must match directory "${id}"`,
      );
    }

    const instructions = (
      await readFile(join(skillDirectory, "SKILL.md"), "utf8")
    ).trim();
    if (instructions.length === 0 || instructions.length > 8_000) {
      throw new Error(
        `${join(skillDirectory, "SKILL.md")}: instructions must contain 1-8,000 characters`,
      );
    }

    enabledSkills.push({ ...metadata, instructions });
  }

  const profileContext = await readOptionalText(
    join(resolvedProfileDirectory, "compiled", "my-business.md"),
  );
  const globalSkills = enabledSkills.filter((skill) => skill.agent === "global");
  const globalSkillInstructions = joinBlocks(skillBlocks(globalSkills));
  const globalInstructions = joinBlocks([
    globalSkillInstructions,
    profileContext,
  ]);
  assertBounded(globalInstructions, "Global instructions");

  const agents = {};
  for (const agentId of AGENT_IDS) {
    const ownedSkills = enabledSkills.filter((skill) => skill.agent === agentId);
    const instructions = joinBlocks([
      globalSkillInstructions,
      ...skillBlocks(ownedSkills),
    ]);
    const settingsContext = await readOptionalText(
      join(
        resolvedProfileDirectory,
        "compiled",
        "agents",
        `${agentId}.md`,
      ),
    );
    // Business facts are deliberately repeated into every effective agent
    // context. That makes isolation auditable without relying on prompt code to
    // remember to add a separate global fragment at runtime.
    const context = joinBlocks([profileContext, settingsContext]);
    assertBounded(instructions, `${agentId} instructions`);
    assertBounded(context, `${agentId} context`);
    agents[agentId] = {
      skillIds: ownedSkills.map((skill) => skill.id),
      instructions,
      context,
    };
  }

  const canonicalBundle = {
    schemaVersion: 2,
    enabledSkills,
    globalInstructions,
    agents,
  };
  const sourceHash = createHash("sha256")
    .update(JSON.stringify(canonicalBundle))
    .digest("hex");

  return { ...canonicalBundle, sourceHash };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const skillsFlagIndex = process.argv.indexOf("--skills-dir");
  const profileFlagIndex = process.argv.indexOf("--profile-dir");
  const skillsDirectory =
    skillsFlagIndex >= 0
      ? process.argv[skillsFlagIndex + 1]
      : defaultSkillsDirectory;
  const profileDirectory =
    profileFlagIndex >= 0
      ? process.argv[profileFlagIndex + 1]
      : defaultProfileDirectory;

  if (skillsFlagIndex >= 0 && !skillsDirectory) {
    throw new Error("--skills-dir requires a directory");
  }
  if (profileFlagIndex >= 0 && !profileDirectory) {
    throw new Error("--profile-dir requires a directory");
  }

  process.stdout.write(
    `${JSON.stringify(await compileSkills(skillsDirectory, { profileDirectory }))}\n`,
  );
}
