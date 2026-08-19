# Optional skills

Your agent starts out able to manage projects and tasks. Everything in this folder is something extra you can bolt on when you need it — and nothing here is switched on until you ask for it.

Each skill is self-contained. Adding one **never** changes the chat app, never touches your other skills, and never overwrites anything you have already customised. If you add the same skill twice, the second time does nothing.

## The skills

| Skill | What it does | Needs |
| --- | --- | --- |
| [`domain-research`](domain-research/) | Reads a company's own website and tells you what the business says about itself | — |
| [`funding-radar`](funding-radar/) | Searches reviewed public sources for grants and funding that match the business facts you save | An Anthropic account |
| [`paid-domain-research`](paid-domain-research/) | Where a site ranks on Google, who it competes with, and which keywords are worth it | `domain-research` + a paid DataForSEO account |
| [`seo-article-writer`](seo-article-writer/) | Writes a full article grounded in what your research actually found | `paid-domain-research` |
| [`linkedin-profile-lookup`](linkedin-profile-lookup/) | Looks up a named person's public professional details | A paid people-search account |
| [`monthly-update`](monthly-update/) | Reads a month of your email and writes your company's monthly update | A read-only Gmail connection |
| [`scheduler`](scheduler/) | Runs any of your agent's other skills at a time you choose, and saves what they found | — |

Open any skill's folder and read its `skill/README.md` before you install it. Each one tells you what it costs, what it can't do, and how to prove it loaded.

## Add one

Open your project in Claude Code and ask it, in plain English:

```text
Add the funding-radar optional skill to my agent.
```

If you would rather run it yourself, it is one command from the top of your project folder:

```bash
node optional-skills/_installer/add-skill.mjs funding-radar
```

To see everything available and what you already have:

```bash
node optional-skills/_installer/add-skill.mjs --list
```

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

## If your project is older than the skill you want

You do not need to update your whole project. Open the skill's folder on GitHub, copy the address out of your browser, and hand it over:

```bash
npm run add-skill -- https://github.com/drsamdonegan/ai-solopreneur/tree/main/optional-skills/funding-radar
```

That downloads **only that one folder** and installs it. It does not bring the other skills, and it does not touch your chat app, your existing skills, or anything you have customised.

Claude Code understands the same thing in plain English — paste the address and ask it to add that skill.

## A word on enabling several at once

Every enabled skill sits in the agent's instructions for **every** message. Three competing reply formats will make it answer an ordinary project question as though it were a sales enquiry.

Add them one at a time, and switch off the ones you are not using by removing their line from `skills/enabled.txt`.

## For instructors

Adding a skill copies in its own files, then makes the smallest possible addition to four shared files that differ from one learner to the next:

| File | What a skill adds |
| --- | --- |
| `n8n/workflows/00-start-here-project-partner.json` | its tool node, the `ai_tool` wire to the agent, and its risk rule inside `basePolicy` in the *Build Agent Context* node |
| `tools/policy.json` | the tool's risk classification |
| `skills/enabled.txt` | one line |
| `n8n/folders.manifest.json` | which folder it appears under in n8n |

The installer skips anything already present, which is why it is safe to run against a repo a learner has already customised — and why skills are no longer shipped as branches to merge.

Each skill's `manifest.json` declares all of that. A new skill needs a manifest, a `skill/` folder, and optionally a `workflows/` folder. Nothing else. **App code never ships with a skill** — `apps/chat` endpoints live in the base and stay inert until a skill's workflow calls them, which is what keeps a skill install away from the frontend.

### Handing out a base agent

```bash
node scripts/make-base.mjs ../ai-solopreneur-base
```

Writes a clean copy with no optional skills, no optional tools, and no catalogue folder. It reads from the last commit, not your working folder, so anything you have installed locally while testing cannot leak into it. Zip the result and hand it out.

The base agent still has its four core skills and three task tools — those *are* the project manager, and `compile-skills.mjs` requires at least one skill enabled. "Base" means no **optional** skills or tools.
