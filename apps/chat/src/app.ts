import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { basename, extname, resolve, sep } from "node:path";
import Busboy from "busboy";
import type { AccessGate } from "./access.js";
import {
  DEFAULT_AGENTS,
  publicAgentDefinitions,
  type AgentDefinition,
} from "./agents.js";
import {
  AgentSettingsStore,
  AgentSettingsValidationError,
} from "./agent-settings.js";
import { buildAgentCardDefinitions } from "./skills.js";
import {
  DocumentStore,
  DocumentStoreError,
  MAX_FILE_BYTES,
  MAX_PASTED_CHARACTERS,
  type DocumentRecord,
} from "./documents.js";
import {
  ChatStore,
  type BusinessMemoryInput,
  type HistoryMessage,
  type PaidComponentStatus,
  type SeoArticleJobInput,
  type SeoArticleJobStatus,
  type SeoArticleVersionInput,
  type SeoSnapshotInput,
  type StoredAttachment,
} from "./chat-store.js";
import {
  createArticleBriefData,
  refreshArticleBriefContext,
  resolveArticleContext,
  selectArticleOpportunity,
  type ArticleContextOverrides,
  type ArticleBriefRecord,
} from "./article-brief.js";
import {
  emptyProfile,
  ProfileStore,
  ProfileValidationError,
  type AgentProfile,
} from "./profile.js";
import { fetchPublicDomainPage, fetchPublicWebPages } from "./public-web.js";
import { validateSeoArticleResult } from "./seo-article.js";

const MAX_MESSAGE_LENGTH = 8_000;
// A saved picture is base64 inside the JSON body, so this endpoint alone needs
// more room than the 64 KB used by every other request.
const MAX_PROFILE_REQUEST_BYTES = 512 * 1_024;
const MAX_BUSINESS_MEMORY_REQUEST_BYTES = 256 * 1_024;
const MAX_PAID_RESEARCH_REQUEST_BYTES = 1_024 * 1_024;
const MAX_SEO_ARTICLE_REQUEST_BYTES = 1_024 * 1_024;
const MAX_REQUEST_BYTES = 65_536;
const MAX_UPSTREAM_BYTES = 65_536;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

type ErrorCode =
  | "AGENT_ERROR"
  | "AGENT_TIMEOUT"
  | "AGENT_UNAVAILABLE"
  | "BUSINESS_MEMORY_ERROR"
  | "CHAT_HISTORY_ERROR"
  | "CONVERSATION_NOT_FOUND"
  | "DOCUMENT_ERROR"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_SERVICE_UNAVAILABLE"
  | "DOCUMENT_TEXT_TOO_LARGE"
  | "FILE_TOO_LARGE"
  | "INVALID_REQUEST"
  | "MESSAGE_TOO_LONG"
  | "RATE_LIMITED"
  | "REQUEST_IN_PROGRESS"
  | "RESEARCH_JOB_NOT_FOUND"
  | "SEO_ARTICLE_ERROR"
  | "SEO_ARTICLE_NOT_FOUND"
  | "TOO_MANY_DOCUMENTS"
  | "UNSUPPORTED_FILE_TYPE";

interface ChatRequest {
  requestId: string;
  sessionId: string;
  agentId: string;
  message: string;
  documentIds: string[];
}

interface UpstreamChatRequest {
  schemaVersion: 3;
  requestId: string;
  sessionId: string;
  agentId: string;
  message: string;
  history: HistoryMessage[];
  documents: Array<{
    id: string;
    name: string;
    type: DocumentRecord["type"];
    wordCount: number;
    characterCount: number;
    text: string;
    pageCount?: number;
  }>;
}

interface ChatResponse {
  requestId?: string;
  messageId?: string;
  sessionId: string;
  reply: string;
  runId?: string;
}

export interface ChatGatewayOptions {
  publicDirectory: string;
  upstreamUrl: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  logError?: (message: string, error?: unknown) => void;
  agents?: readonly AgentDefinition[];
  documentStore?: DocumentStore;
  chatStore?: ChatStore;
  profileStore?: ProfileStore;
  agentSettingsStore?: AgentSettingsStore;
  skillsDirectory?: string;
  profileDirectory?: string;
  /**
   * Guards every route except /health. Omitted on a learner's own computer,
   * where the gateway is only reachable from that computer; required before
   * the gateway is given a public address.
   */
  accessGate?: AccessGate | undefined;
}

class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload).toString(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function sendMarkdown(
  response: ServerResponse,
  markdown: string,
  fileName: string,
): void {
  const safeName = fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "seo-article.md";
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${safeName.endsWith(".md") ? safeName : `${safeName}.md`}"`,
    "Content-Length": Buffer.byteLength(markdown).toString(),
    "Content-Type": "text/markdown; charset=utf-8",
  });
  response.end(markdown);
}

function sendError(response: ServerResponse, error: PublicError): void {
  sendJson(
    response,
    error.status,
    {
      error: {
        code: error.code,
        message: error.publicMessage,
      },
    },
    error.status === 429 ? { "Retry-After": "30" } : {},
  );
}

async function readRequestBody(
  request: IncomingMessage,
  maximumBytes = MAX_REQUEST_BYTES,
): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Send the message as JSON and try again.",
    );
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > maximumBytes) {
      throw new PublicError(
        413,
        "MESSAGE_TOO_LONG",
        "That request is too large.",
      );
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "That message could not be read. Check it and try again.",
    );
  }
}

function validateSessionId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "The conversation could not be identified. Reset it and try again.",
    );
  }
  return value;
}

function validateChatRequest(
  body: unknown,
  agents: readonly AgentDefinition[],
): ChatRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Enter a message and try again.",
    );
  }

  const candidate = body as Record<string, unknown>;
  const sessionId = validateSessionId(candidate.sessionId);
  const requestId =
    candidate.requestId === undefined
      ? randomUUID()
      : validateSessionId(candidate.requestId);
  const rawAgentId =
    typeof candidate.agentId === "string"
      ? candidate.agentId.trim()
      : "project-manager";
  const rawMessage = candidate.message;
  const rawDocumentIds =
    candidate.documentIds === undefined ? [] : candidate.documentIds;

  const agent = agents.find((item) => item.id === rawAgentId);
  if (!agent || agent.status !== "active") {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "That agent is not available yet.",
    );
  }

  if (typeof rawMessage !== "string") {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Enter a message and try again.",
    );
  }

  const message = rawMessage.trim();
  if (message.length === 0) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Enter a message and try again.",
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new PublicError(
      413,
      "MESSAGE_TOO_LONG",
      "That instruction is too long. Keep it under 8,000 characters.",
    );
  }

  if (
    !Array.isArray(rawDocumentIds) ||
    !rawDocumentIds.every((id) => typeof id === "string")
  ) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "The attached document list is invalid.",
    );
  }

  return {
    requestId,
    sessionId,
    agentId: agent.id,
    message,
    documentIds: rawDocumentIds,
  };
}

function businessMemoryText(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      `The saved research has an invalid ${field}.`,
    );
  }
  return value.trim();
}

function businessMemoryObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      `The saved research has an invalid ${field}.`,
    );
  }
  return value as Record<string, unknown>;
}

function businessMemoryObjectArray(
  value: unknown,
  field: string,
  maximumItems: number,
): Array<Record<string, unknown>> {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    !value.every(
      (item) => typeof item === "object" && item !== null && !Array.isArray(item),
    )
  ) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      `The saved research has an invalid ${field}.`,
    );
  }
  return value as Array<Record<string, unknown>>;
}

function businessMemoryStringArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumItemLength: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    !value.every((item) => typeof item === "string" && item.length <= maximumItemLength)
  ) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      `The saved research has an invalid ${field}.`,
    );
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function validateBusinessDomain(value: unknown): string {
  if (typeof value !== "string") {
    throw new PublicError(400, "INVALID_REQUEST", "The saved research has an invalid domain.");
  }
  const domain = value.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(domain) ||
    ["local", "internal", "localhost", "home", "lan"].includes(labels.at(-1) ?? "")
  ) {
    throw new PublicError(400, "INVALID_REQUEST", "The saved research has an invalid domain.");
  }
  return domain;
}

