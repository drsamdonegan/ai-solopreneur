# AI Solopreneur: Local-First Implementation Plan

> **Status note:** Phases 0–8 describe the original `v0.1.0` Docker-based
> implementation. Release `v0.2.0` replaced Docker on the learner path with a
> shared native runner and verified project-local Node.js bootstrap, and added
> bounded PDF, DOCX, TXT, and pasted-text context plus a reusable agent
> registry. Current contracts are documented in
> [CHAT_CONTRACT.md](CHAT_CONTRACT.md),
> [DOCUMENT_UPLOADS.md](DOCUMENT_UPLOADS.md), and
> [ADD_AN_AGENT.md](ADD_AN_AGENT.md). `compose.yaml` remains for contributor
> smoke tests and future server deployment.

## 1. Objective

Build a repository that non-technical teams can copy, start locally with Docker, customise, and extend into a useful Claude-powered agent.

The first release is deliberately local-first. It will provide:

- A simple chat interface built and branded by each team.
- A visual n8n workflow that receives chat messages and runs the agent.
- Claude API integration through an n8n credential.
- Local conversation memory.
- A small set of project-management skills and tools.
- Confirmation before the agent changes data.
- One-click or one-command startup on macOS and Windows.
- Version-controlled workflows, skills, documentation, and examples.

Cloud deployment and external chat channels are explicitly deferred until the local experience is reliable for non-technical users.

## 2. Product principles

1. **First useful result quickly.** A new learner should receive a Claude response within 30 minutes.
2. **Visual before technical.** Core agent behaviour should be visible in n8n.
3. **Safe defaults.** Reading is automatic; changes require confirmation; deletion is unavailable.
4. **No secrets in the browser or Git.** The Claude API key is stored only in n8n credentials.
5. **Small, understandable workflows.** Reusable complexity belongs in named subworkflows.
6. **Portable by design.** The local stack uses standard Docker images, environment variables, stable HTTP contracts, and exported workflow JSON.
7. **Beginner and builder paths.** Non-technical users customise configuration, prompts, skills, and visual workflows; technical users can extend the gateway, tests, tools, and deployment.

## 3. Initial scope

### Included

- Local Docker Compose environment.
- n8n editor and workflow runtime.
- A custom browser-based chat interface.
- A small chat gateway that keeps n8n details and secrets out of the browser.
- An isolated local document reader for searchable PDF, DOCX, TXT, and pasted text.
- A central registry for one active Project Manager and future agent roles.
- Claude-powered n8n AI Agent workflow.
- A browser session identifier and basic conversation memory.
- Local task storage.
- `list_tasks`, `create_task`, and `update_task_status` tools.
- Markdown-based skills.
- Confirmation for create and update operations.
- Setup, backup, troubleshooting, and learner documentation.
- Automated smoke tests for the chat contract and container health.

### Deferred

- AWS, GCP, DigitalOcean, or other cloud deployment.
- Slack, WhatsApp, Telegram, and email.
- Multi-user authentication and organisation accounts.
- OAuth and third-party project-management credentials.
- PostgreSQL, Redis, queue workers, or horizontal scaling.
- Streaming responses, OCR, RAG, or vector databases.
- MCP, multiple active production-ready agents, background autonomy, or scheduled writes.
- Billing, subscriptions, custom domains, and production observability.

## 4. Target local architecture

```text
Browser
  |
  +--> POST /api/documents --> Chat gateway --> Internal document reader
  |
  | POST /api/chat with server-owned document IDs
  v
Reusable chat gateway and static UI
  |
  | POST /webhook/chat over the Docker network
  v
n8n chat workflow
  |
  +--> conversation memory
  +--> selected skill instructions
  +--> Claude API
  +--> allowlisted task tools
  +--> confirmation workflow for writes
  |
  v
Chat gateway
  |
  v
Browser
```

The local Compose stack contains three services:

1. `chat`: serves the reusable interface, agent registry, document store, and
   local API endpoints.
2. `document-worker`: extracts bounded text on an internal-only Docker network.
3. `n8n`: provides the workflow editor, agent runtime, encrypted credentials,
   local SQLite persistence, and Data Tables.

n8n data is stored in a named Docker volume. PostgreSQL is intentionally omitted from the first local release and introduced during production-readiness work.

## 5. Stable contracts

### Browser-to-gateway request

```json
{
  "sessionId": "5b8f0ce8-...",
  "agentId": "project-manager",
  "message": "Show me my open tasks",
  "documentIds": []
}
```

### Gateway-to-browser response

```json
{
  "sessionId": "5b8f0ce8-...",
  "reply": "You have three open tasks.",
  "runId": "optional-local-run-id"
}
```

### Error response

