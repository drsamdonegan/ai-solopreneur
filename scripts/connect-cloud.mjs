#!/usr/bin/env node
/**
 * Sets up a freshly deployed cloud agent: storage, two addresses, two
 * settings, and a redeploy.
 *
 * These are six clicks spread across three menus in a hosting dashboard, and
 * one of them is copying a web address out of one screen and into another,
 * which is where most people go wrong. Doing it through Railway's own CLI
 * makes it one command, and the address is read back and set automatically
 * rather than retyped.
 *
 * Two things are deliberately left to the learner: signing in, and choosing a
 * passcode. Neither should be typed by a program on their behalf, and neither
 * should end up in a transcript.
 *
 * Safe to run twice. Everything is checked before it is created.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const MOUNT_PATH = "/data";
const CHAT_PORT = 3_000;
const N8N_PORT = 5_678;
const MIN_PASSCODE_LENGTH = 8;

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message, ...lines) {
  process.stdout.write(`\nStopped.\n\n${message}\n`);
  if (lines.length > 0) {
    process.stdout.write(`\n${lines.join("\n")}\n`);
  }
  process.stdout.write("\n");
  process.exit(1);
}

function railway(args, { quiet = true } = {}) {
  return spawnSync("railway", args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function railwayOk(args) {
  const result = railway(args);
  return !result.error && result.status === 0;
}

/**
 * Railway has renamed a few commands across versions. Rather than pin to one
 * spelling and break for whoever has a different build installed, each is
 * tried until one works.
 */
function railwayFirstThatWorks(candidates, label) {
  for (const args of candidates) {
    const result = railway(args);
    if (!result.error && result.status === 0) {
      return result;
    }
  }
  fail(
    `${label} did not work with this version of the Railway command line.`,
    "Update it and try again:  npm i -g @railway/cli",
  );
  return null;
}

function jsonOr(args, fallback) {
  const result = railway(args);
  if (result.error || result.status !== 0) {
    return fallback;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fallback;
  }
}

/**
 * The learner's own repository, as owner/name. Read from git rather than asked
 * for, because it is already sitting there and typing it is a chance to get it
 * wrong.
 */
function githubRepo() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\s*$/.exec(result.stdout);
  return match === null ? null : `${match[1]}/${match[2]}`;
}

function askHidden(question) {
  return new Promise((done) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const mask = () => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`${question}${"*".repeat(rl.line.length)}`);
    };
    process.stdout.write(question);
    process.stdin.on("data", mask);
    rl.question("", (answer) => {
      process.stdin.off("data", mask);
      rl.close();
      process.stdout.write("\n");
      done(answer);
    });
  });
}

async function askPasscode() {
  print("Choose a passcode for your agent.");
  print("This is what stops anyone who finds your web address from opening it,");
  print("reading your conversations and spending your Claude credit.");
  print("");
  print(`At least ${MIN_PASSCODE_LENGTH} characters. Not one you use anywhere else.`);
  print("");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = await askHidden("Passcode:      ");
    if (first.length < MIN_PASSCODE_LENGTH) {
      print(`  Too short — use at least ${MIN_PASSCODE_LENGTH} characters.`);
      continue;
    }
    const second = await askHidden("Type it again: ");
    if (first !== second) {
      print("  Those did not match.");
      continue;
    }
    return first;
  }
  fail("The passcode was not confirmed after three tries.");
  return "";
}

