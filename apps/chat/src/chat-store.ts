import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArticleBriefData,
  ArticleBriefRecord,
  ArticleBriefStatus,
  ArticleBusinessContext,
  ArticleOpportunity,
} from "./article-brief.js";

const SCHEMA_VERSION = 5;
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
  status: "queued" | "completed" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
}

export type PaidResearchStatus = "completed" | "partial" | "failed";
export type PaidResearchDepth = "refresh" | "standard" | "deep";
export type PaidComponentStatus =
  | "success"
  | "no_results"
  | "failed"
  | "unavailable"
  | "skipped";

export interface SeoSnapshotInput {
  schemaVersion: 1;
  jobId: string;
  status: PaidResearchStatus;
  researchDepth: PaidResearchDepth;
  domain: string;
  locationCode: number;
  languageCode: string;
  device: "desktop" | "mobile";
  costLimitUsd: number;
  actualCostUsd: number;
  componentStatus: Record<string, PaidComponentStatus>;
  offeringProfile: Record<string, unknown>;
  rankedKeywords: Array<Record<string, unknown>>;
  keywordCandidates: Array<Record<string, unknown>>;
  selectedKeywords: Array<Record<string, unknown>>;
  seoCompetitors: Array<Record<string, unknown>>;
  serpEvidence: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  warnings: string[];
  evidenceSummary: Record<string, unknown>;
  capturedAt?: string;
  expiresAt?: string;
}

