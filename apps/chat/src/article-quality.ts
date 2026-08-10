export type ClaimSupport = "entailed" | "partial" | "unsupported";

export interface ArticleClaim {
  sentence: string;
  sourceIds: string[];
  excerpts: string[];
  support: ClaimSupport;
  repairAction: string;
}

export interface ArticleQualityReport {
  passed: boolean;
  score: number;
  errors: string[];
  warnings: string[];
  measurements: {
    wordCount: number;
    headingCount: number;
    bulletLineRatio: number;
    primaryKeywordUses: number;
    unsupportedClaims: number;
  };
}

function plainWords(markdown: string): string[] {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#\[\]()!-]/g, " ")
    .toLowerCase()
    .match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
}

function repeatedOpenings(markdown: string): boolean {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((value) => value.replace(/^#+\s*/, "").trim().toLowerCase())
    .filter((value) => value.length > 30);
  const openings = paragraphs.map((value) => value.split(/\s+/).slice(0, 4).join(" "));
  return new Set(openings).size < openings.length;
}

export function evaluateArticleQuality(input: {
  markdown: string;
  primaryKeyword: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  claims: readonly ArticleClaim[];
  faqCount: number;
  faqJsonLdCount: number;
}): ArticleQualityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const words = plainWords(input.markdown);
  const lines = input.markdown.split("\n");
  const headings = lines.filter((line) => /^#{1,3}\s+\S/.test(line));
  const bulletLines = lines.filter((line) => /^\s*[-*]\s+\S/.test(line));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const keyword = input.primaryKeyword.toLowerCase().trim();
  const primaryKeywordUses = keyword
    ? input.markdown.toLowerCase().split(keyword).length - 1
    : 0;
  const unsupportedClaims = input.claims.filter((claim) => claim.support === "unsupported").length;

  if (!/^#\s+\S/m.test(input.markdown)) errors.push("The article needs one clear H1 heading.");
  if (input.seoTitle.length < 20 || input.seoTitle.length > 65) {
    errors.push("The SEO title must be 20–65 characters.");
  }
  if (input.metaDescription.length < 70 || input.metaDescription.length > 165) {
    errors.push("The meta description must be 70–165 characters.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 80) {
    errors.push("The slug must be short lowercase words separated by hyphens.");
  }
  if (headings.length < 3) errors.push("The article needs a useful heading structure.");
  if (words.length < 500) warnings.push("The article is shorter than 500 words.");
  if (words.length > 3_500) warnings.push("The article is longer than 3,500 words.");
  if (words.length > 0 && primaryKeywordUses / words.length > 0.025) {
    errors.push("The main keyword is repeated too often.");
  }
  if (/\b(delve|unlock|game[- ]changer|ever[- ]evolving|in today['’]s digital landscape|revolutioni[sz]e)\b/i.test(input.markdown)) {
    warnings.push("The draft contains generic or overused marketing language.");
  }
  if (/(?:\bfirst(?:ly)?\b[\s\S]{0,1200}\bsecond(?:ly)?\b[\s\S]{0,1200}\bthird(?:ly)?\b)/i.test(input.markdown)) {
    warnings.push("The draft leans on a formulaic three-part pattern.");
  }
  const bulletLineRatio = bulletLines.length / Math.max(1, nonEmptyLines.length);
  if (bulletLineRatio > 0.45) warnings.push("The draft uses too many bullet points for a natural article.");
  if (repeatedOpenings(input.markdown)) warnings.push("Some paragraphs start in the same way.");
  if (/\b(?:studies show|research proves|experts say|\d+(?:\.\d+)?%)\b/i.test(input.markdown) && input.claims.length === 0) {
    errors.push("The draft appears to include facts or figures without a claim ledger.");
  }
  const riskyFactSentences = input.markdown
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) =>
      /\b(?:studies show|research proves|experts say|(?:19|20)\d{2})\b|\d+(?:\.\d+)?%|[$£€]\s*\d/i.test(sentence),
    );
  if (
    riskyFactSentences.some(
      (sentence) => !input.claims.some((claim) => sentence.includes(claim.sentence)),
    )
  ) {
    errors.push("A statistic, date, or attributed claim is missing from the claim ledger.");
  }
  if (unsupportedClaims > 0) errors.push("Unsupported factual claims remain in the article.");
  if (input.faqCount !== input.faqJsonLdCount) {
    errors.push("FAQ structured data must match the visible FAQ exactly.");
  }

  const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 5);
  return {
    passed: errors.length === 0,
    score,
    errors,
    warnings,
    measurements: {
      wordCount: words.length,
      headingCount: headings.length,
      bulletLineRatio: Number(bulletLineRatio.toFixed(3)),
      primaryKeywordUses,
      unsupportedClaims,
    },
  };
}
