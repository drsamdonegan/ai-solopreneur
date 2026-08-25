import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultSkillPacksDirectory = join(projectRoot, "skill-packs");

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AGENTS = new Set([
  "project-manager",
  "sales",
  "marketing",
  "investment",
  "bookkeeping",
]);
const ICONS = new Set([
  "article",
  "calendar",
  "checklist",
  "globe",
  "grant",
  "ledger",
  "profile",
  "search",
]);
const MODULE_ROLES = new Set(["core", "extension"]);
const MODULE_SOURCES = new Set(["base", "optional"]);

function boundedText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validatePack(pack, directoryName, path) {
  if (
    pack?.schemaVersion !== 1 ||
    pack.id !== directoryName ||
    !ID_PATTERN.test(pack.id ?? "") ||
    !AGENTS.has(pack.agent) ||
    !boundedText(pack.name, 80) ||
    !boundedText(pack.description, 240) ||
    !ICONS.has(pack.icon) ||
    typeof pack.installable !== "boolean" ||
    !Array.isArray(pack.requires) ||
    !Array.isArray(pack.modules) ||
    pack.modules.length === 0
  ) {
    throw new Error(`${path}: invalid skill-package metadata`);
  }

  if (
    pack.requires.some((id) => typeof id !== "string" || !ID_PATTERN.test(id)) ||
    new Set(pack.requires).size !== pack.requires.length
  ) {
    throw new Error(`${path}: requires must contain unique package IDs`);
  }

  const moduleIds = new Set();
  let coreCount = 0;
  for (const module of pack.modules) {
    if (
      !module ||
      typeof module.id !== "string" ||
      !ID_PATTERN.test(module.id) ||
      moduleIds.has(module.id) ||
      !boundedText(module.name, 80) ||
      !MODULE_ROLES.has(module.role) ||
      !MODULE_SOURCES.has(module.source)
    ) {
      throw new Error(`${path}: invalid or duplicate module entry`);
    }
    moduleIds.add(module.id);
    if (module.role === "core") coreCount += 1;
  }
  if (coreCount === 0) {
    throw new Error(`${path}: every package needs at least one core module`);
  }
  return {
    schemaVersion: 1,
    id: pack.id,
    agent: pack.agent,
    name: pack.name.trim(),
    description: pack.description.trim(),
    icon: pack.icon,
    installable: pack.installable,
    requires: [...pack.requires],
    modules: pack.modules.map((module) => ({ ...module, name: module.name.trim() })),
  };
}

export async function loadSkillPacks(directory = defaultSkillPacksDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const packs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const path = join(directory, entry.name, "pack.json");
    const source = JSON.parse(await readFile(path, "utf8"));
    packs.push(validatePack(source, entry.name, path));
  }
  packs.sort((left, right) => left.id.localeCompare(right.id));

  const ids = new Set(packs.map((pack) => pack.id));
  if (ids.size !== packs.length) {
    throw new Error(`${directory}: duplicate package IDs`);
  }
  for (const pack of packs) {
    for (const requirement of pack.requires) {
      if (!ids.has(requirement) || requirement === pack.id) {
        throw new Error(`${directory}: ${pack.id} requires unknown package ${requirement}`);
      }
    }
  }

  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const complete = new Set();
  const visiting = new Set();
  function visit(id) {
    if (complete.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`${directory}: cyclic package dependency at ${id}`);
    }
    visiting.add(id);
    for (const requirement of byId.get(id).requires) visit(requirement);
    visiting.delete(id);
    complete.add(id);
  }
  for (const pack of packs) visit(pack.id);
  return packs;
}

export function moduleIdsForPackage(pack, { includeExtensions = false } = {}) {
  return pack.modules
    .filter((module) => includeExtensions || module.role === "core")
    .map((module) => module.id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packs = await loadSkillPacks(process.argv[2] || defaultSkillPacksDirectory);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, packages: packs }, null, 2)}\n`);
}
