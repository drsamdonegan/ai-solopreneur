import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export async function writeSkillSyncState(profileDirectory, sourceHash) {
  if (!HASH_PATTERN.test(sourceHash)) {
    throw new Error("Cannot record an invalid skill source hash.");
  }
  await mkdir(profileDirectory, { recursive: true });
  const target = join(profileDirectory, "skill-sync.json");
  const temporary = `${target}.tmp`;
  const state = {
    schemaVersion: 1,
    sourceHash,
    syncedAt: new Date().toISOString(),
  };
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return state;
}

export async function readSkillSyncState(profileDirectory) {
  try {
    const state = JSON.parse(
      await readFile(join(profileDirectory, "skill-sync.json"), "utf8"),
    );
    if (
      state?.schemaVersion === 1 &&
      HASH_PATTERN.test(state.sourceHash) &&
      typeof state.syncedAt === "string"
    ) {
      return state;
    }
  } catch {
    // Missing or malformed sync state means the on-disk context is not proven
    // to match n8n. Callers report syncRequired rather than guessing.
  }
  return null;
}
