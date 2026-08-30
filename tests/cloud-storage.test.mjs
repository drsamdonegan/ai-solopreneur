import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureN8nEphemeralCache } from "../scripts/cloud-storage.mjs";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
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

rmSync(fixture, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Cloud n8n cache relocation checks passed.");
