import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 2;
const DEFAULT_TITLE = "New conversation";
const MAX_TITLE_LENGTH = 80;
const MAX_SEARCH_LENGTH = 200;

export type MessageRole = "user" | "assistant";
export type MessageStatus =
  | "pending"
  | "complete"
  | "failed"
  | "interrupted";

export interface ConversationSummary {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StoredAttachment {
  documentId: string;
  name: string;
  type: string;
  mimeType: string;
  wordCount: number;
  characterCount: number;
  pageCount?: number;
  expiresAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  requestId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  errorCode?: string;
  runId?: string;
  createdAt: string;
  sequence: number;
  attachments: StoredAttachment[];
}

export interface ConversationPage {
  conversation: ConversationSummary;
  messages: StoredMessage[];
  nextBefore?: number;
}

export interface ConversationListPage {
  conversations: ConversationSummary[];
  nextCursor?: string;
}

export interface ConversationSearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: MessageRole;
  snippet: string;
  createdAt: string;
}

export interface HistoryMessage {
  role: MessageRole;
  content: string;
}

export interface BusinessMemoryCompetitors {
  direct: Array<Record<string, unknown>>;
  seo: Array<Record<string, unknown>>;
  adjacent: Array<Record<string, unknown>>;
}

export interface BusinessMemoryInput {
  schemaVersion: 1;
  jobId: string;
  status: "completed" | "partial";
  domain: string;
  companyOverview: string;
  profile: Record<string, unknown>;
  competitors: BusinessMemoryCompetitors;
  seedKeywords: string[];
  keywordCandidates: Array<Record<string, unknown>>;
  keywordGroups: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  warnings: string[];
  researchSummary: string;
  evidenceQuality: Record<string, unknown>;
  researchedAt?: string;
}

