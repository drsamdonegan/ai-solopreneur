# Local chat contract

## Purpose

This contract separates the reusable browser interface from individual n8n
agents. Contract version 2 adds a server-owned agent registry and
session-scoped document context while retaining the version 1 text-only request
as a backward-compatible browser input.

The browser never calls n8n or the document reader directly.

## Browser endpoints

### Health

```http
GET /health
```

```json
{ "status": "ok" }
```

This proves only that the chat gateway is running.

### Agent registry

```http
GET /api/agents
```

```json
{
  "schemaVersion": 1,
  "agents": [
    {
      "id": "project-manager",
      "name": "Project Manager",
      "description": "Plans projects, analyses meetings, and turns decisions into safe next actions.",
      "status": "active",
      "examplePrompts": ["Turn these meeting notes into decisions and action items"]
    }
  ]
}
```

The response deliberately excludes each internal `workflowPath`. Coming-soon
agents are safe to display but cannot receive chat requests.

### Add pasted text

```http
POST /api/documents/text
Content-Type: application/json
```

```json
{
  "sessionId": "9d4482cf-f720-4f70-98af-e337db1a9d53",
  "name": "Monday planning meeting",
  "text": "A long transcript..."
}
```

Successful status is `201`. The response contains document metadata and a short
preview, never the complete stored text.

### Upload a file

```http
POST /api/documents
Content-Type: multipart/form-data
```

The form contains one UUID `sessionId` field and one `file` field. Supported
formats are searchable PDF, DOCX, and UTF-8 TXT. Successful status is `201`.

### Remove a document

```http
DELETE /api/documents/{documentId}?sessionId={sessionId}
```

Successful status is `204`. A document can be read or removed only from the
session that created it.

### Send a chat request

```http
POST /api/chat
Content-Type: application/json
```

```json
{
  "sessionId": "9d4482cf-f720-4f70-98af-e337db1a9d53",
  "agentId": "project-manager",
  "message": "List the confirmed decisions and action items.",
  "documentIds": ["be7ad8f0-f299-4ab8-9ddd-011c0aad2f17"]
}
```

`agentId` defaults to `project-manager` and `documentIds` defaults to an empty
array for version 1 browser clients.

Successful response:

```json
{
  "sessionId": "9d4482cf-f720-4f70-98af-e337db1a9d53",
  "reply": "The meeting confirmed two decisions...",
  "runId": "68c58560-19e4-49ea-aa6f-8b62e18329a0"
}
```

`runId` is optional.

## Gateway-to-n8n request

The gateway resolves document IDs, confirms that each belongs to the current
session, and selects a workflow from the trusted server registry. It sends the
validated request to `N8N_CHAT_WEBHOOK_URL`: the loopback address in the native
local runner, or the private service address in a Compose deployment.

```json
{
  "schemaVersion": 2,
  "sessionId": "9d4482cf-f720-4f70-98af-e337db1a9d53",
  "agentId": "project-manager",
  "message": "List the confirmed decisions and action items.",
  "documents": [
    {
      "id": "be7ad8f0-f299-4ab8-9ddd-011c0aad2f17",
      "name": "Monday planning meeting",
      "type": "pasted-text",
      "wordCount": 10243,
      "characterCount": 58711,
      "text": "The normalised source text..."
    }
  ]
}
```

The n8n workflow validates the request again before model or tool execution.
Direct legacy requests without `schemaVersion`, `agentId`, or `documents` are
treated as Project Manager version 1 text requests.

## Limits

| Input | Limit |
| --- | --- |
| Normal message | 1–8,000 characters after trimming |
| JSON chat body | 65,536 bytes |
| Files per request | 3 |
| One uploaded file | 20 MB |
| Extracted or pasted text per document | 150,000 characters |
| Combined document text per request | 200,000 characters |
| Searchable PDF | 200 pages |
| Expanded DOCX archive | 1,000 entries and 50 MB |
| Stored document lifetime | 24 hours |
| n8n reply returned through the gateway | 8,000 characters |

Document IDs must be unique in a request. Malformed requests do not reach
Claude.

## Extraction and storage

The isolated `document-worker` reads the original bytes and returns normalised
text plus metadata to the gateway. It has no published host port and no n8n or
Claude credentials.

The gateway stores extracted text as mode-`0600` JSON records in the
Git-ignored `data/documents/` folder. Records contain a source hash for diagnostics,
expire after 24 hours, and are bound to the browser session UUID. The original
file is not stored.

