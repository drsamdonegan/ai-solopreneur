# Customise the Agent with Markdown Skills

## Outcome

A skill is a small Markdown file that tells the agent how to behave in one situation. You can change an enabled skill without editing JavaScript or rebuilding anything.

The starter agent includes:

| Skill | What it changes |
| --- | --- |
| `project-assistant` | How the agent turns uncertainty into practical next steps |
| `task-capture` | How the agent prepares a confirmation-gated task proposal |
| `weekly-status` | How the agent summarises factual task progress |
| `domain-research` | How the free website-only business research path behaves |
| `paid-domain-research` | How the default paid-first search and simple SEO advice behave |

## Change one skill

1. Open `skills/project-assistant/SKILL.md` in a plain-text editor.
2. Change one instruction. For example:

   > Finish planning replies with one recommended next action.

3. Save the file.
4. Make sure the local app is running (`start.command` or `start-windows.cmd`).
5. Sync the enabled skills:

   - macOS: double-click `sync-skills.command`.
   - Windows: double-click `sync-skills-windows.cmd`.

6. Wait for **Enabled skills synced successfully**.
7. Select **New conversation** in the chat and test your change.

The existing conversation memory may contain an older response style, which is why a new conversation gives the clearest test.

## Enable or disable a skill

Open `skills/enabled.txt`. It contains one skill ID per line:

```text
project-assistant
task-capture
weekly-status
```

- Remove a line to disable that skill.
- Add its ID back to enable it.
- Lines beginning with `#` are comments.

Run the skill-sync helper after every change. Only IDs in this file are compiled into the agent prompt. A skill directory that is not listed remains available as an example but is not loaded.

`paid-domain-research` does not contain a credential and cannot grant provider access by itself. Its reviewed tools and private n8n credential are configured separately in [Paid Domain Research with DataForSEO](PAID_DOMAIN_RESEARCH.md).

At least one skill must remain enabled.

## Optional extra skills

Five further skills ship with the project but are switched **off**. Each one is a folder under `skills/` with its own `README.md` explaining what it does, a demo you can paste straight into the chat, and the exact characters to look for to prove it loaded.

| Skill | What it does | Read first |
| --- | --- | --- |
| `my-business` | Holds your own prices, hours, and terms so the agent stops guessing them | [README](../skills/my-business/README.md) |
| `lead-conversion` | Turns a new website enquiry or DM into a first reply you can send | [README](../skills/lead-conversion/README.md) |
| `prospect-research` | Turns a name, a company, and text you paste into a cold email you send yourself | [README](../skills/prospect-research/README.md) |
| `deal-desk` | Turns notes from a sales call into a recap email and a proposal skeleton | [README](../skills/deal-desk/README.md) |
| `customer-support` | Turns a customer complaint into a calm draft reply that promises nothing you have not decided | [README](../skills/customer-support/README.md) |

To switch one on, add its ID to `skills/enabled.txt` and run the skill-sync helper. Nothing else needs installing, and no new account is required.

Two rules make these work well:

- **Fill in `my-business` first.** The other three take every price, lead time, and term from it. Without it they leave a bracket such as `[YOU FILL IN: day rate]` for you to complete by hand.
- **Enable one of the other three at a time.** Every enabled skill sits in the prompt for every message, so three competing reply formats make the agent answer an ordinary project question as though it were a sales enquiry.

None of these skills can send an email, read an inbox, or look a company up. There is no internet access in this project. They work only from what you type, paste, or upload, and they say `Not stated` rather than inventing a fact.

`prospect-research` is the clearest example of that boundary. It cannot find anyone for you. You open the profile or company page yourself, copy the part that matters, and paste it in; the skill then does the research thinking and the writing. Given nothing to work from, it writes `No hook found` instead of inventing a detail.

### Add one to a project you have already cloned

If your copy of the project predates these skills, ask Claude Code to fetch just the folder you want:

```text
Add the Deal Desk skill to this project from the AI Solopreneur template.

Do exactly this and nothing else. Do not merge, do not pull, do not create a
branch, do not add a git remote:

1. Run: git fetch https://github.com/drsamdonegan/ai-solopreneur.git skill/deal-desk
2. Run: git checkout FETCH_HEAD -- skills/deal-desk
3. Show me skills/deal-desk/README.md and then stop.
```

Swap `deal-desk` for `my-business`, `lead-conversion`, `prospect-research`, or `customer-support`. The template is public, so this needs no password. It adds only that one folder and leaves your own `skills/enabled.txt` untouched.

Do not re-run those commands to update a skill you have already edited. `git checkout` overwrites your version without warning, which would discard the facts you typed into `my-business`.

## Skill folder convention

Every skill has two files:

```text
skills/
└── my-skill/
    ├── skill.yaml
    └── SKILL.md
```

`skill.yaml` contains four plain fields:

```yaml
id: my-skill
name: My Skill
version: 1.0.0
description: Explain the behaviour this skill adds.
```

Rules:

- `id` uses lowercase words separated by hyphens and matches the folder name.
- `name` is 80 characters or fewer.
- `version` uses three numbers such as `1.0.0`.
- `description` is 240 characters or fewer.
- `SKILL.md` contains 1-8,000 characters.
- The combined enabled instructions may contain at most 200,000 characters. This
  is a runaway guard, not a budget to plan around: enabling every skill in the
  repo stays well under it, so adding a skill never means removing another.

The helper rejects an invalid skill before changing the running agent. It stores a content hash alongside the compiled bundle so technical contributors can see exactly which version is active.

## Write useful skill instructions

Good instructions are:

- Specific about the desired outcome.
- Short enough to scan.
- Clear about which facts require a tool.
- Honest about unavailable data.
- Explicit about what the agent must not claim.

Avoid:

- Pasting API keys or private customer data.
- Telling the agent to ignore the base safety policy.
- Granting new tools or service access in Markdown.
- Asking it to silently change data.
- Copying an entire company handbook into one skill.

Skills influence model behaviour. They cannot grant a capability. Tool access comes only from the reviewed n8n connections and [tool-risk policy](SAFE_WRITE_CONFIRMATION.md#tool-risk-policy).

## Recover from an error

If the helper reports an invalid skill:

1. Read the file and line named in the terminal.
2. Compare `skill.yaml` with the four-field example above.
3. Confirm the ID is listed exactly once in `skills/enabled.txt`.
4. Save the correction and run the helper again.

The previously synced bundle remains active when validation fails.

Technical contributors can validate without changing n8n:

```bash
node scripts/compile-skills.mjs
```

The [finished Launch Partner example](../examples/finished-solo-project-assistant/README.md) includes an alternative project-assistant skill for comparison. After testing a learner change in a new conversation, use [GitHub Desktop](GITHUB_DESKTOP.md) to commit and push the Markdown file.