export interface BusinessMemoryRecord extends BusinessMemoryInput {
  researchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainResearchJobRecord {
  jobId: string;
  sessionId: string;
  domain: string;
  status: "queued" | "completed" | "partial";
  createdAt: string;
  updatedAt: string;
}

export interface BusinessMemorySummary {
  jobId: string;
  status: "completed" | "partial";
  domain: string;
  brandName: string;
  warningCount: number;
  researchedAt: string;
  updatedAt: string;
}

export interface BeginTurnInput {
  conversationId: string;
  agentId: string;
  requestId: string;
  content: string;
  attachments?: readonly StoredAttachment[];
  createdAt?: string;
}

export interface CompleteTurnInput {
  conversationId: string;
  requestId: string;
  content: string;
  runId?: string;
  createdAt?: string;
}

export interface StoredTurn {
  user?: StoredMessage;
  assistant?: StoredMessage;
}

interface ConversationRow {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  request_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  error_code: string | null;
  run_id: string | null;
  created_at: string;
  sequence: number;
}

interface AttachmentRow {
  message_id: string;
  document_id: string;
  name: string;
  type: string;
  mime_type: string;
  word_count: number;
  character_count: number;
  page_count: number | null;
  expires_at: string;
}

interface SearchRow {
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  role: MessageRole;
  snippet: string;
  created_at: string;
}

interface BusinessMemoryRow {
  schema_version: number;
  job_id: string;
  status: "completed" | "partial";
  domain: string;
  company_overview: string;
  profile_json: string;
  competitors_json: string;
  seed_keywords_json: string;
  keyword_candidates_json: string;
  keyword_groups_json: string;
  sources_json: string;
  warnings_json: string;
  research_summary: string;
  evidence_quality_json: string;
  researched_at: string;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromMessage(value: string): string {
  const normalised = value.replace(/\s+/g, " ").trim();
  if (normalised.length <= MAX_TITLE_LENGTH) {
    return normalised || DEFAULT_TITLE;
  }
  return `${normalised.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

function conversationFromRow(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count),
  };
}

function searchExpression(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

function businessMemoryFromRow(row: BusinessMemoryRow): BusinessMemoryRecord {
  return {
    schemaVersion: 1,
    jobId: row.job_id,
    status: row.status,
    domain: row.domain,
    companyOverview: row.company_overview,
    profile: JSON.parse(row.profile_json) as Record<string, unknown>,
    competitors: JSON.parse(row.competitors_json) as BusinessMemoryCompetitors,
    seedKeywords: JSON.parse(row.seed_keywords_json) as string[],
    keywordCandidates: JSON.parse(row.keyword_candidates_json) as Array<Record<string, unknown>>,
    keywordGroups: JSON.parse(row.keyword_groups_json) as Array<Record<string, unknown>>,
    sources: JSON.parse(row.sources_json) as Array<Record<string, unknown>>,
    warnings: JSON.parse(row.warnings_json) as string[],
    researchSummary: row.research_summary,
    evidenceQuality: JSON.parse(row.evidence_quality_json) as Record<string, unknown>,
    researchedAt: row.researched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(value: string): { updatedAt: string; id: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).updatedAt === "string" &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as { updatedAt: string; id: string };
    }
  } catch {
    // Use the stable error below.
  }
  throw new Error("Invalid conversation cursor");
}

export class ChatStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(readonly databasePath: string) {
    const inMemory = databasePath === ":memory:";
    if (!inMemory) {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") {
        chmodSync(dirname(databasePath), 0o700);
      }
    }
    this.database = new DatabaseSync(databasePath);
    if (!inMemory && process.platform !== "win32") {
      chmodSync(databasePath, 0o600);
    }
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
    this.markPendingInterrupted();
  }

  private migrate(): void {
    const versionRow = this.database.prepare("PRAGMA user_version").get() as
      | { user_version: number }
      | undefined;
    const version = Number(versionRow?.user_version ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `Chat database schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`,
      );
    }
    if (version === 0) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            request_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed', 'interrupted')),
            error_code TEXT,
            run_id TEXT,
            created_at TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            UNIQUE (conversation_id, request_id, role),
            UNIQUE (conversation_id, sequence)
          ) STRICT;

          CREATE INDEX messages_conversation_sequence
          ON messages(conversation_id, sequence);

          CREATE TABLE message_attachments (
            message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            document_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            word_count INTEGER NOT NULL,
            character_count INTEGER NOT NULL,
            page_count INTEGER,
            expires_at TEXT NOT NULL,
            PRIMARY KEY (message_id, document_id)
          ) STRICT;

          CREATE VIRTUAL TABLE message_search USING fts5(
            content,
            content='messages',
            content_rowid='rowid',
            tokenize='unicode61'
          );

          CREATE TRIGGER messages_search_insert AFTER INSERT ON messages BEGIN
            INSERT INTO message_search(rowid, content) VALUES (new.rowid, new.content);
          END;

          CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
            INSERT INTO message_search(message_search, rowid, content)
            VALUES ('delete', old.rowid, old.content);
          END;

          CREATE TRIGGER messages_search_update AFTER UPDATE OF content ON messages BEGIN
            INSERT INTO message_search(message_search, rowid, content)
            VALUES ('delete', old.rowid, old.content);
            INSERT INTO message_search(rowid, content) VALUES (new.rowid, new.content);
          END;

          PRAGMA user_version = 1;
        `);
      });
    }
    if (version < 2) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE business_memory (
            domain TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL CHECK (schema_version = 1),
            job_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('completed', 'partial')),
            company_overview TEXT NOT NULL,
            profile_json TEXT NOT NULL,
            competitors_json TEXT NOT NULL,
            seed_keywords_json TEXT NOT NULL,
            keyword_candidates_json TEXT NOT NULL,
            keyword_groups_json TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            warnings_json TEXT NOT NULL,
            research_summary TEXT NOT NULL,
            evidence_quality_json TEXT NOT NULL,
            researched_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX business_memory_updated_at
          ON business_memory(updated_at DESC);

          CREATE TABLE domain_research_jobs (
            job_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'completed', 'partial')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX domain_research_jobs_session
          ON domain_research_jobs(session_id, updated_at DESC);

          PRAGMA user_version = 2;
        `);
      });
    }
    this.database.prepare("SELECT rowid FROM message_search LIMIT 1").all();
    this.database.prepare("SELECT domain FROM business_memory LIMIT 1").all();
    this.database.prepare("SELECT job_id FROM domain_research_jobs LIMIT 1").all();
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private nextSequence(conversationId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM messages WHERE conversation_id = ?",
      )
      .get(conversationId) as { sequence: number };
    return Number(row.sequence);
  }

  private attachmentsFor(messageIds: readonly string[]): Map<string, StoredAttachment[]> {
    const result = new Map<string, StoredAttachment[]>();
    if (messageIds.length === 0) {
      return result;
    }
    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT message_id, document_id, name, type, mime_type, word_count,
                character_count, page_count, expires_at
         FROM message_attachments
         WHERE message_id IN (${placeholders})
         ORDER BY rowid`,
      )
      .all(...messageIds) as unknown as AttachmentRow[];
    for (const row of rows) {
      const attachment: StoredAttachment = {
        documentId: row.document_id,
        name: row.name,
        type: row.type,
        mimeType: row.mime_type,
        wordCount: Number(row.word_count),
        characterCount: Number(row.character_count),
        expiresAt: row.expires_at,
      };
      if (row.page_count !== null) {
        attachment.pageCount = Number(row.page_count);
      }
      const entries = result.get(row.message_id) ?? [];
      entries.push(attachment);
      result.set(row.message_id, entries);
    }
    return result;
  }

  private messagesFromRows(rows: readonly MessageRow[]): StoredMessage[] {
    const attachments = this.attachmentsFor(rows.map((row) => row.id));
    return rows.map((row) => {
      const message: StoredMessage = {
        id: row.id,
        conversationId: row.conversation_id,
        requestId: row.request_id,
        role: row.role,
        content: row.content,
        status: row.status,
        createdAt: row.created_at,
        sequence: Number(row.sequence),
        attachments: attachments.get(row.id) ?? [],
      };
      if (row.error_code !== null) {
        message.errorCode = row.error_code;
      }
      if (row.run_id !== null) {
        message.runId = row.run_id;
      }
      return message;
    });
  }

  private messageById(id: string): StoredMessage | undefined {
    const row = this.database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
    return row === undefined ? undefined : this.messagesFromRows([row])[0];
  }

  createConversation(
    id: string,
    agentId: string,
    createdAt = nowIso(),
  ): ConversationSummary {
    this.database
      .prepare(
        `INSERT INTO conversations(id, agent_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, agentId, DEFAULT_TITLE, createdAt, createdAt);
    const conversation = this.getConversation(id);
    if (!conversation || conversation.agentId !== agentId) {
      throw new Error("Conversation belongs to a different agent");
    }
    return conversation;
  }

  getConversation(id: string): ConversationSummary | undefined {
    const row = this.database
      .prepare(
        `SELECT c.*, COUNT(m.id) AS message_count
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`,
      )
      .get(id) as ConversationRow | undefined;
    return row === undefined ? undefined : conversationFromRow(row);
  }

  listConversations(limit: number, cursor?: string): ConversationListPage {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const cursorValue = cursor === undefined ? undefined : decodeCursor(cursor);
    const rows = (cursorValue === undefined
      ? this.database
          .prepare(
            `SELECT c.*, COUNT(m.id) AS message_count
             FROM conversations c
             LEFT JOIN messages m ON m.conversation_id = c.id
             GROUP BY c.id
             ORDER BY c.updated_at DESC, c.id DESC
             LIMIT ?`,
          )
          .all(boundedLimit + 1)
      : this.database
          .prepare(
            `SELECT c.*, COUNT(m.id) AS message_count
             FROM conversations c
             LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.updated_at < ? OR (c.updated_at = ? AND c.id < ?)
             GROUP BY c.id
             ORDER BY c.updated_at DESC, c.id DESC
             LIMIT ?`,
          )
          .all(
            cursorValue.updatedAt,
            cursorValue.updatedAt,
            cursorValue.id,
            boundedLimit + 1,
          )) as unknown as ConversationRow[];
    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit);
    const page: ConversationListPage = {
      conversations: selected.map(conversationFromRow),
    };
    const last = selected.at(-1);
    if (hasMore && last) {
      page.nextCursor = encodeCursor(last.updated_at, last.id);
    }
    return page;
  }

  getConversationPage(
    id: string,
    limit: number,
    before?: number,
  ): ConversationPage | undefined {
    const conversation = this.getConversation(id);
    if (!conversation) {
      return undefined;
    }
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = (before === undefined
      ? this.database
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ?
             ORDER BY sequence DESC
             LIMIT ?`,
          )
          .all(id, boundedLimit + 1)
      : this.database
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ? AND sequence < ?
             ORDER BY sequence DESC
             LIMIT ?`,
          )
          .all(id, before, boundedLimit + 1)) as unknown as MessageRow[];
    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit).reverse();
    const page: ConversationPage = {
      conversation,
      messages: this.messagesFromRows(selected),
    };
    if (hasMore && selected[0]) {
      page.nextBefore = Number(selected[0].sequence);
    }
    return page;
  }

  renameConversation(id: string, title: string): ConversationSummary | undefined {
    const cleaned = title.replace(/\s+/g, " ").trim();
    if (cleaned.length === 0 || cleaned.length > MAX_TITLE_LENGTH) {
      throw new Error("Invalid conversation title");
    }
    const result = this.database
      .prepare("UPDATE conversations SET title = ? WHERE id = ?")
      .run(cleaned, id);
    return Number(result.changes) === 0 ? undefined : this.getConversation(id);
  }

  deleteConversation(id: string): boolean {
    const result = this.database
      .prepare("DELETE FROM conversations WHERE id = ?")
      .run(id);
    return Number(result.changes) > 0;
  }

  beginTurn(input: BeginTurnInput): StoredTurn {
    return this.transaction(() => {
      const existing = this.getTurn(input.conversationId, input.requestId);
      if (existing.user) {
        return existing;
      }
      const createdAt = input.createdAt ?? nowIso();
      const conversation = this.createConversation(
        input.conversationId,
        input.agentId,
        createdAt,
      );
      const id = randomUUID();
      const sequence = this.nextSequence(input.conversationId);
      this.database
        .prepare(
          `INSERT INTO messages(
             id, conversation_id, request_id, role, content, status,
             error_code, run_id, created_at, sequence
           ) VALUES (?, ?, ?, 'user', ?, 'pending', NULL, NULL, ?, ?)`,
        )
        .run(
          id,
          input.conversationId,
          input.requestId,
          input.content,
          createdAt,
          sequence,
        );
      const insertAttachment = this.database.prepare(
        `INSERT INTO message_attachments(
           message_id, document_id, name, type, mime_type, word_count,
           character_count, page_count, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const attachment of input.attachments ?? []) {
        insertAttachment.run(
          id,
          attachment.documentId,
          attachment.name,
          attachment.type,
          attachment.mimeType,
          attachment.wordCount,
          attachment.characterCount,
          attachment.pageCount ?? null,
          attachment.expiresAt,
        );
      }
      const title =
        conversation.messageCount === 0 && conversation.title === DEFAULT_TITLE
          ? titleFromMessage(input.content)
          : conversation.title;
      this.database
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
        )
        .run(title, createdAt, input.conversationId);
      const user = this.messageById(id);
      if (!user) {
        throw new Error("Stored user message could not be read");
      }
      return { user };
    });
  }

  completeTurn(input: CompleteTurnInput): StoredTurn {
    return this.transaction(() => {
      const existing = this.getTurn(input.conversationId, input.requestId);
      if (!existing.user) {
        throw new Error("User message does not exist");
      }
      if (existing.assistant) {
        return existing;
      }
      const createdAt = input.createdAt ?? nowIso();
      this.database
        .prepare(
          `UPDATE messages
           SET status = 'complete', error_code = NULL
           WHERE conversation_id = ? AND request_id = ? AND role = 'user'`,
        )
        .run(input.conversationId, input.requestId);
      const assistantId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO messages(
             id, conversation_id, request_id, role, content, status,
             error_code, run_id, created_at, sequence
           ) VALUES (?, ?, ?, 'assistant', ?, 'complete', NULL, ?, ?, ?)`,
        )
        .run(
          assistantId,
          input.conversationId,
          input.requestId,
          input.content,
          input.runId ?? null,
          createdAt,
          this.nextSequence(input.conversationId),
        );
      this.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(createdAt, input.conversationId);
      return this.getTurn(input.conversationId, input.requestId);
    });
  }

  failTurn(conversationId: string, requestId: string, errorCode: string): void {
    this.database
      .prepare(
        `UPDATE messages
         SET status = 'failed', error_code = ?
         WHERE conversation_id = ? AND request_id = ? AND role = 'user'
           AND status = 'pending'`,
      )
      .run(errorCode, conversationId, requestId);
  }

  getTurn(conversationId: string, requestId: string): StoredTurn {
    const rows = this.database
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND request_id = ?
         ORDER BY sequence`,
      )
      .all(conversationId, requestId) as unknown as MessageRow[];
    const messages = this.messagesFromRows(rows);
    const user = messages.find((message) => message.role === "user");
    const assistant = messages.find((message) => message.role === "assistant");
    return {
      ...(user === undefined ? {} : { user }),
      ...(assistant === undefined ? {} : { assistant }),
    };
  }

  getHistory(
    conversationId: string,
    maximumTurns = 6,
    maximumCharacters = 24_000,
  ): HistoryMessage[] {
    const rows = this.database
      .prepare(
        `SELECT u.content AS user_content, a.content AS assistant_content
         FROM messages u
         JOIN messages a
           ON a.conversation_id = u.conversation_id
          AND a.request_id = u.request_id
          AND a.role = 'assistant'
          AND a.status = 'complete'
         WHERE u.conversation_id = ?
           AND u.role = 'user'
           AND u.status = 'complete'
         ORDER BY a.sequence DESC`,
      )
      .all(conversationId) as unknown as Array<{
      user_content: string;
      assistant_content: string;
    }>;
    const selected: Array<[HistoryMessage, HistoryMessage]> = [];
    let characters = 0;
    for (const row of rows) {
      if (selected.length >= maximumTurns) {
        break;
      }
      const pairCharacters =
        row.user_content.length + row.assistant_content.length;
      if (characters + pairCharacters > maximumCharacters) {
        break;
      }
      selected.push([
        { role: "user", content: row.user_content },
        { role: "assistant", content: row.assistant_content },
      ]);
      characters += pairCharacters;
    }
    return selected.reverse().flat();
  }

  search(query: string, limit: number): ConversationSearchResult[] {
    const cleaned = query.normalize("NFC").trim();
    if (cleaned.length === 0 || cleaned.length > MAX_SEARCH_LENGTH) {
      throw new Error("Invalid search query");
    }
    const expression = searchExpression(cleaned);
    if (expression.length === 0) {
      return [];
    }
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.database
      .prepare(
        `SELECT m.conversation_id, c.title AS conversation_title,
                m.id AS message_id, m.role,
                snippet(message_search, 0, '', '', ' … ', 18) AS snippet,
                m.created_at
         FROM message_search
         JOIN messages m ON m.rowid = message_search.rowid
         JOIN conversations c ON c.id = m.conversation_id
         WHERE message_search MATCH ?
         ORDER BY rank, m.created_at DESC
         LIMIT ?`,
      )
      .all(expression, boundedLimit) as unknown as SearchRow[];
    return rows.map((row) => ({
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      messageId: row.message_id,
      role: row.role,
      snippet: row.snippet,
      createdAt: row.created_at,
    }));
  }

  saveBusinessMemory(input: BusinessMemoryInput): BusinessMemoryRecord {
    const timestamp = nowIso();
    const researchedAt = input.researchedAt ?? timestamp;
    this.database
      .prepare(
        `INSERT INTO business_memory(
           domain, schema_version, job_id, status, company_overview,
           profile_json, competitors_json, seed_keywords_json,
           keyword_candidates_json, keyword_groups_json, sources_json,
           warnings_json, research_summary, evidence_quality_json,
           researched_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET
           schema_version = excluded.schema_version,
           job_id = excluded.job_id,
           status = excluded.status,
           company_overview = excluded.company_overview,
           profile_json = excluded.profile_json,
           competitors_json = excluded.competitors_json,
           seed_keywords_json = excluded.seed_keywords_json,
           keyword_candidates_json = excluded.keyword_candidates_json,
           keyword_groups_json = excluded.keyword_groups_json,
           sources_json = excluded.sources_json,
           warnings_json = excluded.warnings_json,
           research_summary = excluded.research_summary,
           evidence_quality_json = excluded.evidence_quality_json,
           researched_at = excluded.researched_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.domain,
        input.schemaVersion,
        input.jobId,
        input.status,
        input.companyOverview,
        JSON.stringify(input.profile),
        JSON.stringify(input.competitors),
        JSON.stringify(input.seedKeywords),
        JSON.stringify(input.keywordCandidates),
        JSON.stringify(input.keywordGroups),
        JSON.stringify(input.sources),
        JSON.stringify(input.warnings),
        input.researchSummary,
        JSON.stringify(input.evidenceQuality),
        researchedAt,
        timestamp,
        timestamp,
      );
    const stored = this.getBusinessMemory(input.domain);
    if (!stored) {
      throw new Error("Stored business memory could not be read");
    }
    return stored;
  }

  registerDomainResearchJob(
    sessionId: string,
    jobId: string,
    domain: string,
  ): void {
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT session_id, domain FROM domain_research_jobs WHERE job_id = ?")
        .get(jobId) as { session_id: string; domain: string } | undefined;
      if (
        existing &&
        (existing.session_id !== sessionId || existing.domain !== domain)
      ) {
        throw new Error("Domain research job belongs to a different conversation");
      }
      const timestamp = nowIso();
      this.database
        .prepare(
          `INSERT INTO domain_research_jobs(
             job_id, session_id, domain, status, created_at, updated_at
           ) VALUES (?, ?, ?, 'queued', ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET updated_at = excluded.updated_at`,
        )
        .run(jobId, sessionId, domain, timestamp, timestamp);
    });
  }

  getDomainResearchJob(
    sessionId: string,
    jobId: string,
  ): DomainResearchJobRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT job_id, session_id, domain, status, created_at, updated_at
         FROM domain_research_jobs
         WHERE job_id = ?`,
      )
      .get(jobId) as
      | {
          job_id: string;
          session_id: string;
          domain: string;
          status: DomainResearchJobRecord["status"];
          created_at: string;
          updated_at: string;
        }
      | undefined;
    // A job is only visible to the conversation that registered it.
    if (!row || row.session_id !== sessionId) {
      return undefined;
    }
    return {
      jobId: row.job_id,
      sessionId: row.session_id,
      domain: row.domain,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  saveBusinessMemoryForJob(
    sessionId: string,
    input: BusinessMemoryInput,
  ): BusinessMemoryRecord {
    return this.transaction(() => {
      const job = this.database
        .prepare(
          "SELECT session_id, domain FROM domain_research_jobs WHERE job_id = ?",
        )
        .get(input.jobId) as { session_id: string; domain: string } | undefined;
      if (!job || job.session_id !== sessionId || job.domain !== input.domain) {
        throw new Error("Domain research job is not registered to this conversation");
      }
      const stored = this.saveBusinessMemory(input);
      this.database
        .prepare(
          `UPDATE domain_research_jobs
           SET status = ?, updated_at = ?
           WHERE job_id = ? AND session_id = ?`,
        )
        .run(input.status, nowIso(), input.jobId, sessionId);
      return stored;
    });
  }

  getBusinessMemory(domain: string): BusinessMemoryRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM business_memory WHERE domain = ?")
      .get(domain) as BusinessMemoryRow | undefined;
    return row === undefined ? undefined : businessMemoryFromRow(row);
  }

  listBusinessMemory(limit = 50): BusinessMemoryRecord[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.database
      .prepare(
        `SELECT * FROM business_memory
         ORDER BY updated_at DESC, domain ASC
         LIMIT ?`,
      )
      .all(boundedLimit) as unknown as BusinessMemoryRow[];
    return rows.map(businessMemoryFromRow);
  }

  listBusinessMemorySummaries(limit = 50): BusinessMemorySummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.database
      .prepare(
        `SELECT job_id, status, domain, profile_json, warnings_json,
                researched_at, updated_at
         FROM business_memory
         ORDER BY updated_at DESC, domain ASC
         LIMIT ?`,
      )
      .all(boundedLimit) as unknown as Array<
      Pick<
        BusinessMemoryRow,
        | "job_id"
        | "status"
        | "domain"
        | "profile_json"
        | "warnings_json"
        | "researched_at"
        | "updated_at"
      >
    >;
    return rows.map((row) => {
      const profile = JSON.parse(row.profile_json) as Record<string, unknown>;
      const warnings = JSON.parse(row.warnings_json) as unknown[];
      return {
        jobId: row.job_id,
        status: row.status,
        domain: row.domain,
        brandName: typeof profile.brandName === "string" ? profile.brandName : "",
        warningCount: Array.isArray(warnings) ? warnings.length : 0,
        researchedAt: row.researched_at,
        updatedAt: row.updated_at,
      };
    });
  }

  markPendingInterrupted(): number {
    const result = this.database
      .prepare(
        `UPDATE messages
         SET status = 'interrupted', error_code = 'REQUEST_INTERRUPTED'
         WHERE status = 'pending'`,
      )
      .run();
    return Number(result.changes);
  }

  health(): { schemaVersion: number; quickCheck: string } {
    const version = this.database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    const check = this.database.prepare("PRAGMA quick_check").get() as {
      quick_check: string;
    };
    return {
      schemaVersion: Number(version.user_version),
      quickCheck: String(check.quick_check),
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
    this.closed = true;
  }
}
