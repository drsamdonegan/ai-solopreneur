# Changelog

All meaningful product changes are recorded here. This project uses semantic
versioning for local workshop releases.

## Unreleased

### Added

- Seven learner-facing skill packages with the intended agent-card inventory:
  Project Manager 1, Sales 2, Marketing 2, Investment 1, and Bookkeeping 1.
- A real Crustdata-backed LinkedIn Prospect Search for role, sector, location,
  and company-size discovery, capped at ten public professional results and
  0.30 credits after fresh approval for every call.
- Package-aware surgical installation, dependency resolution, optional
  extensions, GitHub package links, and legacy module-ID compatibility.
- A two-module Xero Bookkeeping package for the Bookkeeping agent. A read-only
  Chrome helper captures the complete queue visible on the learner's open Xero
  Reconcile page through a one-use loopback token; the accounting reasoner then
  uses current Xero catalogues, invoices, contacts and history plus saved company
  context. It prepares only explicitly approved high-certainty rows and keeps a
  likely description and one useful question for everything less certain.
- An optional write lane in that skill, behind a separate `Xero (read-write)`
  credential the learner consents to on its own: it creates accepted suggestions
  as new unreconciled Xero transactions. It never reconciles, edits or deletes
  anything, and it refuses any row that changed after the learner accepted it.
- Freshness, source-hash, existing-ContactID, exact catalogue, duplicate-reference,
  structural-case, and confidence gates that fail closed before any Xero create.
- Receipt evidence from the learner's own mailbox when the Monthly Update
  skill's `Gmail (read-only)` credential happens to be connected. Reviews work
  unchanged without it.
- `docs/XERO_RECONCILIATION.md`, covering the Xero developer app for both the
  local and Railway callbacks, why the built-in Xero node is not used, and what
  a review sends where.

### Changed

- SEO article jobs now prebuild their version payload in a Code node before the
  n8n HTTP request, so the expression parser can no longer stop every draft at
  the save boundary. The real expression is covered by the pinned n8n runtime.
- Article source discovery now rejects DataForSEO API provenance URLs and carries
  paid and free competitor domains into the writer as public-page candidates.
- Draft and repaired-draft checks now use the same Markdown-, case-, and inline-
  whitespace-aware evidence rules as server storage, and the server's complete
  quality gate runs before the one permitted repair instead of first appearing
  at save time.
- Background writer dispatch failures now terminally fail the new job instead of
  reporting a queue that will never run. Marketing also ends its reply after a
  successful queue and never self-polls the article tool in the same turn. The
  article progress card retries transient read failures with capped backoff.
- Article context-load failures and malformed model FAQ entries now enter an
  explicit repair or terminal-failure branch instead of throwing out of the
  workflow. Progress reads also fail stale workers after the n8n execution
  window, so a crashed attempt cannot display as writing forever.
- ChatStore now reconciles the required article tables, columns, and indexes from
  SQLite structure as well as `user_version`, making copied installations safe
  when a private fork already used schema version 6 for different changes. A
  late worker can no longer resurrect a failed or interrupted article attempt.
- Both the generic optional-skill installer and the dedicated writer upgrader
  now reject an older private-fork chat host before changing any installed
  skill, workflow, agent, or policy file. Workflow 56 also checks a versioned
  host contract before job creation, protecting installs made by an older
  generic installer.
- Paid domain research now applies its documented `standard`, Australia, and
  English defaults when n8n supplies empty optional fields.
- Simple custom Marketing article requests now bypass model discretion and
  call the writer deterministically. The current instruction also reaches the
  tool directly, so neither a skipped call nor an omitted model argument can
  turn an explicit topic into a numbered-choice prompt.
- Deterministic article replies now consume the writer tool's actual top-level
  result contract, preserving precise queued, prerequisite, and failure states
  instead of masking them behind a generic safe-failure message.
- Article registration now accepts the workflow's documented zero sentinel for
  a custom topic, so an explicit topic cannot be rejected as an invalid numbered
  choice before keyword research starts.
- Grounding checks now normalize Unicode and whitespace and inspect actual draft
  strings rather than JSON-escaped text. Formatting-only differences no longer
  produce false unsupported-claim failures; URLs and source wording still have
  to match the verified evidence.
- Repaired drafts retain every claim-ledger row for review and reject any row
  whose sentence no longer exists in the article. Claims still require verified
  IDs and excerpts, and terminal failures now distinguish incomplete model
  output, source mismatches, and genuinely unsupported content.
- Reference excerpts that the model paraphrases are now replaced with exact text
  from the same already-verified source page. The selected source ID and URL must
  still match, and claim-ledger excerpts keep their strict grounding checks.
- Article progress writes now sit inline before each source, model, repair, or
  save operation, with the article payload restored immediately afterwards.
  This makes stage timing independent of n8n sibling-branch scheduling.
- Agent cards now show stable packages and installation/sync state instead of
  exposing every internal Markdown skill as a separate product feature.
- Existing capabilities are retained as package modules or add-ons: paid
  domain research and Monthly Update are optional extensions; Scheduler and
  Telegram remain separate cross-cutting add-ons.

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
