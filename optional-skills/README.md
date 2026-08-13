# Optional skills

Your agent starts out able to manage projects and tasks. Everything in this folder is something extra you can bolt on when you need it — and nothing here is switched on until you ask for it.

Each skill is self-contained. Adding one **never** changes the chat app, never touches your other skills, and never overwrites anything you have already customised. If you add the same skill twice, the second time does nothing.

## The skills

Start with **My Business**. Four of the others read your prices, hours, and terms from it, and without it they leave gaps like `[YOU FILL IN: day rate]` for you to complete by hand.

| Skill | What it does | Needs |
| --- | --- | --- |
| [`my-business`](my-business/) | Holds your prices, hours, and terms so the agent stops guessing them | — |
| [`lead-conversion`](lead-conversion/) | Turns a new enquiry or DM into a first reply you can send | `my-business` |
| [`prospect-research`](prospect-research/) | Turns a name and some pasted text into a cold email you send yourself | `my-business` |
| [`deal-desk`](deal-desk/) | Turns sales-call notes into a recap email and a proposal skeleton | `my-business` |
| [`customer-support`](customer-support/) | Turns a complaint into a calm reply that promises nothing you have not decided | `my-business` |
| [`domain-research`](domain-research/) | Reads a company's own website and tells you what the business says about itself | — |
| [`competitor-content`](competitor-content/) | Reads a competitor's public YouTube and blog, and finds their posts that beat their own average | — |
| [`signal-research`](signal-research/) | Finds people describing your problem in public, in their own words | A free Google API key |
| [`paid-domain-research`](paid-domain-research/) | Where a site ranks on Google, who it competes with, and which keywords are worth it | `domain-research` + a paid DataForSEO account |
| [`seo-article-writer`](seo-article-writer/) | Writes a full article grounded in what your research actually found | `paid-domain-research` |
| [`linkedin-profile-lookup`](linkedin-profile-lookup/) | Looks up a named person's public professional details | A paid people-search account |
| [`linkedin-prospect-search`](linkedin-prospect-search/) | Searches for people matching a description of your ideal customer | `linkedin-profile-lookup` |

Open any skill's folder and read its `skill/README.md` before you install it. Each one tells you what it costs, what it can't do, and how to prove it loaded.

## Add one

Open your project in Claude Code and ask it, in plain English:

```text
Add the signal-research optional skill to my agent.
```

If you would rather run it yourself, it is one command from the top of your project folder:

```bash
node optional-skills/_installer/add-skill.mjs signal-research
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

## If you cloned before these existed

If your project has no `optional-skills` folder, ask Claude Code:

```text
My project has no optional-skills folder. Please copy it in from
https://github.com/drsamdonegan/ai-solopreneur, then add the signal-research skill.
```

This only copies the folder in. It does not touch your chat app, your existing skills, or anything you have customised.

## A word on enabling several at once

Every enabled skill sits in the agent's instructions for **every** message. Three competing reply formats will make it answer an ordinary project question as though it were a sales enquiry.

Add them one at a time, and switch off the ones you are not using by removing their line from `skills/enabled.txt`.

## For instructors

Adding a skill touches four shared files that differ from one learner to the next: the agent workflow, `tools/policy.json`, `skills/enabled.txt`, and the base agent instructions inside the workflow's *Build Agent Context* node. The installer makes the smallest possible addition to each and skips anything already present, which is why it is safe to run against a repo a learner has already customised — and why skills are no longer shipped as branches to merge.

Each skill's `manifest.json` declares everything it adds: its agent tool nodes, its `tools/policy.json` entries, and the tool-risk rules that go into the base agent instructions. A new skill needs a manifest, a `skill/` folder, and optionally a `workflows/` folder. Nothing else.
