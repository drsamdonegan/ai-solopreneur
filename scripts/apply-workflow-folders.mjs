import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Files the reviewed workflows into the skill folders a learner sees in n8n.
//
// The default n8n landing page is a flat list of every workflow, which reads to
// a beginner as sixteen unrelated things rather than five things their agent can
// do. n8n has folders, but it only draws them inside a project, so the grouping
// lives in the local owner's Personal project and the launcher points there.
//
// n8n has no CLI or offline API for folders, so this writes the two columns that
// matter straight to its SQLite file: a row per folder, and parentFolderId on
// each workflow. Both writes are idempotent, so re-running setup re-files the
// reviewed workflows without ever creating a second copy of a folder.
//
// Runs after import, with n8n up. SQLite is in WAL mode, so a short write from a
// second process is safe; the import step restarts n8n straight afterwards.

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const manifestPath = join(projectRoot, "n8n", "folders.manifest.json");
const workflowDirectory = join(projectRoot, "n8n", "workflows");
const defaultDatabasePath = join(
  projectRoot,
  "data",
  "n8n",
  ".n8n",
  "database.sqlite",
);

export async function readFolderManifest(path = manifestPath) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(manifest.folders) || manifest.folders.length === 0) {
    throw new Error(`${path}: needs a non-empty folders array`);
  }
  return manifest;
}

// n8n stores datetimes as 'YYYY-MM-DD HH:MM:SS.mmm' in local-agnostic UTC text.
function sqliteTimestamp(date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

async function workflowIdsByFile() {
  const manifest = await readFolderManifest();
  const resolved = [];
  for (const folder of manifest.folders) {
    for (const file of folder.workflows) {
      const path = join(workflowDirectory, file);
      if (!existsSync(path)) {
        // An optional skill that was never installed. Not an error.
        continue;
      }
      const workflow = JSON.parse(await readFile(path, "utf8"));
      if (!workflow.id) {
        throw new Error(`${file}: has no workflow id to file into a folder`);
      }
      resolved.push({ folderId: folder.id, workflowId: workflow.id });
    }
  }
  return { manifest, resolved };
}

// Folders are a licensed n8n feature. On an unlicensed instance the folder rows
// exist but the UI never draws them, and the project page still asks the API for
// "workflows whose parentFolderId is null" — so filing a workflow into a folder
// there does not group it, it hides it. Never write folders without a licence.
function foldersAreLicensed(database) {
  const cert = database
    .prepare("SELECT value FROM settings WHERE key = 'license.cert'")
    .get();
  return Boolean(cert?.value);
}

export async function applyWorkflowFolders({
  databasePath = defaultDatabasePath,
  undo = false,
} = {}) {
  if (!existsSync(databasePath)) {
    return { skipped: "no-database" };
  }

  const { manifest, resolved } = await workflowIdsByFile();
  // Loaded here rather than at the top so that validate-workflows.mjs, which
  // only wants the manifest reader, never triggers the experimental warning.
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 10000");

    if (undo) {
      return { ...unfileEverything(database, manifest), undone: true };
    }

    if (!foldersAreLicensed(database)) {
      return { skipped: "folders-not-licensed" };
    }

    const project = database
      .prepare(
        "SELECT id FROM project WHERE type = 'personal' ORDER BY createdAt ASC LIMIT 1",
      )
      .get();
    if (!project) {
      return { skipped: "no-personal-project" };
    }

    // Newest first, one second apart, so the folders read in the intended order
    // under both "sort by name" and n8n's default "sort by last updated".
    const now = Date.now();
    const upsertFolder = database.prepare(
      `INSERT INTO folder (id, name, parentFolderId, projectId, createdAt, updatedAt)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, projectId = excluded.projectId`,
    );
    const fileWorkflow = database.prepare(
      "UPDATE workflow_entity SET parentFolderId = ? WHERE id = ?",
    );

    database.exec("BEGIN");
    try {
      manifest.folders.forEach((folder, index) => {
        const stamp = sqliteTimestamp(new Date(now - index * 1_000));
        upsertFolder.run(folder.id, folder.name, project.id, stamp, stamp);
      });

      let filed = 0;
      let missing = 0;
      for (const { folderId, workflowId } of resolved) {
        const result = fileWorkflow.run(folderId, workflowId);
        if (result.changes > 0) {
          filed += 1;
        } else {
          missing += 1;
        }
      }
      database.exec("COMMIT");
      return {
        projectId: project.id,
        folders: manifest.folders.length,
        filed,
        missing,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

// Puts every workflow back at the top level and removes the skill folders, so a
// learner whose n8n stops reporting a folder licence can always see their
// workflows again.
//
// Order matters: folder.id is a foreign key on workflow_entity with ON DELETE
// CASCADE, so deleting a folder first would take its workflows with it. Clear
// the references, then delete.
function unfileEverything(database, manifest) {
  const ids = manifest.folders.map((folder) => folder.id);
  const placeholders = ids.map(() => "?").join(", ");
  database.exec("BEGIN");
  try {
    const cleared = database
      .prepare(
        `UPDATE workflow_entity SET parentFolderId = NULL WHERE parentFolderId IN (${placeholders})`,
      )
      .run(...ids);
    const removed = database
      .prepare(`DELETE FROM folder WHERE id IN (${placeholders})`)
      .run(...ids);
    database.exec("COMMIT");
    return { unfiled: cleared.changes, removed: removed.changes };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseDatabaseFlag(argv) {
  const flag = argv.find((argument) => argument.startsWith("--database="));
  return flag ? flag.slice("--database=".length) : defaultDatabasePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const result = await applyWorkflowFolders({
    databasePath: parseDatabaseFlag(argv),
    undo: argv.includes("--undo"),
  });
  if (result.undone) {
    console.log(
      `Moved ${result.unfiled} workflows back to the top level and removed ${result.removed} skill folders.`,
    );
  } else if (result.skipped === "no-database") {
    console.log("No local n8n data yet, so there is nothing to group.");
  } else if (result.skipped === "folders-not-licensed") {
    console.log(
      "This n8n has no folder licence, so the workflows were left ungrouped.",
    );
    console.log(
      "Register the free community edition in n8n first; grouping without it would hide them.",
    );
  } else if (result.skipped === "no-personal-project") {
    console.log("n8n has no owner account yet, so there is nothing to group.");
  } else {
    console.log(
      `Grouped ${result.filed} workflows into ${result.folders} skill folders.`,
    );
    if (result.missing > 0) {
      console.log(
        `${result.missing} reviewed workflows are not installed yet and were left alone.`,
      );
    }
  }
  // Exit 3 means "nothing was wrong, but nothing was grouped either", so the
  // caller can stay quiet about skill folders instead of promising them.
  if (result.skipped) {
    process.exit(3);
  }
}
