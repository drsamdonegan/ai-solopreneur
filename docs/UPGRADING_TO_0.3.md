# Upgrade to v0.3

v0.3 makes agent selection real: each of the five agents receives only its own instructions, saved context, and connected tools. It also adds the accessible agent-card interface, restores daily Funding Radar scheduling, makes SEO writing free-first, removes the LinkedIn fallback the n8n agent could not run, and catalogues cloud-only Telegram and global Scheduler add-ons.

Xero is not included in this release. Bookkeeping is a safe routable role with no accounting connector.

## Before either path

Run the read-only preflight from the project folder:

```bash
npm run upgrade-check
```

It reports source changes, installed skills, workflow schema readiness, sync state, setup workflows to confirm, and the next commands. It does not alter files, workflows, tables, credentials, or learner data.

## Fresh learner

1. Download or clone the v0.3.0 base.
2. Run `setup.command` on macOS or `setup-windows.cmd` on Windows.
3. Start the agent with the matching start helper.
4. Add only the optional skills you want. Use `npm run add-skill -- <skill-id>` or give Claude Code the skill's GitHub folder URL.
5. Run `npm run import-workflows`.
6. Run each installed skill's numbered setup workflow when its README names one.
7. Run `npm run sync-skills` and restart.
8. Run `npm run verify` and `npm run diagnose`.
9. Open a new conversation and smoke-test only the agents whose skills you installed.

The base intentionally contains the four Project Manager skills only. Sales, Marketing, Investment, and Bookkeeping can answer safely without a skill, but must say when a requested capability is not installed.

## Existing v0.2 learner

Do these in order. The order protects your chats, profile data, credentials, and customised source files.

1. Create a backup:

   ```bash
   npm run backup
   ```

2. Stop the agent:

   ```bash
   npm run stop
   ```

3. Commit intentional source customisations, or copy those changed source files somewhere outside the project. `data/` is already outside Git but is included in the backup.
4. Pull v0.3.0, or apply only the commits listed in [FEATURE_SLICES.md](FEATURE_SLICES.md).
5. Install the pinned dependencies:

   ```bash
   npm ci
   ```

6. Import workflows before syncing skills:

   ```bash
   npm run import-workflows
   npm run sync-skills
   ```

   This order is required. Workflow `00` contains the five-agent graph and workflow `11` accepts the schema-v2 skill bundle; the old workflows cannot safely consume the new sync result.

7. Run any idempotent setup or migration workflow named by `npm run upgrade-check` and the selected slice map. Funding Radar users with an older `funding_runs` table must add its `runId` text column as described in [FUNDING_RADAR.md](FUNDING_RADAR.md).
8. Restart:

   ```bash
   npm run restart
   ```

9. Verify and diagnose:

   ```bash
   npm run verify
   npm run diagnose
   ```

10. Smoke-test the agents you use:

    - Project Manager: analyse a short meeting note; action items should use plain `-` lines.
    - Marketing: ask for a domain research scan, then an article; no paid research should start unless explicitly requested.
    - Investment: read the existing Funding Radar report, then start one only if you intend to spend its documented cost.
    - Sales: with no LinkedIn skill installed, it must say lookup is unavailable. With it installed, each Crustdata search needs explicit cost approval.
    - Bookkeeping: it must say no accounting tool is installed; v0.3 contains no Xero connector.

## What is preserved

- `data/chat/chat.sqlite` and saved conversation history;
- `data/profile/` business and per-agent settings;
- the encrypted n8n database, credentials, and tables under `data/n8n/`;
- installed optional skill files unless a selected slice deliberately changes them;
- learner source customisations you committed or copied before pulling.

Do not run `npm run reset` during an upgrade. Reset deletes local runtime state and belongs only in a disposable clean-machine rehearsal.

## If you want only one capability

Give Claude Code [FEATURE_SLICES.md](FEATURE_SLICES.md) and say which slice you want. It should apply the prerequisites, preserve your changes, use the slice's exact verification command, and stop on a real conflict rather than replacing a shared file wholesale.
