import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createChatServer } from "../apps/chat/dist/app.js";
import { ChatStore } from "../apps/chat/dist/chat-store.js";
import { ProfileStore } from "../apps/chat/dist/profile.js";
import { evaluateArticleQuality } from "../apps/chat/dist/article-quality.js";
import { fetchPublicWebPage } from "../apps/chat/dist/public-web.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "seo-article-test-"));
const store = new ChatStore(join(temporary, "chat.sqlite"));
const sessionId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";

const profileDirectory = join(temporary, "profile");
const skillDirectory = join(temporary, "my-business");
await mkdir(profileDirectory, { recursive: true });
await writeFile(
  join(profileDirectory, "profile.json"),
  JSON.stringify({
    schemaVersion: 1,
    agentName: "Helper",
    avatarDataUrl: "",
    tone: "Warm and direct",
    sells: "Bookkeeping support",
    voiceSamples: ["A short saved sample."],
    updatedAt: "2026-08-01T00:00:00.000Z",
  }),
);
const profileStore = new ProfileStore(profileDirectory, skillDirectory);
const migratedProfile = await profileStore.read();
assert.equal(migratedProfile.schemaVersion, 2);
assert.equal(migratedProfile.offer, "Bookkeeping support");
assert.equal(migratedProfile.voice, "Warm and direct");
assert.equal(migratedProfile.agentName, "Helper");
assert.deepEqual(migratedProfile.voiceSamples, ["A short saved sample."]);

const migrationPath = join(temporary, "migration.sqlite");
const beforeMigration = new ChatStore(migrationPath);
beforeMigration.beginTurn({
  conversationId: sessionId,
  agentId: "project-manager",
  requestId,
  content: "Preserve this conversation",
});
beforeMigration.close();
const legacyDatabase = new DatabaseSync(migrationPath);
legacyDatabase.exec("DROP TABLE seo_article_versions; DROP TABLE seo_article_jobs; DROP TABLE seo_article_briefs; PRAGMA user_version = 3;");
legacyDatabase.close();
const afterMigration = new ChatStore(migrationPath);
assert.equal(afterMigration.health().schemaVersion, 5);
assert.equal(afterMigration.getConversation(sessionId)?.title, "Preserve this conversation");
afterMigration.close();
const articleWords = Array.from(
  { length: 90 },
  (_, index) => `Practical step ${index + 1} helps the reader make a clear and measured choice without promising a result.`,
).join(" ");
const markdown = [
  "# A practical guide to bookkeeping for freelancers",
  "",
  "## Start with the work you already do",
  "",
  `Bookkeeping for freelancers becomes easier when records are kept consistently. ${articleWords}`,
  "",
  "## Build a simple weekly habit",
  "",
  "Use a short routine that fits the way the business actually works.",
  "",
  "## Review before making a decision",
  "",
  "Check the records and ask a qualified adviser when the answer depends on personal circumstances.",
  "",
  "## References",
  "",
  "- [Example guidance](https://example.com/guidance)",
].join("\n");
const claim = {
  sentence: "Bookkeeping for freelancers becomes easier when records are kept consistently.",
  sourceIds: ["S1"],
  excerpts: ["Keep accurate and complete records."],
  support: "entailed",
  repairAction: "",
};
const quality = evaluateArticleQuality({
  markdown,
  primaryKeyword: "bookkeeping for freelancers",
  seoTitle: "Bookkeeping for Freelancers: A Practical Guide",
  metaDescription:
    "A plain-English guide to bookkeeping for freelancers, with practical habits for keeping records clear and reviewing the next step.",
  slug: "bookkeeping-for-freelancers",
  claims: [claim],
  faqCount: 0,
  faqJsonLdCount: 0,
});
assert.equal(quality.passed, true, quality.errors.join(" "));

await assert.rejects(fetchPublicWebPage("https://127.0.0.1/"), /public HTTPS/i);

