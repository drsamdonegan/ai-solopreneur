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
 * Runs a Railway command with a value fed to its standard input, so the value
 * never appears in the process arguments. Returns whether it worked.
 */
function railwayStdin(args, value) {
  const result = spawnSync("railway", args, {
    encoding: "utf8",
    input: value,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return !result.error && result.status === 0;
}

/**
 * Railway has renamed a few commands across versions. Rather than pin to one
 * spelling and break for whoever has a different build installed, each is
 * tried until one works.
 *
 * When none of them work, Railway's own message is what gets shown. An earlier
 * version of this said "update the command line" for every failure, which sent
 * people off to reinstall a tool that was already current while the real
 * reason — a plan limit, a name already taken, a signed-out session — stayed
 * hidden in a captured stream.
 */
function railwayFirstThatWorks(candidates, label) {
  let last = null;
  for (const args of candidates) {
    const result = railway(args);
    if (!result.error && result.status === 0) {
      return result;
    }
    last = result;
  }

  const detail = [last?.stderr, last?.stdout]
    .map((stream) => (typeof stream === "string" ? stream.trim() : ""))
    .filter((stream) => stream.length > 0)
    .join("\n")
    .split("\n")
    // The CLI echoes the answers it picked for its own prompts. They are noise
    // here, and they look like progress rather than the failure they precede.
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();

  fail(
    `${label} did not work.`,
    detail.length > 0 ? `Railway said:\n\n  ${detail.replace(/\n/g, "\n  ")}` : "Railway gave no reason.",
    "",
    "That message is from Railway, not from this project. If it mentions a",
    "plan or a limit, it is about your Railway account rather than anything",
    "on this computer.",
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
 * Every Railway command here runs with its output captured, which means it has
 * no terminal to ask questions with. Asked to choose a workspace or a service
 * without one, the CLI does not explain itself: it fails with whatever error
 * it was holding, which in testing was a message about plan limits on an
 * account nowhere near its limit.
 *
 * `--json` is the CLI's own switch for running unattended, so it goes on
 * everything, and the answers it would have asked for are passed in as flags.
 */
function automated(args) {
  return args.includes("--json") ? args : [...args, "--json"];
}

/** The workspace to build in, so the CLI never has to ask which one. */
function workspaceId() {
  const who = jsonOr(["whoami", "--json"], null);
  const workspaces = Array.isArray(who?.workspaces) ? who.workspaces : [];
  if (workspaces.length === 0) {
    return null;
  }
  return workspaces[0].id ?? null;
}

/** The services on a project, as {id, name}, from Railway's edges-and-nodes shape. */
function servicesOf(project) {
  const edges = project?.services?.edges;
  if (!Array.isArray(edges)) {
    return [];
  }
  return edges
    .map((edge) => edge?.node)
    .filter((node) => typeof node?.name === "string")
    .map((node) => ({ id: node.id, name: node.name }));
}

/** Every project on the account that has not been deleted. */
function liveProjects() {
  const projects = jsonOr(["list", "--json"], []);
  return Array.isArray(projects) ? projects.filter((project) => !project.deletedAt) : [];
}

/**
 * The service storage, addresses and settings attach to. These hang off a
 * service rather than off the project, so naming it means the CLI never has to
 * ask which one.
 */
function serviceName() {
  const linked = jsonOr(["status", "--json"], null);
  const direct = servicesOf(linked);
  if (direct.length > 0) {
    return direct[0].name;
  }
  // `status` reports the linked project by id; find it in the project list.
  const id = linked?.id ?? linked?.project?.id;
  const match = liveProjects().find((project) => project.id === id);
  return servicesOf(match)[0]?.name ?? null;
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
  // Without a real terminal there is nothing to type into, and the prompt
  // would otherwise fall out of the bottom of the script as an unfinished
  // wait, which reads as a crash.
  if (!process.stdin.isTTY) {
    fail(
      "This needs to run in a terminal window, so you can type a passcode.",
      "Open the project folder and start it from there:",
      "",
      "  macOS:    double-click connect-cloud.command",
      "  Windows:  double-click connect-cloud-windows.cmd",
    );
  }

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

    // Running this a second time should not build a second agent. A project
    // already carrying a service for this repository is the one to reconnect
    // to, and on a free plan it is usually the only one that will be allowed:
    // a second copy is a second set of resources.
    const repoName = repo.split("/")[1];
    const existingProject = liveProjects().find((project) =>
      servicesOf(project).some((service) => service.name === repoName),
    );

    if (existingProject) {
      print("");
      print(`  Found your existing cloud project "${existingProject.name}". Reconnecting to it.`);
      railwayFirstThatWorks(
        [
          automated(["link", "--project", existingProject.id, "--environment", "production"]),
          automated(["link", "--project", existingProject.id]),
        ],
        "Reconnecting to your project",
      );
    } else {
      const workspace = workspaceId();
      print("");
      print(`  Creating a cloud project for ${repo}...`);
      railwayFirstThatWorks(
        [
          workspace === null ? null : automated(["init", "--name", "my-agent", "--workspace", workspace]),
          automated(["init", "--name", "my-agent"]),
          automated(["init", "-n", "my-agent"]),
        ].filter((candidate) => candidate !== null),
        "Creating the project",
      );

      // --repo keeps it connected to GitHub, which is what makes a push deploy
      // itself later. Uploading the folder instead would deploy once and then
      // never notice a change.
      railwayFirstThatWorks(
        [
          automated(["add", "--repo", repo]),
          automated(["add", "-r", repo]),
        ],
        "Connecting your repository",
      );
      print("  Project created and connected to your repository.");
    }

    if (!railwayOk(["status"])) {
      fail("The project is not linked.", "Run `railway link`, then run this again.");
    }
  }
  print("  Project linked.");

  // Storage, addresses and settings all belong to a service. Without naming
  // one the CLI has a question it cannot ask, and it fails with whichever
  // error it happens to be holding rather than saying so.
  const service = serviceName();
  if (service === null) {
    fail(
      "Your project has no service in it yet.",
      "That usually means the repository was never connected. Open your",
      "project in the Railway dashboard, check a service is there, then run",
      "this again.",
    );
  }
  const forService = (args) => automated([...args, "--service", service]);

  // Where --service is accepted moved between CLI releases. `railway volume`
  // takes it on the command group and rejects it on the subcommand, so
  // `volume add --service X` fails outright with "unexpected argument
  // '--service' found"; other commands take it either way. Rather than pin a
  // version, every call offers both placements and uses whichever the
  // installed CLI accepts.
  const forGroup = (args) => automated([args[0], "--service", service, ...args.slice(1)]);

  /** A JSON read that survives either placement. */
  const jsonForService = (args, fallback) => {
    for (const candidate of [forGroup(args), forService(args)]) {
      const value = jsonOr(candidate, null);
      if (value !== null) {
        return value;
      }
    }
    return fallback;
  };

  print(`  Service: ${service}`);
  print("");

  // --- storage ---
  // This read has to succeed for the check below to mean anything: a failed
  // read looks identical to "no volumes", and then adding one fails because it
  // is already there. That is what made a second run stop instead of resuming.
  const volumes = JSON.stringify(jsonForService(["volume", "list"], []));
  if (volumes.includes(MOUNT_PATH)) {
    print(`  Storage at ${MOUNT_PATH} is already there.`);
  } else {
    railwayFirstThatWorks(
      [
        forGroup(["volume", "add", "--mount-path", MOUNT_PATH]),
        forGroup(["volume", "add", "-m", MOUNT_PATH]),
        forService(["volume", "add", "--mount-path", MOUNT_PATH]),
        forService(["volume", "add", "-m", MOUNT_PATH]),
      ],
      "Adding storage",
    );
    print(`  Storage added at ${MOUNT_PATH}.`);
  }

  // --- two addresses ---
  const existing = domainsFrom(jsonForService(["domain", "list"], {}));
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
        forService(["domain", "--port", String(port)]),
        forService(["domain", "-p", String(port)]),
        forGroup(["domain", "--port", String(port)]),
        forGroup(["domain", "-p", String(port)]),
      ],
      `Creating the address for ${label}`,
    );
    print(`  Address created for ${label} (port ${port}).`);
  }

  const after = domainsFrom(jsonForService(["domain", "list"], {}));
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
        forService(["variable", "set", `${key}=${value}`]),
        forGroup(["variable", "set", `${key}=${value}`]),
        forService(["variables", "--set", `${key}=${value}`]),
        forService(["variables", "set", `${key}=${value}`]),
      ],
      `Setting ${key}`,
    );

  setVariable("N8N_PUBLIC_URL", `https://${n8nHost}`);
  print(`  Workshop address set to https://${n8nHost}`);

  // The passcode is handed over on the CLI's standard input rather than as a
  // command argument. Arguments are readable by anything else running on the
  // machine for as long as the command lasts, and they are the sort of thing
  // that ends up in a shell history. Older builds have no --stdin, so an
  // argument remains the fallback rather than a failure.
  // Both placements are tried on standard input before the argument form is
  // considered, so a CLI that only accepts --service on the command group
  // still keeps the passcode out of the process arguments.
  const passcodeSet =
    railwayStdin(forService(["variable", "set", "AGENT_PASSCODE", "--stdin"]), passcode) ||
    railwayStdin(forGroup(["variable", "set", "AGENT_PASSCODE", "--stdin"]), passcode);
  if (!passcodeSet) {
    setVariable("AGENT_PASSCODE", passcode);
  }
  print("  Passcode set.");

  // --- go ---
  print("");
  print("Starting your agent. This takes a few minutes.");
  // --from-source so the deployment is built from the commit just pushed,
  // rather than re-running whatever was last built.
  railwayFirstThatWorks(
    [
      ["redeploy", "--service", service, "--yes", "--from-source"],
      ["redeploy", "--service", service, "--yes"],
    ],
    "Starting your agent",
  );

  print("");
  print("Done. Your agent has everything it needs.");
  print("");
  if (chatHost) {
    print(`  Your agent:    https://${chatHost}`);
  }
  print(`  Your workshop: https://${n8nHost}`);
  print("");
  print("Next, make the file holding your keys and settings:");
  print("");
  print("  macOS:    double-click pack-agent.command");
  print("  Windows:  double-click pack-agent-windows.cmd");
  print("");
  print("Then open your agent above, sign in with the passcode you just chose,");
  print("and upload that file there.");
  print("");
}

await main();
