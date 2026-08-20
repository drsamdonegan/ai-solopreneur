# Changelog

All meaningful product changes are recorded here. This project uses semantic
versioning for local workshop releases.

## Unreleased

## 0.3.0 — 2026-08-19

### Added

- Five accessible agent cards and a settings dialog that separates workspace
  identity, shared business context, and per-agent context.
- A schema-v2 skill bundle, per-agent prompt/tool isolation, all-five-agent
  routing, migration preflight, and surgical feature-slice hand-off map.
- An inactive 08:00 daily Funding Radar trigger with shared duplicate-run
  protection.
- A cloud-only Telegram trigger that treats inbound messages as untrusted
  user text and sends plain-text replies through the configured bot.
- Durable plaintext SQLite chat history stored in the Git-ignored local data
  folder.
- Conversation browsing, full-text search, rename, delete, pagination, and
  mobile history navigation.
- Restart-safe bounded conversation context supplied by the gateway to n8n.
- Crash-safe request IDs, interrupted/failed turn states, and duplicate-response
  protection.
- Chat database diagnostics, redacted inspection, backup, restore, and reset
  support on macOS and Windows.
- Scheduler optional skill: a saved instruction and a time, carried out by
  whichever agent owns the skill being asked for. Daily, weekdays, weekly,
  monthly, or once; times default to Australia/Melbourne and are correct across
  daylight saving; results saved and read back on request. Its trigger ships unpublished, and a run more than six
  hours late is rolled on rather than run. All five agents hold its tools, and
  a schedule saved without a named agent runs as the agent that saved it.
- The agent's instructions now carry the current date and time, so "tomorrow",
  "next Monday", and "in three weeks" no longer send it back to the user asking
  what day it is.
- Schedules can be set relative to now: create_schedule takes a number of
  minutes and reads its own clock, because the model has none.
- Optional skills may declare `agent: global`, which wires their tools to all
  five agents and writes their tool rules into all five role policies.
  Re-running the installer now repairs a partial wiring rather than reporting
  the tool as already installed, which is the upgrade path for anyone who added
  the scheduler while it was project-manager only.

### Changed

- Agent selection now changes both prompt context and physical tool
  connections for Project Manager, Sales, Marketing, Investment, and
  Bookkeeping. Existing installations must re-import workflows `00` and `11`,
  then run skill sync; skill sync alone cannot replace the old single-agent
  graph.
- Monthly Update uses an explicitly named outbound-only Slack bot credential.
  Funding Radar reports remain local and are read back only in the chat.
- The n8n agent now validates contract version 3 history supplied by the
  gateway and no longer uses process-local Simple Memory.
- SEO Article Writer now works with free Domain Research; paid DataForSEO
  research is an explicit optional upgrade.
- Meeting action items use readable plain-text `-` lines.
- LinkedIn profile lookup is provider-only, needs approval for each Crustdata
  search, and reports unavailability instead of inventing public-search URLs.
- Funding runs now survive every n8n branch, distinguish missing from unreadable
  profiles, expose interrupted searches honestly, and never discard a paid
  result while building its report.
- Backups explicitly contain plaintext chat transcripts in addition to
  encrypted n8n credentials and settings.
- The Anthropic mock used before removal was corrected to distinguish the
  current instruction from restored conversation history; the previously
  failing native agent CI step passed after the fix.

### Removed

- Non-runnable optional catalogue entries and dead installer/build manifests.
- The inbound Slack trigger optional skill and learner guide. Its archived
  verification covered the `url_verification` echo, bot/self filtering,
  approximately 26 ms acknowledgements, deterministic UUID/thread mapping
  (including 20,000 unique threads), and successful CLI import/publish. A real
  Slack OAuth install and bot-token post were never verified.
- GitHub Actions CI/CD, automated test directories, smoke-test scripts, and
  package test commands, at the repository owner's direction after the
  persistence fix was confirmed.

### Deferred

- Xero Coding Review. Bookkeeping remains routable but v0.3 includes no
  accounting connector or accounting write capability.

## 0.2.0 — 2026-07-29

### Added

- Searchable PDF, DOCX, TXT, and long pasted-text context.
- An isolated, internal-only document reader with bounded extraction.
- A reusable agent registry with Project Manager active and four future roles.
- A grounded meeting-analysis skill and document prompt-injection boundaries.
- Beginner document guidance, agent-extension guidance, and document-aware
  native and CI checks.

The document reader runs as a third native Node.js service alongside n8n and
the chat.

### Changed

- The one-click setup, start, stop, diagnose, import, skill-sync, export,
  backup, restore, and reset helpers now run everything directly with Node.js.
- Learners no longer need to install Node.js or npm manually. The helpers use
  the exact reviewed Node.js 24.18.0 and npm 11.16.0 pair or download the pinned
  official archive, verify its SHA-256 checksum, and keep it inside `.runtime/`.
- Windows setup now supports Windows 10 and 11 on x64 and Windows 11 on ARM
  through its built-in x64 emulation. Windows 10 on ARM is explicitly
  unsupported because the pinned n8n native dependencies require x64.
- Windows preflight checks disk space, folder writability, local path risks,
  package-registry access, ports, and the reviewed runtime pair before the large
  install. First setup requires at least 6 GB free; 8 GB is recommended.
- Windows launchers preserve failures, support non-pausing Claude Code use, and
  include root helpers for preflight, workflow export, and backup restore.
- npm downloads use a private project cache with retries, quieter learner
  output, and a detailed local log path when installation fails.
- One cross-platform runner (`scripts/local.mjs`) replaces the parallel Bash
  and PowerShell implementations; the familiar double-click files remain and
  simply delegate to it.
- n8n runs from the exact npm-pinned release with its database, encrypted
  credentials, and logs stored in the Git-ignored `data/` folder inside the
  project.
- All three services now listen on 127.0.0.1 only, which also avoids the Windows
  firewall prompt.
- n8n generates and stores its own encryption key, so learners no longer need
  a `.env` file at all; an existing `.env` or backup key is still honoured, and
  ports remain configurable.
- Agent, packaging, resilience, browser, and occupied-port smoke tests all use
  isolated native project copies. CI exercises Linux, macOS, Windows x64, and
  Windows 11 ARM, including the learner-facing Windows launchers under Windows
  PowerShell.

### Unchanged

- The eleven reviewed workflows, the chat gateway, the confirmation safety
  model, and all learner-facing file names.
- Windows learners do not need WSL2, virtualization, or an administrator
  account.

## 0.1.0 — 2026-07-27

First complete local-first release candidate.

### Included

- One-click macOS and Windows setup through Docker Desktop.
- A learner-built browser chat connected to a visual n8n agent.
- Claude Sonnet through an encrypted n8n credential.
- Local tasks, audit records, conversation memory, and Markdown skills.
- Automatic task reads and exact-confirmation task writes.
- Beginner diagnostics, backup, restore, reset, import, export, and skill sync.
- A finished example, eight-exercise course, instructor kit, and feedback flow.
- Static, contract, PowerShell, Docker integration, and browser-width CI.

### Release decision

The repository owner reviewed the complete local experience and explicitly
authorised Phase 8 without the planned five-person pilot. The automated
evaluator therefore remains `NO_GO`; no participant evidence has been invented.
This release is suitable for local teaching and evaluation, not public or
production deployment.