/** Pulls a hostname out of whatever shape the installed CLI returns. */
function domainsFrom(payload) {
  const found = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const host = node.domain ?? node.host ?? node.url;
    if (typeof host === "string" && host.includes(".")) {
      found.push({
        host: host.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
        port: Number(node.targetPort ?? node.port ?? 0),
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(payload);
  return found;
}

async function main() {
  print("");
  print("Connecting your agent to the cloud.");
  print("");

  // --- the tool itself ---
  if (!railwayOk(["--version"])) {
    fail(
      "The Railway command line is not installed on this computer.",
      "Install it, then run this again:",
      "",
      "  macOS:    brew install railway",
      "  Windows:  npm i -g @railway/cli",
      "  Anything: npm i -g @railway/cli",
    );
  }

  // --- signing in is theirs to do ---
  if (!railwayOk(["whoami"])) {
    print("A browser window will open so you can sign in to Railway.");
    print("");
    railway(["login"], { quiet: false });
    if (!railwayOk(["whoami"])) {
      fail("You are still not signed in to Railway.", "Run `railway login` and try again.");
    }
  }
  const who = railway(["whoami"]).stdout.trim();
  print(`  Signed in: ${who}`);

  // --- which project ---
  if (!railwayOk(["status"])) {
    const repo = githubRepo();
    if (repo === null) {
      fail(
        "This folder is not connected to a repository on GitHub yet.",
        "Your agent has to live on GitHub before the cloud can run it, because",
        "the cloud reads your code from there every time you push a change.",
        "",
        "Push this folder to your own GitHub account, then run this again.",
      );
    }

    print("");
    print(`  Creating a cloud project for ${repo}...`);
    railwayFirstThatWorks(
      [
        ["init", "--name", "my-agent"],
        ["init", "-n", "my-agent"],
      ],
      "Creating the project",
    );

    // --repo keeps it connected to GitHub, which is what makes a push deploy
    // itself later. Uploading the folder instead would deploy once and then
    // never notice a change.
    railwayFirstThatWorks(
      [
        ["add", "--repo", repo],
        ["add", "-r", repo],
      ],
      "Connecting your repository",
    );
    print("  Project created and connected to your repository.");

    if (!railwayOk(["status"])) {
      fail("The project was created but is not linked.", "Run `railway link`, then run this again.");
    }
  }
  print("  Project linked.");
  print("");

  // --- storage ---
  const volumes = JSON.stringify(jsonOr(["volume", "list", "--json"], []));
  if (volumes.includes(MOUNT_PATH)) {
    print(`  Storage at ${MOUNT_PATH} is already there.`);
  } else {
    railwayFirstThatWorks(
      [
        ["volume", "add", "--mount-path", MOUNT_PATH],
        ["volume", "add", "-m", MOUNT_PATH],
      ],
      "Adding storage",
    );
    print(`  Storage added at ${MOUNT_PATH}.`);
  }

  // --- two addresses ---
  const existing = domainsFrom(jsonOr(["domain", "list", "--json"], {}));
  const findFor = (port) => existing.find((entry) => entry.port === port);

  for (const [port, label] of [
    [CHAT_PORT, "your agent"],
    [N8N_PORT, "your workshop"],
  ]) {
    if (findFor(port)) {
      print(`  Address for ${label} already exists.`);
      continue;
    }
    railwayFirstThatWorks(
      [
        ["domain", "--port", String(port)],
        ["domain", "-p", String(port)],
      ],
      `Creating the address for ${label}`,
    );
    print(`  Address created for ${label} (port ${port}).`);
  }

  const after = domainsFrom(jsonOr(["domain", "list", "--json"], {}));
  const chatHost = after.find((entry) => entry.port === CHAT_PORT)?.host;
  const n8nHost = after.find((entry) => entry.port === N8N_PORT)?.host;

  if (!n8nHost) {
    fail(
      "Your workshop address could not be read back, so it cannot be set for you.",
      "In your hosting dashboard, find the address pointing at port 5678 and add",
      "a variable named N8N_PUBLIC_URL set to it, then redeploy.",
    );
  }
  print("");

  // --- the two settings ---
  // Reading the address back and setting it here is the point of this script:
  // copying it by hand between two screens is where most people go wrong, and
  // a wrong value produces trigger addresses that look right and never fire.
  const passcode = await askPasscode();
  print("");

  const setVariable = (key, value) =>
    railwayFirstThatWorks(
      [
        ["variables", "--set", `${key}=${value}`],
        ["variable", "set", `${key}=${value}`],
        ["variables", "set", `${key}=${value}`],
      ],
      `Setting ${key}`,
    );

  setVariable("N8N_PUBLIC_URL", `https://${n8nHost}`);
  print(`  Workshop address set to https://${n8nHost}`);
  setVariable("AGENT_PASSCODE", passcode);
  print("  Passcode set.");

  // --- go ---
  print("");
  print("Starting your agent. This takes a few minutes.");
  railway(["redeploy", "--yes"], { quiet: false });

  print("");
  print("Done. Your agent has everything it needs.");
  print("");
  if (chatHost) {
    print(`  Your agent:    https://${chatHost}`);
  }
  print(`  Your workshop: https://${n8nHost}`);
  print("");
  print("Next: open your agent, sign in with the passcode you just chose, and");
  print("upload the file you made with `npm run pack`.");
  print("");
}

await main();
