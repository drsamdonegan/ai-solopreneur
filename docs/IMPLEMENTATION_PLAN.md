# AI Solopreneur implementation plan

## Objective

Build a local-first project assistant that a non-technical learner can copy,
start, inspect, customise, and extend with Claude Code. All runtime services
execute as project-local Node.js processes and bind to loopback addresses.

## Product principles

1. **Beginner first.** A learner can follow double-click helpers without
   understanding terminals, package managers, or process supervision.
2. **Private by default.** Services listen on `127.0.0.1`; credentials and data
   stay in ignored local folders.
3. **Visible automation.** n8n workflows remain the inspectable source of agent
   behavior.
4. **Safe writes.** Reads may run automatically. Writes require an exact,
   expiring, session-bound confirmation phrase.
5. **Pinned and reproducible.** Node.js, n8n, application dependencies, and
   browser-test dependencies are version locked and checksum verified.
6. **One runtime path.** Learners, contributors, and CI exercise the same native
   services and entry points.

## Supported scope

The local release includes:

- a browser chat gateway;
- n8n and eleven reviewed workflows;
- a bounded PDF, DOCX, TXT, and pasted-text reader;
- a Project Manager agent with local conversation memory;
- local task, audit, pending-confirmation, and skill tables;
- Markdown skills;
- backup, restore, reset, diagnostics, workflow import/export, and skill sync;
- macOS and Windows double-click entry points;
- Linux, macOS, and Windows CI coverage.

Deferred work includes public hosting, multi-user authentication, external chat
channels, OCR, queues, RAG, autonomous background execution, and production
operations.

## Runtime architecture

```text
Browser on localhost
        |
        v
Chat gateway (Node.js, loopback)
        |
        +----> Document reader (Node.js, loopback)
        |
        v
n8n webhook (Node.js, loopback)
        |
        v
Claude through an encrypted n8n credential
```

`scripts/local.mjs` owns installation, startup, shutdown, health checks, data
paths, workflow import, diagnostics, and recovery operations. It uses the exact
reviewed Node.js 24.18.0/npm 11.16.0 pair when available. Otherwise the platform
launcher downloads the pinned official runtime, verifies its SHA-256 checksum,
and keeps it under `.runtime/`.

Generated state lives under:

- `data/n8n/` for n8n state and encrypted credentials;
- `data/documents/` for extracted document context;
- `data/logs/` for bounded service logs;
- `data/run/` for process records;
- `backups/` for explicit local backups;
- `n8n/exports/` for reviewable workflow exports.

All are ignored where they may contain private or machine-specific data.

## Delivery phases

### Phase 0: Product baseline

- Define the learner, instructor, and contributor audiences.
- Set privacy, safety, support, and deferral boundaries.
- Establish pinned versions and repository conventions.

### Phase 1: Native local foundation

- Add the project-local Node.js bootstrap.
- Add the cross-platform runner and macOS/Windows wrappers.
- Start n8n, chat, and document-reader services on loopback ports.
- Add health checks, logs, status, stop, restart, and preflight commands.

### Phase 2: Learner chat

- Build the browser UI and gateway contract.
- Normalise provider, timeout, malformed-response, and inactive-workflow errors.
- Keep credentials out of the browser and gateway.

### Phase 3: Visual Claude agent

- Add request validation, memory, Claude, and stable response nodes.
- Reject malformed requests before any provider call.
- Add the safe agent-health workflow.

### Phase 4: Local task tools

- Add repeatable table setup and sample data.
- Implement narrow list, create, and status-update workers.
- Add validation, idempotency, and audit evidence.

### Phase 5: Skills and safe confirmation

- Compile enabled Markdown skills into a bounded agent bundle.
- Expose read tools automatically.
- Route writes through proposal and exact-confirmation workflows.
- Enforce expiry, supersession, single use, and concurrent-consumption safety.

### Phase 6: Beginner packaging

- Add automatic reviewed-workflow import without overwriting local edits.
- Add diagnostics, backup, restore, reset, and export helpers.
- Validate a fresh copied project with the same native setup learners use.

### Phase 7: Resilience and usability

- Test invalid credentials, exhausted credit, inactive workflows, occupied
  ports, restart recovery, and loss of local n8n.
- Validate mobile, tablet, and desktop layouts with Playwright.
- Keep pilot evidence structured and fail closed when evidence is incomplete.

### Phase 8: Release and course delivery

- Lock version metadata and dependencies.
- Generate a source-based instructor kit with workflows and checksums.
- Provide the course guide, release checklist, feedback process, and template
  readiness validation.

## Verification

The required local checks are:

```bash
node scripts/validate-workflows.mjs
node scripts/validate-template-readiness.mjs
node scripts/validate-release.mjs

./scripts/test-phase5.sh
./scripts/test-phase6.sh
./scripts/test-phase7.sh
./scripts/test-phase8.sh
```

CI repeats contract and static checks, Windows PowerShell parsing, native setup
on Linux/macOS/Windows, the full agent safety smoke, resilience checks, and
browser-width validation.

## Change policy

- Never commit `.env`, `data/`, backups, credentials, or learner documents.
- Keep exact versions in lockfiles; do not use `latest`.
- Export and normalise visual workflow changes before review.
- Preserve stable webhook and browser contracts.
- Add new write capabilities only after extending the confirmation boundary and
  adversarial tests.
- Record owner waivers and incomplete pilot evidence truthfully.
