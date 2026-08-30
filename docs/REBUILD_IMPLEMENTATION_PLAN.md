# Rebuild implementation plan

Status: proposed implementation sequence

Prepared: 18 August 2026

Target release: `v0.3.0`

This plan turns the August 2026 repository audit into an ordered build that can be released as a complete update or applied in documented feature slices. It is intentionally stricter where the audit left product decisions open, and it is self-contained so learners do not need the audit to use it.

## Outcomes

The release is complete when:

- the base learner handout builds and validates from a clean commit;
- selecting an agent changes both the instructions and the tools available to Claude;
- business and per-agent settings reach Claude without modifying tracked files;
- the five agent cards accurately show installed skills and open an accessible settings panel;
- the retained catalogue contains only capabilities that can actually run;
- Funding Radar has an optional daily trigger;
- the SEO writer works with the free domain-research path;
- Bookkeeping provides read-only Xero coding suggestions without claiming to reconcile bank statements;
- an existing learner can upgrade with a backup, re-import, sync, and verification sequence;
- each feature slice has a stable commit boundary and its own verification commands.

## Decisions locked for this build

1. **`linkedin-profile-lookup` remains optional.** Remove it from the base installation and keep the catalogue copy. A clean learner handout must not ship a paid provider tool that has not been configured.
2. **Remove `linkedin-prospect-search` from this release.** Its current Python/web-search instructions cannot run inside the n8n agent. Reintroduce it only with a real provider-backed tool and a separate cost decision.
3. **Agent scoping is real, not presentational.** The UI rework does not ship until n8n selects an agent-specific prompt and an agent-specific tool set.
4. **All five agents become routable together.** Each always has a safe role prompt. Skill-specific claims and tools appear only when the matching skill is installed and synced.
5. **Bookkeeping is publicly named “Xero Coding Review”.** Keep `xero-reconciliation` as the internal skill ID for continuity, but never claim that it reconciles a bank-statement line. Xero says unreconciled bank-statement data is not exposed through the public Accounting API and reconciliation must occur inside Xero.
6. **Use current granular Xero scopes.** Start with `offline_access accounting.banktransactions.read accounting.invoices.read accounting.settings.read`. Add `accounting.contacts.read` only if the implementation makes a direct Contacts request. Do not use the deprecated `accounting.transactions.read` scope or n8n's broad built-in Xero credential.
7. **Learner profile data stays outside Git.** The profile form writes JSON and generated prompt fragments under `data/profile/`; the skill compiler reads these overlays during sync. It must not rewrite tracked `skills/*/SKILL.md` files.
8. **Repository branch cleanup is post-release housekeeping.** It is not mixed into the product changes and is not required by students.

Current Xero references:

