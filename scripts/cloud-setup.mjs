/**
 * First-run setup for a cloud agent.
 *
 * Runs inside the supervisor, before n8n or the chat app start. That ordering
 * is the whole trick: the databases can be written straight into place because
 * nothing has them open yet, so there is no staging area, no restart dance and
 * no window where a half-restored agent is running.
 *
 * The page it serves is the only thing a learner has to do by hand, and it is
 * one file chooser and two passwords.
 */

import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { openPack, PackError, readPackMetadata } from "./agent-pack.mjs";

// Dual-stack. Railway's own network is IPv6, and a server bound to 0.0.0.0
// answers a healthcheck on loopback while the public proxy cannot reach it at
// all — which arrives as "Application failed to respond" with healthy logs.
// "::" accepts IPv6 and IPv4 both, so it is strictly wider than 0.0.0.0.
const LISTEN_ADDRESS = process.env.CLOUD_LISTEN_ADDRESS ?? "::";

/** A pack of decrypted SQLite databases; far above any real one. */
const MAX_UPLOAD_BYTES = 200 * 1_024 * 1_024;

const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * Where each part of a pack belongs on the volume. Anything whose prefix is
 * not listed here is ignored rather than guessed at, so a future pack with
 * extra contents cannot write somewhere unexpected on an older agent.
 */
function destinationFor(entryPath, paths) {
  const targets = [
    ["n8n/", join(paths.n8nUserFolder, ".n8n")],
    ["chat/", paths.chatDataDir],
    ["profile/", paths.profileDataDir],
    ["skills/", paths.skillsDir],
  ];
  for (const [prefix, root] of targets) {
    if (!entryPath.startsWith(prefix)) {
      continue;
    }
    const relativePath = entryPath.slice(prefix.length);
    if (relativePath === "") {
      return null;
    }
    // The pack is a file from outside, so its paths are treated as hostile:
    // anything that climbs out of its own folder is refused, not sanitised.
    const resolved = resolve(root, relativePath);
    const rootWithSep = resolve(root) + sep;
    if (!resolved.startsWith(rootWithSep)) {
      throw new PackError(
        "That pack contains an unexpected file path and was not used.",
      );
    }
    if (normalize(relativePath).split(/[\\/]/).includes("..")) {
      throw new PackError(
        "That pack contains an unexpected file path and was not used.",
      );
    }
    return resolved;
  }
  return null;
}

