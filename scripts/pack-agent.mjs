#!/usr/bin/env node
/**
 * Packs a learner's agent into one encrypted file they can upload to the cloud.
 *
 * Run with `npm run pack`. The agent can stay running: both databases are
 * copied with SQLite's own VACUUM INTO, which takes a consistent snapshot
 * without stopping anything.
 */

import { createInterface } from "node:readline";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPack,
  MIN_PASSPHRASE_LENGTH,
  PACK_EXTENSION,
  PackError,
} from "./agent-pack.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const paths = {
  n8nDatabase: join(projectRoot, "data", "n8n", ".n8n", "database.sqlite"),
  n8nConfig: join(projectRoot, "data", "n8n", ".n8n", "config"),
  chatDatabase: join(projectRoot, "data", "chat", "chat.sqlite"),
  profileDir: join(projectRoot, "data", "profile"),
  skillsDir: join(projectRoot, "skills"),
  outputDir: join(projectRoot, "backups"),
};

/**
 * Execution history is the bulk of an n8n database and is worth nothing in the
 * cloud: it is a log of runs that already happened on a different machine.
 * Credentials, workflows, data tables and settings all stay.
 */
const EXECUTION_TABLES = [
  "execution_data",
  "execution_metadata",
  "execution_annotation_tags",
  "execution_annotations",
  "execution_entity",
];

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message, ...lines) {
  process.stdout.write(`\nCould not pack your agent.\n\n${message}\n`);
  if (lines.length > 0) {
    process.stdout.write(`\n${lines.join("\n")}\n`);
  }
  process.stdout.write("\n");
  process.exit(1);
}

