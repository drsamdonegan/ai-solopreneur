export type ArticleTopicSource = "custom" | "numbered_idea" | "choose_best";

export const SEO_ARTICLE_RESEARCH_COST_LIMIT_USD = 0.15;

export const SEO_ARTICLE_STAGE_ORDER = {
  queued: 0,
  loading_context: 1,
  researching_keywords: 2,
  choosing_strategy: 3,
  finding_sources: 4,
  drafting: 5,
  checking_claims: 6,
  repairing: 7,
  saving: 8,
  ready_for_review: 9,
  failed: 10,
  interrupted: 10,
} as const;

export type SeoArticleStage = keyof typeof SEO_ARTICLE_STAGE_ORDER;

export function isSeoArticleStage(value: unknown): value is SeoArticleStage {
  return typeof value === "string" && value in SEO_ARTICLE_STAGE_ORDER;
}

export type ArticleStrategyEvidenceSource =
  | "fresh_saved_snapshot"
  | "topic_specific_paid_research"
  | "saved_or_free_fallback";

export interface ArticleKeywordCandidate {
  keyword: string;
  intent?: string;
  searchVolume?: number;
  difficulty?: number;
  relevance?: number;
  source?: string;
  language?: string;
  market?: string;
  serpFormatMatch?: number;
}

export interface ArticleStrategyKeyword {
  keyword: string;
  intent: string;
  searchVolume?: number;
  difficulty?: number;
  source: string;
  score: number;
}

export interface ArticleTopicStrategy {
  schemaVersion: 1;
  requestedTopic: string;
  primaryKeyword: string;
  supportingKeywords: ArticleStrategyKeyword[];
  searchIntent: string;
  titleAngle: string;
  rationale: string;
  evidenceSource: ArticleStrategyEvidenceSource;
  market: string;
  language: string;
  candidateCount: number;
  actualCostUsd: number;
  capturedAt: string;
  warnings: string[];
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does",
  "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to",
  "what", "when", "where", "which", "who", "why", "with", "simple", "terms",
  "beginner", "beginners", "explained", "guide",
]);

const QUESTION_START = /^(?:how|what|why|when|where|which|who|can|should|is|are|does|do)\b/i;
const QUESTION_EQUIVALENT = /\b(?:definition|meaning|explained|explanation|guide)\b/i;
const LOCAL_INTENT = /\b(?:near me|nearby|local)\b/i;