function applyPack(entries, paths) {
  // Every path is resolved and every check made before a single byte is
  // written. Writing as we go would mean a pack rejected halfway had already
  // half-replaced the agent, which is worse than either outcome on its own.
  const planned = [];
  for (const entry of entries) {
    const destination = destinationFor(entry.path, paths);
    if (destination !== null) {
      planned.push({ entry, destination });
    }
  }

  if (!planned.some((item) => item.entry.path === "n8n/database.sqlite")) {
    throw new PackError(
      "That pack has no workshop database in it, so it was not used.",
    );
  }

  for (const { entry, destination } of planned) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, entry.data);
    try {
      chmodSync(destination, entry.mode & 0o777 || 0o600);
    } catch {
      // Some volumes do not support chmod. The file is still correct.
    }
  }
  return planned.map((item) => item.entry.path);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function readBody(request, limit) {
  return new Promise((done, fail) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        fail(new PackError("That file is too large to be an agent pack."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", fail);
  });
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...PAGE_HEADERS,
    "Content-Length": Buffer.byteLength(payload).toString(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function sendAsset(response, body, contentType) {
  response.writeHead(200, {
    ...PAGE_HEADERS,
    "Content-Length": Buffer.byteLength(body).toString(),
    "Content-Type": contentType,
  });
  response.end(body);
}

function headerValue(request, name) {
  const value = request.headers[name];
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Set up your agent</title>
    <link rel="stylesheet" href="/setup.css" />
  </head>
  <body>
    <main>
      <h1>Set up your agent</h1>
      <p class="lead">
        Bring everything across from the agent on your own computer: your saved
        credentials, your workflows, your conversations and your business facts.
      </p>

      <form id="form">
        <label for="pack">Your agent pack</label>
        <p class="hint">
          It is in your project's <code>backups</code> folder and its name
          starts with <code>my-agent-</code> and ends in <code>.agentpack</code>.
          You can also drag it onto this page.
        </p>
        <input id="pack" type="file" accept=".agentpack" required />

        <p id="packinfo" class="packinfo" hidden></p>

        <label for="passphrase">The passphrase for that file</label>
        <p class="hint">The one you chose when you packed your agent.</p>
        <input id="passphrase" type="password" autocomplete="off" required />

        <label for="passcode">Your agent passcode</label>
        <p class="hint">The one you set in your hosting dashboard.</p>
        <input id="passcode" type="password" autocomplete="off" required />

        <button id="go" type="submit">Bring my agent across</button>
      </form>

      <p id="status" class="status" hidden></p>

      <details>
        <summary>I do not have a pack</summary>
        <p class="hint">
          You can start with an empty agent instead. You will need to enter your
          credentials again in the workshop, and none of your conversations will
          come across.
        </p>
        <button id="skip" type="button" class="secondary">
          Start with an empty agent
        </button>
      </details>
    </main>
    <script src="/setup.js"></script>
  </body>
</html>
`;

const STYLESHEET = `:root {
  color-scheme: light dark;
  --ink: #16181d; --muted: #5c6270; --line: #d8dbe2;
  --paper: #fff; --page: #f4f5f7; --accent: #1f5eff;
  --warn: #8a2b12; --warn-bg: #fdece7; --ok: #14603a; --ok-bg: #e4f6ec;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #f2f3f5; --muted: #a0a6b4; --line: #343841;
    --paper: #1c1f26; --page: #121419; --accent: #7ba1ff;
    --warn: #ffb4a0; --warn-bg: #3a1d16; --ok: #8ee0b0; --ok-bg: #11301f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  padding: 1.5rem; background: var(--page); color: var(--ink);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main {
  width: 100%; max-width: 34rem; background: var(--paper);
  border: 1px solid var(--line); border-radius: 14px; padding: 2rem;
}
h1 { margin: 0 0 .4rem; font-size: 1.45rem; }
.lead { margin: 0 0 1.6rem; color: var(--muted); }
label { display: block; font-weight: 600; margin-top: 1.3rem; }
.hint { margin: .15rem 0 .5rem; font-size: .87rem; color: var(--muted); }
/* Dragging the pack anywhere on the page counts, so the page itself has to look
   like it is willing to catch it. */
body.dragging main { outline: 2px dashed var(--ok); outline-offset: 6px; }
code {
  font-size: .85em; padding: .1em .35em; border-radius: 4px;
  background: var(--page); border: 1px solid var(--line);
}
input {
  width: 100%; padding: .65rem .75rem; font-size: 1rem; color: var(--ink);
  background: var(--page); border: 1px solid var(--line); border-radius: 9px;
}
input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  width: 100%; margin-top: 1.5rem; padding: .75rem 1rem; font-size: 1rem;
  font-weight: 600; color: #fff; background: var(--accent); border: 0;
  border-radius: 9px; cursor: pointer;
}
button:hover:not(:disabled) { filter: brightness(1.07); }
button:disabled { opacity: .55; cursor: progress; }
button.secondary {
  margin-top: .8rem; color: var(--ink); background: transparent;
  border: 1px solid var(--line);
}
.packinfo, .status {
  margin: 1rem 0 0; padding: .7rem .85rem; border-radius: 9px; font-size: .92rem;
}
.packinfo { background: var(--page); color: var(--muted); }
.status.working { background: var(--page); color: var(--muted); }
.status.bad { background: var(--warn-bg); color: var(--warn); }
.status.good { background: var(--ok-bg); color: var(--ok); }
details { margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 1rem; }
summary { cursor: pointer; color: var(--muted); font-size: .92rem; }
`;

const CLIENT_SCRIPT = `(function () {
  var form = document.getElementById("form");
  var pack = document.getElementById("pack");
  var packinfo = document.getElementById("packinfo");
  var status = document.getElementById("status");
  var go = document.getElementById("go");
  var skip = document.getElementById("skip");

  function show(kind, text) {
    status.hidden = false;
    status.className = "status " + kind;
    status.textContent = text;
  }

  function busy(on) {
    go.disabled = on;
    skip.disabled = on;
  }

  // Dragging the file on is a good deal easier than steering a file chooser to
  // a folder you have never opened, which is what the alternative asks of
  // someone who does not usually think in folders. The whole page is the
  // target, because a small one is its own puzzle.
  ["dragenter", "dragover"].forEach(function (name) {
    document.addEventListener(name, function (event) {
      event.preventDefault();
      document.body.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach(function (name) {
    document.addEventListener(name, function (event) {
      event.preventDefault();
      if (name === "dragleave" && event.relatedTarget) return;
      document.body.classList.remove("dragging");
    });
  });
  document.addEventListener("drop", function (event) {
    var dropped = event.dataTransfer && event.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    var file = dropped[0];
    if (!/\\.agentpack$/i.test(file.name)) {
      show("bad", "That is not an agent pack. The file you want ends in .agentpack.");
      return;
    }
    // Assigning to a file input needs a DataTransfer; without it the chooser
    // still says "No file chosen" and the form submits nothing.
    var holder = new DataTransfer();
    holder.items.add(file);
    pack.files = holder.files;
    pack.dispatchEvent(new Event("change"));
  });

  // Reading the header needs no passphrase, so a learner finds out they picked
  // the wrong file before typing anything.
  pack.addEventListener("change", function () {
    var file = pack.files && pack.files[0];
    if (!file) { packinfo.hidden = true; return; }
    fetch("/setup/inspect", { method: "POST", body: file })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body.error) {
          packinfo.hidden = false;
          packinfo.textContent = body.error;
          return;
        }
        var made = new Date(body.createdAt);
        packinfo.hidden = false;
        packinfo.textContent =
          "Packed " + made.toLocaleString() + " · " + body.fileCount + " files"
          + (body.contains && body.contains.conversations ? " · includes your conversations" : "");
      })
      .catch(function () { packinfo.hidden = true; });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var file = pack.files && pack.files[0];
    if (!file) { show("bad", "Choose your agent pack first."); return; }
    busy(true);
    show("working", "Unlocking your pack and bringing everything across. This can take a minute.");
    fetch("/setup/restore", {
      method: "POST",
      headers: {
        "x-pack-passphrase": document.getElementById("passphrase").value,
        "x-agent-passcode": document.getElementById("passcode").value
      },
      body: file
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (result) {
        if (!result.ok) { busy(false); show("bad", result.body.error || "That did not work."); return; }
        show("good", "Your agent is here. Starting it now — this takes a minute or two while your workshop wakes up. Leave this page open and it will open your agent by itself. Do not reload: while your agent is starting there is nothing at this address yet, so reloading shows a hosting error page instead of this one.");
        setTimeout(waitForAgent, 4000);
      })
      .catch(function () { busy(false); show("bad", "The upload did not finish. Check your connection and try again."); });
  });

  skip.addEventListener("click", function () {
    busy(true);
    show("working", "Starting an empty agent.");
    fetch("/setup/skip", { method: "POST", headers: { "x-agent-passcode": document.getElementById("passcode").value } })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (result) {
        if (!result.ok) { busy(false); show("bad", result.body.error || "That did not work."); return; }
        show("good", "Starting your agent.");
        setTimeout(waitForAgent, 4000);
      })
      .catch(function () { busy(false); show("bad", "That did not work. Try again."); });
  });

  // The setup server stops once it has done its job and the real agent takes
  // over the same address, so polling until the page loads is the signal.
  function waitForAgent() {
    fetch("/health", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body && body.setup) { setTimeout(waitForAgent, 3000); return; }
        window.location.href = "/";
      })
      .catch(function () { setTimeout(waitForAgent, 3000); });
  }
})();
`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Serves the setup page until a learner either restores a pack or chooses an
 * empty agent, then resolves so the supervisor can start the real services.
 *
 * @returns {Promise<{restored: boolean, files: string[]}>}
 */
export function runSetup({ port, passcode, paths, log }) {
  return new Promise((done, fail) => {
    let finished = false;

    function requirePasscode(request, response) {
      const supplied = headerValue(request, "x-agent-passcode");
      if (supplied.length > 0 && supplied === passcode) {
        return true;
      }
      sendJson(response, 401, {
        error: "That is not your agent passcode.",
      });
      return false;
    }

    function finish(outcome) {
      if (finished) {
        return;
      }
      finished = true;
      writeFileSync(
        join(paths.configDir, "setup-complete.json"),
        `${JSON.stringify(
          { completedAt: new Date().toISOString(), ...outcome },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
      // Held open briefly so the browser's own request finishes cleanly before
      // the address changes hands.
      setTimeout(() => server.close(() => done(outcome)), 1_500);
    }

    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://localhost");

        // The platform health check runs throughout setup. Without this the
        // container is killed and restarted under the learner mid-upload.
        if (url.pathname === "/health") {
          sendJson(response, 200, { status: "ok", setup: !finished });
          return;
        }

        if (request.method === "GET" || request.method === "HEAD") {
          if (url.pathname === "/setup.css") {
            sendAsset(response, STYLESHEET, "text/css; charset=utf-8");
            return;
          }
          if (url.pathname === "/setup.js") {
            sendAsset(
              response,
              CLIENT_SCRIPT,
              "text/javascript; charset=utf-8",
            );
            return;
          }
          sendAsset(response, PAGE, "text/html; charset=utf-8");
          return;
        }

        if (request.method !== "POST") {
          sendJson(response, 405, { error: "That is not supported." });
          return;
        }

        if (url.pathname === "/setup/inspect") {
          try {
            const body = await readBody(request, MAX_UPLOAD_BYTES);
            const { metadata } = readPackMetadata(body);
            sendJson(response, 200, metadata);
          } catch (error) {
            sendJson(response, 400, {
              error:
                error instanceof PackError
                  ? error.message
                  : "That file could not be read.",
            });
          }
          return;
        }

        if (url.pathname === "/setup/skip") {
          if (!requirePasscode(request, response)) {
            return;
          }
          log("  Starting with an empty agent, at the learner's request.");
          sendJson(response, 200, { ok: true });
          finish({ restored: false, files: [] });
          return;
        }

        if (url.pathname === "/setup/restore") {
          if (!requirePasscode(request, response)) {
            return;
          }
          try {
            const body = await readBody(request, MAX_UPLOAD_BYTES);
            const passphrase = headerValue(request, "x-pack-passphrase");
            log(`  Opening an agent pack (${body.length} bytes)...`);
            const { entries, metadata } = openPack(body, passphrase);
            const files = applyPack(entries, paths);
            log(
              `  Brought across ${files.length} files from a pack made ${metadata.createdAt}.`,
            );
            sendJson(response, 200, { ok: true, files: files.length });
            finish({ restored: true, files });
          } catch (error) {
            const message =
              error instanceof PackError
                ? error.message
                : "That pack could not be used.";
            log(`  Pack refused: ${message}`);
            sendJson(response, 400, { error: message });
          }
          return;
        }

        sendJson(response, 404, { error: "Not found." });
      })().catch((error) => {
        if (!response.headersSent) {
          sendJson(response, 500, { error: "Something went wrong." });
        }
        log(`  Setup error: ${String(error)}`);
      });
    });

    server.on("error", fail);
    server.listen(port, LISTEN_ADDRESS, () => {
      log("");
      log("  Your agent is waiting for you to set it up.");
      log("  Open your agent's web address to finish.");
      log("");
    });
  });
}