This is workshop privacy, not multi-user authentication. Anyone who can execute
code on the local computer or access its Docker data can inspect local records.

## Document safety

The workflow:

- sanitises document names;
- validates document type, count, and length;
- wraps each source in explicit untrusted-document boundaries;
- tells the model that document content is data, never instructions;
- forbids a transcript from triggering stored task writes unless the current
  user instruction explicitly requests a proposal.

These controls reduce prompt-injection risk; they do not prove arbitrary source
material safe.

## Error format

```json
{
  "error": {
    "code": "DOCUMENT_TEXT_TOO_LARGE",
    "message": "Pasted text must be 150,000 characters or fewer."
  }
}
```

Common stable codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | JSON, session, agent, or required input is invalid |
| 400 | `TOO_MANY_DOCUMENTS` | More than three documents were selected |
| 404 | `DOCUMENT_NOT_FOUND` | Record expired, was removed, or belongs to another session |
| 413 | `MESSAGE_TOO_LONG` | Instruction exceeds 8,000 characters |
| 413 | `FILE_TOO_LARGE` | Upload exceeds 20 MB |
| 413 | `DOCUMENT_TEXT_TOO_LARGE` | One extracted or pasted text exceeds its limit |
| 415 | `UNSUPPORTED_FILE_TYPE` | File is not PDF, DOCX, or TXT |
| 429 | `RATE_LIMITED` | Provider or local limiter rejected the request |
| 502 | `AGENT_ERROR` | n8n failed or returned an invalid response |
| 503 | `AGENT_UNAVAILABLE` | n8n or the selected workflow is unavailable |
| 503 | `DOCUMENT_SERVICE_UNAVAILABLE` | Local extractor is unavailable |
| 504 | `AGENT_TIMEOUT` | Workflow exceeded the gateway deadline |

Raw provider responses, stack traces, credentials, environment values, and
stored source text must not appear in browser-facing errors.

## Timeout and memory

The gateway deadline is 120 seconds. The n8n workflow timeout is 110 seconds,
the Claude node requests at most 2,200 output tokens, and the agent may take at
most four iterations.

Memory is keyed by `agentId:sessionId`, preventing two active roles from sharing
one history. Simple Memory keeps six interactions and is cleared when n8n
restarts. A session UUID is not an authenticated user identity.

## Browser rendering

Agent replies are inserted with `textContent` as untrusted plain text. If
Markdown is added later, generated HTML must be sanitised before rendering.

## Security boundary

- The browser receives no Claude credential.
- The gateway receives no Claude credential.
- The n8n credential store owns the Claude API key.
- The gateway reaches n8n only through `N8N_CHAT_WEBHOOK_URL`: the loopback address in the local runner, or the private service address in a Compose deployment.
- The chat endpoint uses same-origin browser requests in the local release.
- Authentication and public ingress are deferred until cloud deployment.

## Compatibility

Changes are backward-compatible when they:

- Add optional response fields.
- Add ignored request fields.
- Improve error prose without changing error codes.

Changes require a versioned contract when they:

- Rename or remove required fields.
- Change validation limits.
- Change session semantics.
- Make the workflow asynchronous.
- Require browser authentication.

## Contract acceptance tests

Automated tests cover gateway validation, stable error handling, response
filtering, static-file safety, text extraction, invalid binary input, workflow
structure, prompt boundaries, and size limits. The contract suite proves:

- A valid request is forwarded and returned.
- Whitespace is trimmed.
- Missing, invalid, empty, and oversized inputs are rejected.
- n8n is not called for invalid input.
- An unavailable n8n service returns `AGENT_UNAVAILABLE`.
- A timed-out n8n request returns `AGENT_TIMEOUT`.
- A malformed n8n response returns `AGENT_ERROR`.
- Raw upstream errors and secrets are not returned.
- The response session identifier must match the request.
- Document IDs are session-bound and document text is wrapped as untrusted
  source material.
- The local document reader rejects unsupported, oversized, or malformed input.

The native packaging smoke and Docker workflow smoke additionally prove:

- Both exported workflows import and publish in the pinned n8n image.
- n8n, the document reader, and chat all become healthy.
- An uploaded or pasted text record can travel through the gateway.
- A malformed direct webhook request returns a safe error without calling the model.
- A valid browser request travels through the gateway and workflow.
- A session recalls its own conversation while a different session remains isolated.
- Agent output is capped.
- Restarting n8n clears the documented Simple Memory state.
