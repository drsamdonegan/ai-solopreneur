import type {
  BusinessMemoryRecord,
  SeoSnapshotRecord,
} from "./chat-store.js";
import type { AgentProfile } from "./profile.js";

export type ArticleBriefStatus =
  | "choosing"
  | "needs_details"
  | "writing"
  | "complete"
  | "failed";

export type ArticleContextSource =
  | "current_request"
  | "saved_profile"
  | "official_website"
  | "default"
  | "not_stated";

export interface ArticleOpportunity {
  number: number;
  title: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  intent: string;
  searchVolume?: number;
  competition: "Low" | "Medium" | "High" | "Not measured";
  reason: string;
}

export interface ArticleContextValue {
  value: string;
  source: ArticleContextSource;
}

export interface ArticleBusinessContext {
  who: ArticleContextValue;
  offer: ArticleContextValue;
  price: ArticleContextValue;
  boundaries: ArticleContextValue;
  voice: ArticleContextValue;
}

export interface ArticleBriefResearch {
  source: "paid" | "free";
  snapshotId?: string;
  memoryJobId?: string;
  capturedAt: string;
  status: "completed" | "partial";
  companyOverview: string;
  profile: Record<string, unknown>;
  offeringProfile: Record<string, unknown>;
  selectedKeywords: Array<Record<string, unknown>>;
  keywordCandidates: Array<Record<string, unknown>>;
  serpEvidence: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  warnings: string[];
}

export interface ArticleBriefData {
  schemaVersion: 1;
  research: ArticleBriefResearch;
  opportunities: ArticleOpportunity[];
  context: ArticleBusinessContext;
  selection?: ArticleOpportunity;
  missingFields: string[];
  linkedJobId?: string;
}

