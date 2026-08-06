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
| `workflows/50-tool-start-domain-research.json` | Starts authorised public-domain research and binds its job ID to the current conversation |
| `workflows/51-tool-complete-domain-research.json` | Reports what one conversation-bound research job saved, without researching again |
| `workflows/52-tool-get-business-memory.json` | Reads saved company, competitor, keyword, source, and warning data from local memory |
| `workflows/90-debug-agent-health.json` | Exposes a safe local health response without secrets |

The workflow exports contain a credential reference named `Anthropic account`, but no API keys. After import, create or select the real credential inside n8n. Workflows `00` and `50` each need it selected once.

Use the repository import script rather than editing JSON by hand:

```bash
./scripts/import-workflows.sh
```

Workflow setup and testing are documented in [N8N_AGENT_SETUP.md](../docs/N8N_AGENT_SETUP.md). The task schema and extension rules are in [LOCAL_TASK_TOOLS.md](../docs/LOCAL_TASK_TOOLS.md); skills and confirmation are covered by [CUSTOMISE_SKILLS.md](../docs/CUSTOMISE_SKILLS.md) and [SAFE_WRITE_CONFIRMATION.md](../docs/SAFE_WRITE_CONFIRMATION.md). Technical contributors should use [WORKFLOW_DEVELOPMENT.md](../docs/WORKFLOW_DEVELOPMENT.md) when moving a visual edit back into Git.