function cleanText(value: unknown, maximum = 300): string {
  return typeof value === "string"
    ? value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(value: string): Set<string> {
  return new Set(
    comparable(value)
      .split(" ")
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(left.size, right.size);
}

function inferredIntent(topic: string): string {
  if (QUESTION_START.test(topic)) return "informational";
  if (/\b(?:buy|pricing|price|cost|service|software|tool|platform)\b/i.test(topic)) {
    return "commercial";
  }
  return "informational";
}

function requiredQualifiers(topic: string): string[] {
  const normalized = comparable(topic);
  const qualifiers: string[] = [];
  // "In simple terms" describes the writing treatment, so it belongs in the
  // immutable title angle rather than being required in the measured keyword.
  for (const match of normalized.matchAll(/\bin (?:australia|melbourne|victoria|sydney|brisbane|perth|adelaide|tasmania|canada|new zealand|united kingdom|united states)\b/g)) {
    qualifiers.push(match[0].trim());
  }
  const audience = topic.toLowerCase().match(
    /\bfor (?!beginners?\b)([a-z0-9]+(?:\s+[a-z0-9]+){0,3})(?=\s*[:?,.!]|$)/,
  );
  if (audience?.[0]) qualifiers.push(audience[0].trim());
  return qualifiers;
}

function sameIntent(topic: string, candidate: string, candidateIntent: string): boolean {
  if (candidateIntent === "navigational") return false;
  if (QUESTION_START.test(topic) && !QUESTION_START.test(candidate) && !QUESTION_EQUIVALENT.test(candidate)) {
    return false;
  }
  if (!LOCAL_INTENT.test(topic) && LOCAL_INTENT.test(candidate)) return false;
  const normalizedCandidate = comparable(candidate);
  if (requiredQualifiers(topic).some((qualifier) => !normalizedCandidate.includes(qualifier))) {
    return false;
  }
  return true;
}

function optionalNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function normalizeCandidate(value: ArticleKeywordCandidate): Required<Pick<ArticleKeywordCandidate, "keyword">> & ArticleKeywordCandidate {
  const keyword = cleanText(value.keyword, 200).toLowerCase();
  const searchVolume = optionalNumber(value.searchVolume, 0, 1_000_000_000);
  const difficulty = optionalNumber(value.difficulty, 0, 100);
  return {
    keyword,
    intent: cleanText(value.intent, 40).toLowerCase() || "unknown",
    ...(searchVolume === undefined ? {} : { searchVolume }),
    ...(difficulty === undefined ? {} : { difficulty }),
    relevance: optionalNumber(value.relevance, 0, 1) ?? 0.5,
    source: cleanText(value.source, 80) || "unknown",
    language: cleanText(value.language, 20).toLowerCase(),
    market: cleanText(value.market, 80).toLowerCase(),
    serpFormatMatch: optionalNumber(value.serpFormatMatch, 0, 1) ?? 0.5,
  };
}

function titleForTopic(topic: string): string {
  const cleaned = cleanText(topic, 240).replace(/[.!]+$/, "");
  if (!cleaned) return "";
  const title = `${cleaned[0]?.toUpperCase() ?? ""}${cleaned.slice(1)}`;
  return QUESTION_START.test(cleaned) ? `${title.replace(/\?+$/, "")}?` : title;
}

export function buildArticleTopicStrategy(input: {
  requestedTopic: string;
  candidates: ArticleKeywordCandidate[];
  evidenceSource: ArticleStrategyEvidenceSource;
  market?: string;
  language?: string;
  actualCostUsd?: number;
  capturedAt?: string;
  warnings?: string[];
  excludedMeanings?: string[];
}): ArticleTopicStrategy {
  const requestedTopic = cleanText(input.requestedTopic, 240);
  if (!requestedTopic) throw new Error("Article strategy requires the requested topic");
  const topicTokens = contentTokens(requestedTopic);
  if (topicTokens.size === 0) throw new Error("Article topic is too vague to research");
  const market = cleanText(input.market, 80) || "Australia";
  const language = cleanText(input.language, 20).toLowerCase() || "en";
  const expectedIntent = inferredIntent(requestedTopic);
  const exclusions = (input.excludedMeanings ?? [])
    .map((value) => comparable(cleanText(value, 160)))
    .filter(Boolean);

  const unique = new Map<string, ReturnType<typeof normalizeCandidate>>();
  for (const raw of input.candidates.slice(0, 500)) {
    const candidate = normalizeCandidate(raw);
    const key = comparable(candidate.keyword);
    if (!key || exclusions.some((excluded) => key.includes(excluded))) continue;
    if (candidate.language && candidate.language !== language) continue;
    if (candidate.market && candidate.market !== market.toLowerCase()) continue;
    if (!sameIntent(requestedTopic, candidate.keyword, candidate.intent ?? "unknown")) continue;
    const fidelity = overlapScore(topicTokens, contentTokens(candidate.keyword));
    if (fidelity < 0.6) continue;
    const previous = unique.get(key);
    if (
      previous === undefined ||
      Number(candidate.searchVolume ?? -1) > Number(previous.searchVolume ?? -1) ||
      Number(candidate.relevance ?? 0) > Number(previous.relevance ?? 0)
    ) {
      unique.set(key, candidate);
    }
  }

  const requestedKey = comparable(requestedTopic);
  if (!unique.has(requestedKey)) {
    unique.set(requestedKey, normalizeCandidate({
      keyword: requestedTopic,
      intent: expectedIntent,
      relevance: 1,
      source: "requested_topic",
      language,
      market,
      serpFormatMatch: 1,
    }));
  }

  const candidates = [...unique.values()];
  const maximumLogVolume = Math.max(
    1,
    ...candidates.map((candidate) => Math.log1p(candidate.searchVolume ?? 0)),
  );
  const scored = candidates.map((candidate) => {
    const fidelity = overlapScore(topicTokens, contentTokens(candidate.keyword));
    const intent = candidate.intent === expectedIntent
      ? 1
      : candidate.intent === "unknown" ? 0.65 : 0.35;
    const relevance = candidate.relevance ?? 0.5;
    const attainability = candidate.difficulty === undefined
      ? 0.5
      : 1 - candidate.difficulty / 100;
    const volume = Math.log1p(candidate.searchVolume ?? 0) / maximumLogVolume;
    const serp = candidate.serpFormatMatch ?? 0.5;
    const score = fidelity * 0.35 + intent * 0.20 + relevance * 0.15 +
      attainability * 0.15 + volume * 0.10 + serp * 0.05;
    return { candidate, score: Number(score.toFixed(4)) };
  }).sort((left, right) =>
    right.score - left.score ||
    Number(right.candidate.searchVolume ?? -1) - Number(left.candidate.searchVolume ?? -1) ||
    left.candidate.keyword.localeCompare(right.candidate.keyword),
  );

  const primary = scored[0];
  if (primary === undefined) throw new Error("No relevant article keyword was available");
  const toStored = (entry: typeof primary): ArticleStrategyKeyword => ({
    keyword: entry.candidate.keyword,
    intent: entry.candidate.intent ?? "unknown",
    ...(entry.candidate.searchVolume === undefined ? {} : { searchVolume: entry.candidate.searchVolume }),
    ...(entry.candidate.difficulty === undefined ? {} : { difficulty: entry.candidate.difficulty }),
    source: entry.candidate.source ?? "unknown",
    score: entry.score,
  });
  const supportingKeywords = scored
    .slice(1)
    .filter((entry) => entry.candidate.keyword !== primary.candidate.keyword)
    .slice(0, 8)
    .map(toStored);
  const warnings = (input.warnings ?? [])
    .map((value) => cleanText(value, 1_000))
    .filter(Boolean)
    .slice(0, 40);
  const actualCostUsd = Number(input.actualCostUsd ?? 0);
  if (
    !Number.isFinite(actualCostUsd) ||
    actualCostUsd < 0 ||
    actualCostUsd > SEO_ARTICLE_RESEARCH_COST_LIMIT_USD
  ) {
    throw new Error("Article strategy cost exceeds the reviewed research ceiling");
  }
  const measured = primary.candidate.searchVolume !== undefined || primary.candidate.difficulty !== undefined;

  return {
    schemaVersion: 1,
    requestedTopic,
    primaryKeyword: primary.candidate.keyword,
    supportingKeywords,
    searchIntent: expectedIntent,
    titleAngle: titleForTopic(requestedTopic),
    rationale: measured
      ? "Chosen for close topic and intent fit, business relevance, measured demand, and attainable competition."
      : "Kept close to the requested topic because reliable demand or difficulty data was unavailable.",
    evidenceSource: input.evidenceSource,
    market,
    language,
    candidateCount: candidates.length,
    actualCostUsd: Number(actualCostUsd.toFixed(6)),
    capturedAt: input.capturedAt && !Number.isNaN(Date.parse(input.capturedAt))
      ? new Date(input.capturedAt).toISOString()
      : new Date().toISOString(),
    warnings,
  };
}

export function articleStrategyPreservesTopic(strategy: ArticleTopicStrategy): boolean {
  const requested = cleanText(strategy.requestedTopic, 240);
  const primary = cleanText(strategy.primaryKeyword, 200);
  if (!requested || !primary) return false;
  return sameIntent(requested, primary, strategy.searchIntent) &&
    overlapScore(contentTokens(requested), contentTokens(primary)) >= 0.6;
}
