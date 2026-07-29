# Local Operations and Recovery

## Start

### macOS

Double-click `start.command`.

### Windows

Double-click `start-windows.cmd`.

Starting does not reset n8n. Existing local users, settings, credentials, and workflows remain in the project's Git-ignored `data/` folder.

## Stop

### macOS

Double-click `stop.command`.

### Windows

Double-click `stop-windows.cmd`.

Stopping the background services preserves all local data.

## Check health

Open:

- [http://localhost:3000/health](http://localhost:3000/health)
- [http://localhost:5678/healthz](http://localhost:5678/healthz)
- [http://localhost:5678/webhook/agent-health](http://localhost:5678/webhook/agent-health) after the debug workflow is published

Technical contributors can also run:

```bash
node scripts/local.mjs status
```

All three services should report `healthy`.

The first endpoint checks the chat service, the second checks n8n itself, and
the third checks that n8n can run a published workflow. The document reader has
no host port; the diagnostic checks its health from inside Docker. The workflow
health response deliberately does not call Claude or expose credentials.

## Run friendly diagnostics

The diagnostic helper checks more than process health. It also confirms the reviewed checklist and main workflow are installed, the main workflow is published, an existing Anthropic credential is selected, the chat webhook is registered, and the optional health workflow is published.

It sends only an intentionally invalid session ID to the chat webhook, so validation stops the request before Claude. It never decrypts or displays credential values.

### macOS

Double-click `diagnose.command`, or run:

```bash
./scripts/diagnose.sh
```

### Windows

Double-click `diagnose-windows.cmd`, or run:

```powershell
.\scripts\windows\diagnose.ps1
```

Green `[ok]` lines are complete. Yellow `[next]` lines are safe configuration actions. Red `[!!]` lines are local service problems to resolve first.

## Import the supplied workflows

First setup imports the workflows automatically when the learner-checklist marker is absent. A later setup run preserves existing workflow edits.

Manual workflow import is the repeatable repair and refresh path. It imports the canonical repository files, prepares the local Data Tables without duplicating sample tasks, syncs the enabled Markdown skills, and publishes the reviewed runtime subworkflows. It replaces workflows with matching fixed IDs, so export deliberate visual edits before using it. The main agent, health workflow, and two temporary setup workflows remain inactive for deliberate inspection.

### macOS

Double-click `import-workflows.command`, or run:

```bash
./scripts/import-workflows.sh
```

### Windows

Double-click `import-workflows-windows.cmd`, or run:

```powershell
.\scripts\windows\import-workflows.ps1
```

After import, select the learner's `Anthropic account` credential in the Claude node and publish the main and health workflows. See [N8N_AGENT_SETUP.md](N8N_AGENT_SETUP.md).

## Sync Markdown skills

After editing `skills/enabled.txt`, a `skill.yaml`, or a `SKILL.md`, sync the bundle without reimporting every workflow:

### macOS

Double-click `sync-skills.command`, or run:

```bash
./scripts/sync-skills.sh
```

### Windows

Double-click `sync-skills-windows.cmd`, or run:

```powershell
.\scripts\windows\sync-skills.ps1
```

The helper validates the files before changing n8n. It publishes the localhost-only sync endpoint briefly, replaces one `agent_config` row, unpublishes the endpoint, and restarts n8n. Start a new browser conversation after a successful sync.

See [CUSTOMISE_SKILLS.md](CUSTOMISE_SKILLS.md).

## Export workflow copies

Export after making a deliberate visual workflow change:

### macOS

```bash
./scripts/export-workflows.sh
```

### Windows

```powershell
.\scripts\windows\export-workflows.ps1
```

The scripts write timestamped, normalised copies below `n8n/exports/`. That directory is ignored by Git. The normaliser removes local ownership metadata, keeps committed workflows inactive, and restores reviewed credential references. A contributor must still inspect every diff before promoting one file into `n8n/workflows/`.

Follow [WORKFLOW_DEVELOPMENT.md](WORKFLOW_DEVELOPMENT.md) for the exact export, comparison, promotion, validation, and pull-request path.

The local task rows are data, not workflow JSON. They live in the persistent `data/` folder and are included by the repository backup process.

## Conversation memory

The first workflow uses n8n Simple Memory:

- The browser's `sessionId` separates one conversation from another.
- The latest six interactions are supplied to the agent.
- Selecting **New conversation** in the browser creates a fresh session.
- Memory is held inside the running n8n process, not in the persistent data folder.
- Restarting or stopping n8n clears conversation memory.

Workflows, the n8n owner account, and encrypted credentials do persist across a normal restart. Durable conversation history is deliberately deferred from the local beginner release.

## Local task data

Open **Data tables** in n8n to inspect:

- `tasks`: the project source of truth.
- `tool_audit`: one record for every task-tool attempt, including validation errors.
- `pending_actions`: exact, session-bound write proposals and their status.
- `agent_config`: the currently enabled, content-addressed skill bundle.

Running workflow import again does not duplicate the three sample tasks or overwrite edited sample rows. `list_tasks` can run automatically. The model-facing create and update tools can store proposals but cannot mutate `tasks`; only the deterministic confirmation workflow can dispatch a reviewed write worker.

## Extracted document context

Uploaded source files are not stored. Their extracted text is held in
`data/documents/` for up to 24 hours and is removed on
expiry, when the browser removes it, or when the whole stack is reset.

The normal backup intentionally excludes this temporary document volume. Keep
the original source files somewhere appropriate if they must be retained.

## Create a backup

A backup contains:

- The complete local n8n data directory.
- Local users and settings.
- Workflows and execution data.
- Encrypted credentials.
- n8n's own private encryption-key file, which is required to decrypt those credentials.

Backups are written below `backups/YYYYMMDD-HHMMSS` and ignored by Git.

### macOS

Double-click `backup.command`, or run:

```bash
./scripts/backup.sh
```

### Windows

Double-click `backup-windows.cmd`, or run from PowerShell:

```powershell
.\scripts\windows\backup.ps1
```

The backup helper briefly stops n8n to produce a consistent database and filesystem archive. If n8n was running before the backup, the helper starts it again and waits for the stack to become healthy.

Treat the backup directory as a secret. Do not commit, upload, or share it casually.

## Restore a backup

Restore replaces all current local n8n data. Create a fresh backup first if the current state matters.

### macOS

```bash
./scripts/restore.sh backups/YYYYMMDD-HHMMSS
```

Type `RESTORE` when prompted.

### Windows

```powershell
.\scripts\windows\restore.ps1 -BackupDirectory .\backups\YYYYMMDD-HHMMSS
```

Type `RESTORE` when prompted.

Restore reinstates the complete n8n data directory, including the matching encryption key, then starts the stack and waits for healthy services. Backups made by the earlier Docker-based release restore the same way: their archive format and `env.backup` file are both understood.

## Reset all local app data

Reset permanently removes:

- The local n8n owner account.
- Credentials.
- Workflows.
- Execution history.
- Everything else inside `data/n8n`.
- Temporary extracted document context inside `data/documents`.

It preserves `.env` when one exists.

Create a backup first if any local state matters.

### macOS

Double-click `reset.command`, or run `./scripts/reset.sh`.

Type `RESET` when prompted.

### Windows

Double-click `reset-windows.cmd`, or run `.\scripts\windows\reset.ps1`.

Type `RESET` when prompted.

After reset, start the stack and create a new local n8n owner account.

## Update pinned versions

The n8n version is intentionally pinned in `package.json` (and mirrored by the digest-locked image in `compose.yaml` for the Docker-based smoke tests and future deployment). Do not change it during a live workshop.

To evaluate an update:

1. Create a backup.
2. Change the pinned version on a separate branch (`package.json`, the lockfile, and the matching `compose.yaml` digest).
3. Run setup and the smoke tests.
4. Test setup, persistence, backup, restore, and the current workflows.
5. Record the tested version in the pull request.

Do not replace pinned versions with `latest`.

## Secret hygiene

- `data/` is ignored by Git and holds the n8n database, encrypted credentials, and the private encryption key.
- `.env` is ignored by Git and is optional.
- `backups/` content is ignored by Git.
- `.env.example` contains placeholders, not working secrets.
- The chat gateway has no n8n encryption key or Claude API key.
- Workflow exports can contain credential names and IDs, but never commit a manually created credential export or an API key.

If the `data/` folder or a backup is exposed, replace the local credentials before using that instance again.
