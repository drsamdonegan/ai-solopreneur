# Product Baseline

## Purpose

AI Solopreneur gives non-technical teams a working foundation for creating a Claude-powered agent locally. Learners should be able to see the agent workflow, change its behaviour, customise its interface, and add a narrow capability without first learning a full software-development stack.

This document is the product baseline for the local-first release. Proposed features that conflict with it should be deferred or recorded as a deliberate baseline change.

## Primary learner

The primary learner:

- Has little or no prior coding experience.
- Can install desktop applications and follow screenshot-based instructions.
- May not be comfortable using a terminal.
- Wants to build an agent for a real solo-business or team workflow.
- Benefits from immediate visual feedback.

The learner is not expected to understand process management, HTTP servers, databases, JavaScript package management, or cloud infrastructure.

## Technical contributor

The same repository must also support a technical contributor who can:

- Extend the local chat gateway.
- Add validation and automated tests.
- Create reusable n8n subworkflows.
- Add new tool adapters.
- Replace local storage with production data services later.
- Build cloud and external-channel deployments without rewriting the learner-facing agent.

Beginner simplicity must come from packaging and clear boundaries, not from making the architecture impossible to extend.

## Supported local environments

The first release targets:

- macOS 13 or newer on Apple Silicon or Intel.
- Windows 10 or 11 on x64, and Windows 11 ARM through x64 emulation. Windows 10
  ARM is unsupported.
- Current Chrome or Edge.

Linux is a best-effort technical-contributor environment until it is included in the learner pilot.

The local project must not require Node.js, npm, n8n, PostgreSQL, or another
runtime to be installed globally on the learner's computer. The one-click
helpers provide the checksum-verified Node.js 24.18.0/npm 11.16.0 pair inside
the project when that exact reviewed pair is not already available.

## Required learner prerequisites

Every learner needs:

- A GitHub account.
- Claude Desktop with Code mode available.
- An Anthropic Console account.
- A Claude API key with available credit.
- A supported browser.

GitHub Desktop is the recommended way for non-technical learners to obtain and update their repository.

The detailed pre-class check is in [WORKSHOP_PREREQUISITES.md](WORKSHOP_PREREQUISITES.md).

## Default teaching scenario

The starter agent is a **Project Manager**.

Its user is running a small project and wants help turning conversation into organised work. The agent should:

- Discuss plans and break work into practical next actions.
- Turn meeting transcripts and project documents into grounded summaries,
  decisions, action items, risks, and open questions.
- List tasks stored in the local project.
- Produce a concise project or weekly status.
- Propose a new task from a conversation.
- Propose a task-status change.
- Ask for confirmation before it changes task data.
- State clearly when the required project data is unavailable.

The starter scenario is intentionally narrow enough to explain in one workshop and general enough for teams to adapt to marketing, events, onboarding, study, client delivery, or another business function.

## Safety baseline

The local release uses these default rules:

- Read tools may run automatically.
- Create and update tools require confirmation.
- Delete, archive, bulk-write, shell, filesystem, arbitrary SQL, and arbitrary HTTP tools are unavailable to the model.
- A confirmation applies only to the current session and the exact proposed action.
- Secrets are stored in n8n credentials and never sent to the browser.
- Model output is rendered as untrusted content.
- Tool results, rather than model memory, are the source of truth for task facts.
- Uploaded document content is untrusted source material and cannot weaken
  agent or tool safety rules.

## First-release scope

The current local release includes:

- A native local stack run by the shared Node.js runner.
- A verified, project-local Node.js bootstrap for macOS and Windows.
- A custom browser chat.
- A small local chat gateway.
- An isolated PDF, DOCX, TXT, and pasted-text reader.
- A reusable agent registry with one active role and visible future roles.
- A visual n8n agent.
- Claude API integration.
- Browser-session conversation memory.
- Local task storage.
- `list_tasks`, `create_task`, and `update_task_status`.
- Markdown-based skills.
- Confirmation-gated writes.
- Workflow import, export, backup, reset, and restore paths.
- Beginner setup and troubleshooting documentation.
- Contract, health, and smoke tests.

## Deferred scope

The following are not part of the first local release:

- Any cloud-provider deployment.
- Public domains or internet-facing n8n.
- Slack, WhatsApp, Telegram, email, or other provider webhooks.
- Multiple users, organisations, roles, or identity linking.
- OAuth or external project-management services.
- PostgreSQL, Redis, distributed queues, or horizontal scaling.
- Streaming, OCR, RAG, or vector search.
- Multiple simultaneously active, independently configured agent roles.
- MCP, subagents, browser control, or code execution.
- Scheduled autonomous writes.
- Billing, subscriptions, production monitoring, or formal compliance.

These are preserved as later phases in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Learner outcomes

By the end of the local course, each team should be able to:

1. Start its own project locally.
2. Send a message through its custom chat to Claude.
3. Explain the visible n8n workflow at a high level.
4. Change the chat identity and appearance.
5. Change the agent's role or one Markdown skill.
6. Use a read-only task tool.
7. Confirm a proposed task write.
8. Export its workflow changes and document its project.
9. Give its repository to another team and have that team run it from the documentation.

## Success measures

The learner pilot must measure:

| Measure | Target |
| --- | --- |
| Learners receiving a first Claude reply | At least 80% within 30 minutes |
| Learners customising the chat and one skill | 100% of completing teams |
| Teams demonstrating a read tool | 100% of completing teams |
| Teams demonstrating a confirmation-gated write | 100% of completing teams |
| Repositories runnable by a second team using only documentation | 100% of pilot repositories selected for handoff |
| API keys exposed in browser requests or Git | Zero |
| Task writes performed without matching confirmation | Zero |

Instructor intervention, setup time, error category, operating system, and abandoned steps should also be recorded during the pilot.

## Definition of done

The local-first release is complete only when current evidence proves that:

- A new learner can create a repository from the template and start it locally.
- The chat and n8n editor open on the documented localhost addresses.
- The learner can configure Claude without exposing the API key.
- The browser chat reaches the visual n8n workflow and displays Claude's response.
- Conversation context works for the active browser session.
- The learner can change the interface and one skill.
- The agent can retrieve factual local task data.
- Creating or updating a task requires an exact, unexpired confirmation.
- Native restart, reset, backup, restore, workflow import, and workflow export are tested and documented.
- Automated contract and health checks pass.
- A second team can run the repository using its documentation without verbal help.
- Cloud deployment and external-channel code remain outside the release.

Passing a narrower demonstration does not satisfy the milestone.

## Change control

A baseline change should:

1. Identify the learner problem it solves.
2. Explain the added setup or teaching cost.
3. Update this document and the implementation plan.
4. Preserve the stable chat contract or explicitly version it.
5. Add corresponding acceptance evidence.
