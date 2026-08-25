# Skill packages and optional modules

The generated learner base starts out able to manage projects and tasks.
The agent card presents seven understandable **packages**. A package can contain
several internal Markdown skills and workflows, so useful capability is not
lost just to make the interface simpler. A maintainer checkout may already have
some packages installed while testing the release; `skills/enabled.txt` remains
the source of truth for the underlying modules.

Adding a package **never** changes the chat app and never overwrites anything
you have already customised. The installer validates all of a package's module
edits together and is safe to run twice.

## What the agent card shows

| Agent | Package | Included modules | Needs |
| --- | --- | --- | --- |
| Project Manager | `meeting-to-actions` | Project planning, meeting analysis, task capture, weekly status | Included in the base |
| Sales | `linkedin-profile-lookup` | Named-person profile lookup | Crustdata |
| Sales | `linkedin-prospect-search` | Role/sector/location/company-size prospect search | Crustdata |
| Marketing | `domain-research` | Free website research; paid search evidence is an optional extension | Anthropic; DataForSEO only for the extension |
| Marketing | `seo-aeo-article-writer` | Grounded SEO/AEO article writing; installs Domain Research first | Anthropic |
| Investment | `funding-and-investor-updates` | Funding Radar | Anthropic |
| Investment | `monthly-update` | Reads a month of email and writes the company update from it | Anthropic; read-only Gmail |
| Bookkeeping | `xero-bookkeeping` | Read-only Xero statement capture and evidence-backed coding review | Chrome; Xero; Anthropic |

The Bookkeeping package installs its two core modules together because a review
must never fall back to an unsupported API source when capture is absent.

Scheduler and Telegram are cross-cutting delivery add-ons, not extra icons on
one agent card. Nothing has been deleted: the underlying module catalogue is:

| Module | Relationship |
| --- | --- |
| [`domain-research`](domain-research/) | Domain Research core |
| [`paid-domain-research`](paid-domain-research/) | Domain Research optional extension |
| [`seo-article-writer`](seo-article-writer/) | SEO/AEO Article Writer core |
| [`linkedin-profile-lookup`](linkedin-profile-lookup/) | LinkedIn Profile Lookup core |
| [`linkedin-prospect-search`](linkedin-prospect-search/) | LinkedIn Prospect Search core |
| [`funding-radar`](funding-radar/) | Funding & Investor Updates core |
| [`monthly-update`](monthly-update/) | Monthly Update core |
| [`scheduler`](scheduler/) | Global add-on |
| [`telegram-trigger`](telegram-trigger/) | Cloud delivery add-on |
| [`xero-statement-capture`](xero-statement-capture/) | Xero Bookkeeping queue-evidence core |
| [`xero-reconciliation`](xero-reconciliation/) | Xero Bookkeeping review and preparation core |

Open any skill's folder and read its `skill/README.md` before you install it. Each one tells you what it costs, what it can't do, and how to prove it loaded.

## Add one package

Open your project in Claude Code and ask it, in plain English:

```text
Add the funding-and-investor-updates package to my agent.
```

If you would rather run it yourself, it is one command from the top of your project folder:

```bash
npm run add-skill -- funding-and-investor-updates
```

To see everything available and what you already have:

```bash
node optional-skills/_installer/add-skill.mjs --list
```

The package command installs core capability only. Add its named optional
extensions when you want them:

```bash
npm run add-skill -- domain-research --with-extensions
```

Existing module IDs such as `funding-radar` still work, so old learner notes
and surgical Claude Code instructions do not break.

## Then finish the job

Adding a skill changes files on your computer. Two more steps make your running agent notice.

1. Sync the skills:
   - macOS: double-click `sync-skills.command`
   - Windows: double-click `sync-skills-windows.cmd`
2. Restart the services, so n8n picks up any new workflows:
   - macOS: double-click `start.command`
   - Windows: double-click `start-windows.cmd`

Then open the chat and select **New conversation**. An older conversation still carries the old instructions, which is why a fresh one gives the clearest test.

Some skills need one extra setup step — an API key, or a one-off workflow to create their data store. The installer tells you at the end when that applies, and the skill's own README walks through it.

## If your project is older than the package you want

You do not need to update your whole project. Open the package folder on GitHub,
copy the address out of your browser, and hand it over:

```bash
npm run add-skill -- https://github.com/drsamdonegan/ai-solopreneur/tree/main/skill-packs/funding-and-investor-updates
```

That downloads the small package contract, then fetches only its required
modules. It does not bring unrelated modules or replace your chat app. A direct
`optional-skills/<module-id>` GitHub link still installs one legacy module.

Claude Code understands the same thing in plain English — paste the address and ask it to add that skill.

## A word on enabling several at once

Every enabled skill sits only in its owning agent's instructions. Add them one
at a time so two skills for the same role do not introduce competing formats,
and so provider setup failures stay easy to diagnose.

Add packages one at a time. The installer can safely apply several modules
inside one package; package-by-package setup keeps provider failures easy to
diagnose. Switch off an underlying module by removing its line from
`skills/enabled.txt`.

## For instructors

Adding a package resolves its core modules and dependencies, then makes the
smallest cumulative addition to four shared files that differ from one learner
to the next:

| File | What a skill adds |
| --- | --- |
| `n8n/workflows/00-start-here-project-partner.json` | its tool node, the `ai_tool` wire to the agent, and its risk rule inside `basePolicy` in the *Build Agent Context* node |
| `tools/policy.json` | the tool's risk classification |
| `skills/enabled.txt` | one line |
| `n8n/folders.manifest.json` | which folder it appears under in n8n |

The installer skips anything already present, which is why it is safe to run against a repo a learner has already customised — and why skills are no longer shipped as branches to merge.

Each module's `manifest.json` declares those edits. `skill-packs/<id>/pack.json`
declares the learner-facing name, owning agent, core modules, optional
extensions, and package dependencies. **App code never ships with a module** —
the package-aware UI and API live in the base.

### Handing out a base agent

```bash
node scripts/make-base.mjs ../ai-solopreneur-base
```

Writes a clean copy with no installed optional modules, no optional tools, and
no module catalogue. The small `optional-skills/_installer/` and `skill-packs/`
contracts remain so the learner sees the seven intended packages and can fetch
one surgically. It reads from the last commit, not your working folder, so
uncommitted testing cannot leak into the handout.

The base agent still has its four core skills and three task tools — those *are* the project manager, and `compile-skills.mjs` requires at least one skill enabled. "Base" means no **optional** skills or tools.
