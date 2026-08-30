import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