```json
{
  "error": {
    "code": "AGENT_UNAVAILABLE",
    "message": "The local agent is not ready. Check that n8n is running and the workflow is active."
  }
}
```

The gateway validates message length, requires a session identifier, applies a request timeout, and converts internal n8n errors into learner-friendly messages.

## 6. Proposed repository structure

```text
ai-solopreneur/
├── compose.yaml
├── .env.example
├── README.md
├── apps/
│   └── chat/
│       ├── Dockerfile
│       ├── package.json
│       ├── src/
│       │   └── server.ts
│       └── public/
│           ├── index.html
│           ├── app.js
│           ├── styles.css
│           └── agent.config.js
├── n8n/
│   ├── workflows/
│   │   ├── 00-start-here.json
│   │   ├── 10-chat-agent.json
│   │   ├── 20-task-tools.json
│   │   ├── 30-confirm-action.json
│   │   └── 90-debugging.json
│   └── examples/
├── skills/
│   ├── project-assistant/
│   ├── task-capture/
│   └── weekly-status/
├── scripts/
│   ├── setup.sh
│   ├── setup.ps1
│   ├── import-workflows.sh
│   ├── export-workflows.sh
│   ├── backup.sh
│   └── restore.sh
├── tests/
│   ├── contract/
│   ├── smoke/
│   └── workflow-fixtures/
└── docs/
    ├── IMPLEMENTATION_PLAN.md
    ├── INSTALL.md
    ├── BUILD_YOUR_CHAT.md
    ├── CUSTOMISE_THE_AGENT.md
    ├── ADD_A_SKILL.md
    ├── ADD_A_TOOL.md
    └── TROUBLESHOOTING.md
```

## 7. Implementation phases

### Phase 0: Confirm the teaching baseline

**Goal:** agree on the smallest experience learners must complete.

Tasks:

- Define the target learner and supported operating systems.
- Confirm Docker Desktop, GitHub, a browser, and an Anthropic API key as prerequisites.
- Select one example business scenario for the default agent.
- Write the initial scope and deferred-feature list into the README.
- Define the standard chat request, response, and error contracts.
- Define success metrics for the learner pilot.

Deliverables:

- Updated project README.
- Agreed API contract.
- Workshop prerequisite checklist.
- Definition of done for the first local release.

Acceptance criteria:

- The team agrees that cloud deployment and external chat channels are not part of the local milestone.
- Every planned feature maps directly to a learner exercise or a reliability requirement.

Dependencies: none.

### Phase 1: Create the local Docker foundation

**Goal:** start the complete local environment consistently.

Tasks:

- Add Docker Compose with `chat` and `n8n` services.
- Bind the public ports to localhost only.
- Add a persistent n8n volume.
- Pin the n8n image version.
- Add health checks and startup ordering.
- Add `.env.example` containing no real credentials.
- Add setup and start scripts for macOS and Windows.
- Add stop, reset, backup, and restore instructions.
- Add a preflight check for Docker, ports 3000 and 5678, and container health.

Deliverables:

- Working `compose.yaml`.
- Local setup scripts.
- Persistent n8n installation.
- Basic health and preflight commands.

Acceptance criteria:

- A clean machine can start the stack without installing Node.js locally.
- `http://localhost:3000` opens the chat service.
- `http://localhost:5678` opens n8n.
- Restarting the stack preserves n8n workflows and credentials.
- No credential or generated data is committed.

Dependencies: Phase 0.

### Phase 2: Build the learner-owned chat interface

**Goal:** give each team an approachable interface it can visibly customise.

Tasks:

- Build a small TypeScript gateway with `GET /health` and `POST /api/chat`.
- Serve plain HTML, CSS, and JavaScript from the gateway.
- Proxy chat requests to n8n over the internal Docker network.
- Generate and persist a browser session ID.
- Add message bubbles, a loading state, errors, Enter-to-send, and reset conversation.
- Add example prompt buttons.
- Put agent name, subtitle, welcome message, prompts, and main colour in `agent.config.js`.
- Render model output safely; do not allow unsanitised HTML.
- Add responsive and keyboard-accessible behaviour.

Deliverables:

- Functional local chat application.
- Beginner-facing configuration file.
- Documented `/api/chat` contract.
- Completed example design.

Acceptance criteria:

- A learner can change the name, colour, welcome message, and prompts without touching server code.
- The API key is never present in browser requests or source files.
- n8n timeouts and unavailable workflows result in a helpful chat error.
- The interface works on mobile-width and desktop-width browsers.

Dependencies: Phase 1.

### Phase 3: Build the visual n8n agent

**Goal:** connect the custom chat to a visual Claude agent workflow.

Tasks:

- Create a `00 - START HERE` workflow with explanatory sticky notes.
- Add a Webhook trigger for the gateway.
- Validate and normalise `sessionId` and `message`.
- Add the Anthropic Chat Model and AI Agent nodes.
- Add basic conversation memory keyed by `sessionId`.
- Limit agent iterations, output size, and request duration.
- Return the stable response contract through Respond to Webhook.
- Add a debugging workflow that exposes health without exposing secrets.
- Export the workflows into the repository.
- Document how to create and select the Anthropic credential.

Deliverables:

- Importable and documented agent workflow.
- Import/export scripts.
- Debugging workflow.
- Claude credential setup guide.

Acceptance criteria:

- A learner can trace a message from the webhook through Claude to the response.
- Conversation context works within a browser session.
- Restart behaviour is documented.
- The core visual workflow remains small enough to explain in one lesson.
- A malformed message does not reach Claude.

Dependencies: Phases 1 and 2.

### Phase 4: Add local project-management tools

**Goal:** demonstrate a genuine agent that can inspect and change structured data.

Tasks:

- Create a local `tasks` Data Table with title, description, status, priority, due date, and timestamps.
- Create narrow subworkflows for `list_tasks`, `create_task`, and `update_task_status`.
- Give each tool a clear description and strict inputs.
- Add sample task data.
- Prevent the model from accessing arbitrary database queries or HTTP requests.
- Add a tool audit record containing time, session, tool name, proposed input, result, and error.
- Make tool failures recoverable and understandable to the user.

Deliverables:

- Local task schema and sample data.
- Three agent-callable tool subworkflows.
- Tool audit data.
- Tool-building documentation for technical contributors.

Acceptance criteria:

- The agent lists only task data that exists.
- Tool inputs are visible and understandable in n8n.
- Invalid statuses, empty titles, and oversized inputs are rejected.
- Repeating a failed request does not silently create duplicate tasks.

Dependencies: Phase 3.

### Phase 5: Add skills and safe write confirmation

**Goal:** make behaviour reusable while keeping state-changing actions controlled.

Tasks:

- Define a small `skill.yaml` and `SKILL.md` convention.
- Add project-assistant, task-capture, and weekly-status examples.
- Load only the enabled skill instructions into the agent.
- Add risk metadata to tools: `read`, `write`, or `destructive`.
- Run read tools automatically.
- Ask for explicit confirmation before create or update operations.
- Bind confirmation to the session and exact proposed arguments.
- Give confirmations a short expiry and make them single-use.
- Keep delete, archive, and bulk-change tools unavailable.

Deliverables:

- Skill format and examples.
- Confirmation workflow.
- Beginner skill-customisation guide.
- Tool-risk policy.

Acceptance criteria:

- A learner can change agent behaviour by editing one Markdown skill.
- A task is not created or updated without a matching confirmation.
- An old or unrelated “yes” cannot approve a later action.
- No destructive tool is available to the model.

Dependencies: Phase 4.

### Phase 6: Package the beginner experience

**Goal:** remove avoidable setup and troubleshooting friction.

Tasks:

- Configure the repository as a GitHub template.
- Write outcome-first installation instructions with screenshots.
- Create a “start here” checklist inside n8n.
- Add automatic workflow import where it is reliable and an easy manual fallback.
- Add friendly diagnostics for Docker, n8n, the active workflow, and Claude credentials.
- Add a troubleshooting table for common macOS and Windows failures.
- Provide a finished example without hiding the starter implementation.
- Document GitHub Desktop as the default non-technical Git workflow.
- Document how technical users export workflow changes back into Git.

Deliverables:

- GitHub template-ready repository.
- Complete learner documentation.
- Instructor checklist.
- Troubleshooting and recovery guide.

Acceptance criteria:

- A learner can create their own repository from the template.
- Another team can start a project using only its README.
- Learners do not need Node.js, npm, or n8n installed directly on the host.
- Reset and backup procedures are understandable and tested.

Dependencies: Phases 1 through 5.

### Phase 7: Test with non-technical learners

**Goal:** validate the experience before expanding the architecture.

Tasks:

- Run a preflight session focused on Docker Desktop.
- Pilot with approximately five users who were not involved in development.
- Record time to first successful response.
- Record where instructor intervention is required.
- Test macOS, Windows with WSL2, and different browser widths.
- Test invalid credentials, exhausted API credit, inactive workflows, occupied ports, container restart, and no internet.
- Add contract and smoke tests to CI.
- Simplify or remove steps that repeatedly cause confusion.

Deliverables:

- Pilot findings.
- Prioritised usability fixes.
- Automated health and contract tests.
- Go/no-go checklist for the workshop.