function validateBusinessMemory(body: unknown): BusinessMemoryInput {
  const candidate = businessMemoryObject(body, "payload");
  if (candidate.schemaVersion !== 1) {
    throw new PublicError(400, "INVALID_REQUEST", "The saved research schema is not supported.");
  }
  if (candidate.status !== "completed" && candidate.status !== "partial") {
    throw new PublicError(400, "INVALID_REQUEST", "Only completed research can be saved.");
  }
  const competitors = businessMemoryObject(candidate.competitors, "competitors");
  const input: BusinessMemoryInput = {
    schemaVersion: 1,
    jobId: businessMemoryText(candidate.jobId, "job ID", 160),
    status: candidate.status,
    domain: validateBusinessDomain(candidate.domain),
    companyOverview: businessMemoryText(candidate.companyOverview, "company overview", 60_000),
    profile: businessMemoryObject(candidate.profile, "company profile"),
    competitors: {
      direct: businessMemoryObjectArray(competitors.direct, "direct competitors", 20),
      seo: businessMemoryObjectArray(competitors.seo, "SEO competitors", 20),
      adjacent: businessMemoryObjectArray(competitors.adjacent, "adjacent organizations", 20),
    },
    seedKeywords: businessMemoryStringArray(candidate.seedKeywords, "seed keywords", 100, 300),
    keywordCandidates: businessMemoryObjectArray(candidate.keywordCandidates, "keyword candidates", 160),
    keywordGroups: businessMemoryObjectArray(candidate.keywordGroups, "keyword groups", 20),
    sources: businessMemoryObjectArray(candidate.sources, "sources", 60),
    warnings: businessMemoryStringArray(candidate.warnings, "warnings", 40, 2_000),
    researchSummary: businessMemoryText(candidate.researchSummary, "research summary", 20_000),
    evidenceQuality: businessMemoryObject(candidate.evidenceQuality, "evidence quality"),
  };
  if (typeof candidate.researchedAt === "string" && !Number.isNaN(Date.parse(candidate.researchedAt))) {
    input.researchedAt = new Date(candidate.researchedAt).toISOString();
  }
  if (!input.jobId) {
    throw new PublicError(400, "INVALID_REQUEST", "The saved research has no job ID.");
  }
  return input;
}

function paidResearchNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PublicError(400, "INVALID_REQUEST", `The paid research has an invalid ${field}.`);
  }
  return value;
}

function validateSeoSnapshot(body: unknown): SeoSnapshotInput {
  const candidate = businessMemoryObject(body, "paid research snapshot");
  if (candidate.schemaVersion !== 1) {
    throw new PublicError(400, "INVALID_REQUEST", "The paid research schema is not supported.");
  }
  if (!(["completed", "partial", "failed"] as unknown[]).includes(candidate.status)) {
    throw new PublicError(400, "INVALID_REQUEST", "The paid research has an invalid status.");
  }
  if (!(["refresh", "standard", "deep"] as unknown[]).includes(candidate.researchDepth)) {
    throw new PublicError(400, "INVALID_REQUEST", "The paid research has an invalid depth.");
  }
  const componentCandidate = businessMemoryObject(candidate.componentStatus, "component status");
  const componentEntries = Object.entries(componentCandidate);
  const allowedComponentStatuses: readonly PaidComponentStatus[] = [
    "success",
    "no_results",
    "failed",
    "unavailable",
    "skipped",
  ];
  if (
    componentEntries.length > 20 ||
    componentEntries.some(
      ([key, value]) =>
        !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
        !allowedComponentStatuses.includes(value as PaidComponentStatus),
    )
  ) {
    throw new PublicError(400, "INVALID_REQUEST", "The paid research has an invalid component status.");
  }
  const researchDepth = candidate.researchDepth as SeoSnapshotInput["researchDepth"];
  const maximumCost = { refresh: 0.1, standard: 0.2, deep: 0.5 }[researchDepth];
  const costLimitUsd = paidResearchNumber(candidate.costLimitUsd, "cost limit", 0, maximumCost);
  if (candidate.device !== "desktop" && candidate.device !== "mobile") {
    throw new PublicError(400, "INVALID_REQUEST", "The paid research has an invalid device.");
  }
  const input: SeoSnapshotInput = {
    schemaVersion: 1,
    jobId: businessMemoryText(candidate.jobId, "job ID", 160),
    status: candidate.status as SeoSnapshotInput["status"],
    researchDepth,
    domain: validateBusinessDomain(candidate.domain),
    locationCode: Math.trunc(paidResearchNumber(candidate.locationCode, "location", 1, 9_999_999)),
    languageCode: businessMemoryText(candidate.languageCode, "language", 12).toLowerCase(),
    device: candidate.device,
    costLimitUsd,
    // Record real provider cost even if it unexpectedly exceeds the intended cap.
    actualCostUsd: paidResearchNumber(candidate.actualCostUsd, "actual cost", 0, 100),
    componentStatus: Object.fromEntries(componentEntries) as Record<string, PaidComponentStatus>,
    offeringProfile: businessMemoryObject(candidate.offeringProfile, "offering profile"),
    rankedKeywords: businessMemoryObjectArray(candidate.rankedKeywords, "ranked keywords", 200),
    keywordCandidates: businessMemoryObjectArray(candidate.keywordCandidates, "keyword candidates", 500),
    selectedKeywords: businessMemoryObjectArray(candidate.selectedKeywords, "selected keywords", 100),
    seoCompetitors: businessMemoryObjectArray(candidate.seoCompetitors, "SEO competitors", 100),
    serpEvidence: businessMemoryObjectArray(candidate.serpEvidence, "SERP evidence", 100),
    sources: businessMemoryObjectArray(candidate.sources, "paid research sources", 200),
    warnings: businessMemoryStringArray(candidate.warnings, "paid research warnings", 100, 2_000),
    evidenceSummary: businessMemoryObject(candidate.evidenceSummary, "evidence summary"),
  };
  if (!input.jobId || !/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(input.languageCode)) {
    throw new PublicError(400, "INVALID_REQUEST", "The paid research identity is invalid.");
  }
  if (typeof candidate.capturedAt === "string" && !Number.isNaN(Date.parse(candidate.capturedAt))) {
    input.capturedAt = new Date(candidate.capturedAt).toISOString();
  }
  if (typeof candidate.expiresAt === "string" && !Number.isNaN(Date.parse(candidate.expiresAt))) {
    input.expiresAt = new Date(candidate.expiresAt).toISOString();
  }
  return input;
}

function seoArticleUrlArray(value: unknown, field: string): string[] {
  const urls = businessMemoryStringArray(value ?? [], field, 12, 2_000);
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new PublicError(400, "INVALID_REQUEST", `The article request has an invalid ${field}.`);
    }
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      throw new PublicError(400, "INVALID_REQUEST", `The article request has an invalid ${field}.`);
    }
  }
  return urls;
}

interface SeoArticleStartRequest {
  sessionId: string;
  requestId: string;
  domain: string;
  primaryKeyword: string;
  selectionNumber?: number;
  chooseStrongestKeyword: boolean;
  supportingKeywords: string[];
  context: ArticleContextOverrides;
  goal: string;
  sourceUrls: string[];
}

function validateSeoArticleStartRequest(body: unknown): SeoArticleStartRequest {
  const candidate = businessMemoryObject(body, "article request");
  const sessionId = validateSessionId(candidate.sessionId);
  const requestId = validateSessionId(candidate.requestId);
  const domain = validateBusinessDomain(candidate.domain);
  const primaryKeyword = businessMemoryText(candidate.primaryKeyword ?? "", "primary keyword", 200);
  const rawSelection = candidate.selectionNumber ?? candidate.articleChoice;
  const selectionNumber = rawSelection === undefined || rawSelection === ""
    ? undefined
    : Number(rawSelection);
  if (
    selectionNumber !== undefined &&
    (!Number.isInteger(selectionNumber) || selectionNumber < 1 || selectionNumber > 3)
  ) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose article 1, 2 or 3.");
  }
  const supportingKeywords = businessMemoryStringArray(
    candidate.supportingKeywords ?? [],
    "supporting keywords",
    20,
    200,
  );
  const context: ArticleContextOverrides = {
    who: businessMemoryText(
      candidate.who ?? candidate.targetAudience ?? "",
      "who the business helps",
      1_000,
    ),
    offer: businessMemoryText(candidate.offer ?? "", "business offer", 1_000),
    price: businessMemoryText(candidate.price ?? "", "pricing guidance", 1_000),
    boundaries: businessMemoryText(candidate.boundaries ?? "", "business limits", 1_000),
    voice: businessMemoryText(candidate.voice ?? "", "writing voice", 1_000),
  };
  return {
    sessionId,
    requestId,
    domain,
    primaryKeyword,
    ...(selectionNumber === undefined ? {} : { selectionNumber }),
    chooseStrongestKeyword: candidate.chooseStrongestKeyword === true,
    supportingKeywords,
    context,
    goal: businessMemoryText(candidate.goal ?? "", "article goal", 1_000),
    sourceUrls: seoArticleUrlArray(candidate.sourceUrls, "source URLs"),
  };
}

