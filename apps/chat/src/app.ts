import { randomUUID } from "node:crypto";
import { lookup } from "node:dns";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { basename, extname, resolve, sep } from "node:path";
import Busboy from "busboy";
import {
  DEFAULT_AGENTS,
  publicAgentDefinitions,
  type AgentDefinition,
} from "./agents.js";
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
  type SeoSnapshotInput,
  type StoredAttachment,
} from "./chat-store.js";
import { ProfileStore, ProfileValidationError } from "./profile.js";

const MAX_MESSAGE_LENGTH = 8_000;
// A saved picture is base64 inside the JSON body, so this endpoint alone needs
// more room than the 64 KB used by every other request.
const MAX_PROFILE_REQUEST_BYTES = 512 * 1_024;
const MAX_BUSINESS_MEMORY_REQUEST_BYTES = 256 * 1_024;
const MAX_PAID_RESEARCH_REQUEST_BYTES = 1_024 * 1_024;
const MAX_PUBLIC_PAGE_BYTES = 512 * 1_024;
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

function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    const c = octets[2] ?? -1;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family === 6) {
    const normalised = address.toLowerCase();
    // Permit only global unicast IPv6 and exclude the documentation prefix.
    return /^[23]/.test(normalised) && !normalised.startsWith("2001:db8:");
  }
  return false;
}

interface PublicDomainPage {
  url: string;
  statusCode: number;
  text: string;
  truncated: boolean;
}

async function fetchPublicDomainPage(domain: string): Promise<PublicDomainPage> {
  const safeLookup: LookupFunction = (hostname, options, callback) => {
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const requestedFamily = Number(options.family ?? 0);
      // Reject mixed public/private answers instead of selecting the safe-looking one.
      if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
        const lookupError = new Error("Domain resolved to a non-public address") as NodeJS.ErrnoException;
        lookupError.code = "ENETUNREACH";
        callback(lookupError, "", 0);
        return;
      }
      const compatible = addresses.filter(
        (entry) => requestedFamily === 0 || entry.family === requestedFamily,
      );
      if (compatible.length === 0) {
        callback(new Error("Domain has no usable public address"), "", 0);
        return;
      }
      if (options.all) {
        callback(null, compatible);
      } else {
        const selected = compatible[0];
        if (selected === undefined) {
          callback(new Error("Domain has no usable public address"), "", 0);
          return;
        }
        callback(null, selected.address, selected.family);
      }
    });
  };

  const readOnce = async (url: URL): Promise<{
    statusCode: number;
    location?: string;
    text: string;
    truncated: boolean;
  }> => await new Promise((resolvePage, rejectPage) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "User-Agent": "AI-Solopreneur-Domain-Research/1.0",
        },
        lookup: safeLookup,
        timeout: 15_000,
      },
      (upstream) => {
        const statusCode = upstream.statusCode ?? 0;
        const location = upstream.headers.location;
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          upstream.resume();
          resolvePage({ statusCode, location, text: "", truncated: false });
          return;
        }
        const contentType = String(upstream.headers["content-type"] ?? "");
        if (!/^(?:text\/|application\/xhtml\+xml)/i.test(contentType)) {
          upstream.resume();
          resolvePage({ statusCode, text: "", truncated: false });
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        upstream.on("data", (rawChunk: Buffer | string) => {
          if (truncated) return;
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          const remaining = MAX_PUBLIC_PAGE_BYTES - bytes;
          if (chunk.length > remaining) {
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            bytes = MAX_PUBLIC_PAGE_BYTES;
            truncated = true;
            resolvePage({
              statusCode,
              text: Buffer.concat(chunks).toString("utf8"),
              truncated: true,
            });
            upstream.destroy();
            return;
          }
          chunks.push(chunk);
          bytes += chunk.length;
        });
        upstream.on("end", () => {
          resolvePage({
            statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        });
        upstream.on("error", rejectPage);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Public page request timed out")));
    request.on("error", rejectPage);
    request.end();
  });

  let current = new URL(`https://${domain}/`);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const page = await readOnce(current);
    if (page.location === undefined) {
      return {
        url: current.toString(),
        statusCode: page.statusCode,
        text: page.text,
        truncated: page.truncated,
      };
    }
    if (redirects === 3) throw new Error("Public page redirected too many times");
    const next = new URL(page.location, current);
    const nextDomain = next.hostname.toLowerCase().replace(/^www\./, "");
    if (
      next.protocol !== "https:" ||
      next.username !== "" ||
      next.password !== "" ||
      (next.port !== "" && next.port !== "443") ||
      validateBusinessDomain(nextDomain) !== domain
    ) {
      throw new Error("Public page redirected outside the authorised domain");
    }
    current = next;
  }
  throw new Error("Public page could not be read");
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
        sendJson(response, 200, {
          schemaVersion: 1,
          agents: publicAgentDefinitions(agents),
        });
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
              schemaVersion: 1,
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
            sendJson(response, 200, { schemaVersion: 1, profile: saved });
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

      if (url.pathname === "/api/paid-domain-research") {
        try {
          if (request.method === "GET") {
            const requestedJobId = url.searchParams.get("jobId");
            const requestedSessionId = url.searchParams.get("sessionId");
            const requestedDomain = url.searchParams.get("domain");
            if (requestedJobId !== null || requestedSessionId !== null) {
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
              sendJson(response, 200, {
                schemaVersion: 1,
                ...(snapshot === undefined ? {} : { snapshot }),
                history,
              });
              return;
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
            sendJson(response, 200, { schemaVersion: 1, ...saved });
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
            sendJson(response, 200, { schemaVersion: 1, memory });
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
