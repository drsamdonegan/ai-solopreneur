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
| `paid-domain-research` | How the optional, explicitly requested paid search upgrade behaves |

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

Six further skills ship with the project, all switched **off**. They live in [`optional-skills/`](../optional-skills/), one folder each, and none of them exists in your agent until you add it.

Open [`optional-skills/README.md`](../optional-skills/README.md) for the full list, what each one costs, and what it needs.

### Add one

Ask Claude Code, in plain English:

```text
Add the funding-radar optional skill to my agent.
```

Or run it yourself from the top of your project folder:

```bash
npm run add-skill -- funding-radar
```

Then sync the skills and restart the services, exactly as you would after editing a skill by hand.

The installer copies the skill's files in, wires up any workflows it needs, and adds its line to `skills/enabled.txt` for you. It never overwrites anything you have already changed, and running it twice does nothing the second time.

### Two rules make these work well

- **Add one at a time.** Every enabled skill sits in the prompt for every message, so three competing reply formats make the agent answer an ordinary project question as though it were a sales enquiry.

Remove a skill's line from `skills/enabled.txt` to switch it off again without deleting anything.

### What they can and cannot do

Every retained optional skill declares what it reads, writes, and costs in its
own README and manifest. Domain and funding research read public sources;
LinkedIn lookup and paid SEO research call separately configured providers;
Monthly Update reads Gmail through its read-only credential. None can post,
message, apply, or contact anybody merely because researched text asks it to.