export interface SeoSnapshotRecord extends SeoSnapshotInput {
  snapshotId: string;
  sessionId: string;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeoSnapshotSummary {
  snapshotId: string;
  jobId: string;
  status: PaidResearchStatus;
  researchDepth: PaidResearchDepth;
  domain: string;
  locationCode: number;
  languageCode: string;
  actualCostUsd: number;
  capturedAt: string;
  updatedAt: string;
  warningCount: number;
}

export type SeoArticleJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "interrupted";

export interface SeoArticleJobInput {
  sessionId: string;
  requestId: string;
  domain: string;
  briefId: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  input: Record<string, unknown>;
}

export interface SeoArticleJobRecord extends SeoArticleJobInput {
  jobId: string;
  status: SeoArticleJobStatus;
  stage: string;
  errorCode?: string;
  errorMessage?: string;
  latestVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeoArticleVersionInput {
  status: "completed" | "partial";
  domain: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  context: Record<string, unknown>;
  plan: Record<string, unknown>;
  markdown: string;
  structuredData: Record<string, unknown>;
  metadata: Record<string, unknown>;
  answerBlocks: Array<Record<string, unknown>>;
  faq: unknown[];
  sources: unknown[];
  claimLedger: unknown[];
  qualityReport: Record<string, unknown>;
  warnings: string[];
  reviewStatus: "ready_for_review";
  model: string;
}

export interface SeoArticleVersionRecord extends SeoArticleVersionInput {
  versionId: string;
  jobId: string;
  versionNumber: number;
  parentVersionId?: string;
  downloadToken: string;
  createdAt: string;
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

interface SeoSnapshotRow {
  snapshot_id: string;
  job_id: string;
  session_id: string;
  schema_version: number;
  status: PaidResearchStatus;
  research_depth: PaidResearchDepth;
  domain: string;
  location_code: number;
  language_code: string;
  device: "desktop" | "mobile";
  cost_limit_usd: number;
  actual_cost_usd: number;
  component_status_json: string;
  offering_profile_json: string;
  ranked_keywords_json: string;
  keyword_candidates_json: string;
  selected_keywords_json: string;
  seo_competitors_json: string;
  serp_evidence_json: string;
  sources_json: string;
  warnings_json: string;
  evidence_summary_json: string;
  captured_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SeoArticleJobRow {
  job_id: string;
  session_id: string;
  request_id: string;
  domain: string;
  brief_id: string | null;
  primary_keyword: string;
  supporting_keywords_json: string;
  input_json: string;
  status: SeoArticleJobStatus;
  stage: string;
  error_code: string | null;
  error_message: string | null;
  latest_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ArticleBriefRow {
  brief_id: string;
  session_id: string;
  domain: string;
  research_key: string;
  status: ArticleBriefStatus;
  brief_json: string;
  created_at: string;
  updated_at: string;
}

interface SeoArticleVersionRow {
  version_id: string;
  job_id: string;
  version_number: number;
  parent_version_id: string | null;
  status: "completed" | "partial";
  domain: string;
  primary_keyword: string;
  supporting_keywords_json: string;
  context_json: string;
  plan_json: string;
  markdown: string;
  structured_data_json: string;
  metadata_json: string;
  answer_blocks_json: string;
  faq_json: string;
  sources_json: string;
  claim_ledger_json: string;
  quality_report_json: string;
  warnings_json: string;
  review_status: "ready_for_review";
  model: string;
  download_token: string;
  created_at: string;
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

function seoSnapshotFromRow(row: SeoSnapshotRow): SeoSnapshotRecord {
  const result: SeoSnapshotRecord = {
    schemaVersion: 1,
    snapshotId: row.snapshot_id,
    jobId: row.job_id,
    sessionId: row.session_id,
    status: row.status,
    researchDepth: row.research_depth,
    domain: row.domain,
    locationCode: Number(row.location_code),
    languageCode: row.language_code,
    device: row.device,
    costLimitUsd: Number(row.cost_limit_usd),
    actualCostUsd: Number(row.actual_cost_usd),
    componentStatus: JSON.parse(row.component_status_json) as Record<string, PaidComponentStatus>,
    offeringProfile: JSON.parse(row.offering_profile_json) as Record<string, unknown>,
    rankedKeywords: JSON.parse(row.ranked_keywords_json) as Array<Record<string, unknown>>,
    keywordCandidates: JSON.parse(row.keyword_candidates_json) as Array<Record<string, unknown>>,
    selectedKeywords: JSON.parse(row.selected_keywords_json) as Array<Record<string, unknown>>,
    seoCompetitors: JSON.parse(row.seo_competitors_json) as Array<Record<string, unknown>>,
    serpEvidence: JSON.parse(row.serp_evidence_json) as Array<Record<string, unknown>>,
    sources: JSON.parse(row.sources_json) as Array<Record<string, unknown>>,
    warnings: JSON.parse(row.warnings_json) as string[],
    evidenceSummary: JSON.parse(row.evidence_summary_json) as Record<string, unknown>,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.expires_at !== null) {
    result.expiresAt = row.expires_at;
  }
  return result;
}

function seoArticleJobFromRow(row: SeoArticleJobRow): SeoArticleJobRecord {
  return {
    jobId: row.job_id,
    sessionId: row.session_id,
    requestId: row.request_id,
    domain: row.domain,
    briefId: row.brief_id ?? "",
    primaryKeyword: row.primary_keyword,
    supportingKeywords: JSON.parse(row.supporting_keywords_json) as string[],
    input: JSON.parse(row.input_json) as Record<string, unknown>,
    status: row.status,
    stage: row.stage,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    ...(row.latest_version_id === null ? {} : { latestVersionId: row.latest_version_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function articleBriefFromRow(row: ArticleBriefRow): ArticleBriefRecord {
  const data = JSON.parse(row.brief_json) as ArticleBriefData;
  return {
    ...data,
    briefId: row.brief_id,
    sessionId: row.session_id,
    domain: row.domain,
    researchKey: row.research_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function seoArticleVersionFromRow(row: SeoArticleVersionRow): SeoArticleVersionRecord {
  return {
    versionId: row.version_id,
    jobId: row.job_id,
    versionNumber: Number(row.version_number),
    ...(row.parent_version_id === null ? {} : { parentVersionId: row.parent_version_id }),
    status: row.status,
    domain: row.domain,
    primaryKeyword: row.primary_keyword,
    supportingKeywords: JSON.parse(row.supporting_keywords_json) as string[],
    context: JSON.parse(row.context_json) as Record<string, unknown>,
    plan: JSON.parse(row.plan_json) as Record<string, unknown>,
    markdown: row.markdown,
    structuredData: JSON.parse(row.structured_data_json) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    answerBlocks: JSON.parse(row.answer_blocks_json) as Array<Record<string, unknown>>,
    faq: JSON.parse(row.faq_json) as unknown[],
    sources: JSON.parse(row.sources_json) as unknown[],
    claimLedger: JSON.parse(row.claim_ledger_json) as unknown[],
    qualityReport: JSON.parse(row.quality_report_json) as Record<string, unknown>,
    warnings: JSON.parse(row.warnings_json) as string[],
    reviewStatus: row.review_status,
    model: row.model,
    downloadToken: row.download_token,
    createdAt: row.created_at,
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
    if (version < 3) {
      this.transaction(() => {
        this.database.exec(`
          DROP INDEX domain_research_jobs_session;
          ALTER TABLE domain_research_jobs RENAME TO domain_research_jobs_v2;

          CREATE TABLE domain_research_jobs (
            job_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'completed', 'partial', 'failed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          INSERT INTO domain_research_jobs(
            job_id, session_id, domain, status, created_at, updated_at
          )
          SELECT job_id, session_id, domain, status, created_at, updated_at
          FROM domain_research_jobs_v2;

          DROP TABLE domain_research_jobs_v2;

          CREATE INDEX domain_research_jobs_session
          ON domain_research_jobs(session_id, updated_at DESC);

          CREATE TABLE seo_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL,
            schema_version INTEGER NOT NULL CHECK (schema_version = 1),
            status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
            research_depth TEXT NOT NULL CHECK (research_depth IN ('refresh', 'standard', 'deep')),
            domain TEXT NOT NULL,
            location_code INTEGER NOT NULL,
            language_code TEXT NOT NULL,
            device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile')),
            cost_limit_usd REAL NOT NULL CHECK (cost_limit_usd >= 0),
            actual_cost_usd REAL NOT NULL CHECK (actual_cost_usd >= 0),
            component_status_json TEXT NOT NULL,
            offering_profile_json TEXT NOT NULL,
            ranked_keywords_json TEXT NOT NULL,
            keyword_candidates_json TEXT NOT NULL,
            selected_keywords_json TEXT NOT NULL,
            seo_competitors_json TEXT NOT NULL,
            serp_evidence_json TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            warnings_json TEXT NOT NULL,
            evidence_summary_json TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX seo_snapshots_domain_captured
          ON seo_snapshots(domain, captured_at DESC);

          CREATE INDEX seo_snapshots_session_updated
          ON seo_snapshots(session_id, updated_at DESC);

          PRAGMA user_version = 3;
        `);
      });
    }
    if (version < 4) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE seo_article_jobs (
            job_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            primary_keyword TEXT NOT NULL,
            supporting_keywords_json TEXT NOT NULL,
            input_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'interrupted')),
            stage TEXT NOT NULL,
            error_code TEXT,
            error_message TEXT,
            latest_version_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(session_id, request_id)
          ) STRICT;

          CREATE INDEX seo_article_jobs_session_updated
          ON seo_article_jobs(session_id, updated_at DESC);

          CREATE INDEX seo_article_jobs_domain_updated
          ON seo_article_jobs(session_id, domain, updated_at DESC);

          CREATE TABLE seo_article_versions (
            version_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL REFERENCES seo_article_jobs(job_id) ON DELETE CASCADE,
            version_number INTEGER NOT NULL CHECK (version_number > 0),
            parent_version_id TEXT,
            status TEXT NOT NULL CHECK (status IN ('completed', 'partial')),
            domain TEXT NOT NULL,
            primary_keyword TEXT NOT NULL,
            supporting_keywords_json TEXT NOT NULL,
            context_json TEXT NOT NULL,
            plan_json TEXT NOT NULL,
            markdown TEXT NOT NULL,
            structured_data_json TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            answer_blocks_json TEXT NOT NULL,
            faq_json TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            claim_ledger_json TEXT NOT NULL,
            quality_report_json TEXT NOT NULL,
            warnings_json TEXT NOT NULL,
            review_status TEXT NOT NULL CHECK (review_status = 'ready_for_review'),
            model TEXT NOT NULL,
            download_token TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            UNIQUE(job_id, version_number)
          ) STRICT;

          CREATE INDEX seo_article_versions_job_created
          ON seo_article_versions(job_id, created_at DESC);

          PRAGMA user_version = 4;
        `);
      });
    }
    if (version < 5) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE seo_article_briefs (
            brief_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            research_key TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('choosing', 'needs_details', 'writing', 'complete', 'failed')),
            brief_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(session_id, domain, research_key)
          ) STRICT;

          CREATE INDEX seo_article_briefs_session_updated
          ON seo_article_briefs(session_id, updated_at DESC);

          ALTER TABLE seo_article_jobs ADD COLUMN brief_id TEXT;

          CREATE INDEX seo_article_jobs_brief
          ON seo_article_jobs(brief_id, updated_at DESC);

          PRAGMA user_version = 5;
        `);
      });
    }
    this.database.prepare("SELECT rowid FROM message_search LIMIT 1").all();
    this.database.prepare("SELECT domain FROM business_memory LIMIT 1").all();
    this.database.prepare("SELECT job_id FROM domain_research_jobs LIMIT 1").all();
    this.database.prepare("SELECT snapshot_id FROM seo_snapshots LIMIT 1").all();
    this.database.prepare("SELECT job_id FROM seo_article_jobs LIMIT 1").all();
    this.database.prepare("SELECT version_id FROM seo_article_versions LIMIT 1").all();
    this.database.prepare("SELECT brief_id FROM seo_article_briefs LIMIT 1").all();
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

  savePaidDomainResearchForJob(
    sessionId: string,
    snapshot: SeoSnapshotInput,
    memory?: BusinessMemoryInput,
  ): { snapshot: SeoSnapshotRecord; memory?: BusinessMemoryRecord } {
    return this.transaction(() => {
      const job = this.database
        .prepare(
          "SELECT session_id, domain FROM domain_research_jobs WHERE job_id = ?",
        )
        .get(snapshot.jobId) as { session_id: string; domain: string } | undefined;
      if (!job || job.session_id !== sessionId || job.domain !== snapshot.domain) {
        throw new Error("Paid domain research job is not registered to this conversation");
      }
      if (snapshot.status !== "failed") {
        if (
          memory === undefined ||
          memory.jobId !== snapshot.jobId ||
          memory.domain !== snapshot.domain ||
          memory.status !== snapshot.status
        ) {
          throw new Error("Successful paid research requires matching business memory");
        }
      } else if (memory !== undefined) {
        throw new Error("Failed paid research cannot replace business memory");
      }

      const existing = this.database
        .prepare("SELECT snapshot_id, created_at FROM seo_snapshots WHERE job_id = ?")
        .get(snapshot.jobId) as { snapshot_id: string; created_at: string } | undefined;
      const timestamp = nowIso();
      const capturedAt = snapshot.capturedAt ?? timestamp;
      const snapshotId = existing?.snapshot_id ?? randomUUID();
      const createdAt = existing?.created_at ?? timestamp;
      this.database
        .prepare(
          `INSERT INTO seo_snapshots(
             snapshot_id, job_id, session_id, schema_version, status,
             research_depth, domain, location_code, language_code, device,
             cost_limit_usd, actual_cost_usd, component_status_json,
             offering_profile_json, ranked_keywords_json,
             keyword_candidates_json, selected_keywords_json,
             seo_competitors_json, serp_evidence_json, sources_json,
             warnings_json, evidence_summary_json, captured_at, expires_at,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = excluded.status,
             research_depth = excluded.research_depth,
             location_code = excluded.location_code,
             language_code = excluded.language_code,
             device = excluded.device,
             cost_limit_usd = excluded.cost_limit_usd,
             actual_cost_usd = excluded.actual_cost_usd,
             component_status_json = excluded.component_status_json,
             offering_profile_json = excluded.offering_profile_json,
             ranked_keywords_json = excluded.ranked_keywords_json,
             keyword_candidates_json = excluded.keyword_candidates_json,
             selected_keywords_json = excluded.selected_keywords_json,
             seo_competitors_json = excluded.seo_competitors_json,
             serp_evidence_json = excluded.serp_evidence_json,
             sources_json = excluded.sources_json,
             warnings_json = excluded.warnings_json,
             evidence_summary_json = excluded.evidence_summary_json,
             captured_at = excluded.captured_at,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          snapshotId,
          snapshot.jobId,
          sessionId,
          snapshot.schemaVersion,
          snapshot.status,
          snapshot.researchDepth,
          snapshot.domain,
          snapshot.locationCode,
          snapshot.languageCode,
          snapshot.device,
          snapshot.costLimitUsd,
          snapshot.actualCostUsd,
          JSON.stringify(snapshot.componentStatus),
          JSON.stringify(snapshot.offeringProfile),
          JSON.stringify(snapshot.rankedKeywords),
          JSON.stringify(snapshot.keywordCandidates),
          JSON.stringify(snapshot.selectedKeywords),
          JSON.stringify(snapshot.seoCompetitors),
          JSON.stringify(snapshot.serpEvidence),
          JSON.stringify(snapshot.sources),
          JSON.stringify(snapshot.warnings),
          JSON.stringify(snapshot.evidenceSummary),
          capturedAt,
          snapshot.expiresAt ?? null,
          createdAt,
          timestamp,
        );

      const savedMemory = memory === undefined ? undefined : this.saveBusinessMemory(memory);
      this.database
        .prepare(
          `UPDATE domain_research_jobs
           SET status = ?, updated_at = ?
           WHERE job_id = ? AND session_id = ?`,
        )
        .run(snapshot.status, timestamp, snapshot.jobId, sessionId);
      const savedSnapshot = this.getSeoSnapshotForJob(sessionId, snapshot.jobId);
      if (savedSnapshot === undefined) {
        throw new Error("Stored paid domain research snapshot could not be read");
      }
      return {
        snapshot: savedSnapshot,
        ...(savedMemory === undefined ? {} : { memory: savedMemory }),
      };
    });
  }

  getSeoSnapshotForJob(
    sessionId: string,
    jobId: string,
  ): SeoSnapshotRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM seo_snapshots WHERE job_id = ? AND session_id = ?")
      .get(jobId, sessionId) as SeoSnapshotRow | undefined;
    return row === undefined ? undefined : seoSnapshotFromRow(row);
  }

  getLatestSeoSnapshot(domain: string): SeoSnapshotRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM seo_snapshots
         WHERE domain = ? AND status IN ('completed', 'partial')
         ORDER BY captured_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .get(domain) as SeoSnapshotRow | undefined;
    return row === undefined ? undefined : seoSnapshotFromRow(row);
  }

  listSeoSnapshotSummaries(domain?: string, limit = 20): SeoSnapshotSummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = (domain === undefined
      ? this.database
          .prepare("SELECT * FROM seo_snapshots ORDER BY captured_at DESC LIMIT ?")
          .all(boundedLimit)
      : this.database
          .prepare(
            "SELECT * FROM seo_snapshots WHERE domain = ? ORDER BY captured_at DESC LIMIT ?",
          )
          .all(domain, boundedLimit)) as unknown as SeoSnapshotRow[];
    return rows.map((row) => ({
      snapshotId: row.snapshot_id,
      jobId: row.job_id,
      status: row.status,
      researchDepth: row.research_depth,
      domain: row.domain,
      locationCode: Number(row.location_code),
      languageCode: row.language_code,
      actualCostUsd: Number(row.actual_cost_usd),
      capturedAt: row.captured_at,
      updatedAt: row.updated_at,
      warningCount: (JSON.parse(row.warnings_json) as unknown[]).length,
    }));
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

  prepareArticleBrief(
    sessionId: string,
    domain: string,
    researchKey: string,
    data: ArticleBriefData,
  ): ArticleBriefRecord {
    return this.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT * FROM seo_article_briefs
           WHERE session_id = ? AND domain = ? AND research_key = ?`,
        )
        .get(sessionId, domain, researchKey) as ArticleBriefRow | undefined;
      if (existing !== undefined && !["complete", "failed"].includes(existing.status)) {
        return articleBriefFromRow(existing);
      }
      const timestamp = nowIso();
      const briefId = existing?.brief_id ?? `brief-${randomUUID()}`;
      const createdAt = existing?.created_at ?? timestamp;
      this.database
        .prepare(
          `INSERT INTO seo_article_briefs(
             brief_id, session_id, domain, research_key, status,
             brief_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'choosing', ?, ?, ?)
           ON CONFLICT(session_id, domain, research_key) DO UPDATE SET
             status = 'choosing', brief_json = excluded.brief_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          briefId,
          sessionId,
          domain,
          researchKey,
          JSON.stringify(data),
          createdAt,
          timestamp,
        );
      const stored = this.getArticleBrief(sessionId, briefId);
      if (stored === undefined) throw new Error("Stored article brief could not be read");
      return stored;
    });
  }

  getArticleBrief(sessionId: string, briefId: string): ArticleBriefRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM seo_article_briefs WHERE brief_id = ? AND session_id = ?")
      .get(briefId, sessionId) as ArticleBriefRow | undefined;
    return row === undefined ? undefined : articleBriefFromRow(row);
  }

  getLatestArticleBrief(
    sessionId: string,
    domain?: string,
  ): ArticleBriefRecord | undefined {
    const row = (domain === undefined
      ? this.database
          .prepare(
            `SELECT * FROM seo_article_briefs
             WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(sessionId)
      : this.database
          .prepare(
            `SELECT * FROM seo_article_briefs
             WHERE session_id = ? AND domain = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(sessionId, domain)) as ArticleBriefRow | undefined;
    return row === undefined ? undefined : articleBriefFromRow(row);
  }

  updateArticleBrief(
    sessionId: string,
    briefId: string,
    update: {
      status: ArticleBriefStatus;
      selection?: ArticleOpportunity;
      context?: ArticleBusinessContext;
      missingFields?: string[];
      linkedJobId?: string;
    },
  ): ArticleBriefRecord {
    return this.transaction(() => {
      const current = this.getArticleBrief(sessionId, briefId);
      if (current === undefined) {
        throw new Error("Article brief is not registered to this conversation");
      }
      const selection = update.selection ?? current.selection;
      const linkedJobId = update.linkedJobId ?? current.linkedJobId;
      const data: ArticleBriefData = {
        schemaVersion: 1,
        research: current.research,
        opportunities: current.opportunities,
        context: update.context ?? current.context,
        missingFields: update.missingFields ?? current.missingFields,
        ...(selection === undefined ? {} : { selection }),
        ...(linkedJobId === undefined ? {} : { linkedJobId }),
      };
      this.database
        .prepare(
          `UPDATE seo_article_briefs
           SET status = ?, brief_json = ?, updated_at = ?
           WHERE brief_id = ? AND session_id = ?`,
        )
        .run(update.status, JSON.stringify(data), nowIso(), briefId, sessionId);
      const stored = this.getArticleBrief(sessionId, briefId);
      if (stored === undefined) throw new Error("Updated article brief could not be read");
      return stored;
    });
  }

  registerSeoArticleJob(input: SeoArticleJobInput): {
    job: SeoArticleJobRecord;
    created: boolean;
  } {
    return this.transaction(() => {
      const existing = this.database
        .prepare("SELECT * FROM seo_article_jobs WHERE session_id = ? AND request_id = ?")
        .get(input.sessionId, input.requestId) as SeoArticleJobRow | undefined;
      if (existing !== undefined) {
        if (
          existing.domain !== input.domain ||
          (existing.brief_id ?? "") !== input.briefId ||
          existing.primary_keyword !== input.primaryKeyword ||
          existing.supporting_keywords_json !== JSON.stringify(input.supportingKeywords)
        ) {
          throw new Error("The article request ID is already used for different inputs");
        }
        if (input.briefId) {
          const brief = this.getArticleBrief(input.sessionId, input.briefId);
          if (brief !== undefined) {
            const data: ArticleBriefData = {
              schemaVersion: 1,
              research: brief.research,
              opportunities: brief.opportunities,
              context: brief.context,
              missingFields: [],
              ...(brief.selection === undefined ? {} : { selection: brief.selection }),
              linkedJobId: existing.job_id,
            };
            this.database
              .prepare(
                `UPDATE seo_article_briefs
                 SET status = 'writing', brief_json = ?, updated_at = ?
                 WHERE brief_id = ? AND session_id = ?`,
              )
              .run(
                JSON.stringify(data),
                nowIso(),
                input.briefId,
                input.sessionId,
              );
          }
        }
        return { job: seoArticleJobFromRow(existing), created: false };
      }
      const timestamp = nowIso();
      const jobId = `article-${randomUUID()}`;
      this.database
        .prepare(
          `INSERT INTO seo_article_jobs(
             job_id, session_id, request_id, domain, brief_id, primary_keyword,
             supporting_keywords_json, input_json, status, stage,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, ?)`,
        )
        .run(
          jobId,
          input.sessionId,
          input.requestId,
          input.domain,
          input.briefId || null,
          input.primaryKeyword,
          JSON.stringify(input.supportingKeywords),
          JSON.stringify(input.input),
          timestamp,
          timestamp,
        );
      if (input.briefId) {
        const brief = this.getArticleBrief(input.sessionId, input.briefId);
        if (brief === undefined || brief.domain !== input.domain) {
          throw new Error("Article brief is not registered to this conversation");
        }
        const data: ArticleBriefData = {
          schemaVersion: 1,
          research: brief.research,
          opportunities: brief.opportunities,
          context: brief.context,
          missingFields: [],
          ...(brief.selection === undefined ? {} : { selection: brief.selection }),
          linkedJobId: jobId,
        };
        this.database
          .prepare(
            `UPDATE seo_article_briefs
             SET status = 'writing', brief_json = ?, updated_at = ?
             WHERE brief_id = ? AND session_id = ?`,
          )
          .run(JSON.stringify(data), timestamp, input.briefId, input.sessionId);
      }
      const stored = this.getSeoArticleJob(input.sessionId, jobId);
      if (stored === undefined) throw new Error("Stored article job could not be read");
      return { job: stored, created: true };
    });
  }

  updateSeoArticleJob(
    sessionId: string,
    jobId: string,
    update: {
      status: SeoArticleJobStatus;
      stage: string;
      errorCode?: string;
      errorMessage?: string;
    },
  ): SeoArticleJobRecord {
    const result = this.database
      .prepare(
        `UPDATE seo_article_jobs
         SET status = ?, stage = ?, error_code = ?, error_message = ?, updated_at = ?
         WHERE job_id = ? AND session_id = ?`,
      )
      .run(
        update.status,
        update.stage,
        update.errorCode ?? null,
        update.errorMessage ?? null,
        nowIso(),
        jobId,
        sessionId,
      );
    if (Number(result.changes) !== 1) throw new Error("Article job is not registered to this conversation");
    const stored = this.getSeoArticleJob(sessionId, jobId);
    if (stored === undefined) throw new Error("Updated article job could not be read");
    if (
      stored.briefId &&
      (update.status === "failed" || update.status === "interrupted")
    ) {
      this.updateArticleBrief(sessionId, stored.briefId, { status: "failed" });
    }
    return stored;
  }

  getSeoArticleJob(sessionId: string, jobId: string): SeoArticleJobRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM seo_article_jobs WHERE job_id = ? AND session_id = ?")
      .get(jobId, sessionId) as SeoArticleJobRow | undefined;
    return row === undefined ? undefined : seoArticleJobFromRow(row);
  }

  getLatestSeoArticleJob(sessionId: string, domain: string): SeoArticleJobRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM seo_article_jobs
         WHERE session_id = ? AND domain = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(sessionId, domain) as SeoArticleJobRow | undefined;
    return row === undefined ? undefined : seoArticleJobFromRow(row);
  }

  saveSeoArticleVersion(
    sessionId: string,
    jobId: string,
    input: SeoArticleVersionInput,
  ): { job: SeoArticleJobRecord; version: SeoArticleVersionRecord } {
    return this.transaction(() => {
      const job = this.database
        .prepare("SELECT * FROM seo_article_jobs WHERE job_id = ? AND session_id = ?")
        .get(jobId, sessionId) as SeoArticleJobRow | undefined;
      if (job === undefined) throw new Error("Article job is not registered to this conversation");
      if (job.domain !== input.domain || job.primary_keyword !== input.primaryKeyword) {
        throw new Error("Article result does not match the registered request");
      }
      const numberRow = this.database
        .prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS next_number FROM seo_article_versions WHERE job_id = ?")
        .get(jobId) as { next_number: number };
      const versionId = randomUUID();
      const timestamp = nowIso();
      const downloadToken = randomBytes(32).toString("base64url");
      this.database
        .prepare(
          `INSERT INTO seo_article_versions(
             version_id, job_id, version_number, parent_version_id, status,
             domain, primary_keyword, supporting_keywords_json, context_json,
             plan_json, markdown, structured_data_json, metadata_json,
             answer_blocks_json, faq_json, sources_json, claim_ledger_json,
             quality_report_json, warnings_json, review_status, model,
             download_token, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          jobId,
          Number(numberRow.next_number),
          job.latest_version_id,
          input.status,
          input.domain,
          input.primaryKeyword,
          JSON.stringify(input.supportingKeywords),
          JSON.stringify(input.context),
          JSON.stringify(input.plan),
          input.markdown,
          JSON.stringify(input.structuredData),
          JSON.stringify(input.metadata),
          JSON.stringify(input.answerBlocks),
          JSON.stringify(input.faq),
          JSON.stringify(input.sources),
          JSON.stringify(input.claimLedger),
          JSON.stringify(input.qualityReport),
          JSON.stringify(input.warnings),
          input.reviewStatus,
          input.model,
          downloadToken,
          timestamp,
        );
      this.database
        .prepare(
          `UPDATE seo_article_jobs
           SET status = ?, stage = 'ready_for_review', error_code = NULL,
               error_message = NULL, latest_version_id = ?, updated_at = ?
           WHERE job_id = ? AND session_id = ?`,
        )
        .run(input.status, versionId, timestamp, jobId, sessionId);
      if (job.brief_id !== null) {
        this.database
          .prepare(
            `UPDATE seo_article_briefs
             SET status = 'complete', updated_at = ?
             WHERE brief_id = ? AND session_id = ?`,
          )
          .run(timestamp, job.brief_id, sessionId);
      }
      const storedJob = this.getSeoArticleJob(sessionId, jobId);
      const version = this.getSeoArticleVersionForJob(sessionId, jobId, versionId);
      if (storedJob === undefined || version === undefined) {
        throw new Error("Stored article version could not be read");
      }
      return { job: storedJob, version };
    });
  }

  getSeoArticleVersionForJob(
    sessionId: string,
    jobId: string,
    versionId?: string,
  ): SeoArticleVersionRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT v.* FROM seo_article_versions v
         JOIN seo_article_jobs j ON j.job_id = v.job_id
         WHERE j.session_id = ? AND v.job_id = ?
           AND (? IS NULL OR v.version_id = ?)
         ORDER BY v.version_number DESC LIMIT 1`,
      )
      .get(sessionId, jobId, versionId ?? null, versionId ?? null) as SeoArticleVersionRow | undefined;
    return row === undefined ? undefined : seoArticleVersionFromRow(row);
  }

  getSeoArticleVersionByDownloadToken(token: string): SeoArticleVersionRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM seo_article_versions WHERE download_token = ?")
      .get(token) as SeoArticleVersionRow | undefined;
    return row === undefined ? undefined : seoArticleVersionFromRow(row);
  }

  getLatestSuccessfulSeoArticleVersion(
    sessionId: string,
    domain: string,
  ): SeoArticleVersionRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT v.* FROM seo_article_versions v
         JOIN seo_article_jobs j ON j.job_id = v.job_id
         WHERE j.session_id = ? AND v.domain = ?
         ORDER BY v.created_at DESC LIMIT 1`,
      )
      .get(sessionId, domain) as SeoArticleVersionRow | undefined;
    return row === undefined ? undefined : seoArticleVersionFromRow(row);
  }

  markPendingInterrupted(): number {
    return this.transaction(() => {
      const messages = this.database
        .prepare(
          `UPDATE messages
           SET status = 'interrupted', error_code = 'REQUEST_INTERRUPTED'
           WHERE status = 'pending'`,
        )
        .run();
      this.database
        .prepare(
          `UPDATE seo_article_jobs
           SET status = 'interrupted', stage = 'interrupted',
               error_code = 'WORKER_INTERRUPTED',
               error_message = 'The article worker stopped before it finished.',
               updated_at = ?
           WHERE status IN ('queued', 'running')`,
        )
        .run(nowIso());
      this.database
        .prepare(
          `UPDATE seo_article_briefs
           SET status = 'failed', updated_at = ?
           WHERE status = 'writing'`,
        )
        .run(nowIso());
      return Number(messages.changes);
    });
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
