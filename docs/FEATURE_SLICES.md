# v0.3 feature slices

This is the hand-off map for a learner—or for Claude Code—who needs one part of the rebuild without replacing a customised project. Apply slices in dependency order, commit or copy your own changes first, and run the listed verification before moving on.

The commit IDs below are immutable slice boundaries on the v0.3 release line. `00` means `n8n/workflows/00-start-here-project-partner.json`; `11` means `n8n/workflows/11-setup-sync-enabled-skills.json`.

## Core runtime slices

### S01 · Self-contained base · `8ba94be`

- Purpose: remove the installed paid LinkedIn lookup from the learner base and derive local workflow inventories from disk.
- Prerequisites: v0.2.0 or later.
- Owns: `skills/enabled.txt`, the removed `skills/linkedin-profile-lookup/` copy, workflow 61 removal, `tools/policy.json`, `n8n/folders.manifest.json`, `scripts/local.mjs`, and LinkedIn tool removal from `00`.
- Re-import: `00` yes. `11` no.
- Skill sync: yes.
- External setup: none.
- Verify: `npm run verify`, then commit and run `node scripts/make-base.mjs <empty-target>`.
- Rollback: `git revert 8ba94be`; do not restore only `enabled.txt`.

### S02 · Honest optional catalogue · `a312ae9`

- Purpose: remove non-runnable catalogue entries and retain standalone outbound Slack setup for Monthly Update, which still posts.
- Prerequisites: S01.
- Owns: deleted optional skill directories and dead installers/manifests; `optional-skills/README.md`; catalogue and Slack documentation; Monthly Update Slack credential/error handling; catalogue validator cleanup.
- Re-import: `00` no; `11` no. Re-import workflow 74 only if its Slack node is already installed.
- Skill sync: only if a removed skill was enabled.
- External setup: optional `Slack bot token` Header Auth credential for Monthly Update only. Funding reports are chat-only in the final v0.3 state.
- Verify: `node scripts/validate-workflows.mjs && node scripts/validate-release.mjs`.
- Rollback: `git revert a312ae9`; restoring deleted skills also restores claims that the local n8n agent cannot execute.

### S03 · Agent-scoped skill bundle v2 · `168f7ad`

- Purpose: compile each skill and saved settings into the owning agent's context instead of one mixed prompt.
- Prerequisites: S01–S02.
- Owns: `scripts/compile-skills.mjs`, skill metadata, profile/settings overlays, sync-state tracking, workflow `11`, the bundle reader in `00`, and scoped-skill tests.
- Re-import: `00` yes; `11` yes, in that order.
- Skill sync: required after re-import.
- External setup: none.
- Verify: `node scripts/test-agent-scoped-skills.mjs && node scripts/validate-workflows.mjs`.
- Rollback: revert dependent slices first, then `git revert 168f7ad`. A v1 bundle must never be presented as scoped.

### S04 · Physical agent routing and tool isolation · `f29e6c9`

- Purpose: make all five agent IDs routable and wire each optional tool only to its owning agent.
- Prerequisites: S03.
- Owns: `apps/chat/config/agents.json`, agent routing helpers/tests, optional installer ownership validation, five agent nodes and role policy in `00`, and agent registry runtime code.
- Re-import: `00` yes; `11` no.
- Skill sync: required.
- External setup: none.
- Verify: `node scripts/test-agent-runtime.mjs && node scripts/test-optional-installer.mjs && node scripts/validate-workflows.mjs`.
- Rollback: `git revert f29e6c9`, then re-import the restored `00` and sync. Do not keep v2 UI claims on a single-agent graph.

### S05 · Agent-card/settings API · `9c26a84`

- Purpose: expose installed/unsynced skills safely and persist per-agent settings outside Git.
- Prerequisites: S03–S04.
- Owns: `apps/chat/src/skills.ts`, `agent-settings.ts`, registry/API changes, cloud/local paths, and API tests.
- Re-import: none.
- Skill sync: required only after saving settings; the API deliberately reports `syncRequired`.
- External setup: none.
- Verify: build the chat, then run `node scripts/test-agent-card-api.mjs && node scripts/test-agent-scoped-skills.mjs`.
- Rollback: `git revert 9c26a84`; saved JSON under `data/profile/` may remain safely unused.

### S06 · Agent-card frontend · `b3bb790`

- Purpose: ship five accessible colour-coded cards, skill status, workspace/agent identity separation, and the settings dialog.
- Prerequisites: S05.
- Owns: `apps/chat/public/index.html`, `app.js`, `styles.css`, and `scripts/test-agent-ui.mjs`.
- Re-import: none.
- Skill sync: no.
- External setup: none.
- Verify: `node scripts/test-agent-ui.mjs`; also check keyboard focus, Escape, tooltips, 320 px layout, and the `/api/agents` failure fallback in a browser.
- Rollback: `git revert b3bb790`.

## Capability slices

### S07 · Daily Funding Radar · `cccd7ad`

- Purpose: restore an inactive 08:00 daily trigger, put duplicate-run protection in the shared funding path, and keep reports local to chat.
- Prerequisites: S03–S04 and Funding Radar already installed. On this release line the canonical installed Funding Radar state begins at `19cfd00`.
- Owns: workflows 71 and 76 in installed/catalogue copies, Funding Radar docs/tests, and folder placement.
- Re-import: workflow 71 yes; import workflow 76. `00` and `11` no.
- Skill sync: no unless its Markdown was separately changed.
- External setup: run setup workflow 14; enable workflow 76 only after checking a manual run and its cost.
- Verify: `node optional-skills/funding-radar/tests/chat-only-delivery.test.mjs && node optional-skills/funding-radar/tests/daily-schedule.test.mjs && node optional-skills/funding-radar/tests/run-state.test.mjs && node scripts/validate-workflows.mjs`.
- Rollback: `git revert cccd7ad`; disable 76 first if an existing n8n copy was activated.

