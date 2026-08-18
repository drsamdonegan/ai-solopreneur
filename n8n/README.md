# n8n Workflows

This directory contains portable workflow exports for the local AI agent.

| File | Purpose |
| --- | --- |
| `workflows/00-start-here-project-partner.json` | Validates chat requests, calls Claude, keeps session memory, and returns the chat contract |
| `workflows/01-start-here-learner-checklist.json` | Gives learners a five-step visual path from local owner setup to a customised, diagnosed agent |
| `workflows/10-setup-local-task-data.json` | Idempotently creates task, audit, and pending-confirmation tables plus three sample tasks |
| `workflows/11-setup-sync-enabled-skills.json` | Validates and stores the enabled Markdown skill bundle through a temporary local endpoint |
| `workflows/20-tool-list-tasks.json` | Validates filters, reads factual task rows, and audits the read |
| `workflows/21-tool-create-task.json` | Idempotently creates one task when called by the confirmation dispatcher |
| `workflows/22-tool-update-task-status.json` | Changes only one task status when called by the confirmation dispatcher |
| `workflows/30-tool-propose-create-task.json` | Model-facing create proposal with no task-table mutation |
| `workflows/31-tool-propose-update-task-status.json` | Model-facing status proposal with no task-table mutation |
| `workflows/40-confirm-task-write.json` | Enforces exact session binding, expiry, supersession, and single-use before a write |
| `workflows/90-debug-agent-health.json` | Exposes a safe local health response without secrets |

The workflow exports contain a credential reference named `Anthropic account`,
but no secret. After import, create or select the real credential inside n8n.
Optional skills document any additional provider credentials they require.

## Skill folders

`folders.manifest.json` decides how the workflows are grouped in n8n. Eleven numbered workflows read to a beginner as eleven unrelated things, so import files them into three folders named after what the agent can do, and the launcher prints the link to the page that shows them.

That page is the local owner's **Personal** project. n8n only draws folders inside a project; its **Overview** page is always a flat list of everything and cannot be grouped. Nothing about the agent depends on the folders — they change the list, not the wiring — so a learner who ignores them still has a working agent.

**Folders are a licensed n8n feature.** An unregistered instance has no folder licence, and on one the grouping is worse than useless: the folders are never drawn, but the project page still asks for "workflows at the top level", so a filed workflow disappears from the list instead of being grouped. Import therefore checks for a licence and leaves the workflows ungrouped without one, which is simply the flat list a learner has today. Registering the free community edition inside n8n unlocks folders; it sends an email address to n8n and returns a licence key.

Adding a workflow means adding it to `folders.manifest.json` as well. `scripts/validate-workflows.mjs` fails while a workflow belongs to no folder or to two. Re-file an existing install, or put everything back at the top level, at any time:

```bash
node scripts/local.mjs group-workflows
```

```bash
node scripts/local.mjs group-workflows --undo
```

Use the repository import script rather than editing JSON by hand:

```bash
./scripts/import-workflows.sh
```

Workflow setup and testing are documented in [N8N_AGENT_SETUP.md](../docs/N8N_AGENT_SETUP.md). The task schema and extension rules are in [LOCAL_TASK_TOOLS.md](../docs/LOCAL_TASK_TOOLS.md); skills and confirmation are covered by [CUSTOMISE_SKILLS.md](../docs/CUSTOMISE_SKILLS.md) and [SAFE_WRITE_CONFIRMATION.md](../docs/SAFE_WRITE_CONFIRMATION.md). Technical contributors should use [WORKFLOW_DEVELOPMENT.md](../docs/WORKFLOW_DEVELOPMENT.md) when moving a visual edit back into Git.
