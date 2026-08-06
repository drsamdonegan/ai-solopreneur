# AI Solopreneur

Build and personalise a useful Claude-powered project assistant on your own computer. No manual Node.js install is required: Claude Code or the one-click setup selects the reviewed Node.js 24.18.0 and npm 11.16.0 pair, downloading a verified private copy inside this project when that exact pair is not already available.

**Local release:** `v0.2.0`

If this is your first technical project, use the
**[complete beginner getting-started guide](docs/GETTING_STARTED.md)**. It
explains every name, click, success check, stop/start action, and recovery path
in plain language.

In about 30 minutes you will have:

- Your own browser chat.
- A visual n8n agent you can inspect.
- Claude connected through a private n8n credential.
- PDF, DOCX, TXT, and long-transcript input.
- Local project tasks and conversation memory.
- Editable Markdown skills.
- Confirmation-gated task creation and status changes.

Everything runs locally as ordinary Node.js processes. Nothing is deployed to the cloud in this release.

![The finished local chat rejecting plain yes and accepting an exact confirmation](docs/images/03-chat-confirmation.png)

## Start here

### 1. Prepare the things you need

- A GitHub account.
- Claude Desktop, open in Code mode.
- GitHub Desktop if you want its visual commit-and-push workflow.
- An Anthropic Console API key with a small amount of API credit.
- At least 6 GB of free disk space for first setup; 8 GB is recommended.

Use the detailed [workshop prerequisites](docs/WORKSHOP_PREREQUISITES.md) if any item is unfamiliar. A Claude web subscription does not include API usage.

Windows support is Windows 10 or 11 on x64, plus Windows 11 on ARM through its
built-in x64 emulation. Windows 10 on ARM is not supported. On Windows, keep the
project in a short local folder outside OneDrive and network/UNC paths.

Never paste the Claude API key into GitHub, `.env`, a chat message, a screenshot, or `agent.config.js`. You will enter it only in n8n.

### 2. Create your own repository

1. On this repository's GitHub page, select **Use this template**, then **Create a new repository**.
2. Choose your account, give the project a name, and select private visibility for workshop work.
3. Leave **Include all branches** off.
4. Select **Create repository**.
5. Select **Code**, keep **HTTPS** selected, and copy your repository URL.
6. Open Claude Desktop in Code mode and ask: `Please clone this repo: <paste your repository URL>`. On Windows, add: `Use a short local folder outside OneDrive or a network path.`
7. Open the cloned project in the Claude Code session.

The [GitHub Desktop guide](docs/GITHUB_DESKTOP.md) remains available as a visual cloning fallback and explains how to review, commit, and push your customisations.

### 3. Run the one-click setup

In the cloned project's Claude Code session, ask:

```text
Read the README and the existing setup scripts in this repository.
Start the local services using the project's documented one-click setup.
On Windows, set AI_SOLO_NO_PAUSE=1 before running the .cmd helper.
Keep them running, verify the chat and n8n URLs, then open those two pages for me.
```

Claude runs the matching helper. Setup accepts an existing Node.js 24.18.0 only
when it has the matching npm 11.16.0; otherwise it downloads the official
Node.js archive, verifies its SHA-256 checksum, and keeps the reviewed pair in
the Git-ignored `.runtime/` folder. It does not install anything globally or
request administrator access. `AI_SOLO_NO_PAUSE=1` lets the Windows launcher
return its real status to Claude Code without waiting for a key; double-clicked
launchers still pause so a learner can read the result.

You can also run the same setup without Claude:

#### macOS

Double-click `setup.command`.

If macOS blocks it, Control-click the file, choose **Open**, then confirm.

#### Windows

Double-click `setup-windows.cmd`.

Setup prepares the reviewed Node.js 24.18.0 and npm 11.16.0 pair when needed,
checks disk space, folder access, and all required local ports, downloads the exact
pinned n8n release and document-reader packages, builds the chat app, starts all
three services in the background, imports all reviewed workflows, creates three
sample tasks, and loads the enabled skills. First setup can take several minutes
while packages download.

Success ends with:

```text
Local stack is healthy.
  Chat app:          http://localhost:3000
  n8n editor:        http://localhost:5678
  Next: create the local n8n owner, then open 01 - START HERE - Learner Checklist.
```

If automatic workflow import is interrupted, wait for n8n to become healthy and use the manual fallback:

- macOS: double-click `import-workflows.command`.
- Windows: double-click `import-workflows-windows.cmd`.

