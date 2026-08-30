import {
  chmodSync,
  chownSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function pathIsInside(candidate, parent) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Keep n8n's generated editor cache away from the persistent volume.
 *
 * n8n derives `.cache/n8n/public` from N8N_USER_FOLDER. The user folder must
 * remain persistent because it also contains credentials and the database,
 * but the editor cache is rebuilt from the installed package on every start.
 * A symlink lets n8n keep its expected path while the bytes live on the
 * container's disposable filesystem.
 */
export function ensureN8nEphemeralCache({
  persistentRoot,
  persistentCacheDir,
  ephemeralCacheDir,
}) {
  const root = resolve(persistentRoot);
  const cacheLink = resolve(persistentCacheDir);
  const ephemeral = resolve(ephemeralCacheDir);

  if (!pathIsInside(cacheLink, root)) {
    throw new Error("The n8n cache link must be inside the persistent root.");
  }
  if (pathIsInside(ephemeral, root)) {
    throw new Error("The n8n ephemeral cache must be outside the persistent root.");
  }

  mkdirSync(ephemeral, { recursive: true });
  mkdirSync(dirname(cacheLink), { recursive: true });

  const existing = lstatIfPresent(cacheLink);
  if (existing?.isSymbolicLink()) {
    const currentTarget = resolve(dirname(cacheLink), readlinkSync(cacheLink));
    if (currentTarget === ephemeral) {
      return { changed: false, cacheLink, ephemeral };
    }
    // Remove the link itself only. A pre-existing target may contain data that
    // does not belong to this process.
    unlinkSync(cacheLink);
  } else if (existing) {
    // `.cache` is generated n8n UI/type data, never credentials, workflows or
    // execution history. Removing it is safe and immediately recoverable.
    rmSync(cacheLink, { recursive: true, force: true });
  }

  symlinkSync(ephemeral, cacheLink, "dir");
  return { changed: true, cacheLink, ephemeral };
}

function unlinkIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function syncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseSnapshot(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA quick_check").get()?.quick_check;
    if (integrity !== "ok") {
      throw new Error(`SQLite integrity check returned ${String(integrity)}.`);
    }
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema " +
          "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const rowCounts = Object.fromEntries(
      tables.map(({ name }) => [
        name,
        database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get()
          .count,
      ]),
    );
    return { integrity, rowCounts };
  } finally {
    database.close();
  }
}

function sameRowCounts(left, right) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([name, count]) => right[name] === count)
  );
}

function validDatabase(path) {
  try {
    return databaseSnapshot(path);
  } catch {
    return null;
  }
}

/** Recover an interrupted atomic swap before deciding whether to compact. */
function recoverCompactionFiles(databasePath) {
  const compactPath = `${databasePath}.compact`;
  const backupPath = `${databasePath}.precompact`;
  const main = validDatabase(databasePath);
  const backup = validDatabase(backupPath);
  const compact = validDatabase(compactPath);

  if (main) {
    unlinkIfPresent(backupPath);
    unlinkIfPresent(compactPath);
    return;
  }
  if (backup) {
    unlinkIfPresent(databasePath);
    renameSync(backupPath, databasePath);
    unlinkIfPresent(compactPath);
    syncDirectory(dirname(databasePath));
    return;
  }
  if (compact) {
    unlinkIfPresent(databasePath);
    renameSync(compactPath, databasePath);
    unlinkIfPresent(backupPath);
    syncDirectory(dirname(databasePath));
    return;
  }
  if (
    lstatIfPresent(databasePath) ||
    lstatIfPresent(backupPath) ||
    lstatIfPresent(compactPath)
  ) {
    throw new Error("No valid n8n database remained after an interrupted compaction.");
  }
}

function removeRotatedEventLogs(logDirectory) {
  let removedBytes = 0;
  for (const entry of readdirSync(logDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^n8nEventLog-\d+\.log$/.test(entry.name)) continue;
    const path = resolve(logDirectory, entry.name);
    removedBytes += statSync(path).size;
    unlinkSync(path);
  }
  return removedBytes;
}

/**
 * Compact a stopped n8n SQLite database when free pages dominate the file.
 *
 * The compact copy is created beside the original, checked table-by-table,
 * and swapped with same-filesystem renames. A retained original makes every
 * interruption recoverable on the next start until the new file is verified.
 */
export function compactN8nSqliteDatabase({
  databasePath,
  logDirectory = dirname(databasePath),
  minBytes = 128 * 1024 * 1024,
  minFreeRatio = 0.35,
  reserveBytes = 4 * 1024 * 1024,
}) {
  const sourcePath = resolve(databasePath);
  if (!lstatIfPresent(sourcePath)) return { compacted: false, reason: "missing" };

  recoverCompactionFiles(sourcePath);
  const compactPath = `${sourcePath}.compact`;
  const backupPath = `${sourcePath}.precompact`;
  const originalStat = statSync(sourcePath);
  const source = new DatabaseSync(sourcePath);

  try {
    source.exec("PRAGMA busy_timeout = 15000");
    source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const pageSize = source.prepare("PRAGMA page_size").get().page_size;
    const pageCount = source.prepare("PRAGMA page_count").get().page_count;
    const freePages = source.prepare("PRAGMA freelist_count").get().freelist_count;
    const freeRatio = pageCount === 0 ? 0 : freePages / pageCount;

    if (originalStat.size < minBytes || freeRatio < minFreeRatio) {
      return { compacted: false, reason: "below-threshold", freeRatio };
    }

    const before = databaseSnapshot(sourcePath);
    const removedLogBytes = removeRotatedEventLogs(logDirectory);
    const fileSystem = statfsSync(dirname(sourcePath));
    const availableBytes = fileSystem.bavail * fileSystem.bsize;
    const estimatedBytes = (pageCount - freePages) * pageSize + reserveBytes;
    if (availableBytes < estimatedBytes) {
      return {
        compacted: false,
        reason: "insufficient-space",
        availableBytes,
        estimatedBytes,
        removedLogBytes,
      };
    }

    unlinkIfPresent(compactPath);
    source.exec(`VACUUM INTO ${quoteSqlString(compactPath)}`);
    const compact = databaseSnapshot(compactPath);
    if (!sameRowCounts(before.rowCounts, compact.rowCounts)) {
      throw new Error("Compacted n8n database did not preserve every table row count.");
    }
  } finally {
    source.close();
  }

  chmodSync(compactPath, originalStat.mode & 0o777);
  chownSync(compactPath, originalStat.uid, originalStat.gid);
  unlinkIfPresent(`${sourcePath}-wal`);
  unlinkIfPresent(`${sourcePath}-shm`);

  renameSync(sourcePath, backupPath);
  try {
    renameSync(compactPath, sourcePath);
    syncDirectory(dirname(sourcePath));
    const original = databaseSnapshot(backupPath);
    const replacement = databaseSnapshot(sourcePath);
    if (!sameRowCounts(original.rowCounts, replacement.rowCounts)) {
      throw new Error("Installed n8n database did not preserve every table row count.");
    }
  } catch (error) {
    unlinkIfPresent(sourcePath);
    renameSync(backupPath, sourcePath);
    syncDirectory(dirname(sourcePath));
    throw error;
  }

  const compactedBytes = statSync(sourcePath).size;
  unlinkIfPresent(backupPath);
  syncDirectory(dirname(sourcePath));
  return {
    compacted: true,
    beforeBytes: originalStat.size,
    afterBytes: compactedBytes,
  };
}