Acceptance criteria:

- At least 80% of pilot users receive a Claude response within 30 minutes.
- Every team can customise the interface and one skill.
- Every team can demonstrate a read tool and an approved write.
- A second team can start another team’s repository without verbal help.

Dependencies: Phase 6.

### Phase 8: Local release and course delivery

**Goal:** publish a stable local-first version and teach from it.

Tasks:

- Tag the first local release.
- Freeze image and dependency versions for the workshop.
- Prepare instructor backup copies of images and workflow exports.
- Deliver the course in incremental exercises.
- Collect learner feedback and examples.
- Create issues for improvements rather than changing the baseline during the live class.

Suggested course sequence:

1. Start the local stack and send the first message.
2. Build and brand the chat interface.
3. Change the agent’s role and instructions.
4. Inspect conversation memory and Claude usage.
5. Use the local task-reading tool.
6. Add a skill.
7. Confirm a task creation.
8. Export, document, and demonstrate the team project.

Acceptance criteria:

- A versioned local release can be reproduced after the workshop.
- Workshop changes do not depend on undocumented instructor actions.
- Learner projects remain independently runnable.

Dependencies: Phase 7.

## 8. Deferred production phases

These phases should begin only after the local pilot succeeds.

### Future Phase A: Production data and runtime

- Replace local SQLite and Data Tables where necessary with PostgreSQL.
- Separate n8n internal data from agent-owned data.
- Add durable inbox, job, audit, approval, and outbox records.
- Add backups, migrations, retention rules, and restore tests.
- Split synchronous chat from asynchronous provider-webhook processing.

### Future Phase B: Cloud-provider evaluation and deployment

- Compare AWS, GCP, DigitalOcean, and current lower-cost options at implementation time.
- Evaluate cost, managed PostgreSQL, TLS, backups, logging, secret storage, and scale-to-zero behaviour.
- Produce Docker-based infrastructure and deployment documentation without coupling the application to one provider.
- Select a teaching path and a production path separately if their operational needs differ.

### Future Phase C: External channels

Add channels in this order:

1. Telegram or Slack for a first external chat adapter.
2. Email.
3. WhatsApp sandbox.
4. Production WhatsApp.

Each adapter must verify requests, normalise messages, deduplicate provider events, acknowledge quickly, and dispatch responses through the same agent contract.

### Future Phase D: Real project-management services

- Map the local task vocabulary to one external provider.
- Add least-privilege OAuth.
- Keep provider credentials and project scope outside model control.
- Preserve confirmation and audit requirements.
- Add other services as separate tool adapters rather than changing core agent behaviour.

## 9. Testing strategy

### Automated

- Gateway request and response contract tests.
- Input validation and timeout tests.
- Static frontend smoke test.
- Container health test.
- Workflow JSON validation.
- Replay fixtures for valid and malformed chat requests.
- Tool-schema and confirmation-policy tests.
- Secret-scanning and dependency checks.

### Manual

- Clean install on macOS.
- Clean install on Windows with WSL2.
- Restart and persistence test.
- Workflow import/export test.
- Invalid Claude key and no-credit test.
- Occupied-port test.
- UI keyboard and mobile-width test.
- Read-tool, write-confirmation, expired-confirmation, and duplicate-request tests.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Docker Desktop setup consumes workshop time | Mandatory preflight session, screenshots, and instructor test machines |
| Learners accidentally expose API keys | Store keys only in n8n credentials; exclude generated data and `.env` from Git |
| n8n workflows become visually overwhelming | Keep the main workflow small and move tools into clearly named subworkflows |
| Workflow changes are not captured in Git | Provide export scripts and an end-of-session export checklist |
| The agent invents project data | Require tools for task facts and tell the agent to state when data is unavailable |
| Agent writes happen unexpectedly | Risk-classify tools and require exact, expiring confirmation for writes |
| Learners confuse product failures with Claude failures | Friendly gateway errors and a dedicated diagnostics workflow |
| The local design blocks future cloud work | Stable HTTP contracts, standard containers, environment configuration, and no host-specific paths |

## 11. Definition of done for the local-first release

The milestone is complete when:

- A new learner can create a repository from the template and start it locally.
- The chat and n8n editor open successfully.
- The learner can add a Claude credential without exposing it in Git or the browser.
- The custom chat sends a message to the visual n8n agent and displays the answer.
- Conversation context works for the active browser session.
- The learner can change the interface and one agent skill.
- The agent can list local tasks.
- Creating or updating a task requires an exact confirmation.
- Restart, reset, backup, restore, workflow export, and troubleshooting paths are documented.
- A second team can run the repository using documentation alone.
- Cloud deployment and external channel work remain separate, prioritised future phases.