function humanSize(bytes) {
  return bytes < 1_048_576
    ? `${Math.max(1, Math.round(bytes / 1_024))} KB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Passphrase entry
// ---------------------------------------------------------------------------

function askHidden(question) {
  return new Promise((done) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Replace the echo so the passphrase never appears on screen or in a
    // scrollback buffer someone else might read.
    const onKeypress = (chunk) => {
      // Enter arrives here too, and by then readline has already emptied the
      // line — so redrawing would print the question again with no asterisks
      // after it, which reads as being asked the same thing twice.
      if (chunk && /[\r\n]/.test(String(chunk))) {
        return;
      }
      const written = rl.line.length;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`${question}${"*".repeat(written)}`);
    };
    process.stdout.write(question);
    process.stdin.on("data", onKeypress);
    rl.question("", (answer) => {
      process.stdin.off("data", onKeypress);
      rl.close();
      process.stdout.write("\n");
      done(answer);
    });
  });
}

async function askPassphrase() {
  if (!process.stdin.isTTY) {
    const fromEnv = process.env.AGENT_PACK_PASSPHRASE ?? "";
    if (fromEnv.length >= MIN_PASSPHRASE_LENGTH) {
      return fromEnv;
    }
    fail(
      "This needs to be run in a terminal so you can type a passphrase.",
      "Double-click the pack helper, or run `npm run pack` in a terminal.",
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = await askHidden("Choose a passphrase: ");
    if (first.length < MIN_PASSPHRASE_LENGTH) {
      print(
        `  Too short. Use at least ${MIN_PASSPHRASE_LENGTH} characters — a short sentence works well.`,
      );
      continue;
    }
    const second = await askHidden("Type it again:      ");
    if (first !== second) {
      print("  Those did not match. Try again.");
      continue;
    }
    return first;
  }
  fail("The passphrase was not confirmed after three tries.");
  return "";
}

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

function snapshotDatabase(source, destination) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    // VACUUM INTO writes a consistent copy even while the agent is running and
    // mid-write, which is why nothing has to be stopped first.
    db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}

function pruneExecutions(databasePath) {
  const db = new DatabaseSync(databasePath);
  let removed = 0;
  try {
    try {
      removed = db.prepare("SELECT count(*) n FROM execution_entity").get().n;
    } catch {
      removed = 0;
    }
    for (const table of EXECUTION_TABLES) {
      try {
        db.exec(`DELETE FROM ${table}`);
      } catch {
        // Table absent in this n8n version. The rest still applies.
      }
    }
    db.exec("VACUUM");
  } finally {
    db.close();
  }
  return removed;
}

function collectDirectory(directory, prefix, entries) {
  if (!existsSync(directory)) {
    return;
  }
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, item.name);
    if (item.isDirectory()) {
      collectDirectory(absolute, prefix, entries);
      continue;
    }
    if (!item.isFile()) {
      continue;
    }
    entries.push({
      path: `${prefix}/${relative(directory, absolute).split(sep).join("/")}`,
      mode: 0o600,
      data: readFileSync(absolute),
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  print("Packing your agent for the cloud.");
  print("");

  if (!existsSync(paths.n8nDatabase)) {
    fail(
      "There is no agent on this computer to pack yet.",
      "Run `npm run setup`, start your agent once, then try again.",
    );
  }
  if (!existsSync(paths.n8nConfig)) {
    fail(
      "Your agent's credential key is missing, so its saved credentials could not be moved.",
      "Start your agent once and try again.",
    );
  }

  const staging = mkdtempSync(join(tmpdir(), "agent-pack-"));
  const entries = [];
  let removedExecutions = 0;

  try {
    print("  Copying your workshop, credentials and workflows...");
    const n8nSnapshot = join(staging, "database.sqlite");
    snapshotDatabase(paths.n8nDatabase, n8nSnapshot);
    removedExecutions = pruneExecutions(n8nSnapshot);
    entries.push({
      path: "n8n/database.sqlite",
      mode: 0o600,
      data: readFileSync(n8nSnapshot),
    });

    // Without this the database is unreadable: it is what decrypts every
    // credential inside it.
    entries.push({
      path: "n8n/config",
      mode: 0o600,
      data: readFileSync(paths.n8nConfig),
    });

    if (existsSync(paths.chatDatabase)) {
      print("  Copying your conversations and business memory...");
      const chatSnapshot = join(staging, "chat.sqlite");
      snapshotDatabase(paths.chatDatabase, chatSnapshot);
      entries.push({
        path: "chat/chat.sqlite",
        mode: 0o600,
        data: readFileSync(chatSnapshot),
      });
    }

    print("  Copying your business facts and skills...");
    collectDirectory(paths.profileDir, "profile", entries);
    collectDirectory(paths.skillsDir, "skills", entries);
  } catch (error) {
    fail("Something went wrong while copying your agent.", String(error));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const rawBytes = entries.reduce((total, entry) => total + entry.data.length, 0);
  print("");
  print(`  ${entries.length} files, ${humanSize(rawBytes)} before compression.`);
  if (removedExecutions > 0) {
    print(
      `  Left behind ${removedExecutions} past runs, which belong to this computer.`,
    );
  }
  print("");
  print("Choose a passphrase for this file.");
  print("You will type it once more when you upload the file to the cloud.");
  print("If you lose it, the file cannot be opened by anyone, including you.");
  print("");

  const passphrase = await askPassphrase();

  print("");
  print("  Locking the file...");

  let pack;
  try {
    pack = createPack({
      entries,
      passphrase,
      metadata: {
        createdAt: new Date().toISOString(),
        fileCount: entries.length,
        contains: {
          credentialsAndWorkflows: true,
          conversations: entries.some((entry) => entry.path.startsWith("chat/")),
          businessFacts: entries.some((entry) =>
            entry.path.startsWith("profile/"),
          ),
          skills: entries.some((entry) => entry.path.startsWith("skills/")),
        },
      },
    });
  } catch (error) {
    fail(
      error instanceof PackError
        ? error.message
        : "The file could not be locked.",
    );
  }

  mkdirSync(paths.outputDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, "-");
  const output = join(paths.outputDir, `my-agent-${stamp}${PACK_EXTENSION}`);
  writeFileSync(output, pack, { mode: 0o600 });

  print("");
  print("Done. Your agent is packed.");
  print("");
  print(`  ${output}`);
  print(`  ${humanSize(statSync(output).size)}`);
  print("");
  // Same reason as the connector: the agent in the other window is running this
  // sequence and will hand over the address and the path. One next step, not two.
  print("Now go back to Claude Code and type:   packed");
  print("");
  print("It gives you your agent's address and walks you through the upload.");
  print("");
  print("Working without Claude Code? Open your agent's web address, choose");
  print("this file when it asks for your agent pack, and type the passphrase");
  print("you just chose.");
  print("");
  print("This file holds your API keys. Do not email it and do not put it in");
  print("Dropbox or Google Drive. Leave it in backups/, which is already kept");
  print("out of GitHub for you.");
  print("");
  print("Keep it after your cloud agent is working. It is your only copy if");
  print("the cloud one ever goes away.");
  print("");
}

await main();