The fallback is safe to repeat and does not duplicate the sample tasks.

### 4. Create the local n8n owner

Open [http://localhost:5678](http://localhost:5678). On the first visit, create the owner account. Use a private password; this account exists only inside this project's Git-ignored `data/` folder on this computer.

![The local n8n owner-account screen](docs/images/01-n8n-owner-setup.png)

When the n8n Overview appears, open `01 - START HERE - Learner Checklist`. Its five cards take you through the remaining setup.

![The five-step learner checklist inside n8n](docs/images/02-n8n-learner-checklist.png)

### 5. Connect Claude and publish the two entry points

1. In n8n, open **Credentials**.
2. Create an **Anthropic** credential named `Anthropic account`.
3. Paste the API key into its **API Key** field and save.
4. Open `00 - START HERE - Project Partner`.
5. Open **Claude - Sonnet 4.6**, select `Anthropic account`, and save.
6. If you will use domain research, open `50 - TOOL - start_domain_research` and check that **Analyse With Claude** shows `Anthropic account`. Import matches it by name, so usually it is already selected. If it is empty, select it and save.
7. Select **Publish**.
8. Open `90 - DEBUG - Agent Health` and select **Publish**.

The key stays in n8n's encrypted credential store. The browser and chat gateway never receive it.

### 6. Check readiness

Run the friendly diagnostic:

- macOS: double-click `diagnose.command`.
- Windows: double-click `diagnose-windows.cmd`.

The helper checks Node.js, all three local services, the installed checklist, the published agent, the selected Anthropic credential, and the health workflow. It does not call Claude and never displays credential values.

Follow any yellow `[next]` line, then run it again. Continue when it reports:

```text
All checks are green. The local agent is ready for a real Claude message.
```

### 7. Send three proof messages

Open [http://localhost:3000](http://localhost:3000), then try:

1. `Turn my project idea into three clear next steps.`
2. `What tasks are in my local project?`
3. `Create a high-priority task to invite the pilot group.`

For the third message, check the proposed fields and send the exact `CONFIRM XXXXXXXX` phrase as a separate message within five minutes. Plain `yes` must not change a task.

You now have a working local AI agent.

### 8. Try a meeting transcript or document

1. Select the **+** inside the message box, then choose **Upload a file** and
   select a PDF, DOCX, or TXT file, or choose **Paste long text** and add a
   transcript.
2. Wait until the document appears as a removable chip inside the message box.
3. Enter an instruction such as
   `Summarise this meeting, separate decisions from ideas, and list action items with owners and due dates.`
4. Select **Send**.

The chip leaves the message box when sent and appears above your message in the
conversation, so it is always clear which file the agent received.

The document is read locally. Its extracted text is sent to Claude with your
instruction, so do not add secrets you would not send to the Anthropic API.
Scanned image-only PDFs need OCR and are not supported yet. See
[Use documents and long transcripts](docs/DOCUMENT_UPLOADS.md).

## Make it yours

Start with two beginner-safe changes:

1. Change the name, welcome message, colour, and example prompts in `apps/chat/public/agent.config.js` using [Customise the chat](docs/CUSTOMISE_CHAT.md).
2. Change one instruction in `skills/project-assistant/SKILL.md`, then run the skill-sync helper using [Customise with Markdown skills](docs/CUSTOMISE_SKILLS.md).

Use [the finished example](examples/finished-solo-project-assistant/README.md) as a reference. It shows a complete alternative personality while keeping every editable source file visible.

In GitHub Desktop, review the changed files, write a short summary such as `Customise my project partner`, select **Commit to main**, then **Push origin**.

## Protect and recover local work

Before a workshop experiment or workflow edit, create a private backup:

- macOS: double-click `backup.command`.
- Windows: double-click `backup-windows.cmd`.

Backups contain plaintext saved chats, encrypted credentials, and local settings.
They are ignored by Git and must stay private.

Normal stop/start restores saved chats and recent per-conversation context.
Reset permanently removes saved chats, local n8n accounts, credentials,
workflows, execution history, and extracted document context:

- macOS: double-click `reset.command`.
- Windows: double-click `reset-windows.cmd`.

Reset asks you to type `RESET`. The [operations and recovery guide](docs/LOCAL_OPERATIONS.md) explains backup, restore, reset, and workflow export before you use them.

## What is included

- One cross-platform Node.js runner (`scripts/local.mjs`) behind every double-click helper.
- A checksum-verified Node.js 24.18.0 and npm 11.16.0 bootstrap for macOS and Windows, stored only inside `.runtime/` when the computer needs it.
- The exact pinned n8n release, installed with npm and kept in this project's folder.
- A TypeScript chat gateway, custom browser interface, and isolated document reader.
- Eleven reviewed n8n workflows, including the visual learner checklist.
- Durable local SQLite chat history with browsing, full-text search, rename,
  deletion, and restart-safe bounded conversation memory.
- Four local Data Tables for tasks, audits, pending confirmations, and enabled skills.
- Four editable Markdown skills, including grounded meeting analysis.
- A central agent registry with Project Manager active and Sales, Marketing,
  Investment, and Bookkeeping shown as coming soon.
- Local extraction for searchable PDFs, DOCX, TXT, and pasted text.
- Automatic reads and exact, expiring, single-use confirmation for writes.
- Local diagnostics, backup, restore, reset, import, export, and skill-sync helpers.
- macOS and Windows entry points.

Deliberately deferred: OCR for scanned PDFs, cloud deployment, public access,
Slack, WhatsApp, Telegram, email, external project-management accounts,
multi-user authentication, RAG, queues, and autonomous background work.

## Guides

### Learners

- [Complete beginner getting-started guide](docs/GETTING_STARTED.md)
- [Workshop prerequisites](docs/WORKSHOP_PREREQUISITES.md)
- [Detailed local setup](docs/LOCAL_SETUP.md)
- [GitHub Desktop workflow](docs/GITHUB_DESKTOP.md)
- [Connect the visual agent to Claude](docs/N8N_AGENT_SETUP.md)
- [Customise the chat](docs/CUSTOMISE_CHAT.md)
- [Customise Markdown skills](docs/CUSTOMISE_SKILLS.md)
- [Use documents and long transcripts](docs/DOCUMENT_UPLOADS.md)
- [Understand durable local chat memory](docs/CHAT_PERSISTENCE_PLAN.md)
- [Troubleshooting quick table](docs/TROUBLESHOOTING.md)

### Instructors

- [Eight-exercise course guide](docs/COURSE_GUIDE.md)
- [Local release and instructor kit](docs/RELEASE.md)
- [Feedback and live-course change control](docs/FEEDBACK_AND_CHANGE_CONTROL.md)
- [Instructor checklist](docs/INSTRUCTOR_CHECKLIST.md)
- [Non-technical learner pilot](docs/PILOT_RUNBOOK.md)
- [Pilot findings](docs/PILOT_FINDINGS.md)
- [Workshop go/no-go checklist](docs/GO_NO_GO.md)
- [Prioritised usability fixes](docs/USABILITY_FIXES.md)
- [Template release checklist](docs/TEMPLATE_RELEASE.md)
- [Local operations and recovery](docs/LOCAL_OPERATIONS.md)
- [Finished example](examples/finished-solo-project-assistant/README.md)

### Technical contributors

- [Product baseline](docs/PRODUCT_BASELINE.md)
- [Chat API contract](docs/CHAT_CONTRACT.md)
- [Add another agent or workflow](docs/ADD_AN_AGENT.md)
- [Local task tools](docs/LOCAL_TASK_TOOLS.md)
- [Safe write confirmation](docs/SAFE_WRITE_CONFIRMATION.md)
- [n8n workflow exports](n8n/README.md)
- [Move visual workflow changes back into Git](docs/WORKFLOW_DEVELOPMENT.md)
- [Phased implementation plan](docs/IMPLEMENTATION_PLAN.md)

Technical checks run directly with the same reviewed Node.js and npm pair used
by the learner helpers:

```bash
node scripts/validate-workflows.mjs

# The evaluator remains NO_GO because the owner waived, rather than fabricated,
# the planned human pilot.
./scripts/evaluate-pilot.sh
```

The maintenance helpers are also available directly: `node scripts/local.mjs help` lists setup, start, stop, status, logs, diagnose, and the import, export, backup, restore, and reset commands. The repository does not currently include an automated test or CI/CD suite; contributors should validate workflow structure and manually exercise the affected learner path before sharing a change.

## Current milestone

Phases 0–8 of the local-first implementation plan are implemented for local
release `v0.2.0`, using a verified project-local Node.js runtime throughout.
The repository owner reviewed the experience and
explicitly authorised Phase 8 without the planned five-person pilot. That
waiver is recorded transparently: `pilot/results.json` remains `not_run` and
the evaluator remains `NO_GO`. Cloud deployment, external chat channels, and
production hardening remain deferred.