### S08 · Free-first SEO writing · `8e69f18`

- Purpose: let SEO Article Writer depend on free Domain Research; keep DataForSEO as an explicit optional paid upgrade.
- Prerequisites: S03–S04.
- Owns: the three marketing manifests/instructions/docs, paid workflow 53 authority metadata, installer regression coverage, and validator rules.
- Re-import: `00` yes if any affected marketing skill is already installed; workflow 53 only for the optional paid upgrade. `11` no.
- Skill sync: yes.
- External setup: Domain Research needs the existing Anthropic credential; paid DataForSEO remains optional.
- Verify: `node scripts/test-optional-installer.mjs && node scripts/test-seo-article.mjs && node scripts/validate-workflows.mjs`.
- Rollback: `git revert 8e69f18`; this restores the paid dependency and should be disclosed before learners install the writer.

### S09 · Plain-text meeting actions · `7444554`

- Purpose: render grounded action items as readable `-` lists while preserving the transcript-to-task write boundary.
- Prerequisites: S03.
- Owns: `skills/meeting-analysis/SKILL.md`.
- Re-import: none.
- Skill sync: yes.
- External setup: none.
- Verify: `node scripts/compile-skills.mjs >/dev/null && node scripts/validate-workflows.mjs`.
- Rollback: `git revert 7444554`, then sync.

### S10 · Provider-only LinkedIn lookup · `d6d5c81`

- Purpose: remove the Python/public-search fiction, require per-search credit approval, and fail honestly when Crustdata is unavailable.
- Prerequisites: S02–S04. LinkedIn lookup remains optional.
- Owns: `optional-skills/linkedin-profile-lookup/`, its manifest, installer test, and matching validator rule.
- Re-import: installing the slice imports workflow 61 and patches `00`; an existing install must update/re-import both copies manually because the installer never overwrites customised files.
- Skill sync: yes.
- External setup: `CRUSTDATA_API_KEY` Bearer Auth credential and explicit approval for each search up to 0.30 credits.
- Verify: `node scripts/test-optional-installer.mjs && node scripts/validate-workflows.mjs`; the installed and catalogue `SKILL.md` files must be byte-identical and under 7,200 characters.
- Rollback: `git revert d6d5c81`; doing so restores a fallback the n8n agent cannot run.

## Post-v0.3 package slices

These slices are also self-contained, but their immutable merge commit IDs are
assigned with the next release rather than the v0.3 line above.

### S11 · Public skill-package contract and agent cards

- Purpose: show one Project Manager package, two Sales packages, two Marketing
  packages, one Investment package, and zero Bookkeeping packages without
  deleting internal modules.
- Prerequisites: S03–S06.
- Owns: `skill-packs/`, `scripts/skill-packages.mjs`, package API/UI rendering,
  the package-aware installer, and their contract/API/frontend tests.
- Re-import: none for the UI alone. Installing a package applies its declared
  workflow changes normally.
- Skill sync: only after installing or changing an underlying module.
- External setup: none for package presentation.
- Verify: `node scripts/test-skill-packages.mjs && node scripts/test-optional-installer.mjs && node scripts/test-agent-card-api.mjs && node scripts/test-agent-ui.mjs` after building the chat.
- Rollback: restore the old raw-skill API/UI together; do not remove underlying
  modules merely because the grouping is removed.

### S12 · Provider-backed LinkedIn prospect search

- Purpose: replace the deleted Python/public-search fiction with one reviewed
  Crustdata Person Search call for role, sector, location, and company size.
- Prerequisites: S04 and S11.
- Owns: `optional-skills/linkedin-prospect-search/`, installed workflow 59 and
  skill copy, its Sales tool/policy wiring in `00`, and its package manifest.
- Re-import: workflow 59 and `00` yes for an existing maintainer install; a
  learner should use `npm run add-skill -- linkedin-prospect-search` instead.
- Skill sync: yes.
- External setup: `CRUSTDATA_API_KEY` Bearer Auth credential; each call needs
  fresh approval and is capped at ten results/0.30 credits.
- Verify: `node optional-skills/linkedin-prospect-search/tests/prospect-search.test.mjs && node scripts/test-optional-installer.mjs && node scripts/validate-workflows.mjs`.
- Rollback: remove only the package/module wiring and workflow 59. Keep named
  LinkedIn Profile Lookup if the learner uses that separate Sales package.

## Deliberately absent from v0.3

Xero Coding Review is deferred. The Bookkeeping agent remains safely routable but has no role-specific accounting tool. Do not copy the Phase 8 design from `REBUILD_IMPLEMENTATION_PLAN.md` into a learner project unless it is implemented and tested as a separate later slice.

## Applying one slice

From a clean branch, apply every listed prerequisite first, then the desired commit:

```bash
git cherry-pick <prerequisite-sha> <slice-sha>
npm ci
npm run verify
```

If the slice says to re-import `00` or `11`, run `npm run import-workflows` before `npm run sync-skills`. Preserve intentional customisations with a commit or separate copy before cherry-picking; never resolve a conflict by overwriting the whole file blindly.