export interface ArticleBriefRecord extends ArticleBriefData {
  briefId: string;
  sessionId: string;
  domain: string;
  researchKey: string;
  status: ArticleBriefStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleContextOverrides {
  who?: string;
  offer?: string;
  price?: string;
  boundaries?: string;
  voice?: string;
}

interface Candidate {
  keyword: string;
  intent: string;
  searchVolume?: number;
  difficulty?: number;
  relevance: number;
}

const DEFAULT_VOICE = "Simple, clear, friendly, conversational and jargon-free.";

function text(value: unknown, maximum = 1_000): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function firstText(value: unknown): string {
  if (typeof value === "string") return text(value);
  if (!Array.isArray(value)) return "";
  return value.map((item) => text(item)).find(Boolean) ?? "";
}

function candidateFrom(value: Record<string, unknown>): Candidate | undefined {
  const keyword = text(value.keyword ?? value.term ?? value.name, 200).toLowerCase();
  if (keyword.length < 2) return undefined;
  const volume = Number(value.searchVolume ?? value.search_volume);
  const difficulty = Number(value.difficulty ?? value.keywordDifficulty);
  const relevance = Number(value.relevance ?? value.lexicalFit ?? 0.5);
  return {
    keyword,
    intent: text(value.intent, 40).toLowerCase() || "informational",
    ...(Number.isFinite(volume) && volume >= 0 ? { searchVolume: volume } : {}),
    ...(Number.isFinite(difficulty) && difficulty >= 0 ? { difficulty } : {}),
    relevance: Number.isFinite(relevance) ? relevance : 0.5,
  };
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function titleFor(candidate: Candidate): string {
  const keyword = sentenceCase(candidate.keyword);
  if (/^(how|what|why|when|where|which|can|should|is|are)\b/.test(candidate.keyword)) {
    return `${keyword.replace(/[?.!]+$/, "")}?`;
  }
  if (/commercial|transaction/.test(candidate.intent)) {
    return `${keyword}: what to know before you choose`;
  }
  return `${keyword}: a practical guide`;
}

function competitionFor(difficulty?: number): ArticleOpportunity["competition"] {
  if (difficulty === undefined) return "Not measured";
  if (difficulty <= 30) return "Low";
  if (difficulty <= 60) return "Medium";
  return "High";
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  const shared = [...a].filter((token) => b.has(token)).length;
  const total = new Set([...a, ...b]).size;
  return total === 0 ? 0 : shared / total;
}

function makeOpportunities(
  snapshot: SeoSnapshotRecord | undefined,
  memory: BusinessMemoryRecord | undefined,
): ArticleOpportunity[] {
  const raw: Array<Record<string, unknown>> = [
    ...(snapshot?.selectedKeywords ?? []),
    ...(snapshot?.keywordCandidates ?? []),
    ...(memory?.keywordCandidates ?? []),
    ...(memory?.seedKeywords ?? []).map((keyword) => ({ keyword, relevance: 0.4 })),
  ];
  const unique = new Map<string, Candidate>();
  for (const item of raw) {
    const candidate = candidateFrom(item);
    if (candidate === undefined || candidate.intent === "navigational") continue;
    const previous = unique.get(candidate.keyword);
    if (
      previous === undefined ||
      candidate.relevance > previous.relevance ||
      (candidate.searchVolume ?? 0) > (previous.searchVolume ?? 0)
    ) {
      unique.set(candidate.keyword, candidate);
    }
  }
  const ranked = [...unique.values()].sort(
    (left, right) =>
      right.relevance - left.relevance ||
      (right.searchVolume ?? 0) - (left.searchVolume ?? 0) ||
      (left.difficulty ?? 100) - (right.difficulty ?? 100),
  );
  const chosen: Candidate[] = [];
  for (const candidate of ranked) {
    if (chosen.some((existing) => similarity(existing.keyword, candidate.keyword) >= 0.65)) {
      continue;
    }
    chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  return chosen.map((candidate, index) => ({
    number: index + 1,
    title: titleFor(candidate),
    primaryKeyword: candidate.keyword,
    supportingKeywords: ranked
      .filter(
        (other) =>
          other.keyword !== candidate.keyword &&
          similarity(other.keyword, candidate.keyword) >= 0.35,
      )
      .slice(0, 5)
      .map((other) => other.keyword),
    intent: candidate.intent,
    ...(candidate.searchVolume === undefined ? {} : { searchVolume: candidate.searchVolume }),
    competition: competitionFor(candidate.difficulty),
    reason:
      candidate.searchVolume !== undefined && candidate.searchVolume > 0
        ? "A strong match for the business with measured search interest."
        : "A clear match for the business and the saved research.",
  }));
}

function profileValue(value: string): ArticleContextValue {
  return value
    ? { value, source: "saved_profile" }
    : { value: "", source: "not_stated" };
}

function inferredValue(value: string): ArticleContextValue {
  return value
    ? { value, source: "official_website" }
    : { value: "", source: "not_stated" };
}

function contextFromResearch(
  research: Pick<ArticleBriefResearch, "profile" | "offeringProfile" | "companyOverview">,
  profile: AgentProfile,
): ArticleBusinessContext {
  const websiteProfile = Object.keys(research.offeringProfile).length > 0
    ? research.offeringProfile
    : research.profile;
  const inferredWho =
    firstText(websiteProfile.audiences) ||
    firstText(websiteProfile.audience);
  const inferredOffer =
    text(websiteProfile.offeringSummary) ||
    text(websiteProfile.offering) ||
    text(research.companyOverview);
  return {
    who: profile.whoYouServe
      ? profileValue(profile.whoYouServe)
      : inferredValue(inferredWho),
    offer: profile.offer
      ? profileValue(profile.offer)
      : inferredValue(inferredOffer),
    price: profileValue(profile.price),
    boundaries: profileValue(profile.boundaries),
    voice: profile.voice
      ? profileValue(profile.voice)
      : { value: DEFAULT_VOICE, source: "default" },
  };
}

export function createArticleBriefData(input: {
  snapshot?: SeoSnapshotRecord;
  memory?: BusinessMemoryRecord;
  profile: AgentProfile;
}): ArticleBriefData | undefined {
  const { snapshot, memory, profile } = input;
  if (snapshot === undefined && memory === undefined) return undefined;
  const source = snapshot === undefined ? "free" : "paid";
  const research: ArticleBriefResearch = {
    source,
    ...(snapshot === undefined ? {} : { snapshotId: snapshot.snapshotId }),
    ...(memory === undefined ? {} : { memoryJobId: memory.jobId }),
    capturedAt: snapshot?.capturedAt ?? memory?.researchedAt ?? new Date().toISOString(),
    status:
      snapshot?.status === "completed"
        ? "completed"
        : snapshot?.status === "partial"
          ? "partial"
          : memory?.status ?? "partial",
    companyOverview: text(memory?.companyOverview, 20_000),
    profile: memory?.profile ?? {},
    offeringProfile: snapshot?.offeringProfile ?? {},
    selectedKeywords: (snapshot?.selectedKeywords ?? []).slice(0, 40),
    keywordCandidates: (
      snapshot?.keywordCandidates ??
      memory?.keywordCandidates ??
      []
    ).slice(0, 80),
    serpEvidence: (snapshot?.serpEvidence ?? []).slice(0, 40),
    sources: [...(snapshot?.sources ?? []), ...(memory?.sources ?? [])].slice(0, 120),
    warnings: [...(snapshot?.warnings ?? []), ...(memory?.warnings ?? [])].slice(0, 40),
  };
  const context = contextFromResearch(research, profile);
  return {
    schemaVersion: 1,
    research,
    opportunities: makeOpportunities(snapshot, memory),
    context,
    missingFields: [
      ...(context.who.value ? [] : ["who"]),
      ...(context.offer.value ? [] : ["offer"]),
    ],
  };
}

export function refreshArticleBriefContext(
  brief: ArticleBriefRecord,
  profile: AgentProfile,
): { context: ArticleBusinessContext; missingFields: string[] } {
  const refreshed = contextFromResearch(brief.research, profile);
  for (const field of ["who", "offer", "price", "boundaries", "voice"] as const) {
    if (brief.context[field].source === "current_request") {
      refreshed[field] = brief.context[field];
    }
  }
  const missingFields = brief.selection === undefined
    ? [
        ...(refreshed.who.value ? [] : ["who"]),
        ...(refreshed.offer.value ? [] : ["offer"]),
      ]
    : [
        ...(refreshed.who.value ? [] : ["who"]),
        ...(refreshed.offer.value ? [] : ["offer"]),
        ...(requiresPrice(brief.selection.primaryKeyword) && !refreshed.price.value
          ? ["price"]
          : []),
        ...(requiresBoundaries(brief.selection.primaryKeyword) && !refreshed.boundaries.value
          ? ["boundaries"]
          : []),
      ];
  return { context: refreshed, missingFields };
}

export function requiresPrice(primaryKeyword: string): boolean {
  return /\b(price|prices|pricing|cost|costs|fee|fees|rate|rates|package|packages|quote|quotes|how much)\b/i.test(
    primaryKeyword,
  );
}

export function requiresBoundaries(primaryKeyword: string): boolean {
  return /\b(guarantee|promise|best|versus|vs|compare|comparison|legal|medical|financial|finance|tax|investment|health|safety|advice)\b/i.test(
    primaryKeyword,
  );
}

export function selectArticleOpportunity(
  brief: ArticleBriefRecord,
  input: {
    primaryKeyword?: string;
    selectionNumber?: number;
    chooseBest?: boolean;
  },
): ArticleOpportunity | undefined {
  const primaryKeyword = text(input.primaryKeyword, 200).toLowerCase();
  if (primaryKeyword) {
    const existing = brief.opportunities.find(
      (opportunity) => opportunity.primaryKeyword.toLowerCase() === primaryKeyword,
    );
    return existing ?? {
      number: 0,
      title: titleFor({ keyword: primaryKeyword, intent: "informational", relevance: 1 }),
      primaryKeyword,
      supportingKeywords: [],
      intent: "informational",
      competition: "Not measured",
      reason: "This is the topic you asked for.",
    };
  }
  if (Number.isInteger(input.selectionNumber) && Number(input.selectionNumber) > 0) {
    return brief.opportunities.find(
      (opportunity) => opportunity.number === Number(input.selectionNumber),
    );
  }
  if (input.chooseBest === true) return brief.opportunities[0];
  return brief.selection;
}

export function resolveArticleContext(
  brief: ArticleBriefRecord,
  opportunity: ArticleOpportunity,
  overrides: ArticleContextOverrides,
): { context: ArticleBusinessContext; missingFields: string[] } {
  const use = (
    current: ArticleContextValue,
    supplied: string | undefined,
  ): ArticleContextValue => {
    const value = text(supplied);
    return value ? { value, source: "current_request" } : current;
  };
  const context: ArticleBusinessContext = {
    who: use(brief.context.who, overrides.who),
    offer: use(brief.context.offer, overrides.offer),
    price: use(brief.context.price, overrides.price),
    boundaries: use(brief.context.boundaries, overrides.boundaries),
    voice: use(brief.context.voice, overrides.voice),
  };
  const missingFields = [
    ...(context.who.value ? [] : ["who"]),
    ...(context.offer.value ? [] : ["offer"]),
    ...(requiresPrice(opportunity.primaryKeyword) && !context.price.value ? ["price"] : []),
    ...(requiresBoundaries(opportunity.primaryKeyword) && !context.boundaries.value
      ? ["boundaries"]
      : []),
  ];
  return { context, missingFields };
}
