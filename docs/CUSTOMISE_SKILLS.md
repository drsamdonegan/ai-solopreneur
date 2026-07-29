# Customise the Agent with Markdown Skills

## Outcome

A skill is a small Markdown file that tells the agent how to behave in one situation. You can change an enabled skill without editing JavaScript or rebuilding anything.

The starter agent includes:

| Skill | What it changes |
| --- | --- |
| `project-assistant` | How the agent turns uncertainty into practical next steps |
| `task-capture` | How the agent prepares a confirmation-gated task proposal |
| `weekly-status` | How the agent summarises factual task progress |

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

At least one skill must remain enabled.

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
- The combined enabled instructions may contain at most 24,000 characters.

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
node tests/phase5/test-skills.mjs
```

The [finished Launch Partner example](../examples/finished-solo-project-assistant/README.md) includes an alternative project-assistant skill for comparison. After testing a learner change in a new conversation, use [GitHub Desktop](GITHUB_DESKTOP.md) to commit and push the Markdown file.
