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

/**
 * This computer's timezone, or null when it cannot be read.
 *
 * Null rather than a guessed default: a wrong timezone is worse than a known
 * missing one, because UTC at least fails in a way the deploy log can warn about.
 */
function detectTimezone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.includes("/") ? zone : null;
  } catch {
    return null;
  }
}

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

/**
 * Where the Railway command actually is, and how it has to be run.
 *
 * On Windows `npm i -g @railway/cli` installs no .exe — only a `railway.cmd`
 * shim. Node has refused to spawn a .cmd without a shell since the fix for
 * CVE-2024-27980, so `spawnSync("railway", ...)` fails with an error rather
 * than a non-zero status, and every check built on it reads as "not
 * installed". The learner is then told to install the thing they just
 * installed. Resolving the real path once, and only using a shell when the
 * thing found is a shim, keeps that from happening.
 */
const railwayCommand = (() => {
  if (process.platform !== "win32") {
    return { command: "railway", shell: false };
  }
  const found = spawnSync("where.exe", ["railway"], { encoding: "utf8" });
  const paths = (found.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // An .exe can be spawned directly, which keeps arguments and stdin exactly
  // as written. A shim cannot, and needs the shell.
  const exe = paths.find((candidate) => candidate.toLowerCase().endsWith(".exe"));
  if (exe) {
    return { command: exe, shell: false };
  }
  const shim = paths.find((candidate) => /\.(cmd|bat)$/i.test(candidate));
  return shim ? { command: shim, shell: true } : { command: "railway", shell: true };
})();

function railway(args, { quiet = true } = {}) {
  return spawnSync(railwayCommand.command, args, {
    encoding: "utf8",
    shell: railwayCommand.shell,
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
  const result = spawnSync(railwayCommand.command, args, {
    encoding: "utf8",
    shell: railwayCommand.shell,
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
function linkedService() {
  const linked = jsonOr(["status", "--json"], null);
  const direct = servicesOf(linked);
  if (direct.length > 0) {
    return direct[0];
  }
  // `status` reports the linked project by id; find it in the project list.
  const id = linked?.id ?? linked?.project?.id;
  const match = liveProjects().find((project) => project.id === id);
  return servicesOf(match)[0] ?? null;
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
    const mask = (chunk) => {
      // Enter arrives here too, and by then readline has already emptied the
      // line — so redrawing would print the question again with no asterisks
      // after it, which reads as being asked the same thing twice.
      if (chunk && /[\r\n]/.test(String(chunk))) {
        return;
      }
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

/**
 * The dashboard page for this service's addresses. Railway's own link file
 * already holds the three ids the URL needs, so the learner is handed the page
 * rather than a trail of menu names to follow.
 */
function networkingUrl() {
  const printed = railway(["open", "--print"]);
  const direct = (printed.stdout ?? "").trim();
  const fromCli = direct.match(/https:\/\/\S+/)?.[0];

  const status = jsonOr(["status", "--json"], null);
  const projectId = status?.id ?? null;
  const environmentId = status?.environments?.edges?.[0]?.node?.id ?? null;
  const serviceId = servicesOf(status)[0]?.id ?? null;

  // Only the service panel itself is a real route. A deeper path like
  // /settings/networking is ignored and silently lands on Deployments, which
  // sends the learner looking for a button that is not on the page they are on.
  if (projectId && serviceId) {
    const query = environmentId ? `?environmentId=${environmentId}` : "";
    return `https://railway.com/project/${projectId}/service/${serviceId}${query}`;
  }
  return fromCli ?? null;
}

/**
 * Waits for the learner to finish something in their browser. Needs a real
 * terminal for the same reason the passcode does, and says so rather than
 * hanging on a prompt nobody can see.
 */
function askEnter(question) {
  if (!process.stdin.isTTY) {
    fail(
      "This needs to run in a terminal window, so it can wait for you.",
      "Open the project folder and start it from there:",
      "",
      "  macOS:    double-click connect-cloud.command",
      "  Windows:  double-click connect-cloud-windows.cmd",
    );
  }
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} `, () => {
      rl.close();
      done();
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

  // Checked here rather than at the prompt that needs it. This run will ask for
  // a passcode and wait for a browser step, and without a terminal it can do
  // neither — but the prompt comes after the project, the storage and both
  // addresses have been created, so discovering it there left real things half
  // made and explained the problem far too late.
  if (!process.stdin.isTTY) {
    fail(
      "This needs to run in a terminal window, so you can type a passcode.",
      "Nothing has been changed. Open the project folder and start it from",
      "there:",
      "",
      "  macOS:    double-click connect-cloud.command",
      "  Windows:  double-click connect-cloud-windows.cmd",
    );
  }

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
  const linked = linkedService();
  const service = linked?.name ?? null;
  // Some commands want the service by name and one wants it by id. Both are
  // read once here rather than looked up per call.
  const serviceId = linked?.id ?? null;
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

  /** A JSON read that survives either placement, and prefers the service id. */
  const jsonForService = (args, fallback) => {
    const candidates = [
      serviceId === null ? null : automated([args[0], "--service", serviceId, ...args.slice(1)]),
      forGroup(args),
      forService(args),
    ].filter((candidate) => candidate !== null);
    for (const candidate of candidates) {
      const value = jsonOr(candidate, null);
      if (value !== null) {
        return value;
      }
    }
    return fallback;
  };

  print(`  Service: ${service}`);

  const setVariable = (key, value) =>
    railwayFirstThatWorks(
      [
        forService(["variable", "set", `${key}=${value}`, "--skip-deploys"]),
        forGroup(["variable", "set", `${key}=${value}`, "--skip-deploys"]),
        forService(["variable", "set", `${key}=${value}`]),
        forGroup(["variable", "set", `${key}=${value}`]),
        forService(["variables", "--set", `${key}=${value}`]),
        forService(["variables", "set", `${key}=${value}`]),
      ],
      `Setting ${key}`,
    );

  // Set before anything else, because connecting the repository above already
  // started a build. railway.json asks for the Dockerfile builder and a brand
  // new service can ignore it — reading no config file, choosing its own build
  // system, and failing having printed no build output at all: a few scheduling
  // lines over ten minutes and nothing else. Naming the Dockerfile as a variable
  // does not depend on the config file being noticed, and is harmless where it
  // already was. Verified: the same commit went from a failed RAILPACK build to
  // a successful DOCKERFILE one with nothing else changed.
  setVariable("RAILWAY_DOCKERFILE_PATH", "Dockerfile");
  print("  Build set to use the Dockerfile.");
  print("");

  // --- storage ---
  // This read has to succeed for the check below to mean anything: a failed
  // read looks identical to "no volumes", and then adding one fails because it
  // is already there. That is what made a second run stop instead of resuming.
  const volumes = JSON.stringify(jsonForService(["volume", "list"], []));
  if (volumes.includes(MOUNT_PATH)) {
    print(`  Storage at ${MOUNT_PATH} is already there.`);
  } else {
    // `railway volume` documents its --service as a Service ID, and unlike
    // every other command it does not merely reject a name: it panics inside
    // the CLI with "called `Option::unwrap()` on a `None` value", which tells a
    // learner nothing at all. The id is what it wants. --json is left off
    // deliberately — nothing here reads the output, and it was part of the
    // combination that panicked.
    railwayFirstThatWorks(
      [
        serviceId === null ? null : ["volume", "--service", serviceId, "add", "--mount-path", MOUNT_PATH],
        serviceId === null ? null : ["volume", "--service", serviceId, "add", "-m", MOUNT_PATH],
        forGroup(["volume", "add", "--mount-path", MOUNT_PATH]),
        forService(["volume", "add", "--mount-path", MOUNT_PATH]),
        forService(["volume", "add", "-m", MOUNT_PATH]),
      ].filter((candidate) => candidate !== null),
      "Adding storage",
    );
    print(`  Storage added at ${MOUNT_PATH}.`);
  }

  // --- two addresses ---
  const domainsNow = () => domainsFrom(jsonForService(["domain", "list"], {}));
  const hostOn = (list, port) => list.find((entry) => entry.port === port)?.host;

  // The agent's address. `railway domain` generates one service domain, so this
  // is the one the CLI can make, and it is the important one: it is what the
  // learner opens and what the health check watches.
  if (hostOn(domainsNow(), CHAT_PORT)) {
    print("  Address for your agent already exists.");
  } else {
    railwayFirstThatWorks(
      [
        forService(["domain", "--port", String(CHAT_PORT)]),
        forService(["domain", "-p", String(CHAT_PORT)]),
        forGroup(["domain", "--port", String(CHAT_PORT)]),
        forGroup(["domain", "-p", String(CHAT_PORT)]),
      ],
      "Creating the address for your agent",
    );
    // Asked for a second address, `railway domain` returns the one that already
    // exists and creates nothing, while still exiting zero. So a success here
    // proves nothing; the list is the only evidence that counts.
    if (!hostOn(domainsNow(), CHAT_PORT)) {
      fail(
        "Your agent's address was not created, even though the command reported no error.",
        "Add it in your hosting dashboard instead: Settings, then Networking,",
        `then Generate Domain, with the target port set to ${CHAT_PORT}.`,
        "Then run this again.",
      );
    }
    print(`  Address created for your agent (port ${CHAT_PORT}).`);
  }

  // The workshop's address. This one cannot be created from the command line at
  // all: the CLI has no way to add a second service domain, and asking for one
  // silently hands back the first. It is six seconds in the dashboard, so the
  // script waits here rather than sending the learner away and giving up.
  /**
   * Repoints a spare address at the workshop port. The CLI cannot create a
   * second address, but it can move one, so the learner never has to choose a
   * port — which is the part they get wrong. Railway's own default is 8080.
   */
  const adoptSpareDomain = () => {
    // `port > 0` matters more than it looks. domainsFrom() defaults an
    // unreadable port to 0, so without it the agent's own address — or a custom
    // domain the learner set up themselves — can qualify as "spare" and get
    // repointed at the workshop, while this script finishes reporting success.
    const spare = domainsNow().find(
      (entry) => entry.port > 0 && entry.port !== CHAT_PORT && entry.port !== N8N_PORT,
    );
    if (!spare) {
      return false;
    }
    const moved = railwayFirstThatWorks(
      [
        forService(["domain", "update", spare.host, "--port", String(N8N_PORT)]),
        ["domain", "update", spare.host, "--port", String(N8N_PORT)],
      ],
      `Pointing ${spare.host} at port ${N8N_PORT}`,
    );
    return Boolean(moved) && Boolean(hostOn(domainsNow(), N8N_PORT));
  };

  if (hostOn(domainsNow(), N8N_PORT)) {
    print("  Address for your workshop already exists.");
  } else if (adoptSpareDomain()) {
    print(`  Second address pointed at port ${N8N_PORT} for your workshop.`);
  } else {
    print("");
    print("  One step has to be done in your browser, because the command line");
    print("  cannot make a second address. Two clicks, then come back here.");
    print("");
    // The exact page, rather than the name of a menu to go looking for. The ids
    // are already in the CLI's own link file, so there is nothing to type.
    const settingsUrl = networkingUrl();
    if (settingsUrl !== null) {
      print("  1. Open your service:");
      print(`     ${settingsUrl}`);
    } else {
      print("  1. Open your project in the Railway dashboard, and click your");
      print("     service.");
    }
    print("  2. Click the Settings tab, at the right-hand end of the row that");
    print("     starts with Deployments, and scroll down to Networking.");
    print("  3. Click Generate Domain.");
    print("");
    print("  Whatever port it offers you is fine — ignore it, do not change it,");
    print("  and do not touch the address you already have. The port is set for");
    print("  you when you come back.");
    print("");

    for (let attempt = 1; ; attempt += 1) {
      await askEnter("  Press Enter once you have generated it.");
      if (hostOn(domainsNow(), N8N_PORT) || adoptSpareDomain()) {
        break;
      }
      if (attempt >= 3) {
        fail(
          "No second address has appeared, so the workshop cannot be set up for you.",
          "In Settings, then Networking, click Generate Domain so there are two",
          "addresses listed, then run this again. Everything else you have done",
          "is already saved.",
        );
      }
      print("");
      print("  Still only one address here. Check the Networking section lists");
      print("  two, then press Enter again.");
      print("");
    }
    print(`  Address set up for your workshop (port ${N8N_PORT}).`);
  }

  const after = domainsNow();
  const chatHost = hostOn(after, CHAT_PORT);
  const n8nHost = hostOn(after, N8N_PORT);

  if (!n8nHost) {
    fail(
      "Your workshop address could not be read back, so it cannot be set for you.",
      "In your hosting dashboard, find the address pointing at port 5678 and add",
      "a variable named N8N_PUBLIC_URL set to it, then redeploy.",
    );
  }
  print("");

  // --- the settings ---
  // Every one of these is written with --skip-deploys, and a single redeploy
  // happens at the end. Setting them one at a time without that flag queues a
  // fresh build per variable, and each build pulls a 1.5 GB image.
  // Written before the passcode is asked for, deliberately. These two need no
  // decision from anyone, and if this run is abandoned at the prompt below —
  // closing the window is the obvious thing to do when interrupted — the agent
  // is left with addresses and no routing port, which is a permanent 502 that
  // no amount of redeploying fixes and nothing on screen explains.
  //
  // Reading the address back and setting it here is the point of this script:
  // copying it by hand between two screens is where most people go wrong, and
  // a wrong value produces trigger addresses that look right and never fire.
  setVariable("N8N_PUBLIC_URL", `https://${n8nHost}`);
  print(`  Workshop address set to https://${n8nHost}`);

  // Railway injects PORT for the one service it thinks it is routing to, and it
  // healthchecks that same port. Its default is 8080, which is neither of this
  // agent's ports, so the agent would listen on 8080 while the addresses point
  // at 3000 and 5678 — a container that passes its healthcheck and answers
  // nothing, which is the least diagnosable failure there is. Setting it makes
  // the platform, the agent and the port-3000 address agree.
  setVariable("PORT", String(CHAT_PORT));
  print(`  Routing port set to ${CHAT_PORT}.`);

  // A container has no idea what time it is where the learner lives. Railway
  // sets no timezone, and scripts/cloud.mjs then falls back to UTC — so a
  // workflow scheduled for 8am would run at 6pm in Melbourne. That failure is
  // invisible until the morning it does not happen, and "check your timezone"
  // is not where anyone looks. This machine already knows the answer, so send
  // it once, here, rather than asking thirty people to edit a dashboard.
  const timezone = detectTimezone();
  if (timezone === null) {
    print("  Could not read this computer's timezone, so cloud times will be UTC.");
    print("  Set GENERIC_TIMEZONE in the Railway dashboard if you schedule anything.");
  } else {
    setVariable("GENERIC_TIMEZONE", timezone);
    print(`  Cloud clock set to ${timezone}, so scheduled times mean what they say.`);
  }


  const passcode = await askPasscode();
  print("");

  // The passcode is handed over on the CLI's standard input rather than as a
  // command argument. Arguments are readable by anything else running on the
  // machine for as long as the command lasts, and they are the sort of thing
  // that ends up in a shell history. Older builds have no --stdin, so an
  // argument remains the fallback rather than a failure.
  // Both placements are tried on standard input before the argument form is
  // considered, so a CLI that only accepts --service on the command group
  // still keeps the passcode out of the process arguments.
  const passcodeSet =
    railwayStdin(
      forService(["variable", "set", "AGENT_PASSCODE", "--stdin", "--skip-deploys"]),
      passcode,
    ) ||
    railwayStdin(
      forGroup(["variable", "set", "AGENT_PASSCODE", "--stdin", "--skip-deploys"]),
      passcode,
    ) ||
    railwayStdin(forService(["variable", "set", "AGENT_PASSCODE", "--stdin"]), passcode) ||
    railwayStdin(forGroup(["variable", "set", "AGENT_PASSCODE", "--stdin"]), passcode);
  if (!passcodeSet) {
    setVariable("AGENT_PASSCODE", passcode);
  }

  // Read back rather than trust the exit code. A command that reports success
  // and changes nothing is the failure this whole script has been bitten by
  // twice: storage that was never mounted, and an address that was never made.
  // Only the names are looked at — the values stay where they were put.
  const savedNames = Object.keys(jsonForService(["variable", "list"], {}) ?? {});
  const missing = ["AGENT_PASSCODE", "PORT", "N8N_PUBLIC_URL"].filter(
    (key) => savedNames.length > 0 && !savedNames.includes(key),
  );
  if (missing.length > 0) {
    fail(
      `These settings did not save: ${missing.join(", ")}.`,
      "Nothing is broken, but your agent will not start without them. Run this",
      "again — everything else you have done is already saved, so it will pick up",
      "where it left off.",
    );
  }
  print("  Passcode set.");
  if (savedNames.length === 0) {
    print("  (Could not read the settings back to double-check them.)");
  }

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
  // The learner is being walked through this by a coding agent in another
  // window, and that agent opens the next tool itself. Printing "double-click
  // pack-agent" here gave them a second, competing set of instructions at the
  // one moment they most need a single next step.
  print("Now go back to Claude Code and type:   connected");
  print("");
  print("It takes you through the rest: making the file that holds your keys,");
  print("and bringing your agent across.");
  print("");
  print("Working without Claude Code? Run pack-agent.command instead (or");
  print("pack-agent-windows.cmd on Windows), then open your agent above, sign");
  print("in with the passcode you just chose, and upload the file it makes.");
  print("");
}

await main();