function researchKeyForBrief(brief: ReturnType<typeof createArticleBriefData>): string {
  if (brief === undefined) return "";
  if (brief.research.snapshotId) return `snapshot:${brief.research.snapshotId}`;
  return `memory:${brief.research.memoryJobId ?? brief.research.capturedAt}`;
}

function prepareArticleBrief(
  chatStore: ChatStore,
  sessionId: string,
  domain: string,
  profile: AgentProfile,
  options: { paidOnly?: boolean; freeOnly?: boolean } = {},
): ArticleBriefRecord | undefined {
  const snapshot = options.freeOnly ? undefined : chatStore.getLatestSeoSnapshot(domain);
  const memory = options.paidOnly ? undefined : chatStore.getBusinessMemory(domain);
  const data = createArticleBriefData({
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(memory === undefined ? {} : { memory }),
    profile,
  });
  if (data === undefined) return undefined;
  return chatStore.prepareArticleBrief(
    sessionId,
    domain,
    researchKeyForBrief(data),
    data,
  );
}

function prepareSeoArticleJob(
  chatStore: ChatStore,
  request: SeoArticleStartRequest,
  profile: AgentProfile,
):
  | { status: "needs_selection"; brief: ArticleBriefRecord; message: string }
  | {
      status: "needs_details";
      brief: ArticleBriefRecord;
      missingFields: string[];
      message: string;
    }
  | { status: "ready"; brief: ArticleBriefRecord; jobInput: SeoArticleJobInput } {
  let brief = chatStore.getLatestArticleBrief(request.sessionId, request.domain);
  if (brief === undefined) {
    brief = prepareArticleBrief(
      chatStore,
      request.sessionId,
      request.domain,
      profile,
    );
  }
  if (brief === undefined) {
    throw new PublicError(
      422,
      "SEO_ARTICLE_ERROR",
      "I need to research this website before I can write a reliable article.",
    );
  }
  const opportunity = selectArticleOpportunity(brief, {
    primaryKeyword: request.primaryKeyword,
    ...(request.selectionNumber === undefined
      ? {}
      : { selectionNumber: request.selectionNumber }),
    chooseBest: request.chooseStrongestKeyword,
  });
  if (opportunity === undefined) {
    return {
      status: "needs_selection",
      brief,
      message: brief.opportunities.length > 0
        ? "Choose article 1, 2 or 3, ask me to choose, or tell me another topic."
        : "Tell me the article topic you want to write.",
    };
  }
  const resolved = resolveArticleContext(brief, opportunity, request.context);
  if (resolved.missingFields.length > 0) {
    brief = chatStore.updateArticleBrief(request.sessionId, brief.briefId, {
      status: "needs_details",
      selection: opportunity,
      context: resolved.context,
      missingFields: resolved.missingFields,
    });
    return {
      status: "needs_details",
      brief,
      missingFields: resolved.missingFields,
      message: "I only need the missing business details shown here before I write.",
    };
  }
  brief = chatStore.updateArticleBrief(request.sessionId, brief.briefId, {
    status: "choosing",
    selection: opportunity,
    context: resolved.context,
    missingFields: [],
  });
  const supportingKeywords = [
    ...request.supportingKeywords,
    ...opportunity.supportingKeywords,
  ]
    .filter(
      (keyword, index, values) =>
        keyword.toLowerCase() !== opportunity.primaryKeyword.toLowerCase() &&
        values.findIndex((value) => value.toLowerCase() === keyword.toLowerCase()) === index,
    )
    .slice(0, 12);
  return {
    status: "ready",
    brief,
    jobInput: {
      sessionId: request.sessionId,
      requestId: request.requestId,
      domain: request.domain,
      briefId: brief.briefId,
      primaryKeyword: opportunity.primaryKeyword,
      supportingKeywords,
      input: {
        targetAudience: resolved.context.who.value,
        offer: resolved.context.offer.value,
        price: resolved.context.price.value,
        boundaries: resolved.context.boundaries.value,
        voice: resolved.context.voice.value,
        goal: request.goal,
        sourceUrls: request.sourceUrls,
        requestedAt: new Date().toISOString(),
      },
    },
  };
}

function validateSeoArticleJobUpdate(body: unknown): {
  sessionId: string;
  jobId: string;
  status: SeoArticleJobStatus;
  stage: string;
  errorCode?: string;
  errorMessage?: string;
} {
  const candidate = businessMemoryObject(body, "article job update");
  const allowed: readonly SeoArticleJobStatus[] = [
    "running",
    "failed",
    "interrupted",
  ];
  if (!allowed.includes(candidate.status as SeoArticleJobStatus)) {
    throw new PublicError(400, "INVALID_REQUEST", "The article job has an invalid status.");
  }
  const errorCode = businessMemoryText(candidate.errorCode ?? "", "article error code", 100);
  const errorMessage = businessMemoryText(candidate.errorMessage ?? "", "article error message", 2_000);
  return {
    sessionId: validateSessionId(candidate.sessionId),
    jobId: businessMemoryText(candidate.jobId, "article job ID", 160),
    status: candidate.status as SeoArticleJobStatus,
    stage: businessMemoryText(candidate.stage, "article stage", 80),
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function articleVersionInput(
  candidate: Record<string, unknown>,
  primaryKeyword: string,
  domain: string,
  supportingKeywords: string[],
): SeoArticleVersionInput {
  let result;
  try {
    result = validateSeoArticleResult(candidate.result, primaryKeyword);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid article result";
    throw new PublicError(400, "INVALID_REQUEST", `The article result could not be saved: ${message}.`);
  }
  if (!result.qualityReport.passed) {
    throw new PublicError(
      422,
      "SEO_ARTICLE_ERROR",
      `The draft did not pass its final checks: ${result.qualityReport.errors.join(" ")}`,
    );
  }
  return {
    status: result.status,
    domain,
    primaryKeyword,
    supportingKeywords,
    context: businessMemoryObject(candidate.context ?? {}, "article context"),
    plan: result.plan,
    markdown: result.markdown,
    structuredData: result.structuredData,
    metadata: {
      seoTitle: result.seoTitle,
      metaDescription: result.metaDescription,
      slug: result.slug,
      canonicalSuggestion: result.canonicalSuggestion,
      keywordMap: result.keywordMap,
    },
    answerBlocks: result.answerBlocks,
    faq: result.faq,
    sources: result.sources,
    claimLedger: result.claims,
    qualityReport: result.qualityReport as unknown as Record<string, unknown>,
    warnings: [...result.warnings, ...result.qualityReport.warnings],
    reviewStatus: result.reviewStatus,
    model: result.model,
  };
}

interface UploadedFile {
  sessionId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

async function readMultipartUpload(
  request: IncomingMessage,
): Promise<UploadedFile> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Upload the document using the file picker.",
    );
  }

  return await new Promise<UploadedFile>((resolveUpload, rejectUpload) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fields: 2,
          files: 1,
          fileSize: MAX_FILE_BYTES,
          parts: 3,
        },
      });
    } catch {
      rejectUpload(
        new PublicError(
          400,
          "INVALID_REQUEST",
          "The uploaded document could not be read.",
        ),
      );
      return;
    }

    let settled = false;
    let sessionId = "";
    let fileName = "";
    let mimeType = "";
    let fileSeen = false;
    let fileTooLarge = false;
    const chunks: Buffer[] = [];

    const fail = (error: PublicError) => {
      if (!settled) {
        settled = true;
        rejectUpload(error);
      }
    };

    parser.on("field", (name, value) => {
      if (name === "sessionId") {
        sessionId = value;
      }
    });
    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== "file" || fileSeen) {
        stream.resume();
        return;
      }
      fileSeen = true;
      fileName = basename(info.filename || "document");
      mimeType = info.mimeType || "application/octet-stream";
      stream.on("limit", () => {
        fileTooLarge = true;
      });
      stream.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });
      stream.on("error", () => {
        fail(
          new PublicError(
            400,
            "INVALID_REQUEST",
            "The uploaded document could not be read.",
          ),
        );
      });
    });
    parser.on("partsLimit", () => {
      fail(
        new PublicError(
          400,
          "INVALID_REQUEST",
          "Upload one document at a time.",
        ),
      );
    });
    parser.on("filesLimit", () => {
      fail(
        new PublicError(
          400,
          "INVALID_REQUEST",
          "Upload one document at a time.",
        ),
      );
    });
    parser.on("error", () => {
      fail(
        new PublicError(
          400,
          "INVALID_REQUEST",
          "The uploaded document could not be read.",
        ),
      );
    });
    parser.on("finish", () => {
      if (settled) {
        return;
      }
      if (fileTooLarge) {
        fail(
          new PublicError(
            413,
            "FILE_TOO_LARGE",
            "Files must be 20 MB or smaller.",
          ),
        );
        return;
      }
      if (!fileSeen || chunks.length === 0) {
        fail(
          new PublicError(
            400,
            "INVALID_REQUEST",
            "Choose a PDF, DOCX, or text file.",
          ),
        );
        return;
      }
      try {
        settled = true;
        resolveUpload({
          sessionId: validateSessionId(sessionId),
          fileName,
          mimeType,
          buffer: Buffer.concat(chunks),
        });
      } catch (error) {
        settled = true;
        rejectUpload(error);
      }
    });

    request.pipe(parser);
  });
}