/**
 * Holds the door open when the agent is not configured yet.
 *
 * A hosting platform starts building the moment a project is created, before
 * anyone has had a chance to add storage or settings, so the very first deploy
 * of every new agent arrives here. Exiting would be honest but useless: the
 * platform reports "healthcheck failure" and hides the real reason inside a
 * log nobody has been taught to open.
 *
 * So this answers the health check, stays up, and puts the missing pieces on a
 * page in the learner's own browser instead.
 */
export function runConfigHelp({ port, problems, log }) {
  return new Promise(() => {
    const items = problems
      .map(
        (problem) =>
          `<li><h2>${problem.title}</h2><ol>${problem.steps
            .map((step) => `<li>${step}</li>`)
            .join("")}</ol></li>`,
      )
      .join("");

    const page = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Your agent needs a moment</title>
    <link rel="stylesheet" href="/setup.css" />
  </head>
  <body>
    <main>
      <h1>Nearly there</h1>
      <p class="lead">
        Your agent is built and running, but there ${
          problems.length === 1 ? "is one thing" : `are ${problems.length} things`
        } it still needs before it can start. Add ${
          problems.length === 1 ? "it" : "them"
        } in your hosting dashboard, then deploy again.
      </p>
      <ul class="todo">${items}</ul>
      <p class="footnote">
        This page will be replaced by your agent as soon as it can start.
        Nothing here has gone wrong, and nothing has been lost.
      </p>
    </main>
  </body>
</html>
`;

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/health") {
        // Answered so the platform does not kill and restart the container in
        // a loop while the learner is reading the instructions.
        sendJson(response, 200, { status: "ok", needsConfiguration: true });
        return;
      }
      if (url.pathname === "/setup.css") {
        sendAsset(response, STYLESHEET + TODO_STYLES, "text/css; charset=utf-8");
        return;
      }
      sendAsset(response, page, "text/html; charset=utf-8");
    });

    server.listen(port, LISTEN_ADDRESS, () => {
      log("");
      log("  Waiting for you. Open your agent's web address to see what it");
      log("  still needs, or read the list above.");
      log("");
    });
  });
}

const TODO_STYLES = `
.todo { list-style: none; margin: 0; padding: 0; }
.todo > li {
  padding: 1rem 0 0.2rem;
  border-top: 1px solid var(--line);
}
.todo h2 { margin: 0 0 .5rem; font-size: 1.02rem; }
.todo ol { margin: 0; padding-left: 1.2rem; color: var(--muted); font-size: .94rem; }
.todo ol li { margin-bottom: .3rem; }
`;

/**
 * Setup runs on a fresh volume, or whenever AGENT_RESTORE is set so a learner
 * can bring a newer pack across later.
 */
export function setupIsNeeded(paths) {
  if ((process.env.AGENT_RESTORE ?? "") !== "") {
    return true;
  }
  if (existsSync(join(paths.configDir, "setup-complete.json"))) {
    return false;
  }
  return !existsSync(join(paths.n8nUserFolder, ".n8n", "database.sqlite"));
}
