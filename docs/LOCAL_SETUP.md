# Local Setup

New to GitHub, Node.js, or n8n? Start with the
[complete beginner getting-started guide](GETTING_STARTED.md). This document is
the shorter technical reference for the same setup.

## Outcome

At the end of setup, three local services will be healthy:

- The chat app at [http://localhost:3000](http://localhost:3000).
- The n8n editor at [http://localhost:5678](http://localhost:5678).
- The internal document reader, which has no browser address.

The eleven reviewed workflows, three sample tasks, and enabled Markdown skills
will also be installed automatically. All three services run as background
Node.js processes on this computer. Nothing is published to the internet.

## Before starting

You need:

- A supported macOS or Windows computer.
- This repository on the computer.
- At least 6 GB free for first setup; 8 GB is recommended.

The complete preparation checklist is in [WORKSHOP_PREREQUISITES.md](WORKSHOP_PREREQUISITES.md).

## macOS setup

1. Open the repository folder in Finder.
2. Double-click `setup.command`.
3. If macOS asks for confirmation, allow the local script to run.
4. Wait for the terminal window to report `Local stack is healthy`.
5. Open [http://localhost:3000](http://localhost:3000).
6. Open [http://localhost:5678](http://localhost:5678).

If macOS will not open the command file, Control-click it, select **Open**, then confirm.

## Windows setup

Windows 10 and 11 x64 are supported. Windows 11 ARM is supported through its
built-in x64 emulation; Windows 10 ARM is not supported. Keep the project in a
short local folder outside OneDrive and network/UNC paths.

1. Open the repository folder in File Explorer.
2. Double-click `preflight-windows.cmd` and resolve any `[!!]` result.
3. Double-click `setup-windows.cmd`.
4. Wait for the window to report `Local stack is healthy`.
5. Press a key when prompted to close the setup window.
6. Open [http://localhost:3000](http://localhost:3000).
7. Open [http://localhost:5678](http://localhost:5678).

The Windows wrapper runs the shared runner through the included PowerShell shim without requiring the learner to change their permanent PowerShell execution policy.

On either platform, setup uses an existing runtime only when it is the exact
reviewed Node.js 24.18.0 and npm 11.16.0 pair. Otherwise it downloads the pinned
official Node.js archive, verifies its SHA-256 checksum, and unpacks the pair
into `.runtime/` inside the project. It does not install anything globally or
require administrator access.

## First n8n visit

On the first visit to n8n:

1. Create the local n8n owner account.
2. Use a password that is not shared with another team.
3. Store the password privately.
4. Open `01 - START HERE - Learner Checklist`.
5. Follow its visual steps before adding the Claude credential.

The n8n owner account exists only in this project's local `data/` folder.

## What setup creates

All local state lives inside the repository folder and is ignored by Git:

- `.runtime/` — the verified private Node.js/npm pair and npm cache.
- `node_modules/` — the exact npm-pinned n8n release.
- `apps/chat/dist/` — the compiled chat gateway.
- `data/n8n/` — the n8n database, settings, and encrypted credentials, including a private encryption key n8n generates on first start.
- `data/chat/` — plaintext saved conversations, attachment metadata, and the
  full-text search index.
- `data/documents/` — temporary extracted document context, retained for at most 24 hours.
- `data/logs/` — one log file per service.
- `data/run/` — process records for stop/start.

No `.env` file is required. Create one from `.env.example` only to change a port or timezone. Do not copy real values into `.env.example`, screenshots, issues, or chat messages.

The setup script:

1. Selects the reviewed Node.js 24.18.0/npm 11.16.0 pair or prepares the
   verified private copy.
2. Validates disk space, folder access, Node.js, npm, and package-registry
   access.
3. Proves ports 3000, 3100, 5678, and n8n's derived internal task-broker port
   can be bound.
4. Installs the pinned n8n release with `npm ci`.
5. Installs the document-reader packages.
6. Installs the chat build tools and compiles the TypeScript gateway.
7. Validates the committed workflow files.
8. Starts n8n and the document reader, then waits for both to become healthy.
9. Imports the eleven reviewed workflows when they are not already installed.
10. Creates the local tables and three missing sample tasks.
11. Loads only the skills listed in `skills/enabled.txt`.
12. Starts the chat app and confirms all three local health endpoints.

On a later setup run, the learner-checklist workflow acts as the installation marker. Setup keeps existing workflow edits unchanged. Use the explicit workflow-import helper only when you deliberately want to refresh the reviewed workflows.

## Local-only networking

All three services and n8n's internal task broker listen on `127.0.0.1` only:

- `127.0.0.1:3000`
- `127.0.0.1:3100` (internal document reader)
- `127.0.0.1:5678`
- `127.0.0.1:5679` by default (the internal task broker)

Other computers on the local network cannot connect. This is a local learning environment, not a public deployment. Because nothing listens on an external interface, Windows learners should not see a firewall prompt.

The chat is the only application that uses the document reader. Learners do not
need to open its internal health address.

## Changing ports

If another application needs port 3000, 3100, 5678, or the derived task-broker
port:

1. Stop the local stack.
2. Copy `.env.example` to `.env` if `.env` does not exist.
3. Change `CHAT_PORT`, `DOCUMENT_WORKER_PORT`, or `N8N_PORT`. Set
   `N8N_RUNNERS_BROKER_PORT` only when the automatically derived broker port
   also conflicts.
4. Save the file.
5. Start the stack again.

When a port changes, use the matching new localhost address in the browser.

## Technical setup

Technical contributors can use:

```bash
./scripts/setup.sh
```

or call the shared cross-platform runner directly:

```bash
node scripts/local.mjs setup
node scripts/local.mjs help
```

Every double-click helper selects the same verified runtime and delegates to `scripts/local.mjs`, so macOS, Windows, and CI exercise the same code path.

## Expected success

Setup is successful only when:

- The setup command exits successfully.
- `node scripts/local.mjs status` reports n8n, the document reader, and chat as healthy.
- `http://localhost:3000/health` returns `{"status":"ok"}`.
- `http://localhost:5678/healthz` returns a successful response.
- Restarting the stack preserves the local n8n owner and saved settings.
- `01 - START HERE - Learner Checklist` appears in n8n.

If automatic workflow import was interrupted, double-click `import-workflows.command` on macOS or `import-workflows-windows.cmd` on Windows. The fallback is safe to repeat.

If any check fails, use [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

After adding the Anthropic credential and publishing workflows `00` and `90`, run `diagnose.command` on macOS or `diagnose-windows.cmd` on Windows. Continue to a real Claude message only when every diagnostic is green.

## Make the chat your own

After setup, follow [CUSTOMISE_CHAT.md](CUSTOMISE_CHAT.md) to change the agent name, welcome message, colour, and example prompts. Those beginner-facing settings update after a browser refresh and do not require a rebuild.

## Connect the agent

When setup and customisation are complete, follow [N8N_AGENT_SETUP.md](N8N_AGENT_SETUP.md). It walks through confirming automatic import, storing the Anthropic API key safely in n8n, publishing the workflow, and sending a first message.