function asPublicError(error: DocumentStoreError): PublicError {
  const supportedCode: ErrorCode =
    error.code === "DOCUMENT_NOT_FOUND"
      ? "DOCUMENT_NOT_FOUND"
      : error.code === "DOCUMENT_SERVICE_UNAVAILABLE"
        ? "DOCUMENT_SERVICE_UNAVAILABLE"
        : error.code === "DOCUMENT_TEXT_TOO_LARGE"
          ? "DOCUMENT_TEXT_TOO_LARGE"
          : error.code === "FILE_TOO_LARGE"
            ? "FILE_TOO_LARGE"
            : error.code === "TOO_MANY_DOCUMENTS"
              ? "TOO_MANY_DOCUMENTS"
              : error.code === "UNSUPPORTED_FILE_TYPE"
                ? "UNSUPPORTED_FILE_TYPE"
                : "DOCUMENT_ERROR";
  return new PublicError(error.status, supportedCode, error.publicMessage);
}

async function readUpstreamBody(response: Response): Promise<unknown> {
  const rawBody = await response.text();
  if (Buffer.byteLength(rawBody) > MAX_UPSTREAM_BYTES) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }
}

function validateUpstreamResponse(
  body: unknown,
  request: ChatRequest,
): ChatResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }

  const candidate = body as Record<string, unknown>;
  const reply =
    typeof candidate.reply === "string" ? candidate.reply.trim() : "";

  if (
    candidate.sessionId !== request.sessionId ||
    reply.length === 0 ||
    (candidate.runId !== undefined && typeof candidate.runId !== "string")
  ) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }

  const result: ChatResponse = {
    sessionId: request.sessionId,
    reply,
  };
  if (typeof candidate.runId === "string") {
    result.runId = candidate.runId;
  }
  return result;
}

async function callAgent(
  request: ChatRequest,
  agent: AgentDefinition,
  documents: DocumentRecord[],
  history: HistoryMessage[],
  options: Required<
    Pick<ChatGatewayOptions, "fetchImplementation" | "timeoutMs" | "upstreamUrl">
  >,
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let upstreamResponse: Response;

  try {
    const configuredUrl = new URL(options.upstreamUrl);
    const upstreamUrl =
      configuredUrl.pathname === agent.workflowPath
        ? configuredUrl
        : new URL(
            agent.workflowPath,
            `${configuredUrl.protocol}//${configuredUrl.host}`,
          );
    const upstreamRequest: UpstreamChatRequest = {
      schemaVersion: 3,
      requestId: request.requestId,
      sessionId: request.sessionId,
      agentId: request.agentId,
      message: request.message,
      history,
      documents: documents.map((document) => ({
        id: document.id,
        name: document.name,
        type: document.type,
        wordCount: document.wordCount,
        characterCount: document.characterCount,
        text: document.text,
        ...(document.pageCount === undefined
          ? {}
          : { pageCount: document.pageCount }),
      })),
    };

    upstreamResponse = await options.fetchImplementation(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamRequest),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PublicError(
        504,
        "AGENT_TIMEOUT",
        "The agent took too long to reply. Wait a moment and try again.",
      );
    }
    throw new PublicError(
      503,
      "AGENT_UNAVAILABLE",
      "The local agent is not ready. Check that n8n is running and the chat workflow is active.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (upstreamResponse.status === 429) {
    throw new PublicError(
      429,
      "RATE_LIMITED",
      "The agent is busy right now. Wait a moment and try again.",
    );
  }

  if (upstreamResponse.status === 404) {
    throw new PublicError(
      503,
      "AGENT_UNAVAILABLE",
      "The local agent is not ready. Check that n8n is running and the chat workflow is active.",
    );
  }

  if (!upstreamResponse.ok) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent could not complete that request. Check the n8n workflow and try again.",
    );
  }

  const responseBody = await readUpstreamBody(upstreamResponse);
  return validateUpstreamResponse(responseBody, request);
}

async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  publicDirectory: string,
  pathname: string,
): Promise<void> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, SECURITY_HEADERS);
    response.end("Bad request");
    return;
  }

  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const root = resolve(publicDirectory);
  const filePath = resolve(root, `.${requestedPath}`);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(404, SECURITY_HEADERS);
    response.end("Not found");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new Error("Not a file");
    }

    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "Content-Length": fileStats.size.toString(),
      "Content-Type":
        MIME_TYPES[extname(filePath).toLowerCase()] ??
        "application/octet-stream",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  }
}

function queryLimit(
  value: string | null,
  fallback: number,
  maximum: number,
): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      `Limit must be a whole number from 1 to ${maximum}.`,
    );
  }
  return parsed;
}

function activeAgentFor(
  value: unknown,
  agents: readonly AgentDefinition[],
): AgentDefinition {
  const id = typeof value === "string" ? value.trim() : "project-manager";
  const agent = agents.find(
    (candidate) => candidate.id === id && candidate.status === "active",
  );
  if (!agent) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "That agent is not available yet.",
    );
  }
  return agent;
}

function attachmentSnapshot(document: DocumentRecord): StoredAttachment {
  return {
    documentId: document.id,
    name: document.name,
    type: document.type,
    mimeType: document.mimeType,
    wordCount: document.wordCount,
    characterCount: document.characterCount,
    expiresAt: document.expiresAt,
    ...(document.pageCount === undefined
      ? {}
      : { pageCount: document.pageCount }),
  };
}

function publicConversationPage(
  page: NonNullable<ReturnType<ChatStore["getConversationPage"]>>,
): unknown {
  const now = Date.now();
  return {
    ...page,
    messages: page.messages.map((message) => ({
      ...message,
      attachments: message.attachments.map((attachment) => ({
        ...attachment,
        expired: Date.parse(attachment.expiresAt) <= now,
      })),
    })),
  };
}

