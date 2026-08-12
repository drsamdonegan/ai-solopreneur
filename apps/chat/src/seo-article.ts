import { evaluateArticleQuality, type ArticleClaim, type ArticleQualityReport } from "./article-quality.js";

export type SeoArticleJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "interrupted";

export interface SeoArticleFaq {
  question: string;
  answer: string;
}

export interface SeoArticleSource {
  id: string;
  url: string;
  title: string;
  excerpt: string;
}

export interface SeoArticleResultInput {
  status: "completed" | "partial";
  stage: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  canonicalSuggestion: string;
  markdown: string;
  structuredData: Record<string, unknown>;
  plan: Record<string, unknown>;
  keywordMap: Array<Record<string, unknown>>;
  answerBlocks: Array<Record<string, unknown>>;
  faq: SeoArticleFaq[];
  sources: SeoArticleSource[];
  claims: ArticleClaim[];
  warnings: string[];
  reviewStatus: "ready_for_review";
  model: string;
}

export interface ValidatedSeoArticleResult extends SeoArticleResultInput {
  qualityReport: ArticleQualityReport;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${field}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number, required = true): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`Invalid ${field}`);
  const cleaned = value.trim();
  if (required && cleaned.length === 0) throw new Error(`Invalid ${field}`);
  return cleaned;
}

function objectArray(value: unknown, field: string, maximum: number): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Invalid ${field}`);
  return value.map((item) => object(item, field));
}

function stringArray(value: unknown, field: string, maximum: number, itemMaximum: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    !value.every((item) => typeof item === "string" && item.length <= itemMaximum)
  ) throw new Error(`Invalid ${field}`);
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function validateFaq(value: unknown): SeoArticleFaq[] {
  return objectArray(value, "FAQ", 12).map((item) => ({
    question: text(item.question, "FAQ question", 300),
    answer: text(item.answer, "FAQ answer", 2_000),
  }));
}

function validateSources(value: unknown): SeoArticleSource[] {
  return objectArray(value, "sources", 20).map((item) => {
    const url = text(item.url, "source URL", 2_000);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Invalid source URL");
    return {
      id: text(item.id, "source ID", 80),
      url,
      title: text(item.title, "source title", 500, false),
      excerpt: text(item.excerpt, "source excerpt", 2_000),
    };
  });
}

function validateClaims(value: unknown): ArticleClaim[] {
  return objectArray(value, "claim ledger", 160).map((item) => {
    if (!(item.support === "entailed" || item.support === "partial" || item.support === "unsupported")) {
      throw new Error("Invalid claim support");
    }
    const sourceIds = stringArray(item.sourceIds, "claim source IDs", 12, 80);
    const excerpts = stringArray(item.excerpts, "claim excerpts", 12, 2_000);
    if (sourceIds.length === 0 || excerpts.length === 0) throw new Error("Claim evidence is missing");
    return {
      sentence: text(item.sentence, "claim sentence", 2_000),
      sourceIds,
      excerpts,
      support: item.support,
      repairAction: text(item.repairAction, "claim repair action", 1_000, false),
    };
  });
}

export function validateSeoArticleResult(
  value: unknown,
  primaryKeyword: string,
): ValidatedSeoArticleResult {
  const candidate = object(value, "article result");
  if (candidate.status !== "completed" && candidate.status !== "partial") {
    throw new Error("Invalid article status");
  }
  if (candidate.reviewStatus !== "ready_for_review") throw new Error("Invalid review status");
  const faq = validateFaq(candidate.faq);
  const structuredData = object(candidate.structuredData, "structured data");
  const faqPage = structuredData.faqPage;
  const faqJsonLdCount = Array.isArray(faqPage)
    ? faqPage.length
    : typeof faqPage === "object" && faqPage !== null && !Array.isArray(faqPage)
      ? Array.isArray((faqPage as Record<string, unknown>).mainEntity)
        ? ((faqPage as Record<string, unknown>).mainEntity as unknown[]).length
        : 0
      : 0;
  const claims = validateClaims(candidate.claims);
  const sources = validateSources(candidate.sources);
  const sourceIds = new Set(sources.map((source) => source.id));
  if (claims.some((claim) => claim.sourceIds.some((id) => !sourceIds.has(id)))) {
    throw new Error("A claim refers to an unknown source");
  }
  const assembled = JSON.stringify({ ...candidate, claims: undefined, sources: undefined });
  if (claims.some((claim) => !assembled.includes(claim.sentence))) {
    throw new Error("A claim sentence is not present in the assembled article");
  }
  if (candidate.status === "completed" && claims.some((claim) => claim.support === "partial")) {
    throw new Error("Partially supported claims require a partial article status");
  }
  const result: SeoArticleResultInput = {
    status: candidate.status,
    stage: text(candidate.stage, "article stage", 80),
    seoTitle: text(candidate.seoTitle, "SEO title", 100),
    metaDescription: text(candidate.metaDescription, "meta description", 300),
    slug: text(candidate.slug, "slug", 100),
    canonicalSuggestion: text(candidate.canonicalSuggestion, "canonical suggestion", 2_000, false),
    markdown: text(candidate.markdown, "article Markdown", 200_000),
    structuredData,
    plan: object(candidate.plan, "article plan"),
    keywordMap: objectArray(candidate.keywordMap, "keyword map", 80),
    answerBlocks: objectArray(candidate.answerBlocks, "answer blocks", 3),
    faq,
    sources,
    claims,
    warnings: stringArray(candidate.warnings, "warnings", 80, 2_000),
    reviewStatus: "ready_for_review",
    model: text(candidate.model, "model", 120),
  };
  const qualityReport = evaluateArticleQuality({
    markdown: result.markdown,
    primaryKeyword,
    seoTitle: result.seoTitle,
    metaDescription: result.metaDescription,
    slug: result.slug,
    claims: result.claims,
    faqCount: result.faq.length,
    faqJsonLdCount,
  });
  return { ...result, qualityReport };
}
