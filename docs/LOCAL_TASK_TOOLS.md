# Local Task Tools

## Outcome

Phase 4 turns the conversational assistant into an agent that can retrieve structured facts and provides two tightly scoped write workers. Phase 5 places proposal and confirmation workflows in front of those workers.

Learners can:

- Open the local task table and understand every field.
- Ask the agent which tasks actually exist.
- Trace the read tool from the AI Agent into a small subworkflow.
- Inspect an audit row for every tool attempt.

Technical contributors can extend the task schema and tools without giving the model arbitrary database, HTTP, filesystem, or command access.

## The two core task tables

The import helper creates both core task tables with n8n's built-in [Data Tables](https://docs.n8n.io/data/data-tables/). Phase 5 also creates `pending_actions` for confirmation state and `agent_config` for enabled skills; those are documented in [SAFE_WRITE_CONFIRMATION.md](SAFE_WRITE_CONFIRMATION.md) and [CUSTOMISE_SKILLS.md](CUSTOMISE_SKILLS.md).

### `tasks`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | Number | Built-in n8n row identifier used by status updates |
| `requestId` | String | Stable idempotency key for the original create request |
| `lastRequestId` | String | Idempotency key for the most recent accepted write |
| `title` | String | Required task title, at most 120 characters |
| `description` | String | Optional detail, at most 2,000 characters |
| `status` | String | `backlog`, `todo`, `in_progress`, `blocked`, or `done` |
| `priority` | String | `low`, `medium`, or `high` |
| `dueDate` | Date | Optional UTC date |
| `createdAt` | Date | Built-in n8n creation timestamp |
| `updatedAt` | Date | Built-in n8n update timestamp |

The three starter tasks have stable `requestId` values. Re-running import inserts a starter only when that key is missing; it neither duplicates nor overwrites an edited row.

### `tool_audit`

| Column | Purpose |
| --- | --- |
| `occurredAt` | Time the tool prepared its result |
| `sessionId` | Browser conversation that requested the operation |
| `requestId` | Write idempotency key, or empty for a list |
| `toolName` | Exact reviewed tool name |
| `proposedInput` | JSON snapshot of normalised inputs |
| `result` | JSON snapshot of the structured result |
| `error` | Understandable error message, or empty on success |

Audit rows are operational records, not conversation memory. They persist across normal restarts and are included in local backups.

## The workflow set

| Workflow | Risk | Current access | Data-table operations |
| --- | --- | --- | --- |
| `10 - SETUP - Local Task Data` | Setup | None | Create tables; insert missing samples |
| `20 - TOOL - list_tasks` | Read | Connected | Get up to 100 task rows; insert audit |
| `21 - TOOL - create_task` | Write | Confirmation executor only | Lookup request ID; insert one task; insert audit |
| `22 - TOOL - update_task_status` | Write | Confirmation executor only | Lookup task ID; update status and idempotency marker; insert audit |
| `30 - TOOL - Propose create_task` | Write proposal | Connected | Store exact pending action; no task mutation |
| `31 - TOOL - Propose update_task_status` | Write proposal | Connected | Read one task and store an exact pending action |
| `40 - CONFIRM - Task Write` | Write dispatcher | Deterministic main-workflow branch | Consume one matching proposal, then call one worker |

Each tool starts with a typed Execute Workflow Trigger. n8n documents this pattern under [subworkflows](https://docs.n8n.io/flow-logic/subworkflows/) and the [Call n8n Workflow Tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolworkflow/).

`list_tasks` runs automatically. The model-facing `create_task` and `update_task_status` names point to workflows `30` and `31`, which cannot mutate the `tasks` table. A model cannot call either execution worker or workflow `40`.

See [SAFE_WRITE_CONFIRMATION.md](SAFE_WRITE_CONFIRMATION.md) for the exact, expiring, single-use boundary.

## Trace a factual read

Ask:

> What tasks are in my local project?

Then open the latest execution of `00 - START HERE - Project Partner`:

1. The gateway-supplied `sessionId` is kept out of model control.
2. The model chooses only the documented status and priority filters.
3. `list_tasks` validates those filters.
4. The Data Table node reads existing rows.
5. A Code node returns only documented task fields.
6. The result and proposed input are inserted into `tool_audit`.
7. Claude explains the tool result to the user.

Tool output is the source of truth. Conversation memory must never be used to reconstruct missing tasks.

## Validation and recovery

All three tools return structured results:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATUS",
    "message": "Status must be one of: backlog, todo, in_progress, blocked, done."
  }
}
```

Invalid input follows the audited error path before a task mutation. Missing tables produce `TASK_DATA_UNAVAILABLE` with an instruction to rerun setup. Missing task IDs produce `TASK_NOT_FOUND`.

`create_task` requires a UUID `requestId`:

- Repeating the same request ID and exact fields returns the existing row.
- Reusing it with different fields returns `IDEMPOTENCY_CONFLICT`.
- No second task is silently inserted.

`update_task_status` uses the same rule and can update only `status` and `lastRequestId`.

## Safe extension rules

When adding a new project-management tool:

1. Start with a separate, typed subworkflow.
2. Accept only the fields the operation needs.
3. Validate lengths, enums, identifiers, and dates before touching data.
4. Use Data Table **By Name** mode so exports remain portable.
5. Map explicit columns; do not auto-map untrusted model input.
6. Return documented fields rather than raw internal rows.
7. Insert a `tool_audit` record on success and failure.
8. Add idempotency to every write.
9. Keep HTTP Request, SQL, Execute Command, and filesystem nodes outside model-callable tools.
10. Add structural and runtime tests before connecting the tool.
11. Classify the tool as `read`, `write`, or `destructive`.
12. Never connect a write until the confirmation policy covers its exact arguments.

Delete, archive, bulk-write, arbitrary SQL, arbitrary HTTP, shell, and filesystem tools remain outside the local release.

## Automated verification

Run:

```bash
./scripts/test-phase5.sh
```

The test creates a separate native project copy and fake local Anthropic endpoint. It verifies:

- Workflow import in n8n 2.30.5.
- Repeatable setup without duplicate samples.
- Exact list results and filter validation.
- Empty and oversized create rejection.
- Idempotent task creation and conflict handling.
- Invalid, missing, successful, and repeated status updates.
- Complete audit records.
- The browser-to-agent-to-`list_tasks` path.
- Model-visible create and update names resolve only to proposal workflows.

The same test also covers confirmation, expiry, single-use, skill-loading, and destructive-tool checks.