const server = createChatServer({
  publicDirectory: join(projectRoot, "apps", "chat", "public"),
  upstreamUrl: "http://127.0.0.1:5678/webhook/chat",
  chatStore: store,
  profileStore,
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

const jsonRequest = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json();
  return { response, body };
};

try {
  store.saveBusinessMemory({
    schemaVersion: 1,
    jobId: "fixture-research",
    status: "completed",
    domain: "example.com",
    companyOverview: "A bookkeeping service for Australian freelancers.",
    profile: {
      brandName: "Example Books",
      audience: "Australian freelancers",
      offering: "Simple bookkeeping support",
    },
    competitors: { direct: [], seo: [], adjacent: [] },
    seedKeywords: ["bookkeeping for freelancers", "freelance records", "bookkeeping costs"],
    keywordCandidates: [
      {
        keyword: "bookkeeping for freelancers",
        relevance: 0.95,
        searchVolume: 320,
        difficulty: 28,
        intent: "informational",
      },
      {
        keyword: "freelance records",
        relevance: 0.7,
        searchVolume: 90,
        difficulty: 18,
        intent: "informational",
      },
      {
        keyword: "bookkeeping costs",
        relevance: 0.65,
        searchVolume: 70,
        difficulty: 24,
        intent: "commercial",
      },
    ],
    keywordGroups: [],
    sources: [{ url: "https://example.com/", type: "home page" }],
    warnings: [],
    researchSummary: "Grounded fixture research.",
    evidenceQuality: { confidence: "high" },
  });

  const pricingNeedsDetail = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      requestId: "66666666-6666-4666-8666-666666666666",
      domain: "example.com",
      selectionNumber: 3,
    }),
  });
  assert.equal(pricingNeedsDetail.response.status, 200);
  assert.equal(pricingNeedsDetail.body.status, "needs_details");
  assert.deepEqual(pricingNeedsDetail.body.missingFields, ["price"]);
  assert.equal(pricingNeedsDetail.body.brief.selection.primaryKeyword, "bookkeeping costs");

  const profileWithPrice = await jsonRequest("/api/profile", {
    method: "PUT",
    body: JSON.stringify({
      profile: {
        agentName: "Helper",
        businessName: "Example Books",
        whoYouServe: "Australian freelancers",
        offer: "Bookkeeping support",
        price: "Do not mention price",
        boundaries: "",
        voice: "Warm and direct",
        voiceSamples: ["A short saved sample."],
      },
    }),
  });
  assert.equal(profileWithPrice.response.status, 200);
  const refreshedBrief = await jsonRequest("/api/seo-article/briefs", {
    method: "PATCH",
    body: JSON.stringify({
      sessionId,
      briefId: pricingNeedsDetail.body.brief.briefId,
    }),
  });
  assert.equal(refreshedBrief.response.status, 200);
  assert.equal(refreshedBrief.body.brief.status, "choosing");
  assert.deepEqual(refreshedBrief.body.brief.missingFields, []);
  assert.equal(refreshedBrief.body.brief.context.price.value, "Do not mention price");

  const pricingReady = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      requestId: "66666666-6666-4666-8666-666666666666",
      domain: "example.com",
    }),
  });
  assert.equal(pricingReady.response.status, 201);
  assert.equal(pricingReady.body.job.input.price, "Do not mention price");
  assert.equal(pricingReady.body.job.primaryKeyword, "bookkeeping costs");

  const registrationBody = {
    sessionId,
    requestId,
    domain: "example.com",
    primaryKeyword: "",
    selectionNumber: 1,
    supportingKeywords: ["freelance records"],
    targetAudience: "Australian freelancers",
    goal: "Help readers build a simple habit",
    sourceUrls: ["https://example.com/guidance"],
  };
  const first = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify(registrationBody),
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.created, true);
  assert.equal(first.body.job.primaryKeyword, "bookkeeping for freelancers");
  assert.match(first.body.job.briefId, /^brief-/);
  const jobId = first.body.job.jobId;

  const briefDuringWrite = await jsonRequest(
    `/api/seo-article/briefs?sessionId=${sessionId}&domain=example.com`,
  );
  assert.equal(briefDuringWrite.response.status, 200);
  assert.equal(briefDuringWrite.body.brief.status, "writing");
  assert.equal(briefDuringWrite.body.brief.opportunities.length, 3);

  const duplicate = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify(registrationBody),
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.created, false);
  assert.equal(duplicate.body.job.jobId, jobId);

  const wrongSession = await jsonRequest(
    `/api/seo-article/jobs?sessionId=33333333-3333-4333-8333-333333333333&jobId=${jobId}`,
  );
  assert.equal(wrongSession.response.status, 404);

  const saved = await jsonRequest("/api/seo-article/versions", {
    method: "PUT",
    body: JSON.stringify({
      sessionId,
      jobId,
      context: { sourceUrls: ["https://example.com/guidance"] },
      result: {
        status: "completed",
        stage: "ready_for_review",
        seoTitle: "Bookkeeping for Freelancers: A Practical Guide",
        metaDescription:
          "A plain-English guide to bookkeeping for freelancers, with practical habits for keeping records clear and reviewing the next step.",
        slug: "bookkeeping-for-freelancers",
        canonicalSuggestion: "https://example.com/bookkeeping-for-freelancers",
        markdown,
        structuredData: { article: { "@type": "Article" }, faqPage: [] },
        plan: { audience: "Australian freelancers" },
        keywordMap: [{ keyword: "bookkeeping for freelancers", role: "primary" }],
        answerBlocks: [],
        faq: [],
        sources: [
          {
            id: "S1",
            url: "https://example.com/guidance",
            title: "Example guidance",
            excerpt: "Keep accurate and complete records.",
          },
          { id: "S2", url: "https://example.org/two", title: "Two", excerpt: "Records." },
          { id: "S3", url: "https://example.net/three", title: "Three", excerpt: "Review." },
          { id: "S4", url: "https://iana.org/four", title: "Four", excerpt: "Check." },
        ],
        claims: [claim],
        warnings: [],
        reviewStatus: "ready_for_review",
        model: "fixture-model",
      },
    }),
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.match(saved.body.article.downloadUrl, /^\/api\/seo-article\/download\//);

  const completedBrief = await jsonRequest(
    `/api/seo-article/briefs?sessionId=${sessionId}&domain=example.com`,
  );
  assert.equal(completedBrief.body.brief.status, "complete");
  assert.equal(completedBrief.body.article.downloadUrl, saved.body.article.downloadUrl);

  const download = await fetch(`${base}${saved.body.article.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /\.md"$/);
  assert.equal(await download.text(), markdown);

  const secondRequest = "44444444-4444-4444-8444-444444444444";
  const second = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify({ ...registrationBody, requestId: secondRequest }),
  });
  const failedJobId = second.body.job.jobId;
  await jsonRequest("/api/seo-article/jobs", {
    method: "PATCH",
    body: JSON.stringify({
      sessionId,
      jobId: failedJobId,
      status: "failed",
      stage: "failed",
      errorCode: "INSUFFICIENT_SOURCES",
      errorMessage: "Only three sources were readable.",
    }),
  });
  const latest = await jsonRequest(
    `/api/seo-article/jobs?sessionId=${sessionId}&domain=example.com`,
  );
  assert.equal(latest.body.job.jobId, failedJobId);
  assert.equal(latest.body.job.status, "failed");
  assert.equal(latest.body.previousArticle.downloadUrl, saved.body.article.downloadUrl);

  const interruptedRequest = "55555555-5555-4555-8555-555555555555";
  const queued = store.registerSeoArticleJob({
    sessionId,
    requestId: interruptedRequest,
    domain: "example.com",
    briefId: first.body.job.briefId,
    primaryKeyword: "record keeping",
    supportingKeywords: [],
    input: {},
  });
  assert.equal(queued.created, true);
  store.markPendingInterrupted();
  assert.equal(store.getSeoArticleJob(sessionId, queued.job.jobId)?.status, "interrupted");
} finally {
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  store.close();
  await rm(temporary, { recursive: true, force: true });
}

console.log("SEO article storage, API, quality, SSRF, idempotency, and failure-preservation tests passed.");
