# Changelog

All meaningful product changes are recorded here. This project uses semantic
versioning for local workshop releases.

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
- Learners no longer need to install Node.js manually. The helpers use an
  existing Node.js 24+ runtime or download the pinned official Node.js 24.18.0
  archive, verify its SHA-256 checksum, and keep it inside `.runtime/`.
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
  isolated native project copies. CI exercises Linux, macOS, and Windows.

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
