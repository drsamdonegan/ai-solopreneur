import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  AgentDefinition,
  PublicAgentDefinition,
} from "./agents.js";
import { publicAgentDefinitions } from "./agents.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AGENT_IDS = new Set([
  "project-manager",
  "sales",
  "marketing",
  "investment",
  "bookkeeping",
  "global",
]);
const METADATA_KEYS = new Set([
  "id",
  "agent",
  "name",
  "version",
  "description",
]);

export interface InstalledSkillSummary {
  id: string;
  agent: string;
  name: string;
  version: string;
  description: string;
}

type ValidMetadata = Record<string, string> & {
  id: string;
  agent: string;
  name: string;
  version: string;
  description: string;
};

export interface AgentCardDefinition extends PublicAgentDefinition {
  skills: InstalledSkillSummary[];
  syncRequired: boolean;
}

function parseMetadata(source: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/.exec(line);
    const key = match?.[1];
    const rawValue = match?.[2];
    if (!key || rawValue === undefined || !METADATA_KEYS.has(key)) {
      throw new Error("unsupported skill metadata");
    }
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length === 0 || Object.hasOwn(metadata, key)) {
      throw new Error("empty or duplicate skill metadata");
    }
    metadata[key] = value;
  }
  return metadata;
}

function validMetadata(
  metadata: Record<string, string>,
  directoryName: string,
): metadata is ValidMetadata {
  const { id, agent, name, version, description } = metadata;
  return (
    id === directoryName &&
    typeof id === "string" &&
    ID_PATTERN.test(id) &&
    typeof agent === "string" &&
    AGENT_IDS.has(agent) &&
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 80 &&
    typeof version === "string" &&
    /^\d+\.\d+\.\d+$/.test(version) &&
    typeof description === "string" &&
    description.length >= 1 &&
    description.length <= 240
  );
}

export async function readInstalledSkills(
  skillsDirectory: string,
  logWarning: (message: string) => void = () => undefined,
): Promise<InstalledSkillSummary[]> {
  let warnings = 0;
  const warn = (message: string) => {
    if (warnings < 3) {
      logWarning(message);
    }
    warnings += 1;
  };

  let enabledSource: string;
  let entries: Dirent[];
  try {
    [enabledSource, entries] = await Promise.all([
      readFile(join(skillsDirectory, "enabled.txt"), "utf8"),
      readdir(skillsDirectory, { withFileTypes: true }),
    ]);
  } catch {
    return [];
  }

  const availableDirectories = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  const enabledIds = enabledSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const summaries: InstalledSkillSummary[] = [];

  for (const id of enabledIds) {
    // Never join an unchecked enabled-list value into a path. It must also be
    // a directory name returned by the filesystem enumeration above.
    if (!ID_PATTERN.test(id) || !availableDirectories.has(id)) {
      warn(`Skipped invalid or missing enabled skill "${id.slice(0, 80)}".`);
      continue;
    }
    try {
      const metadata = parseMetadata(
        await readFile(join(skillsDirectory, id, "skill.yaml"), "utf8"),
      );
      if (!validMetadata(metadata, id)) {
        throw new Error("invalid skill metadata");
      }
      summaries.push({
        id: metadata.id,
        agent: metadata.agent,
        name: metadata.name,
        version: metadata.version,
        description: metadata.description,
      });
    } catch {
      warn(`Skipped malformed enabled skill "${id}".`);
    }
  }
  return summaries;
}

async function currentSourceHash(
  skillsDirectory: string,
  profileDirectory: string,
): Promise<string | null> {
  try {
    const compilerPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../scripts/compile-skills.mjs",
    );
    const compiler = (await import(pathToFileURL(compilerPath).href)) as {
      compileSkills: (
        directory: string,
        options: { profileDirectory: string },
      ) => Promise<{ sourceHash: string }>;
    };
    const bundle = await compiler.compileSkills(skillsDirectory, {
      profileDirectory,
    });
    return /^[a-f0-9]{64}$/.test(bundle.sourceHash)
      ? bundle.sourceHash
      : null;
  } catch {
    return null;
  }
}

async function syncedSourceHash(profileDirectory: string): Promise<string | null> {
  try {
    const state = JSON.parse(
      await readFile(join(profileDirectory, "skill-sync.json"), "utf8"),
    );
    return state?.schemaVersion === 1 &&
      typeof state.sourceHash === "string" &&
      /^[a-f0-9]{64}$/.test(state.sourceHash)
      ? state.sourceHash
      : null;
  } catch {
    return null;
  }
}

export async function buildAgentCardDefinitions(
  agents: readonly AgentDefinition[],
  skillsDirectory: string,
  profileDirectory: string,
  logWarning: (message: string) => void = () => undefined,
): Promise<AgentCardDefinition[]> {
  const [skills, currentHash, syncedHash] = await Promise.all([
    readInstalledSkills(skillsDirectory, logWarning),
    currentSourceHash(skillsDirectory, profileDirectory),
    syncedSourceHash(profileDirectory),
  ]);
  const syncRequired = currentHash === null || currentHash !== syncedHash;
  return publicAgentDefinitions(agents).map((agent) => ({
    ...agent,
    skills: skills.filter((skill) => skill.agent === agent.id),
    syncRequired,
  }));
}