- [Accounting API bank-statement boundary](https://developer.xero.com/documentation/api/accounting/bankstatements)
- [OAuth scopes and granular replacements](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [Authorization-code flow and localhost redirect support](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
- [Developer pricing and connection limits](https://developer.xero.com/pricing)

## Release-slice contract

Every slice below must be one mergeable commit or one small pull request. Do not combine slices merely because they touch the same file.

Each completed slice must provide:

- a single purpose and no unrelated formatting changes;
- an explicit list of files changed;
- an upgrade note when an existing n8n workflow must be re-imported;
- a rollback note;
- automated verification plus any required browser or n8n smoke test;
- no uncommitted generated profile data;
- a short entry in `docs/FEATURE_SLICES.md` containing the final commit SHA.

The intended dependency order is:

`baseline` → `base repair` → `catalogue cleanup` → `skill bundle v2` → `real agent runtime` → `UI backend` → `UI frontend` → `target skills` → `Xero coding review` → `release and migration`

Students may take a later slice only when all of its dependencies are already present. `docs/FEATURE_SLICES.md` is the hand-off document for Claude Code: it names the slice, prerequisites, files, invariants, and verify command without requiring the full audit.

---

## Phase 0 — Stabilise and record the baseline

### Step 0.1 — Preserve the in-flight monthly-update work

Work in the existing `funding-radar-standalone` branch. Do not discard or overwrite the current changes under `optional-skills/monthly-update/`.

Rename the untracked Gmail check before committing:

- `optional-skills/monthly-update/workflows/68-tool-check-gmail-connection.json`
  → `69-tool-check-gmail-connection.json`;
- update the workflow `name`;
- update the matching manifest folder entry and cached display name;
- update `optional-skills/monthly-update/tests/pipeline.test.mjs`.

Commit the monthly-update files as their own slice, then land the funding-radar branch on `main`. Do not begin cleanup from a dirty feature branch.

Verify:

```sh
node optional-skills/monthly-update/tests/pipeline.test.mjs
node scripts/validate-workflows.mjs
node scripts/validate-release.mjs
git status --short
```

Expected: all commands pass and the worktree is clean.

### Step 0.2 — Save the known baseline

Run and save the output in the implementation PR:

```sh
node scripts/validate-workflows.mjs
node scripts/validate-release.mjs
node scripts/compile-skills.mjs
node optional-skills/monthly-update/tests/pipeline.test.mjs
node optional-skills/_installer/add-skill.mjs --list
```

Record the current `make-base` failure separately; it is the acceptance test for Phase 1.

```sh
REBUILD_TMP_DIR="$(mktemp -d)"
node scripts/make-base.mjs "$REBUILD_TMP_DIR/base"
```

### Step 0.3 — Add one canonical verifier

Create `scripts/verify.mjs` and add `npm run verify`. It should run, in order:

1. workflow validation;
2. release validation;
3. skill compilation;
4. every retained optional-skill test discovered from a declared test path in its manifest;
5. the chat TypeScript build;
6. `apps/chat`'s SEO article test.

The script must stop at the first failure and print the failing command. It must not start services or mutate data.

Verify:

```sh
npm run verify
```

Commit boundary: `chore(verification): add one read-only release verifier`.

---

## Phase 1 — Repair the distributable base

### Step 1.1 — Move LinkedIn lookup back to catalogue-only

Remove the installed copy and every base integration point:

- `skills/enabled.txt`;
- `skills/linkedin-profile-lookup/`;
- `n8n/workflows/61-tool-lookup-linkedin-profile.json`;
- its tuple in `tools/policy.json`;
- its folder placement in `n8n/folders.manifest.json`;
- its tool node and connections in `n8n/workflows/00-start-here-project-partner.json`;
- its policy paragraph in `Build Agent Context`.

Keep `optional-skills/linkedin-profile-lookup/` as the source of truth. Preserve the installer anchor beginning `- Delete, archive, bulk changes,` exactly.

### Step 1.2 — Derive local workflow inventories from disk

Replace the hard-coded optional workflow IDs and export file names in `scripts/local.mjs` with the same file-driven approach used by `scripts/cloud-workflows.mjs`.

Requirements:

- import/export only JSON files actually present in `n8n/workflows/`;
- derive publishable workflow IDs from those files;
- never fail because an uninstalled optional workflow is absent;
- unpublish anything already published if a later setup step fails.

### Step 1.3 — Commit, then prove the handout is fixed

Commit the Phase 1 slice before running `make-base`: the instructor tool deliberately reads committed `HEAD`, not the working tree.

Commit boundary: `fix(base): make the learner handout self-contained`.

```sh
npm run verify
REBUILD_TMP_DIR="$(mktemp -d)"
node scripts/make-base.mjs "$REBUILD_TMP_DIR/base"
(
  cd "$REBUILD_TMP_DIR/base"
  node scripts/validate-workflows.mjs
  node scripts/validate-release.mjs
  node scripts/compile-skills.mjs
)
```

Expected: `make-base` exits `0`, and the copied handout validates with only the four base project-management skills.

Rollback: revert this slice and restore the lookup integration as a complete unit; never restore only `enabled.txt`.

---

## Phase 2 — Remove capabilities that cannot honestly ship

### Step 2.1 — Preserve the only Slack setup knowledge still needed

Before deleting `slack-trigger`, write a standalone outbound-only Slack section in `docs/MONTHLY_UPDATE.md`:

- create a Slack app with only `chat:write`;
- install it to the workspace;
- create the named n8n Header Auth credential;
- attach it to `Post To Slack`;
- explain that no inbound events or webhook subscription are needed.

Attach the named credential to the monthly-update and funding-radar `Post To Slack` nodes. Set `onError: continueRegularOutput` and save the delivery failure in `errorSummary`.

### Step 2.2 — Delete five non-shipping catalogue entries

Delete each directory as one atomic directory removal:

- `optional-skills/competitor-content/`;
- `optional-skills/signal-research/`;
- `optional-skills/prospect-research/`;
- `optional-skills/slack-trigger/`;
- `optional-skills/linkedin-prospect-search/`.

Also remove the now-orphaned signal installer, signal documentation, dead workflow-tool manifest, dead skill-list builder, and obsolete validator block identified in the audit.

Do not delete `project-assistant`, `task-capture`, `weekly-status`, `paid-domain-research`, or any live runtime/deployment directory.

### Step 2.3 — Repair references and catalogue truth

Update:

- `optional-skills/README.md`;
- `docs/CUSTOMISE_SKILLS.md`;
- `docs/N8N_AGENT_SETUP.md`;
- `docs/CLOUD_DEPLOYMENT.md`;
- `docs/CLOUD_RUNBOOK.md`;
- `docs/WORKFLOW_DEVELOPMENT.md`;
- `scripts/cloud-workflows.mjs` comments;
- both copies of the `skill-finding-customers` description.

Move recorded Slack trigger test evidence to `CHANGELOG.md` rather than deleting it.

Verify:

```sh
npm run verify
node optional-skills/_installer/add-skill.mjs --list
rg -n \
  --glob '!docs/REBUILD_IMPLEMENTATION_PLAN.md' \
  "signal-research|prospect-research|competitor-content|slack-trigger|linkedin-prospect-search|tools\.manifest|build-skill-list" \
  README.md docs scripts n8n optional-skills
```

Expected: the catalogue lists the six retained audited skills, plus the later
cloud-only Telegram trigger and global Scheduler when that concurrent main-line
work is present.
The final search has no live references to removed skills other than an
intentional changelog/archive note.

Rollback: restore a removed skill only as a complete directory plus its docs and validator coverage.

Commit boundary: `refactor(catalogue): remove non-runnable optional skills`.

---

## Phase 3 — Build skill bundle schema v2 and fix profile sync

This phase creates the data model required by real agent scoping. Do not build the new cards against schema v1.

### Step 3.1 — Make agent ownership part of installed skill metadata

Allow and require an `agent` field in every `skill.yaml`:

```yaml
agent: project-manager | sales | marketing | investment | bookkeeping | global
```

Assign:

- project-management base skills → `project-manager`;
- LinkedIn lookup → `sales`;
- domain research, paid domain research, SEO writer → `marketing`;
- funding radar, monthly update → `investment`;
- Xero coding review, when added → `bookkeeping`;
- learner business facts → `global` context, not a tracked skill.

The metadata travels with a skill installed from a GitHub folder, so cloud and local installs do not depend on patching `apps/chat/config/agents.json`.

### Step 3.2 — Change `compile-skills.mjs` to emit schema v2

The v2 bundle should contain:

```json
{
  "schemaVersion": 2,
  "enabledSkills": [],
  "globalInstructions": "...",
  "agents": {
    "project-manager": { "skillIds": [], "instructions": "...", "context": "..." },
    "sales": { "skillIds": [], "instructions": "...", "context": "..." },
    "marketing": { "skillIds": [], "instructions": "...", "context": "..." },
    "investment": { "skillIds": [], "instructions": "...", "context": "..." },
    "bookkeeping": { "skillIds": [], "instructions": "...", "context": "..." }
  },
  "sourceHash": "..."
}
```

Rules:

- a skill appears in exactly one agent group unless its metadata is `global`;
- global instructions are included for every agent;
- an unknown agent ID fails compilation;
- each per-agent compiled instruction block has its own size guard;
- the source hash covers skill files and generated profile/context fragments;
- schema v1 remains readable by the n8n runtime during migration, but the compiler emits v2.

### Step 3.3 — Store profile output under `data/`, not `skills/`

Change `apps/chat/src/profile.ts` so a save writes:

- `data/profile/profile.json`;
- `data/profile/compiled/my-business.md`.

The compiler reads the generated Markdown as `globalInstructions`. If it is missing, it uses an empty safe context. It never requires or writes `skills/my-business/`.

Prefix every line of a writing sample with `> ` before placing it between markers. Add a regression test containing a forged `--- END WRITING SAMPLE 1 ---` line.

### Step 3.4 — Add per-agent settings overlays

Create `apps/chat/src/agent-settings.ts`. Save:

- source JSON at `data/profile/agent-settings.json`;
- one generated fragment per agent at `data/profile/compiled/agents/<agent-id>.md`.

Use registry-owned labels and field definitions. The request supplies values only. Unknown agent IDs and unknown fields are rejected or dropped as specified by the API contract. Block fields are line-prefixed with `> ` after length validation.

The compiler adds only the selected agent's generated fragment to that agent's v2 context. No agent can see another agent's settings.

### Step 3.5 — Upgrade the sync workflow

Update `n8n/workflows/11-setup-sync-enabled-skills.json` to validate and store schema v2. Keep a read-only v1 fallback in `00-start-here-project-partner.json` so an existing stored bundle produces a clear “sync required” state instead of crashing.

Update every compiler caller:

- local sync;
- cloud sync;
- workflow validator;
- command-line compiler.

After a successful sync, write the hash to `data/profile/skill-sync.json`. The chat API uses this later to distinguish “on disk” from “synced”.

Verify:

```sh
npm run verify
npm run sync-skills
```

Add automated assertions that:

- Sales receives the LinkedIn skill but not meeting-analysis;
- Investment receives funding-radar but not marketing skills;
- global business facts appear in all five groups;
- Sales settings do not appear in Bookkeeping context;
- saving a profile leaves `git status --short` unchanged.

Commit boundary: `feat(skills): compile agent-scoped bundles and data overlays`.

---

## Phase 4 — Make agent selection real in n8n

### Step 4.1 — Split common policy from role policy

In `00-start-here-project-partner.json`, keep one common policy for:

- tool risk and confirmation;
- document prompt-injection boundaries;
- history handling;
- secrets and internal data;
- concise, honest responses.

Add a validated role-policy map for the five agent IDs. `Build Agent Context` selects the role, v2 skill instructions, and v2 agent context using `request.agentId`.

### Step 4.2 — Route to five agent nodes with structural tool scoping

Add a switch after context construction and create one AI Agent node per role. Connect each tool workflow only to its owning agent:

- Project Manager: task reads and confirmation-gated task proposals;
- Sales: LinkedIn lookup;
- Marketing: domain research and article tools;
- Investment: funding radar and monthly update;
- Bookkeeping: Xero read/review tools.

All five nodes may share Claude credentials, memory limits, output parsing, and the final response path. They must not share tool connections.

Prompt wording alone is not accepted as tool scoping. A validator must fail when a tool is connected to the wrong agent or to more than one agent.

### Step 4.3 — Make the installer agent-aware

Each optional manifest declares `agent`. During installation:

- validate that the manifest agent matches `skill.yaml`;
- insert policy and workflow files as today;
- connect each installed `agentTools` workflow to the matching n8n agent node;
- fail before copying anything if the agent or anchor is unknown;
- make a second install a no-op;
- remove the misleading “Nothing else was changed” message unless rollback is actually complete.

Do not patch `apps/chat/config/agents.json` to make an installed skill visible. The UI discovers installed skills from their metadata.

### Step 4.4 — Activate all five routes atomically

In one commit:

- allow all five IDs in `Validate and Normalise`;
- make all five registry entries active with `/webhook/chat`;
- update the validator's allow-list assertion;
- add safe example prompts for Marketing, Investment, and Bookkeeping;
- update fallback agent definitions in both TypeScript and browser JavaScript.

Bookkeeping copy must say “coding review” and “suggestions”, never “automatic reconciliation”.

### Step 4.5 — Runtime verification

Add a fixture bundle with one unique marker per agent and one unique mock tool per agent. Prove that each selected agent receives only its marker and tool.

Manual smoke:

1. select Sales and ask for a task-list read — the task tool must not be available;
2. select Project Manager and ask for LinkedIn lookup — the lookup tool must not be available;
3. select Investment and request a funding scan — only Investment tools appear;
4. send an unknown `agentId` — request is rejected before Claude;
5. send a v1 stored bundle — response asks for a skill sync rather than mixing all skills.

Verify:

```sh
npm run verify
npm run import-workflows
npm run sync-skills
npm run restart
```

Existing students must re-import `00` and `11`; a plain skill sync is insufficient.

Commit boundary: `feat(agent-runtime): enforce prompt and tool scope per agent`.

---

## Phase 5 — Build the UI backend contract

### Step 5.1 — Extend agent registry schema

Bump `apps/chat/config/agents.json` to schema v2. Add:

- `accentColour`;
- at most two validated `settingsFields`;
- complete example prompts.

Do not add installed `skillIds` to this registry. Skill ownership comes from installed `skill.yaml` metadata. Keep an explicit public-field allow-list; never expose `workflowPath`.

### Step 5.2 — Read installed skills safely

Create `apps/chat/src/skills.ts`.

It must enumerate actual directories, validate their metadata, and then intersect with `skills/enabled.txt`. Never join an unchecked enabled-list string into a path. Skip a malformed optional folder in the UI response while logging a bounded warning; the release validator remains strict.

### Step 5.3 — Return one coherent `/api/agents` response

For each agent return:

- public identity and accent;
- settings-field definitions;
- installed skills belonging to that agent;
- `syncRequired`, determined by comparing the current compiled source hash with `data/profile/skill-sync.json`;
- no claim that setup or external credentials are complete.

Use one endpoint so the card list does not flash empty and then repopulate.

### Step 5.4 — Add `/api/agent-settings`

Implement GET and PUT using `AgentSettingsStore`. Return `syncRequired: true` after a successful save. Do not post directly to n8n from the chat gateway.

### Step 5.5 — Cloud paths

Add `SKILLS_DIRECTORY` and the profile-data path to the chat environment in `scripts/cloud.mjs`. Ensure cloud compilation reads `/data/skills` and `/data/profile`, not the stale image seed.

Verify:

```sh
(
  cd apps/chat
  npm run build
)
npm run verify
```

API smoke cases:

- normal skills directory;
- empty skills directory;
- one malformed optional folder;
- missing sync-hash file;
- valid and invalid settings updates;
- a block field containing forged Markdown markers.

Commit boundary: `feat(chat-api): expose agent skills and scoped settings`.

---

## Phase 6 — Rework the agent-card frontend

### Step 6.1 — Update semantic HTML

In `apps/chat/public/index.html`:

- rename the workspace header to “My AI Agent”;
- preserve the existing sidebar wrapper around status content;
- remove the incorrect list role from the agent container;
- add a reachable “My Business” button;
- change the global profile label to “What do you want to call this workspace?”;
- add a separate `#agent-dialog` after the profile dialog;
- use “What should your agent do?” before JavaScript hydrates.

### Step 6.2 — Implement identity separation

In `app.js`:

- the saved profile name controls the workspace identity only;
- the selected registry entry controls the chat-header identity;
- switching agents never renames the workspace;
- the saved avatar stays on the workspace mark;
- all fallback agent data matches the server registry.

### Step 6.3 — Replace rows and cogs with accessible cards

Each card is one button with:

- `data-agent-id` and `data-status`;
- `aria-current` for the selected agent;
- a visible status;
- an installed-skill icon row;
- one visually hidden skill summary;
- decorative chips hidden from the accessibility tree.

Every card opens the dialog. Selection happens through `Chat with <name>` inside the dialog. Do not disable cards that lack installed skills.

Build SVG icons with DOM methods. Do not use `innerHTML` for skill metadata.

### Step 6.4 — Add the agent dialog

The dialog contains:

- role name and description;
- installed skills and descriptions;
- generated settings fields with explicit labels;
- sync status;
- Close, Save, and conditional Chat actions.

Saving settings persists them but says that `npm run sync-skills` is still required. The Chat button closes the dialog before switching, then restores focus safely.

### Step 6.5 — Add CSS tokens and responsive behaviour

In `styles.css`:

- define the fallback accent tokens before the agent-specific blocks;
- use lightened tints rather than opacity for incomplete states;
- keep status text on the darker ink token;
- anchor tooltips to the icon row and open them downward inside the scrolling sidebar;
- suppress hover tooltips on coarse or non-hover pointers;
- extend dialog textarea and scrolling overrides to `.agent-dialog`;
- remove dead cog/row/button styles;
- honour reduced motion.

No inline style attributes: the app's CSP does not allow them.

### Step 6.6 — Browser acceptance pass

Test desktop and a viewport at or below `50rem`:

- all five cards open;
- cards have distinct accents and text contrast of at least 4.5:1;
- skill tooltips are not clipped;
- screen readers announce the skill summary once;
- Escape closes the dialog before the mobile drawer;
- focus returns to the originating card;
- request busy state disables and re-enables Chat without rebuilding the card list;
- a failed `/api/agents` request renders safe fallback cards with empty skill rows;
- the console has no CSP errors.

Commit boundary: `feat(chat-ui): add agent cards, skills, and settings dialog`.

---

## Phase 7 — Finish the retained non-Xero capabilities

Each step is its own feature slice so a student can take it independently after Phase 4.

### Step 7.1 — Funding Radar daily schedule

Add `76-trigger-daily-funding-scan.json`, inactive by default, scheduled daily at 08:00. Put the in-flight concurrency guard in the shared run path so chat and schedule entry points cannot overlap.

Update the manifest setup text and Funding Radar docs. Note the data-table migration issue for learners whose existing table lacks `runId`.

Verify:

```sh
node scripts/validate-workflows.mjs
rg -l 'scheduleTrigger' optional-skills/funding-radar optional-skills/monthly-update
```

Commit: `feat(funding-radar): restore optional daily trigger`.

### Step 7.2 — Free-first SEO article chain

Change `seo-article-writer` to require `domain-research`, not `paid-domain-research`. Rewrite both skills so free research is the default and paid research is an installed upgrade, never an assumed tool.

Verify in a scratch copy:

```sh
npm run add-skill -- domain-research
npm run add-skill -- seo-article-writer
(
  cd apps/chat
  npm run test:seo-article
)
```

Commit: `fix(marketing): make article writing work with free research`.

### Step 7.3 — Meeting output for the plain-text chat

Change meeting action items from a Markdown table to a `-` list and add the standard plain-text rendering rule. Preserve the current rule preventing transcript text from initiating task writes.

Verify:

```sh
node scripts/compile-skills.mjs
node scripts/validate-workflows.mjs
```

Commit: `fix(meetings): render grounded action items as plain text`.

### Step 7.4 — Trim LinkedIn lookup instructions

Remove the non-runnable Python/public-search fallback from both catalogue copies and keep the files byte-identical. The skill must either call its installed provider tool or clearly say that lookup is unavailable.

Keep the instructions concise for maintainability; compilation no longer uses an arbitrary per-skill character ceiling.

Verify:

```sh
diff \
  skills/linkedin-profile-lookup/SKILL.md \
  optional-skills/linkedin-profile-lookup/skill/SKILL.md
node scripts/compile-skills.mjs
```

Run this comparison only in a scratch install where the optional skill has been added; the clean base intentionally has no installed copy.

Commit: `fix(sales): remove non-runnable lookup fallback`.

---

## Phase 8 — Build the read-only Xero Coding Review skill

Status: deferred by the repository owner on 18 August 2026. Do not implement or ship this phase in v0.3.0. Bookkeeping remains a routable, safely scoped agent with no installed Xero capability; it must say that no role-specific tool is installed when asked for live accounting work. The design below is retained for a later release.

### Step 8.1 — Confirm the integration contract

The public feature is a coding review, not bank reconciliation:

- read available BankTransactions and unpaid Invoices;
- read the chart of accounts;
- suggest contact, account code, tax treatment, and a confidence/basis;
- flag uncertainty and amounts above the user's review threshold;
- save suggestions and the user's later decisions locally;
- never write to Xero;
- never say a line is reconciled before the user completes it inside Xero.

The official docs already settle the bank-statement limitation, so the live spike is now an authentication and response-shape smoke test, not a product-scope decision.

### Step 8.2 — Re-check local n8n credential behaviour

Before authoring workflows, assert against the installed `n8n-nodes-base` version that:

- the built-in Xero node still lacks the needed read operations;
- its credential still requests broader write scopes;
- generic OAuth2 still exposes a user-set Scope field.

Encode these checks in a small test so an n8n dependency upgrade cannot silently invalidate the security design.

### Step 8.3 — Live OAuth smoke with a demo company

Use an authorization-code Xero app and n8n's exact localhost callback. Confirm:

- `http://localhost/...` is accepted; do not substitute `127.0.0.1`;
- `/connections` returns the authorised tenant;
- granular read-only scopes can read BankTransactions, Invoices, and Accounts;
- no write scope appears on the consent screen;
- the Starter tier's connection and request limits are documented as current, not permanent promises.

### Step 8.4 — Scaffold catalogue metadata and docs

Create:

```text
optional-skills/xero-reconciliation/
  manifest.json
  skill/skill.yaml
  skill/SKILL.md
  skill/README.md
  tests/matching.test.mjs
  workflows/16-setup-bookkeeping-data.json
  workflows/80-tool-check-xero-connection.json
  workflows/81-tool-set-bookkeeping-profile.json
  workflows/82-tool-start-reconciliation-review.json
  workflows/83-tool-get-reconciliation-suggestions.json
  workflows/84-tool-record-reconciliation-decision.json
  workflows/85-run-reconciliation-review.json
  workflows/86-run-transaction-matching.json
  workflows/87-trigger-reconciliation-review.json
```

Use `agent: bookkeeping`. Public metadata and docs say “Xero Coding Review”; internal workflow IDs may retain “reconciliation” for continuity.

### Step 8.5 — Create local tables and tool workflows

Use the table shapes from the audit, with three tables:

- `bookkeeping_profile`;
- `reconciliation_suggestions`;
- `reconciliation_runs`.

Follow the existing validated tool-workflow house shape for input validation, result shaping, audit insertion, and bounded timeouts.

All model-callable Xero tools are read or bounded local write. The two background workflows are not model-callable.

### Step 8.6 — Implement the review pipeline

Order the pipeline:

1. load and validate profile;
2. refuse a second recent in-flight run;
3. discover the tenant;
4. read bounded pages and a bounded date range;
5. normalise records deterministically;
6. apply saved supplier/account rules first;
7. classify remaining rows;
8. save suggestions and run totals;
9. deliver a summary if configured;
10. surface partial failures in `errorSummary`.

For the first release, default to deterministic suggestions when financial data cannot be sent to the configured model under the organisation's Xero and model-provider terms. If model-assisted classification is enabled, document explicit user consent, data minimisation, retention behaviour, and the prohibition on using Xero API data for AI/ML training.

The inactive schedule trigger must enter the same guarded run path as chat.

### Step 8.7 — Test safety and matching offline

Fixtures must cover:

- known supplier rule;
- ambiguous supplier;
- exact and near invoice matches;
- GST/tax field left undecided;
- threshold-forced human review;
- untrusted transaction text containing instructions;
- duplicate run suppression;
- pagination and partial Xero failures;
- no Xero write node or write method anywhere in the skill.

Verify:

```sh
node optional-skills/xero-reconciliation/tests/matching.test.mjs
node scripts/validate-workflows.mjs
node scripts/validate-release.mjs
```

Then install into a scratch copy and confirm tool policies, prompt rules, Bookkeeping tool connections, and UI grouping.

Commit boundary: `feat(bookkeeping): add read-only Xero coding review`.

---

## Phase 9 — Package safe full and surgical upgrades

### Step 9.1 — Create `docs/FEATURE_SLICES.md`

For each merged slice, record:

- slice ID and purpose;
- final commit SHA;
- prerequisites;
- files owned by the slice;
- whether `00` or `11` must be re-imported;
- whether skill sync is required;
- whether an external credential or setup workflow is required;
- exact verify command;
- rollback commit or procedure.

This is the document a student gives Claude Code when asking for only one capability.

### Step 9.2 — Create `docs/UPGRADING_TO_0.3.md`

Provide two paths.

Fresh learner:

1. download or clone the `v0.3.0` base;
2. run setup;
3. start the agent;
4. add only wanted optional skills;
5. import workflows, run each skill's setup workflow, then sync skills.

Existing learner:

1. run `npm run backup`;
2. stop the agent;
3. commit or separately copy intentional source customisations;
4. pull `v0.3.0` or apply documented slices;
5. run `npm ci`;
6. run `npm run import-workflows` before `npm run sync-skills` because schema v2 requires workflows `00` and `11`;
7. run any idempotent table migration/setup workflows named in the slice map;
8. restart;
9. run `npm run verify` and `npm run diagnose`;
10. smoke-test the selected agents.

Never tell an existing learner to run `npm run reset`; it destroys local runtime state and belongs only in a disposable clean-machine rehearsal.

### Step 9.3 — Add an upgrade preflight

Create `scripts/upgrade-check.mjs` and `npm run upgrade-check`. It is read-only and reports:

- current repository version;
- dirty tracked source files;
- installed skill IDs;
- whether `00` and `11` are the required schema versions;
- current compiled source hash versus last synced hash;
- optional setup/migration workflows still requiring a manual run;
- exact next commands.

It must never overwrite a workflow, credential, table, or learner file.

### Step 9.4 — Update release inventories and version

Regenerate learner-facing skill/workflow lists from the actual manifests and files. Update `CHANGELOG.md`, `VERSION`, `package.json`, and `package-lock.json` together.

Add required release artifacts for:

- feature-slice map;
- v0.3 upgrade guide;
- agent registry schema v2;
- any new test files.

### Step 9.5 — Full release gate

```sh
npm run verify

REBUILD_TMP_DIR="$(mktemp -d)"
node scripts/make-base.mjs "$REBUILD_TMP_DIR/base"
(
  cd "$REBUILD_TMP_DIR/base"
  npm ci
  npm run verify
)
```

In a separate disposable clone:

1. run setup and start;
2. add Funding Radar and complete its setup;
3. import workflows and sync skills;
4. verify that the Investment card and runtime expose only Investment capabilities;
5. select Bookkeeping and confirm it says no role-specific accounting tool is installed rather than fabricating data;
6. create a pack and validate it;
7. rehearse the documented v0.2 → v0.3 upgrade path with retained chats and profile data.

Release only if the fresh-install and upgrade rehearsals both pass.

Commit boundary: `chore(release): publish v0.3 migration and slice map`.

---

## Phase 10 — Post-release repository housekeeping

Handle remote branch deletion in a separate maintainer-only change after `v0.3.0` is tagged and recoverable.

1. re-fetch and recompute merged/unmerged branch sets; do not trust the audit's old counts;
2. extract any documents still worth preserving into a tracked `docs/archive/` location;
3. tag every unmerged branch under `archive/<branch-name>` and push the tag;
4. delete merged remote branches;
5. delete tagged unmerged remote branches;
6. verify `main`, the release tag, and archive tags from a fresh clone.

This phase has no student migration impact and must never be a prerequisite for the product release.

## Definition of done

The rebuild is done only when all of these are true:

- `npm run verify` passes in the maintainer repo and generated base copy;
- `make-base` exits `0` from a clean committed `HEAD`;
- profile/settings saves leave Git clean;
- five agent IDs are accepted server-side;
- each agent receives only its own skill instructions, context, and tools;
- the UI accurately distinguishes on-disk and unsynced skills, and never claims that external setup is complete;
- no retained `SKILL.md` instructs the model to call an unavailable script or tool;
- daily Funding Radar is present and off by default;
- free domain research can drive the SEO writer;
- Bookkeeping has no Xero capability in v0.3.0 and never fabricates accounting access;
- the v0.2 → v0.3 rehearsal preserves chats, profile data, and installed optional skills;
- `docs/FEATURE_SLICES.md` lets a student or Claude Code identify and apply one capability without reading the full audit.
