# Local Troubleshooting

## Start with this table

Run `diagnose.command` on macOS or `diagnose-windows.cmd` on Windows first. It does not call Claude or display credential values.

| What you see | Most likely cause | First action |
| --- | --- | --- |
| Node.js download fails | nodejs.org is blocked, offline, or interrupted | Check the connection or managed-device policy, then rerun setup |
| Node.js SHA-256 safety check fails | The archive is incomplete or does not match the reviewed release | Delete nothing; rerun setup once, then ask a facilitator if it repeats |
| npm reports `EPERM`, `EBUSY`, or a very long path | OneDrive, a network folder, antivirus, or path length is locking native packages | Move the project to a short local folder such as `C:\ai-workshop\ai-solopreneur`, then rerun setup |
| npm cannot download SheetJS or a native binary | An asset host is blocked even though the npm website opens | Allow `cdn.sheetjs.com` and `release-assets.githubusercontent.com`, then rerun setup |
| A required port is in use | Another local app or project copy owns the chat, document, n8n, or task-broker port | Close that app or change the matching `.env` value |
| Setup pauses a long time on the npm download | Large first download | Wait; later runs reuse the download. Run setup at home before a workshop |
| Chat opens but says the agent is not ready | Workflow `00` is not published | Follow the yellow diagnostic action and publish workflow `00` |
| Upload says the document reader is not ready | `document-worker` is still starting or stopped | Restart the local stack, wait for it to become healthy, then retry |
| PDF says no readable text was found | The PDF is probably an image-only scan | Create a searchable PDF with trusted OCR software or paste reviewed text |
| File type is unsupported | The file is not searchable PDF, DOCX, or UTF-8 TXT | Export it to a supported format and retry |
| Diagnostic says the Anthropic credential is missing | The Claude node still references a nonexistent placeholder | Create `Anthropic account`, select it in the Claude node, save, and publish |
| n8n Overview has no learner checklist | Automatic import was interrupted | Run the platform's `import-workflows` fallback |
| Claude returns an authentication error | API key is invalid or revoked | Replace only the n8n credential; never put the key in a file |
| Claude returns a credit/rate error | API billing or workspace limit | Check the Anthropic Console balance and limits |
| Plain `yes` does not create a task | Expected safety behaviour | Send the exact, current `CONFIRM XXXXXXXX` phrase |
| A skill edit has no effect | Bundle was not synced or conversation memory is old | Run the skill-sync helper and start a new conversation |
| Data vanished after reset | Reset removed the local data folder | Restore the latest complete private backup |
| `.command` is blocked on macOS | Gatekeeper has not approved that local script | Control-click it, choose **Open**, then confirm |
| A `.cmd` window closes or reports an execution error | A download, managed-device, or project script failure | Rerun it and read the first red or `[!!]` line |

## The private Node.js download fails

Every helper requires the reviewed Node.js 24.18.0 and npm 11.16.0 pair. If the
exact pair is unavailable or incomplete, setup downloads and repairs a
checksum-verified private copy in `.runtime/`. Nothing is installed globally.

If the download fails:

1. Confirm the computer can reach `nodejs.org`, `registry.npmjs.org`,
   `cdn.sheetjs.com`, and `release-assets.githubusercontent.com`.
2. Confirm at least 6 GB of free disk space remains; 8 GB is recommended.
3. Rerun `setup.command` on macOS or `setup-windows.cmd` on Windows.
4. On Windows, use a short local folder outside OneDrive and network/UNC paths.
5. If a company-managed computer blocks downloads or project-local executables,
   ask a facilitator. Do not install a different Node/npm version as a
   workaround; the pinned native dependencies require the reviewed pair.

Never bypass a repeated SHA-256 mismatch. It prevents an unexpected archive from running.

## A required local port is already in use

Another application is listening on the required local port.

Either close that application or copy `.env.example` to `.env` and change the matching value:

```dotenv
CHAT_PORT=3000
N8N_PORT=5678
# N8N_RUNNERS_BROKER_PORT=5679
```

The internal broker defaults to `N8N_PORT + 1`; set its commented value only if
that derived port also conflicts. After changing a browser-facing port, use the
new localhost address in the browser.

## The chat app does not open

