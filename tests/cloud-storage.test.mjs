import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  compactN8nSqliteDatabase,
  ensureN8nEphemeralCache,
} from "../scripts/cloud-storage.mjs";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const lstatIfPresentForTest = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const fixture = mkdtempSync(join(tmpdir(), "cloud-storage-test-"));
const persistentRoot = join(fixture, "persistent");
const persistentCacheDir = join(persistentRoot, "n8n", ".cache");
const ephemeralCacheDir = join(fixture, "ephemeral", "n8n-cache");

mkdirSync(join(persistentCacheDir, "n8n", "public"), { recursive: true });
writeFileSync(join(persistentCacheDir, "n8n", "public", "old.js"), "generated");

const first = ensureN8nEphemeralCache({
  persistentRoot,
  persistentCacheDir,
  ephemeralCacheDir,
});
check(first.changed, "a generated persistent cache is replaced on first run");
check(lstatSync(persistentCacheDir).isSymbolicLink(), "the persistent cache path becomes a symlink");
check(
  resolve(join(persistentCacheDir, ".."), readlinkSync(persistentCacheDir)) ===
    resolve(ephemeralCacheDir),
  "the symlink targets the ephemeral cache",
);

mkdirSync(join(persistentCacheDir, "n8n", "public"), { recursive: true });
writeFileSync(join(persistentCacheDir, "n8n", "public", "fresh.js"), "fresh");
check(
  readFileSync(join(ephemeralCacheDir, "n8n", "public", "fresh.js"), "utf8") ===
    "fresh",
  "writes through n8n's normal cache path land on ephemeral storage",
);

const second = ensureN8nEphemeralCache({
  persistentRoot,
  persistentCacheDir,
  ephemeralCacheDir,
});
check(!second.changed, "repeated startup leaves the correct symlink in place");

const foreignTarget = join(fixture, "foreign-cache");
unlinkSync(persistentCacheDir);
mkdirSync(foreignTarget, { recursive: true });
writeFileSync(join(foreignTarget, "owned-elsewhere"), "keep");
symlinkSync(foreignTarget, persistentCacheDir, "dir");
ensureN8nEphemeralCache({
  persistentRoot,
  persistentCacheDir,
  ephemeralCacheDir,
});
check(
  readFileSync(join(foreignTarget, "owned-elsewhere"), "utf8") === "keep",
  "replacing a foreign cache symlink never deletes its target",
);

let rejectedPersistentEphemeral = false;
try {
  ensureN8nEphemeralCache({
    persistentRoot,
    persistentCacheDir,
    ephemeralCacheDir: join(persistentRoot, "temporary-cache"),
  });
} catch {
  rejectedPersistentEphemeral = true;
}
check(
  rejectedPersistentEphemeral,
  "an ephemeral cache configured inside the persistent volume is rejected",
);

const cloudSupervisor = readFileSync(
  new URL("../scripts/cloud.mjs", import.meta.url),
  "utf8",
);
for (const variable of [
  "EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL",
  "EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL",
  "EXECUTIONS_DATA_HARD_DELETE_BUFFER",
]) {
  check(
    cloudSupervisor.includes(variable),
    `${variable} is explicitly bounded for small cloud volumes`,
  );
}

const sqliteDirectory = join(fixture, "sqlite");
const sqlitePath = join(sqliteDirectory, "database.sqlite");
mkdirSync(sqliteDirectory, { recursive: true });
const sqlite = new DatabaseSync(sqlitePath);
sqlite.exec("CREATE TABLE preserved (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
const insert = sqlite.prepare("INSERT INTO preserved (payload) VALUES (?)");
for (let index = 0; index < 1_200; index += 1) {
  insert.run(`${index}:` + "generated history ".repeat(180));
}
sqlite.exec("DELETE FROM preserved WHERE id <= 1100");
sqlite.close();
const sqliteBefore = lstatSync(sqlitePath).size;
writeFileSync(join(sqliteDirectory, "n8nEventLog-1.log"), "rotated");
writeFileSync(join(sqliteDirectory, "n8nEventLog.log"), "current");

const compacted = compactN8nSqliteDatabase({
  databasePath: sqlitePath,
  minBytes: 0,
  minFreeRatio: 0,
});
check(compacted.compacted, "a sparse stopped n8n database is compacted");
check(
  lstatSync(sqlitePath).size < sqliteBefore,
  "compaction releases physical database bytes",
);
const compactedDb = new DatabaseSync(sqlitePath, { readOnly: true });
check(
  compactedDb.prepare("PRAGMA quick_check").get().quick_check === "ok" &&
    compactedDb.prepare("SELECT COUNT(*) AS count FROM preserved").get().count === 100,
  "the compacted database is valid and preserves every retained row",
);
compactedDb.close();
check(
  !lstatIfPresentForTest(join(sqliteDirectory, "n8nEventLog-1.log")) &&
    readFileSync(join(sqliteDirectory, "n8nEventLog.log"), "utf8") === "current",
  "only rotated n8n event logs are removed to make compaction headroom",
);
check(
  !lstatIfPresentForTest(`${sqlitePath}.compact`) &&
    !lstatIfPresentForTest(`${sqlitePath}.precompact`),
  "successful compaction leaves no swap files behind",
);

copyFileSync(sqlitePath, `${sqlitePath}.precompact`);
const recovered = compactN8nSqliteDatabase({
  databasePath: sqlitePath,
  minBytes: Number.MAX_SAFE_INTEGER,
});
check(
  recovered.reason === "below-threshold" &&
    !lstatIfPresentForTest(`${sqlitePath}.precompact`),
  "startup removes a leftover backup after proving the main database is valid",
);

rmSync(fixture, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Cloud n8n cache relocation checks passed.");