export function createChatHandler(options: ChatGatewayOptions): RequestListener {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const agents = options.agents ?? DEFAULT_AGENTS;
  const documentStore = options.documentStore;
  const profileStore = options.profileStore;
  if (!options.chatStore) {
    throw new Error("Chat history store is required.");
  }
  const chatStore = options.chatStore;

  return (request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(response, 405, {
            error: {
              code: "INVALID_REQUEST",
              message: "That method is not supported.",
            },
          }, { Allow: "GET, HEAD" });
          return;
        }
        sendJson(response, 200, { status: "ok" });
        return;
      }

      // Deliberately below /health, so the platform's health check keeps
      // working while nobody is signed in, and above everything else, so no
      // route can be added later that forgets to check.
      if (
        options.accessGate !== undefined &&
        (await options.accessGate.handle(request, response, url))
      ) {
        return;
      }

      if (url.pathname === "/api/agents") {
        if (request.method !== "GET") {
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET" },
          );
          return;
        }
        const publicAgents =
          options.skillsDirectory !== undefined &&
          options.profileDirectory !== undefined
            ? await buildAgentCardDefinitions(
                agents,
                options.skillsDirectory,
                options.profileDirectory,
                (message) => options.logError?.(message),
              )
            : publicAgentDefinitions(agents).map((agent) => ({
                ...agent,
                skills: [],
                syncRequired: true,
              }));
        sendJson(response, 200, { schemaVersion: 2, agents: publicAgents });
        return;
      }

      if (url.pathname === "/api/profile") {
        if (profileStore === undefined) {
          sendJson(response, 503, {
            error: {
              code: "AGENT_UNAVAILABLE",
              message: "Saved agent details are not available.",
            },
          });
          return;
        }
        try {
          if (request.method === "GET") {
            sendJson(response, 200, {
              schemaVersion: 2,
              profile: await profileStore.read(),
            });
            return;
          }
          if (request.method === "PUT") {
            const body = await readRequestBody(
              request,
              MAX_PROFILE_REQUEST_BYTES,
            );
            if (
              typeof body !== "object" ||
              body === null ||
              Array.isArray(body)
            ) {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "The agent details could not be saved.",
              );
            }
            const saved = await profileStore.write(
              (body as Record<string, unknown>).profile ?? body,
            );
            sendJson(response, 200, { schemaVersion: 2, profile: saved });
            return;
          }
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET, PUT" },
          );
        } catch (error) {
          if (error instanceof ProfileValidationError) {
            sendError(
              response,
              new PublicError(400, "INVALID_REQUEST", error.message),
            );
          } else if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not save the agent profile", error);
            sendError(
              response,
              new PublicError(
                500,
                "AGENT_ERROR",
                "Your agent details could not be saved.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/agent-settings") {
        if (options.agentSettingsStore === undefined) {
          sendJson(response, 503, {
            error: {
              code: "AGENT_UNAVAILABLE",
              message: "Agent settings are not available.",
            },
          });
          return;
        }
        try {
          if (request.method === "GET") {
            const saved = await options.agentSettingsStore.readAll();
            sendJson(response, 200, { schemaVersion: 1, ...saved });
            return;
          }
          if (request.method === "PUT") {
            const body = await readRequestBody(request, MAX_REQUEST_BYTES);
            if (
              typeof body !== "object" ||
              body === null ||
              Array.isArray(body)
            ) {
              throw new AgentSettingsValidationError(
                "Agent settings must be an object.",
              );
            }
            const candidate = body as Record<string, unknown>;
            if (typeof candidate.agentId !== "string") {
              throw new AgentSettingsValidationError(
                "Choose an agent before saving settings.",
              );
            }
            const saved = await options.agentSettingsStore.write(
              candidate.agentId,
              candidate.values,
            );
            sendJson(response, 200, {
              schemaVersion: 1,
              ...saved,
              syncRequired: true,
            });
            return;
          }
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET, PUT" },
          );
        } catch (error) {
          if (error instanceof AgentSettingsValidationError) {
            sendJson(response, 400, {
              error: {
                code: "INVALID_REQUEST",
                message: error.message,
              },
            });
          } else {
            options.logError?.("Could not manage agent settings", error);
            sendJson(response, 500, {
              error: {
                code: "AGENT_UNAVAILABLE",
                message: "Agent settings could not be saved.",
              },
            });
          }
        }
        return;
      }

      if (url.pathname === "/api/business-memory/jobs") {
        try {
          if (request.method === "GET") {
            const sessionId = validateSessionId(
              url.searchParams.get("sessionId"),
            );
            const jobId = businessMemoryText(
              url.searchParams.get("jobId"),
              "job ID",
              160,
            );
            if (!jobId) {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "The research job has no job ID.",
              );
            }
            const job = chatStore.getDomainResearchJob(sessionId, jobId);
            if (job === undefined) {
              throw new PublicError(
                404,
                "RESEARCH_JOB_NOT_FOUND",
                "That research job is not registered to this conversation.",
              );
            }
            const memory = job.status === "completed" || job.status === "partial"
              ? chatStore.getBusinessMemory(job.domain)
              : undefined;
            sendJson(response, 200, {
              schemaVersion: 1,
              job,
              ...(memory === undefined ? {} : { memory }),
            });
            return;
          }
          if (request.method !== "POST") {
            sendJson(
              response,
              405,
              {
                error: {
                  code: "INVALID_REQUEST",
                  message: "That method is not supported.",
                },
              },
              { Allow: "GET, POST" },
            );
            return;
          }
          const candidate = businessMemoryObject(
            await readRequestBody(request),
            "job registration",
          );
          const sessionId = validateSessionId(candidate.sessionId);
          const jobId = businessMemoryText(candidate.jobId, "job ID", 160);
          const domain = validateBusinessDomain(candidate.domain);
          if (!jobId) {
            throw new PublicError(400, "INVALID_REQUEST", "The research job has no job ID.");
          }
          chatStore.registerDomainResearchJob(sessionId, jobId, domain);
          sendJson(response, 201, {
            schemaVersion: 1,
            job: { jobId, sessionId, domain, status: "queued" },
          });
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not register the business research job", error);
            sendError(
              response,
              new PublicError(
                409,
                "BUSINESS_MEMORY_ERROR",
                "That research job could not be linked to this conversation.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/public-domain-page") {
        try {
          if (request.method !== "POST") {
            sendJson(
              response,
              405,
              { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
              { Allow: "POST" },
            );
            return;
          }
          const candidate = businessMemoryObject(
            await readRequestBody(request),
            "public domain request",
          );
          const domain = validateBusinessDomain(candidate.domain);
          const page = await fetchPublicDomainPage(domain);
          sendJson(response, 200, { schemaVersion: 1, domain, ...page });
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not safely read the authorised public domain", error);
            sendError(
              response,
              new PublicError(
                502,
                "BUSINESS_MEMORY_ERROR",
                "The authorised public page could not be read safely.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/public-research-pages") {
        try {
          if (request.method !== "POST") {
            sendJson(
              response,
              405,
              { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
              { Allow: "POST" },
            );
            return;
          }
          const candidate = businessMemoryObject(
            await readRequestBody(request, MAX_SEO_ARTICLE_REQUEST_BYTES),
            "public research request",
          );
          const urls = seoArticleUrlArray(candidate.urls, "source URLs");
          if (urls.length === 0) {
            throw new PublicError(400, "INVALID_REQUEST", "Add at least one public source URL.");
          }
          const pages = await fetchPublicWebPages(urls);
          sendJson(response, 200, { schemaVersion: 1, pages });
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not safely read public research pages", error);
            sendError(
              response,
              new PublicError(502, "SEO_ARTICLE_ERROR", "The public sources could not be read safely."),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/seo-article/briefs") {
        try {
          if (request.method === "PATCH") {
            const candidate = businessMemoryObject(
              await readRequestBody(request, MAX_SEO_ARTICLE_REQUEST_BYTES),
              "article plan update",
            );
            const sessionId = validateSessionId(candidate.sessionId);
            const briefId = businessMemoryText(candidate.briefId, "article plan ID", 160);
            const current = chatStore.getArticleBrief(sessionId, briefId);
            if (current === undefined) {
              throw new PublicError(
                404,
                "SEO_ARTICLE_NOT_FOUND",
                "That article plan is not saved for this conversation.",
              );
            }
            if (current.status === "choosing" || current.status === "needs_details") {
              const refreshed = refreshArticleBriefContext(
                current,
                profileStore === undefined ? emptyProfile() : await profileStore.read(),
              );
              const brief = chatStore.updateArticleBrief(sessionId, briefId, {
                status: refreshed.missingFields.length > 0 && current.selection !== undefined
                  ? "needs_details"
                  : "choosing",
                context: refreshed.context,
                missingFields: refreshed.missingFields,
              });
              sendJson(response, 200, { schemaVersion: 1, brief });
              return;
            }
            sendJson(response, 200, { schemaVersion: 1, brief: current });
            return;
          }
          if (request.method !== "GET") {
            sendJson(
              response,
              405,
              { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
              { Allow: "GET, PATCH" },
            );
            return;
          }
          const sessionId = validateSessionId(url.searchParams.get("sessionId"));
          const requestedDomain = url.searchParams.get("domain");
          const brief = chatStore.getLatestArticleBrief(
            sessionId,
            requestedDomain === null ? undefined : validateBusinessDomain(requestedDomain),
          );
          if (brief === undefined) {
            throw new PublicError(
              404,
              "SEO_ARTICLE_NOT_FOUND",
              "There is no article plan in this conversation yet.",
            );
          }
          const job = brief.linkedJobId
            ? chatStore.getSeoArticleJob(sessionId, brief.linkedJobId)
            : undefined;
          const version = job?.latestVersionId
            ? chatStore.getSeoArticleVersionForJob(sessionId, job.jobId, job.latestVersionId)
            : undefined;
          sendJson(response, 200, {
            schemaVersion: 1,
            brief: {
              briefId: brief.briefId,
              domain: brief.domain,
              status: brief.status,
              opportunities: brief.opportunities,
              context: brief.context,
              selection: brief.selection,
              missingFields: brief.missingFields,
              research: {
                source: brief.research.source,
                capturedAt: brief.research.capturedAt,
                status: brief.research.status,
                warnings: brief.research.warnings,
              },
              createdAt: brief.createdAt,
              updatedAt: brief.updatedAt,
            },
            ...(job === undefined ? {} : { job }),
            ...(version === undefined
              ? {}
              : {
                  article: {
                    status: version.status,
                    metadata: version.metadata,
                    warnings: version.warnings,
                    createdAt: version.createdAt,
                    downloadUrl: `/api/seo-article/download/${version.downloadToken}.md`,
                  },
                }),
          });
        } catch (error) {
          if (error instanceof PublicError) sendError(response, error);
          else {
            options.logError?.("Could not read the article plan", error);
            sendError(
              response,
              new PublicError(500, "SEO_ARTICLE_ERROR", "The article plan could not be loaded."),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/seo-article/jobs") {
        try {
          if (request.method === "POST") {
            const startRequest = validateSeoArticleStartRequest(
              await readRequestBody(request, MAX_SEO_ARTICLE_REQUEST_BYTES),
            );
            const prepared = prepareSeoArticleJob(
              chatStore,
              startRequest,
              profileStore === undefined ? emptyProfile() : await profileStore.read(),
            );
            if (prepared.status !== "ready") {
              sendJson(response, 200, {
                schemaVersion: 1,
                status: prepared.status,
                message: prepared.message,
                brief: {
                  briefId: prepared.brief.briefId,
                  domain: prepared.brief.domain,
                  status: prepared.brief.status,
                  opportunities: prepared.brief.opportunities,
                  context: prepared.brief.context,
                  selection: prepared.brief.selection,
                  missingFields: prepared.brief.missingFields,
                },
                ...(prepared.status === "needs_details"
                  ? { missingFields: prepared.missingFields }
                  : {}),
              });
              return;
            }
            const registered = chatStore.registerSeoArticleJob(prepared.jobInput);
            sendJson(response, registered.created ? 201 : 200, {
              schemaVersion: 1,
              status: registered.job.status,
              brief: {
                briefId: prepared.brief.briefId,
                selection: prepared.brief.selection,
                context: prepared.brief.context,
              },
              ...registered,
            });
            return;
          }
          if (request.method === "PATCH") {
            const update = validateSeoArticleJobUpdate(
              await readRequestBody(request, MAX_SEO_ARTICLE_REQUEST_BYTES),
            );
            const job = chatStore.updateSeoArticleJob(update.sessionId, update.jobId, update);
            sendJson(response, 200, { schemaVersion: 1, job });
            return;
          }
          if (request.method === "GET") {
            const sessionId = validateSessionId(url.searchParams.get("sessionId"));
            const jobId = url.searchParams.get("jobId");
            const domain = url.searchParams.get("domain");
            const job = jobId !== null
              ? chatStore.getSeoArticleJob(
                  sessionId,
                  businessMemoryText(jobId, "article job ID", 160),
                )
              : domain !== null
                ? chatStore.getLatestSeoArticleJob(sessionId, validateBusinessDomain(domain))
                : undefined;
            if (job === undefined) {
              throw new PublicError(
                404,
                "SEO_ARTICLE_NOT_FOUND",
                "That article job is not saved for this conversation.",
              );
            }
            const version = job.latestVersionId === undefined
              ? undefined
              : chatStore.getSeoArticleVersionForJob(sessionId, job.jobId, job.latestVersionId);
            const previousVersion = version === undefined
              ? chatStore.getLatestSuccessfulSeoArticleVersion(sessionId, job.domain)
              : undefined;
            sendJson(response, 200, {
              schemaVersion: 1,
              job,
              ...(version === undefined
                ? {}
                : {
                    article: {
                      versionId: version.versionId,
                      versionNumber: version.versionNumber,
                      status: version.status,
                      metadata: version.metadata,
                      warnings: version.warnings,
                      reviewStatus: version.reviewStatus,
                      qualityReport: version.qualityReport,
                      createdAt: version.createdAt,
                      downloadUrl: `/api/seo-article/download/${version.downloadToken}.md`,
                    },
                  }),
              ...(previousVersion === undefined
                ? {}
                : {
                    previousArticle: {
                      versionId: previousVersion.versionId,
                      versionNumber: previousVersion.versionNumber,
                      status: previousVersion.status,
                      metadata: previousVersion.metadata,
                      warnings: previousVersion.warnings,
                      reviewStatus: previousVersion.reviewStatus,
                      qualityReport: previousVersion.qualityReport,
                      createdAt: previousVersion.createdAt,
                      downloadUrl: `/api/seo-article/download/${previousVersion.downloadToken}.md`,
                    },
                  }),
            });
            return;
          }
          sendJson(
            response,
            405,
            { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
            { Allow: "GET, POST, PATCH" },
          );
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not access the SEO article job", error);
            sendError(
              response,
              new PublicError(409, "SEO_ARTICLE_ERROR", "The article job could not be updated safely."),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/seo-article/context") {
        try {
          if (request.method !== "GET") {
            sendJson(
              response,
              405,
              { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
              { Allow: "GET" },
            );
            return;
          }
          const sessionId = validateSessionId(url.searchParams.get("sessionId"));
          const jobId = businessMemoryText(url.searchParams.get("jobId"), "article job ID", 160);
          const job = chatStore.getSeoArticleJob(sessionId, jobId);
          if (job === undefined) {
            throw new PublicError(404, "SEO_ARTICLE_NOT_FOUND", "That article job is not saved for this conversation.");
          }
          const brief = job.briefId
            ? chatStore.getArticleBrief(sessionId, job.briefId)
            : undefined;
          const memory = brief === undefined ? chatStore.getBusinessMemory(job.domain) : undefined;
          const snapshot = brief === undefined ? chatStore.getLatestSeoSnapshot(job.domain) : undefined;
          const profile = profileStore === undefined ? undefined : await profileStore.read();
          sendJson(response, 200, {
            schemaVersion: 1,
            job,
            ...(brief === undefined ? {} : { brief }),
            ...(memory === undefined ? {} : { memory }),
            ...(snapshot === undefined ? {} : { snapshot }),
            ...(profile === undefined ? {} : { profile }),
          });
        } catch (error) {
          if (error instanceof PublicError) sendError(response, error);
          else {
            options.logError?.("Could not prepare SEO article context", error);
            sendError(response, new PublicError(500, "SEO_ARTICLE_ERROR", "The saved research could not be prepared."));
          }
        }
        return;
      }

      if (url.pathname === "/api/seo-article/versions") {
        try {
          if (request.method !== "PUT") {
            sendJson(
              response,
              405,
              { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
              { Allow: "PUT" },
            );
            return;
          }
          const candidate = businessMemoryObject(
            await readRequestBody(request, MAX_SEO_ARTICLE_REQUEST_BYTES),
            "article version",
          );
          const sessionId = validateSessionId(candidate.sessionId);
          const jobId = businessMemoryText(candidate.jobId, "article job ID", 160);
          const job = chatStore.getSeoArticleJob(sessionId, jobId);
          if (job === undefined) {
            throw new PublicError(404, "SEO_ARTICLE_NOT_FOUND", "That article job is not saved for this conversation.");
          }
          const saved = chatStore.saveSeoArticleVersion(
            sessionId,
            jobId,
            articleVersionInput(candidate, job.primaryKeyword, job.domain, job.supportingKeywords),
          );
          sendJson(response, 200, {
            schemaVersion: 1,
            job: saved.job,
            article: {
              versionId: saved.version.versionId,
              versionNumber: saved.version.versionNumber,
              status: saved.version.status,
              metadata: saved.version.metadata,
              warnings: saved.version.warnings,
              reviewStatus: saved.version.reviewStatus,
              qualityReport: saved.version.qualityReport,
              createdAt: saved.version.createdAt,
              downloadUrl: `/api/seo-article/download/${saved.version.downloadToken}.md`,
            },
          });
        } catch (error) {
          if (error instanceof PublicError) sendError(response, error);
          else {
            options.logError?.("Could not save SEO article version", error);
            sendError(response, new PublicError(500, "SEO_ARTICLE_ERROR", "The article could not be saved."));
          }
        }
        return;
      }

      const articleDownload = url.pathname.match(/^\/api\/seo-article\/download\/([A-Za-z0-9_-]{40,60})\.md$/);
      if (articleDownload !== null) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(
            response,
            405,
            { error: { code: "INVALID_REQUEST", message: "That method is not supported." } },
            { Allow: "GET, HEAD" },
          );
          return;
        }
        const token = articleDownload[1] ?? "";
        const version = chatStore.getSeoArticleVersionByDownloadToken(token);
        if (version === undefined) {
          sendError(response, new PublicError(404, "SEO_ARTICLE_NOT_FOUND", "That article download is not available."));
          return;
        }
        const slug = typeof version.metadata.slug === "string" ? version.metadata.slug : "seo-article";
        if (request.method === "HEAD") {
          response.writeHead(200, {
            ...SECURITY_HEADERS,
            "Cache-Control": "no-store",
            "Content-Type": "text/markdown; charset=utf-8",
          });
          response.end();
          return;
        }
        sendMarkdown(response, version.markdown, `${slug}.md`);
        return;
      }

      if (url.pathname === "/api/paid-domain-research") {
        try {
          if (request.method === "GET") {
            const requestedJobId = url.searchParams.get("jobId");
            const requestedSessionId = url.searchParams.get("sessionId");
            const requestedDomain = url.searchParams.get("domain");
            if (requestedJobId !== null) {
              const sessionId = validateSessionId(requestedSessionId);
              const jobId = businessMemoryText(requestedJobId, "job ID", 160);
              const snapshot = jobId
                ? chatStore.getSeoSnapshotForJob(sessionId, jobId)
                : undefined;
              if (snapshot === undefined) {
                throw new PublicError(
                  404,
                  "RESEARCH_JOB_NOT_FOUND",
                  "That paid research job is not saved for this conversation.",
                );
              }
              sendJson(response, 200, { schemaVersion: 1, snapshot });
              return;
            }
            if (requestedDomain !== null) {
              const domain = validateBusinessDomain(requestedDomain);
              const snapshot = chatStore.getLatestSeoSnapshot(domain);
              const history = chatStore.listSeoSnapshotSummaries(domain, 20);
              const articleBrief = requestedSessionId === null || snapshot === undefined
                ? undefined
                : prepareArticleBrief(
                    chatStore,
                    validateSessionId(requestedSessionId),
                    domain,
                    profileStore === undefined ? emptyProfile() : await profileStore.read(),
                  );
              sendJson(response, 200, {
                schemaVersion: 1,
                ...(snapshot === undefined ? {} : { snapshot }),
                ...(articleBrief === undefined ? {} : { articleBrief }),
                history,
              });
              return;
            }
            if (requestedSessionId !== null) {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "Choose a website before preparing article ideas.",
              );
            }
            sendJson(response, 200, {
              schemaVersion: 1,
              history: chatStore.listSeoSnapshotSummaries(undefined, 50),
            });
            return;
          }
          if (request.method === "PUT") {
            const candidate = businessMemoryObject(
              await readRequestBody(request, MAX_PAID_RESEARCH_REQUEST_BYTES),
              "paid research payload",
            );
            const sessionId = validateSessionId(candidate.sessionId);
            const snapshot = validateSeoSnapshot(candidate.snapshot);
            const memory = candidate.memory === undefined
              ? undefined
              : validateBusinessMemory(candidate.memory);
            const saved = chatStore.savePaidDomainResearchForJob(
              sessionId,
              snapshot,
              memory,
            );
            const articleBrief = snapshot.status === "failed"
              ? undefined
              : prepareArticleBrief(
                  chatStore,
                  sessionId,
                  snapshot.domain,
                  profileStore === undefined ? emptyProfile() : await profileStore.read(),
                );
            sendJson(response, 200, {
              schemaVersion: 1,
              ...saved,
              ...(articleBrief === undefined ? {} : { articleBrief }),
            });
            return;
          }
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET, PUT" },
          );
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not access paid domain research", error);
            sendError(
              response,
              new PublicError(
                500,
                "BUSINESS_MEMORY_ERROR",
                "Paid domain research is not available right now.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/business-memory") {
        try {
          if (request.method === "GET") {
            const requestedDomain = url.searchParams.get("domain");
            const memories = requestedDomain === null
              ? chatStore.listBusinessMemorySummaries(50)
              : [chatStore.getBusinessMemory(validateBusinessDomain(requestedDomain))].filter(
                  (memory) => memory !== undefined,
                );
            sendJson(response, 200, { schemaVersion: 1, memories });
            return;
          }
          if (request.method === "PUT") {
            const body = await readRequestBody(
              request,
              MAX_BUSINESS_MEMORY_REQUEST_BYTES,
            );
            const candidate = businessMemoryObject(body, "payload");
            const sessionId = validateSessionId(candidate.sessionId);
            const memory = chatStore.saveBusinessMemoryForJob(
              sessionId,
              validateBusinessMemory(candidate),
            );
            const data = createArticleBriefData({
              memory,
              profile: profileStore === undefined ? emptyProfile() : await profileStore.read(),
            });
            const articleBrief = data === undefined
              ? undefined
              : chatStore.prepareArticleBrief(
                  sessionId,
                  memory.domain,
                  researchKeyForBrief(data),
                  data,
                );
            sendJson(response, 200, {
              schemaVersion: 1,
              memory,
              ...(articleBrief === undefined ? {} : { articleBrief }),
            });
            return;
          }
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET, PUT" },
          );
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not access saved business research", error);
            sendError(
              response,
              new PublicError(
                500,
                "BUSINESS_MEMORY_ERROR",
                "Saved business research is not available right now.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/conversations/search") {
        if (request.method !== "GET") {
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Search conversations with GET.",
              },
            },
            { Allow: "GET" },
          );
          return;
        }
        try {
          const query = (url.searchParams.get("q") ?? "").trim();
          if (query.length === 0 || query.length > 200) {
            throw new PublicError(
              400,
              "INVALID_REQUEST",
              "Search for between 1 and 200 characters.",
            );
          }
          const limit = queryLimit(url.searchParams.get("limit"), 50, 100);
          sendJson(response, 200, {
            results: chatStore.search(query, limit),
          });
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not search chat history", error);
            sendError(
              response,
              new PublicError(
                500,
                "CHAT_HISTORY_ERROR",
                "Chat history could not be searched. Try again.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/conversations") {
        try {
          if (request.method === "GET") {
            const limit = queryLimit(url.searchParams.get("limit"), 50, 100);
            let page;
            try {
              page = chatStore.listConversations(
                limit,
                url.searchParams.get("cursor") ?? undefined,
              );
            } catch {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "That conversation page is invalid. Refresh and try again.",
              );
            }
            sendJson(response, 200, page);
            return;
          }
          if (request.method === "POST") {
            const body = await readRequestBody(request);
            if (
              typeof body !== "object" ||
              body === null ||
              Array.isArray(body)
            ) {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "The conversation could not be created.",
              );
            }
            const agent = activeAgentFor(
              (body as Record<string, unknown>).agentId,
              agents,
            );
            const conversation = chatStore.createConversation(
              randomUUID(),
              agent.id,
            );
            sendJson(response, 201, { conversation });
            return;
          }
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET, POST" },
          );
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not manage conversations", error);
            sendError(
              response,
              new PublicError(
                500,
                "CHAT_HISTORY_ERROR",
                "Chat history is not available. Restart the local app and try again.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname.startsWith("/api/conversations/")) {
        try {
          const rawId = url.pathname.slice("/api/conversations/".length);
          if (rawId.length === 0 || rawId.includes("/")) {
            throw new PublicError(
              404,
              "CONVERSATION_NOT_FOUND",
              "That conversation could not be found.",
            );
          }
          let conversationId: string;
          try {
            conversationId = validateSessionId(decodeURIComponent(rawId));
          } catch {
            throw new PublicError(
              404,
              "CONVERSATION_NOT_FOUND",
              "That conversation could not be found.",
            );
          }

          if (request.method === "GET") {
            const limit = queryLimit(url.searchParams.get("limit"), 100, 200);
            const rawBefore = url.searchParams.get("before");
            const before = rawBefore === null ? undefined : Number(rawBefore);
            if (
              before !== undefined &&
              (!Number.isSafeInteger(before) || before < 1)
            ) {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "That message page is invalid. Refresh and try again.",
              );
            }
            const page = chatStore.getConversationPage(
              conversationId,
              limit,
              before,
            );
            if (!page) {
              throw new PublicError(
                404,
                "CONVERSATION_NOT_FOUND",
                "That conversation could not be found.",
              );
            }
            sendJson(response, 200, publicConversationPage(page));
            return;
          }

          if (request.method === "PATCH") {
            const body = await readRequestBody(request);
            const rawTitle =
              typeof body === "object" &&
              body !== null &&
              !Array.isArray(body)
                ? (body as Record<string, unknown>).title
                : undefined;
            const title =
              typeof rawTitle === "string"
                ? rawTitle.replace(/\s+/g, " ").trim()
                : "";
            if (title.length === 0 || title.length > 80) {
              throw new PublicError(
                400,
                "INVALID_REQUEST",
                "Conversation titles must be between 1 and 80 characters.",
              );
            }
            const conversation = chatStore.renameConversation(
              conversationId,
              title,
            );
            if (!conversation) {
              throw new PublicError(
                404,
                "CONVERSATION_NOT_FOUND",
                "That conversation could not be found.",
              );
            }
            sendJson(response, 200, { conversation });
            return;
          }

          if (request.method === "DELETE") {
            if (!chatStore.deleteConversation(conversationId)) {
              throw new PublicError(
                404,
                "CONVERSATION_NOT_FOUND",
                "That conversation could not be found.",
              );
            }
            response.writeHead(204, {
              ...SECURITY_HEADERS,
              "Cache-Control": "no-store",
            });
            response.end();
            return;
          }

          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "That method is not supported.",
              },
            },
            { Allow: "GET, PATCH, DELETE" },
          );
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Could not manage conversation", error);
            sendError(
              response,
              new PublicError(
                500,
                "CHAT_HISTORY_ERROR",
                "Chat history is not available. Restart the local app and try again.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/documents/text") {
        if (request.method !== "POST") {
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Add pasted text with POST.",
              },
            },
            { Allow: "POST" },
          );
          return;
        }
        if (!documentStore) {
          sendError(
            response,
            new PublicError(
              503,
              "DOCUMENT_SERVICE_UNAVAILABLE",
              "The local document reader is not configured.",
            ),
          );
          return;
        }

        try {
          await documentStore.cleanupExpired();
          const body = await readRequestBody(
            request,
            MAX_PASTED_CHARACTERS * 4 + 4_096,
          );
          if (
            typeof body !== "object" ||
            body === null ||
            Array.isArray(body)
          ) {
            throw new PublicError(
              400,
              "INVALID_REQUEST",
              "Paste some transcript or document text first.",
            );
          }
          const candidate = body as Record<string, unknown>;
          const sessionId = validateSessionId(candidate.sessionId);
          if (typeof candidate.text !== "string") {
            throw new PublicError(
              400,
              "INVALID_REQUEST",
              "Paste some transcript or document text first.",
            );
          }
          const document = await documentStore.createPastedText(
            sessionId,
            typeof candidate.name === "string"
              ? candidate.name
              : "Pasted transcript",
            candidate.text,
          );
          sendJson(response, 201, { document });
        } catch (error) {
          if (error instanceof DocumentStoreError) {
            sendError(response, asPublicError(error));
          } else if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Unexpected pasted document error", error);
            sendError(
              response,
              new PublicError(
                502,
                "DOCUMENT_ERROR",
                "The pasted text could not be prepared.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/documents") {
        if (request.method !== "POST") {
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Upload documents with POST.",
              },
            },
            { Allow: "POST" },
          );
          return;
        }
        if (!documentStore) {
          sendError(
            response,
            new PublicError(
              503,
              "DOCUMENT_SERVICE_UNAVAILABLE",
              "The local document reader is not configured.",
            ),
          );
          return;
        }

        try {
          await documentStore.cleanupExpired();
          const upload = await readMultipartUpload(request);
          const document = await documentStore.createFile(
            upload.sessionId,
            upload.fileName,
            upload.mimeType,
            upload.buffer,
          );
          sendJson(response, 201, { document });
        } catch (error) {
          if (error instanceof DocumentStoreError) {
            sendError(response, asPublicError(error));
          } else if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Unexpected document upload error", error);
            sendError(
              response,
              new PublicError(
                502,
                "DOCUMENT_ERROR",
                "The document could not be read.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname.startsWith("/api/documents/")) {
        if (request.method !== "DELETE") {
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Remove documents with DELETE.",
              },
            },
            { Allow: "DELETE" },
          );
          return;
        }
        if (!documentStore) {
          sendError(
            response,
            new PublicError(
              503,
              "DOCUMENT_SERVICE_UNAVAILABLE",
              "The local document reader is not configured.",
            ),
          );
          return;
        }

        try {
          const sessionId = validateSessionId(
            url.searchParams.get("sessionId"),
          );
          const id = decodeURIComponent(
            url.pathname.slice("/api/documents/".length),
          );
          await documentStore.remove(sessionId, id);
          response.writeHead(204, {
            ...SECURITY_HEADERS,
            "Cache-Control": "no-store",
          });
          response.end();
        } catch (error) {
          if (error instanceof DocumentStoreError) {
            sendError(response, asPublicError(error));
          } else if (error instanceof PublicError) {
            sendError(response, error);
          } else {
            options.logError?.("Unexpected document removal error", error);
            sendError(
              response,
              new PublicError(
                502,
                "DOCUMENT_ERROR",
                "The document could not be removed.",
              ),
            );
          }
        }
        return;
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          sendJson(
            response,
            405,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Send chat messages with POST.",
              },
            },
            { Allow: "POST" },
          );
          return;
        }

        let durableRequest: ChatRequest | undefined;
        let turnStarted = false;
        try {
          const body = await readRequestBody(request);
          const chatRequest = validateChatRequest(body, agents);
          durableRequest = chatRequest;
          const agent = activeAgentFor(chatRequest.agentId, agents);
          const existing = chatStore.getTurn(
            chatRequest.sessionId,
            chatRequest.requestId,
          );
          if (existing.assistant) {
            sendJson(response, 200, {
              sessionId: chatRequest.sessionId,
              requestId: chatRequest.requestId,
              messageId: existing.assistant.id,
              reply: existing.assistant.content,
              ...(existing.assistant.runId === undefined
                ? {}
                : { runId: existing.assistant.runId }),
            });
            return;
          }
          if (existing.user) {
            throw new PublicError(
              409,
              "REQUEST_IN_PROGRESS",
              existing.user.status === "pending"
                ? "That message is already being processed. Wait for its reply."
                : "That earlier send was interrupted or failed. Send it again as a new message.",
            );
          }
          if (chatRequest.documentIds.length > 0 && !documentStore) {
            throw new PublicError(
              503,
              "DOCUMENT_SERVICE_UNAVAILABLE",
              "The local document reader is not configured.",
            );
          }
          const documents = documentStore
            ? await documentStore.resolveForMessage(
                chatRequest.sessionId,
                chatRequest.documentIds,
              )
            : [];
          chatStore.beginTurn({
            conversationId: chatRequest.sessionId,
            agentId: chatRequest.agentId,
            requestId: chatRequest.requestId,
            content: chatRequest.message,
            attachments: documents.map(attachmentSnapshot),
          });
          turnStarted = true;
          const history = chatStore.getHistory(chatRequest.sessionId);
          const chatResponse = await callAgent(
            chatRequest,
            agent,
            documents,
            history,
            {
              fetchImplementation,
              timeoutMs,
              upstreamUrl: options.upstreamUrl,
            },
          );
          const completed = chatStore.completeTurn({
            conversationId: chatRequest.sessionId,
            requestId: chatRequest.requestId,
            content: chatResponse.reply,
            ...(chatResponse.runId === undefined
              ? {}
              : { runId: chatResponse.runId }),
          });
          if (!completed.assistant) {
            throw new Error("Stored assistant reply could not be read");
          }
          sendJson(response, 200, {
            ...chatResponse,
            requestId: chatRequest.requestId,
            messageId: completed.assistant.id,
          });
        } catch (error) {
          const publicError =
            error instanceof DocumentStoreError
              ? asPublicError(error)
              : error instanceof PublicError
                ? error
                : undefined;
          if (turnStarted && durableRequest) {
            try {
              chatStore.failTurn(
                durableRequest.sessionId,
                durableRequest.requestId,
                publicError?.code ?? "AGENT_ERROR",
              );
            } catch (storeError) {
              options.logError?.("Could not mark failed chat turn", storeError);
            }
          }
          if (error instanceof DocumentStoreError) {
            sendError(response, publicError as PublicError);
            return;
          } else if (error instanceof PublicError) {
            sendError(response, error);
            return;
          }
          options.logError?.("Unexpected chat gateway error", error);
          sendError(
            response,
            new PublicError(
              502,
              "AGENT_ERROR",
              "The agent could not complete that request. Check the n8n workflow and try again.",
            ),
          );
        }
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          ...SECURITY_HEADERS,
          Allow: "GET, HEAD",
        });
        response.end("Method not allowed");
        return;
      }

      await serveStaticFile(
        request,
        response,
        options.publicDirectory,
        url.pathname,
      );
    })().catch((error: unknown) => {
      options.logError?.("Unexpected request error", error);
      if (!response.headersSent) {
        sendError(
          response,
          new PublicError(
            502,
            "AGENT_ERROR",
            "The chat service hit an unexpected problem. Try again.",
          ),
        );
      } else {
        response.destroy();
      }
    });
  };
}

export function createChatServer(options: ChatGatewayOptions): Server {
  const ownsChatStore = options.chatStore === undefined;
  const chatStore = options.chatStore ?? new ChatStore(":memory:");
  const server = createServer(createChatHandler({ ...options, chatStore }));
  if (ownsChatStore) {
    server.once("close", () => chatStore.close());
  }
  return server;
}