1. Open [http://localhost:3000/health](http://localhost:3000/health).
2. Run the start script again.
3. Run the diagnostic helper.
4. Technical helpers can run `node scripts/local.mjs status` and
   `node scripts/local.mjs logs chat`.

The chat service starts only after n8n and the internal document reader are
healthy.

## A document will not upload

The document reader accepts searchable PDF, Word `.docx`, and UTF-8 `.txt`
files up to 20 MB.

1. Confirm the file has one of those extensions.
2. For a PDF, try selecting a sentence. If you cannot, it is probably an
   image-only scan and needs OCR before upload.
3. Confirm the file is not password protected.
4. Restart the local stack and wait for the chat to open.
5. Retry with a small plain-text file.

Technical helpers can run:

```bash
node scripts/local.mjs status
node scripts/local.mjs logs documents
```

The original file is processed locally. Extracted text is sent to Claude only
when the user submits a chat request. See
[DOCUMENT_UPLOADS.md](DOCUMENT_UPLOADS.md) for limits and privacy behaviour.

## The chat says the local agent is not ready

The page and chat gateway are working, but n8n does not yet have an active `/webhook/chat` workflow.

1. Run the workflow import command for the computer.
2. Open n8n and confirm `00 - START HERE - Project Partner` is published.
3. Confirm its production webhook path is exactly `chat`.
4. Check the workflow's most recent execution for a failed node.
5. Restart the local stack and try again.

The browser intentionally does not show raw workflow errors or credentials.

## A workflow does not appear after import

1. Confirm the terminal reported `Workflows imported successfully`.
2. Refresh the n8n Overview.
3. Check that the local n8n owner account has been created.
4. Run the import fallback again; the fixed workflow IDs prevent duplicate copies.
5. Ask a technical helper to run `node scripts/local.mjs logs n8n`.

First setup normally imports all eleven workflows automatically. The main agent, health workflow, learner checklist, and temporary setup workflows remain inactive until viewed, run manually, or deliberately published. The import helper publishes the six reviewed runtime dependencies automatically.

## Claude credential is missing or invalid

Open `00 - START HERE - Project Partner`, then open **Claude - Sonnet 4.6**.

1. Select a credential named `Anthropic account`, or create it if it does not exist.
2. Paste only an Anthropic Console API key into the **API Key** field.
3. Leave **Base URL** at its default for real Claude use.
4. Save the credential, save the workflow, and publish it again.

An Anthropic web-chat subscription is separate from API access. Follow [N8N_AGENT_SETUP.md](N8N_AGENT_SETUP.md) for the supported credential steps.

## Claude reports a credit or rate-limit error

Anthropic API use requires API billing and available usage credit. Open the Anthropic Console to check the workspace's usage, limits, and billing. Add only a small workshop budget and keep the supplied response and iteration limits.

If billing is available, wait briefly and retry. Persistent 429 responses can also mean a workspace rate limit has been reached.

## The agent health endpoint does not work

Open [http://localhost:5678/webhook/agent-health](http://localhost:5678/webhook/agent-health).

- A small JSON response with `"status":"ok"` proves the debug workflow is published.
- An n8n 404 usually means `90 - DEBUG - Agent Health` has not been published.
- A failed n8n health check means the service itself needs attention.

This endpoint intentionally does not test Claude. Use an ordinary chat message for an end-to-end test.

## The agent forgot an earlier message

Saved chats survive n8n and gateway restarts. The agent receives the latest six
complete turns that fit within 24,000 characters; older messages remain
browsable and searchable but are not automatically sent to Claude.

Check:

1. The expected saved conversation is selected in **Chats**.
2. **New conversation** was not selected; new chats intentionally start clean.
3. The missing detail is within the latest six completed turns and was not part
   of an expired document that now needs to be uploaded again.
4. Diagnostics reports that the local chat database and search index are ready.

Do not add n8n Simple Memory to the workflow. SQLite history supplied by the
gateway is authoritative.

## The agent says local task data is not ready

Run the workflow import command again. It safely recreates missing table schemas and adds only missing sample rows.

Then:

1. Open **Data tables** in n8n.
2. Confirm `tasks`, `tool_audit`, `pending_actions`, and `agent_config` exist.
3. Confirm `20 - TOOL - list_tasks` is published.
4. Publish `00 - START HERE - Project Partner` again if the import refreshed its draft.

Do not create a replacement table with different column names; the reviewed tools intentionally expect the documented schema.

## The agent will not create or update a task

The first message only prepares a proposal. It must say that no task changed and show an exact phrase such as `CONFIRM A1B2C3D4`.

Check the proposed fields, then send the complete phrase as a separate message in the same browser conversation within five minutes.

- Plain `yes` is deliberately insufficient.
- A phrase from another browser conversation cannot work.
- A newer proposal supersedes the older phrase.
- An expired or already-used phrase requires a new proposal.

If a correct new phrase still fails, confirm workflows `30`, `31`, `40`, `21`, and `22` are published and rerun workflow import. Do not connect write workers `21` or `22` directly to the AI Agent.

See [SAFE_WRITE_CONFIRMATION.md](SAFE_WRITE_CONFIRMATION.md).

## A skill change did not appear

1. Save both `skill.yaml` and `SKILL.md`.
2. Confirm the skill ID appears exactly once in `skills/enabled.txt`.
3. Double-click `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
4. Wait for **Enabled skills synced successfully**.
5. Start a new browser conversation.

If validation fails, correct the file and rerun the helper. The previously valid bundle stays active. See [CUSTOMISE_SKILLS.md](CUSTOMISE_SKILLS.md).

## A task tool reports an invalid input

The task tools reject:

- Empty or longer-than-120-character titles.
- Descriptions longer than 2,000 characters.
- Unknown statuses or priorities.
- Invalid dates and task IDs.
- Reused request IDs containing different details.

Correct the specific field named in the response and retry. Every rejected attempt is also visible in `tool_audit`; it does not create or update a task.

## Chat customisation did not appear

1. Save `apps/chat/public/agent.config.js`.
2. Refresh the chat page.
3. Confirm the edited words remain inside quotes and prompts remain comma-separated.
4. Open the browser developer console only if a technical helper is available; a syntax error in the config file causes the safe default settings to load.

Normal changes to the agent name, subtitle, welcome message, colour, and example prompts do not require any rebuild.

## n8n does not open

1. Open [http://localhost:5678/healthz](http://localhost:5678/healthz).
2. Wait another minute on the first start; the first n8n boot prepares its local database.
3. Run the start script again.
4. Technical helpers can run `node scripts/local.mjs logs n8n` for the exact error.

## Log says the Python task runner is unavailable

The pinned n8n release starts its JavaScript task runner but may warn that the optional Python runner could not start when Python 3 is absent.

This does not make the service unhealthy and does not affect the visual agent, Claude integration, or JavaScript workflow nodes used by this project. Python Code nodes are outside the local-first release.

## A browser warns about secure cookies

The local stack explicitly disables n8n secure cookies because it uses local HTTP rather than public HTTPS. Confirm that the address begins with `http://localhost`, not a public hostname.

Public deployments require HTTPS and a different security configuration.

## Data disappeared

Stopping and starting preserves data. Data is removed only when the project's `data/` folder is deleted or the reset script is confirmed.

Look for a recent private backup below `backups/`. Follow [LOCAL_OPERATIONS.md](LOCAL_OPERATIONS.md) to restore it.

## Backup or restore fails

Check:

- Setup has prepared a working Node.js runtime and completed once.
- The selected backup contains `n8n-data.tar.gz` (or an `n8n-data` folder).
- A current-format backup also contains `backup.json` and
  `chat-data/chat.sqlite`.
- The backup path is local and accessible.
- There is enough disk space.

The backup includes n8n's own encryption-key file, so a complete backup restores
encrypted credentials correctly. Saved chat transcripts are plaintext and must
also be kept private. A partial copy of either database alone is not a complete
backup.

## Windows script execution error

Use the supplied `.cmd` wrappers. They invoke the repository's PowerShell shims
without changing the computer's permanent execution policy and preserve the
real success or failure status. Root wrappers include
`preflight-windows.cmd`, `export-workflows-windows.cmd`, and
`restore-windows.cmd`.

## macOS blocks a command file

Control-click the `.command` file, choose **Open**, then confirm. This allows the specific local script without broadly disabling macOS protections.

## Get diagnostic status

Learners should first double-click `diagnose.command` or `diagnose-windows.cmd`. Technical contributors can run:

```bash
./scripts/diagnose.sh
./scripts/preflight.sh
node scripts/local.mjs status
node scripts/local.mjs logs n8n
node scripts/local.mjs logs chat
```

Do not paste `.env`, credential exports, full backups, or logs containing secrets into a public issue.
