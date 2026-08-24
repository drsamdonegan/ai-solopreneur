import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createChatServer } from "../apps/chat/dist/app.js";
import { ChatStore } from "../apps/chat/dist/chat-store.js";
import { ProfileStore } from "../apps/chat/dist/profile.js";
import {
  articleTextContainsExcerpt,
  evaluateArticleQuality,
} from "../apps/chat/dist/article-quality.js";
import {
  articleStrategyPreservesTopic,
  buildArticleTopicStrategy,
} from "../apps/chat/dist/article-strategy.js";
import { fetchPublicWebPage } from "../apps/chat/dist/public-web.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const { Expression } = require("n8n-workflow");
const startWorkflow = JSON.parse(
  await readFile(join(projectRoot, "n8n", "workflows", "56-tool-start-seo-article.json"), "utf8"),
);
const writerWorkflow = JSON.parse(
  await readFile(
    join(projectRoot, "n8n", "workflows", "57-internal-write-seo-article.json"),
    "utf8",
  ),
);
const startValidationCode = startWorkflow.nodes.find(
  (node) => node.name === "Validate Article Brief",
).parameters.jsCode;
const runStartValidation = new Function("$json", startValidationCode);
const directTopic = "what is artificial intelligence in simple terms?";
const directRequest = runStartValidation({
  sessionId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  currentInstruction: `write an article for mlai.au about '${directTopic}'`,
  domain: "wrong.example",
  requestedTopic: "",
  selectionNumber: 1,
  chooseStrongestKeyword: true,
}).json;
assert.equal(directRequest.valid, true);
assert.equal(directRequest.domain, "mlai.au");
assert.equal(directRequest.requestedTopic, directTopic);
assert.equal(directRequest.selectionNumber, 0);
assert.equal(directRequest.chooseStrongestKeyword, false);

const groundingPages = [1, 2, 3, 4].map((number) => ({
  id: `S${number}`,
  url: `https://source${number}.example/article`,
  title: `Source ${number}`,
  text: number === 4
    ? "The provider supports make-good s when a placement needs correction."
    : `Evidence ${number}\nline supporting this draft.`,
}));
const groundedDraft = {
  status: "completed",
  stage: "ready_for_review",
  seoTitle: "Artificial Intelligence in Simple Terms",
  metaDescription:
    "A beginner-friendly explanation of artificial intelligence, how pattern recognition works, and what the idea means in everyday language.",
  slug: "artificial-intelligence-simple-terms",
  canonicalSuggestion: "https://mlai.au/artificial-intelligence-simple-terms",
  markdown: "# AI basics\n\nAI Systems can **\"recognise\"** patterns.",
  structuredData: { article: { "@type": "Article" }, faqPage: [] },
  plan: { audience: "Beginners" },
  keywordMap: [],
  answerBlocks: [],
  faq: [],
  sources: groundingPages.map((page, index) => ({
    id: page.id,
    url: page.url,
    title: page.title,
    excerpt: index === 1
      ? "A paraphrase that is not on the page"
      : index === 3
        ? "make-goods"
        : `Evidence ${index + 1} line`,
  })),
  claims: [
    {
      sentence: "AI systems can \"recognise\" patterns.",
      sourceIds: ["S1"],
      excerpts: ["Evidence 1 line"],
      support: "entailed",
      repairAction: "",
    },
  ],
  warnings: [],
  reviewStatus: "ready_for_review",
  model: "fixture-model",
};
const groundedResponse = {
  statusCode: 200,
  body: {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "save_seo_article", input: groundedDraft }],
  },
};
const workflowBase = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  jobId: "article-fixture",
  pages: groundingPages,
  context: {},
  requestBody: { messages: [], temperature: 0.2 },
};
const workflowLookup = (records) => (name) => ({
  first: () => {
    assert.ok(Object.hasOwn(records, name), `Unexpected workflow lookup: ${name}`);
    return { json: records[name] };
  },
});
const inspectHostCode = startWorkflow.nodes.find(
  (node) => node.name === "Inspect Article Host Contract",
).parameters.jsCode;
const compatibleHost = new Function("$json", "$", inspectHostCode)(
  { statusCode: 200, body: { seoArticleWriterHostContract: 2 } },
  workflowLookup({ "Validate Article Brief": directRequest }),
).json;
assert.equal(compatibleHost.hostCompatible, true);
assert.equal(compatibleHost.response, undefined);
const incompatibleHost = new Function("$json", "$", inspectHostCode)(
  { statusCode: 404, body: {} },
  workflowLookup({ "Validate Article Brief": directRequest }),
).json;
assert.equal(incompatibleHost.hostCompatible, false);
assert.equal(incompatibleHost.response.ok, false);
assert.equal(incompatibleHost.response.error.code, "ARTICLE_HOST_UPGRADE_REQUIRED");
assert.equal(
  startWorkflow.connections["Article Host Is Compatible?"].main[1][0].node,
  "Prepare Audit",
);

const prepareTopicResearchCode = writerWorkflow.nodes.find(
  (node) => node.name === "Prepare Topic Research",
).parameters.jsCode;
const unavailableContext = new Function("$json", "$", prepareTopicResearchCode)(
  { statusCode: 500, body: {} },
  workflowLookup({
    "Worker Input": {
      sessionId: workflowBase?.sessionId ?? "11111111-1111-4111-8111-111111111111",
      jobId: workflowBase?.jobId ?? "article-fixture",
    },
  }),
).json;
assert.equal(unavailableContext.ready, false);
assert.equal(unavailableContext.failure.code, "RESEARCH_CONTEXT_UNAVAILABLE");
assert.equal(
  writerWorkflow.connections["Prepare Topic Research"].main[0][0].node,
  "Topic Context Is Ready?",
);
assert.equal(
  writerWorkflow.connections["Topic Context Is Ready?"].main[1][0].node,
  "Prepare Honest Failure",
);
const inspectDraftCode = writerWorkflow.nodes.find(
  (node) => node.name === "Inspect Draft",
).parameters.jsCode;
const inspectRepairedDraftCode = writerWorkflow.nodes.find(
  (node) => node.name === "Inspect Repaired Draft",
).parameters.jsCode;
const inspectedDraft = new Function("$json", "$", inspectDraftCode)(
  groundedResponse,
  workflowLookup({ "Prepare Grounded Draft": workflowBase }),
).json;
assert.equal(inspectedDraft.valid, true);
assert.equal(inspectedDraft.needsRepair, false);
assert.equal(inspectedDraft.draft.claims.length, 1);
assert.equal(inspectedDraft.draft.claims[0].sentence, groundedDraft.claims[0].sentence);
assert.equal(
  inspectedDraft.draft.sources[1].excerpt,
  "Evidence 2 line supporting this draft.",
);
assert.equal(inspectedDraft.draft.sources[3].excerpt, "make-goods");
assert.equal(inspectedDraft.validationBody.result.model, "claude-sonnet-4-6");
assert.equal(
  articleTextContainsExcerpt(
    "Evidence 1 line supporting this draft.",
    "[Evidence 1 line](https://invented.example/)",
  ),
  false,
);
assert.equal(
  articleTextContainsExcerpt(
    "Evidence 1 line supporting this draft.",
    "Evidence 1 line <invented>",
  ),
  false,
);
assert.equal(
  articleTextContainsExcerpt(
    "The provider supports make-good s when a placement needs correction.",
    "make-goods",
  ),
  true,
);

const changedNumberResponse = structuredClone(groundedResponse);
changedNumberResponse.body.content[0].input.claims[0].sentence =
  "AI systems can recognise 25 patterns.";
const changedNumber = new Function("$json", "$", inspectDraftCode)(
  changedNumberResponse,
  workflowLookup({ "Prepare Grounded Draft": workflowBase }),
).json;
assert.equal(changedNumber.needsRepair, true);
assert(changedNumber.repairReasons.some((reason) => /sentence/i.test(reason)));

const partialResponse = structuredClone(groundedResponse);
partialResponse.body.content[0].input.claims[0].support = "partial";
const partialDraft = new Function("$json", "$", inspectDraftCode)(
  partialResponse,
  workflowLookup({ "Prepare Grounded Draft": workflowBase }),
).json;
assert.equal(partialDraft.draft.status, "partial");
assert(partialDraft.draft.warnings.some((warning) => /marked partial/i.test(warning)));

const metadataResponse = structuredClone(groundedResponse);
metadataResponse.body.content[0].input.seoTitle =
  "A very long artificial intelligence title that keeps going beyond the supported search-result boundary";
metadataResponse.body.content[0].input.metaDescription =
  "A very long meta description about artificial intelligence in simple terms that deliberately continues beyond the normal search-result limit so deterministic preparation can shorten it cleanly at a word boundary without losing the visible article contract.";
metadataResponse.body.content[0].input.faq = [
  { question: "What is AI?", answer: "Software that can recognise patterns." },
];
metadataResponse.body.content[0].input.structuredData.faqPage = [];
const normalizedMetadata = new Function("$json", "$", inspectDraftCode)(
  metadataResponse,
  workflowLookup({ "Prepare Grounded Draft": workflowBase }),
).json;
assert(normalizedMetadata.draft.seoTitle.length <= 65);
assert(normalizedMetadata.draft.metaDescription.length <= 165);
assert.equal(normalizedMetadata.draft.structuredData.faqPage.mainEntity.length, 1);
assert(normalizedMetadata.draft.warnings.some((warning) => /SEO title was shortened/i.test(warning)));

const changedExcerptResponse = structuredClone(groundedResponse);
changedExcerptResponse.body.content[0].input.claims[0].excerpts = ["Evidence 1 lie"];
const changedExcerpt = new Function("$json", "$", inspectDraftCode)(
  changedExcerptResponse,
  workflowLookup({ "Prepare Grounded Draft": workflowBase }),
).json;
assert.equal(changedExcerpt.needsRepair, true);
assert(changedExcerpt.repairReasons.some((reason) => /excerpt/i.test(reason)));

const malformedFaqResponse = structuredClone(groundedResponse);
malformedFaqResponse.body.content[0].input.faq = [null];
const malformedFaqDraft = new Function("$json", "$", inspectDraftCode)(
  malformedFaqResponse,
  workflowLookup({ "Prepare Grounded Draft": workflowBase }),
).json;
assert.equal(malformedFaqDraft.needsRepair, true);
assert(malformedFaqDraft.repairReasons.some((reason) => /FAQ entry/i.test(reason)));
assert.deepEqual(malformedFaqDraft.draft.faq, []);
const malformedFaqRepair = new Function("$json", "$", inspectRepairedDraftCode)(
  malformedFaqResponse,
  workflowLookup({ "Prepare One Repair": workflowBase }),
).json;
assert.equal(malformedFaqRepair.valid, false);
assert.match(malformedFaqRepair.failure.message, /FAQ entry/i);

for (const inventedExcerpt of [
  "[Evidence 1 line](https://invented.example/)",
  "Evidence 1 line <invented>",
]) {
  const adversarialResponse = structuredClone(groundedResponse);
  adversarialResponse.body.content[0].input.sources[0].excerpt = inventedExcerpt;
  adversarialResponse.body.content[0].input.claims[0].excerpts = [inventedExcerpt];
  const adversarialDraft = new Function("$json", "$", inspectDraftCode)(
    adversarialResponse,
    workflowLookup({ "Prepare Grounded Draft": workflowBase }),
  ).json;
  assert.equal(adversarialDraft.needsRepair, true);
  assert(adversarialDraft.repairReasons.some((reason) => /excerpt/i.test(reason)));
  assert.notEqual(adversarialDraft.draft.sources[0].excerpt, inventedExcerpt);

  const adversarialRepair = new Function("$json", "$", inspectRepairedDraftCode)(
    adversarialResponse,
    workflowLookup({ "Prepare One Repair": workflowBase }),
  ).json;
  assert.equal(adversarialRepair.valid, false);
  assert.match(adversarialRepair.failure.message, /excerpt/i);
}

const repairedDraft = new Function("$json", "$", inspectRepairedDraftCode)(
  groundedResponse,
  workflowLookup({ "Prepare One Repair": workflowBase }),
).json;
assert.equal(repairedDraft.valid, true);
assert.equal(repairedDraft.needsRepair, false);

const unsupportedResponse = structuredClone(groundedResponse);
unsupportedResponse.body.content[0].input.claims[0].support = "unsupported";
const unsupportedRepair = new Function("$json", "$", inspectRepairedDraftCode)(
  unsupportedResponse,
  workflowLookup({ "Prepare One Repair": workflowBase }),
).json;
assert.equal(unsupportedRepair.valid, false);
assert.match(unsupportedRepair.failure.message, /unsupported/i);

const incompleteRepair = new Function("$json", "$", inspectRepairedDraftCode)(
  {
    ...groundedResponse,
    body: { ...groundedResponse.body, stop_reason: "max_tokens" },
  },
  workflowLookup({ "Prepare One Repair": workflowBase }),
).json;
assert.equal(incompleteRepair.valid, false);
assert.match(
  incompleteRepair.failure.message,
  /incomplete repair/i,
);

const mergeDraftCode = writerWorkflow.nodes.find(
  (node) => node.name === "Merge Draft Quality",
).parameters.jsCode;
const qualityRepair = new Function("$json", "$", mergeDraftCode)(
  {
    statusCode: 200,
    body: {
      valid: false,
      errors: [
        "The SEO title must be 20–65 characters.",
        "FAQ structured data must match the visible FAQ exactly.",
      ],
    },
  },
  workflowLookup({ "Inspect Draft": inspectedDraft }),
).json;
assert.equal(qualityRepair.needsRepair, true);
assert(qualityRepair.repairReasons.some((reason) => /SEO title/i.test(reason)));
const prepareRepairCode = writerWorkflow.nodes.find(
  (node) => node.name === "Prepare One Repair",
).parameters.jsCode;
const repairRequest = new Function("$json", prepareRepairCode)(qualityRepair).json;
assert.match(repairRequest.requestBody.messages[0].content, /SEO title must be 20–65/i);
assert.match(repairRequest.requestBody.messages[0].content, /FAQ structured data/i);

const chooseSourcesCode = writerWorkflow.nodes.find(
  (node) => node.name === "Choose Public Sources",
).parameters.jsCode;
const sourceSelectionInput = {
  ready: true,
  sessionId: workflowBase.sessionId,
  jobId: workflowBase.jobId,
  strategy: {},
  liveSerpUrls: [],
  context: {
    job: {
      domain: "mlai.au",
      requestedTopic: directTopic,
      primaryKeyword: "artificial intelligence",
      input: { sourceUrls: [] },
    },
    brief: {
      research: {
        companyOverview: "Australian AI education.",
        profile: {},
        offeringProfile: {},
        selectedKeywords: [],
        keywordCandidates: [],
        serpEvidence: [],
        sources: [
          {
            provider: "DataForSEO",
            endpoint: "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live",
            title: "Artificial intelligence research",
          },
          {
            url: "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
            title: "Artificial intelligence in simple terms",
          },
        ],
        seoCompetitors: [{ domain: "competitor-one.example" }],
        competitors: {
          direct: [{ domain: "competitor-two.example" }],
          seo: [],
          adjacent: [],
        },
        warnings: [],
      },
    },
    profile: {},
  },
};
const selectedSources = new Function("$json", chooseSourcesCode)(sourceSelectionInput).json;
assert(selectedSources.urls.includes("https://competitor-one.example/"));
assert(selectedSources.urls.includes("https://competitor-two.example/"));
assert(selectedSources.urls.includes("https://mlai.au/"));
assert.equal(selectedSources.urls.some((url) => /dataforseo\.com/i.test(url)), false);

const crowdedSourceInput = structuredClone(sourceSelectionInput);
crowdedSourceInput.context.brief.research.seoCompetitors = Array.from(
  { length: 20 },
  (_, index) => ({ domain: `competitor-${index + 1}.example` }),
);
const crowdedSources = new Function("$json", chooseSourcesCode)(crowdedSourceInput).json;
assert.equal(crowdedSources.urls.length, 12);
assert.equal(crowdedSources.urls[0], "https://mlai.au/");

const prepareSaveCode = writerWorkflow.nodes.find(
  (node) => node.name === "Prepare Save Request",
).parameters.jsCode;
const preparedSave = new Function("$json", prepareSaveCode)({
  ...inspectedDraft,
  context: {
    brief: { briefId: "brief-fixture", research: { memoryJobId: "memory-fixture" } },
  },
}).json;
const saveExpression = writerWorkflow.nodes.find(
  (node) => node.name === "Save Article Version",
).parameters.jsonBody;
const resolvedSaveBody = new Expression("Australia/Melbourne").resolveSimpleParameterValue(
  saveExpression,
  {
    $json: preparedSave,
    $thisRunIndex: 0,
    $thisItemIndex: 0,
  },
);
assert.deepEqual(JSON.parse(resolvedSaveBody), preparedSave.saveBody);
assert.equal(preparedSave.saveBody.result.model, "claude-sonnet-4-6");

const temporary = await mkdtemp(join(tmpdir(), "seo-article-test-"));
const store = new ChatStore(join(temporary, "chat.sqlite"));
const sessionId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";

const profileDirectory = join(temporary, "profile");
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
const profileStore = new ProfileStore(profileDirectory);
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
assert.equal(afterMigration.health().schemaVersion, 6);
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
  `**BOOKKEEPING FOR FREELANCERS** becomes easier when records are kept consistently. ${articleWords}`,
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

const topicStrategy = buildArticleTopicStrategy({
  requestedTopic: "what is artificial intelligence in simple terms?",
  evidenceSource: "topic_specific_paid_research",
  market: "Australia",
  language: "en",
  actualCostUsd: 0.02,
  capturedAt: "2026-08-24T00:00:00.000Z",
  candidates: [
    {
      keyword: "artificial intelligence",
      intent: "informational",
      searchVolume: 27_100,
      difficulty: 55,
      relevance: 0.9,
      source: "live_keyword_data",
      language: "en",
      market: "Australia",
    },
    {
      keyword: "what is artificial intelligence in simple terms",
      intent: "informational",
      searchVolume: 320,
      difficulty: 24,
      relevance: 1,
      source: "live_keyword_data",
      language: "en",
      market: "Australia",
      serpFormatMatch: 1,
    },
    {
      keyword: "artificial intelligence near me",
      intent: "local",
      searchVolume: 1_300,
      difficulty: 12,
      relevance: 0.7,
      source: "live_keyword_data",
      language: "en",
      market: "Australia",
    },
  ],
});
assert.equal(topicStrategy.requestedTopic, "what is artificial intelligence in simple terms?");
assert.equal(topicStrategy.primaryKeyword, "what is artificial intelligence in simple terms");
assert.equal(topicStrategy.supportingKeywords.some(({ keyword }) => keyword.includes("near me")), false);
assert.equal(articleStrategyPreservesTopic(topicStrategy), true);

const fallbackStrategy = buildArticleTopicStrategy({
  requestedTopic: "how does a cash flow forecast work?",
  evidenceSource: "saved_or_free_fallback",
  candidates: [],
});
assert.equal(fallbackStrategy.primaryKeyword, "how does a cash flow forecast work?");
assert.equal(fallbackStrategy.actualCostUsd, 0);

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
  const capabilities = await jsonRequest("/api/seo-article/capabilities");
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.seoArticleWriterHostContract, 2);

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
    competitors: {
      direct: [{ name: "Competitor Books", domain: "competitor-books.example" }],
      seo: [{ domain: "records-guide.example" }],
      adjacent: [],
    },
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

  // A topic supplied in the current request is not article option 1. The
  // saved brief may contain a broader, higher-volume option, but it must never
  // replace what the user actually asked the article to explain.
  const customTopic = "what is bookkeeping in simple terms?";
  const customTopicRequest = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      requestId: "77777777-7777-4777-8777-777777777777",
      domain: "example.com",
      requestedTopic: customTopic,
      // Workflow 56 uses zero as the explicit custom-topic sentinel. The API
      // must normalize it away instead of treating it as a numbered choice.
      selectionNumber: 0,
    }),
  });
  assert.equal(customTopicRequest.response.status, 201);
  assert.equal(customTopicRequest.body.status, "queued");
  assert.equal(customTopicRequest.body.job.requestedTopic, customTopic);
  assert.equal(customTopicRequest.body.job.topicSource, "custom");
  assert.equal(customTopicRequest.body.job.primaryKeyword, customTopic);
  assert.equal(customTopicRequest.body.brief.selection.number, 0);
  assert.equal(customTopicRequest.body.brief.selection.primaryKeyword, customTopic);

  const storedCustomTopic = store.getSeoArticleJob(
    sessionId,
    customTopicRequest.body.job.jobId,
  );
  assert.equal(storedCustomTopic?.requestedTopic, customTopic);
  assert.equal(storedCustomTopic?.topicSource, "custom");

  const customTopicContext = await jsonRequest(
    `/api/seo-article/context?sessionId=${sessionId}&jobId=${customTopicRequest.body.job.jobId}`,
  );
  assert.equal(customTopicContext.response.status, 200);
  assert.equal(customTopicContext.body.memory.competitors.direct[0].domain, "competitor-books.example");
  assert.equal(
    customTopicContext.body.brief.research.competitors.seo[0].domain,
    "records-guide.example",
  );

  const conflictingMode = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      requestId: "88888888-8888-4888-8888-888888888888",
      domain: "example.com",
      requestedTopic: customTopic,
      selectionNumber: 1,
    }),
  });
  assert.equal(conflictingMode.response.status, 400);

  for (const stage of ["loading_context", "researching_keywords"]) {
    const progress = await jsonRequest("/api/seo-article/jobs", {
      method: "PATCH",
      body: JSON.stringify({
        sessionId,
        jobId: customTopicRequest.body.job.jobId,
        status: "running",
        stage,
      }),
    });
    assert.equal(progress.response.status, 200);
    assert.equal(progress.body.job.stage, stage);
  }
  const savedStrategy = await jsonRequest("/api/seo-article/strategy", {
    method: "PUT",
    body: JSON.stringify({
      sessionId,
      jobId: customTopicRequest.body.job.jobId,
      evidenceSource: "topic_specific_paid_research",
      market: "Australia",
      language: "en",
      actualCostUsd: 0.01,
      candidates: [
        {
          keyword: "bookkeeping",
          intent: "informational",
          searchVolume: 20_000,
          difficulty: 50,
          relevance: 0.9,
          source: "live_keyword_data",
          language: "en",
          market: "Australia",
        },
        {
          keyword: "what is bookkeeping",
          intent: "informational",
          searchVolume: 500,
          difficulty: 20,
          relevance: 1,
          source: "live_keyword_data",
          language: "en",
          market: "Australia",
          serpFormatMatch: 1,
        },
      ],
    }),
  });
  assert.equal(savedStrategy.response.status, 200);
  assert.equal(savedStrategy.body.strategy.requestedTopic, customTopic);
  assert.equal(savedStrategy.body.strategy.primaryKeyword, "what is bookkeeping");
  assert.equal(savedStrategy.body.job.stage, "choosing_strategy");
  assert.equal(savedStrategy.body.job.requestedTopic, customTopic);

  const backwardsProgress = await jsonRequest("/api/seo-article/jobs", {
    method: "PATCH",
    body: JSON.stringify({
      sessionId,
      jobId: customTopicRequest.body.job.jobId,
      status: "running",
      stage: "loading_context",
    }),
  });
  assert.equal(backwardsProgress.response.status, 409);

  const overBudgetStrategy = await jsonRequest("/api/seo-article/strategy", {
    method: "PUT",
    body: JSON.stringify({
      sessionId,
      jobId: customTopicRequest.body.job.jobId,
      evidenceSource: "topic_specific_paid_research",
      market: "Australia",
      language: "en",
      actualCostUsd: 0.151,
      candidates: [],
    }),
  });
  assert.equal(overBudgetStrategy.response.status, 400);

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
  const firstRequestedTopic = first.body.job.requestedTopic;

  const firstStrategy = await jsonRequest("/api/seo-article/strategy", {
    method: "PUT",
    body: JSON.stringify({
      sessionId,
      jobId,
      evidenceSource: "fresh_saved_snapshot",
      market: "Australia",
      language: "en",
      actualCostUsd: 0,
      candidates: [{
        keyword: "bookkeeping for freelancers",
        intent: "informational",
        searchVolume: 320,
        difficulty: 28,
        relevance: 1,
        source: "fresh_saved_snapshot",
        language: "en",
        market: "Australia",
        serpFormatMatch: 1,
      }],
    }),
  });
  assert.equal(firstStrategy.response.status, 200);

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

  const articleResult = {
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
  };

  const invalidValidation = await jsonRequest("/api/seo-article/validate", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      jobId,
      result: {
        ...articleResult,
        seoTitle: "AI",
        metaDescription: "Too short.",
        markdown: `${markdown}\n\nIn 2026, records changed by 25%.`,
        faq: [{ question: "What is bookkeeping?", answer: "A way to keep records." }],
        structuredData: { article: { "@type": "Article" }, faqPage: [] },
      },
    }),
  });
  assert.equal(invalidValidation.response.status, 200);
  assert.equal(invalidValidation.body.valid, false);
  assert(invalidValidation.body.errors.some((error) => /SEO title/i.test(error)));
  assert(invalidValidation.body.errors.some((error) => /meta description/i.test(error)));
  assert(invalidValidation.body.errors.some((error) => /claim ledger/i.test(error)));
  assert(invalidValidation.body.errors.some((error) => /FAQ structured data/i.test(error)));

  const saved = await jsonRequest("/api/seo-article/versions", {
    method: "PUT",
    body: JSON.stringify({
      sessionId,
      jobId,
      context: { sourceUrls: ["https://example.com/guidance"] },
      result: articleResult,
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
  const downloadedMarkdown = await download.text();
  assert(downloadedMarkdown.startsWith(markdown));
  assert.match(downloadedMarkdown, /<!-- SEO REVIEW METADATA/);
  assert(downloadedMarkdown.includes(`Requested topic: ${firstRequestedTopic}`));
  assert.match(downloadedMarkdown, /Primary keyword: bookkeeping for freelancers/);
  const storedVersion = store.getSeoArticleVersionForJob(sessionId, jobId);
  assert.equal(storedVersion?.context.requestedTopic, firstRequestedTopic);
  assert.equal(storedVersion?.plan.requestedTopic, firstRequestedTopic);
  assert.equal(storedVersion?.context.articleStrategy.primaryKeyword, "bookkeeping for freelancers");

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
  const lateSave = await jsonRequest("/api/seo-article/versions", {
    method: "PUT",
    body: JSON.stringify({
      sessionId,
      jobId: failedJobId,
      context: {},
      result: articleResult,
    }),
  });
  assert.equal(lateSave.response.status, 409);
  assert.match(lateSave.body.error.message, /late worker/i);
  const latest = await jsonRequest(
    `/api/seo-article/jobs?sessionId=${sessionId}&domain=example.com`,
  );
  assert.equal(latest.body.job.jobId, failedJobId);
  assert.equal(latest.body.job.status, "failed");
  assert.equal(latest.body.previousArticle.downloadUrl, saved.body.article.downloadUrl);

  const staleSessionId = "66666666-6666-4666-8666-666666666666";
  const staleRegistration = await jsonRequest("/api/seo-article/jobs", {
    method: "POST",
    body: JSON.stringify({
      ...registrationBody,
      sessionId: staleSessionId,
      requestId: "77777777-7777-4777-8777-777777777777",
    }),
  });
  assert.equal(staleRegistration.response.status, 201);
  const staleJobId = staleRegistration.body.job.jobId;
  const staleDatabase = new DatabaseSync(join(temporary, "chat.sqlite"));
  staleDatabase
    .prepare("UPDATE seo_article_jobs SET updated_at = ? WHERE job_id = ?")
    .run("2020-01-01T00:00:00.000Z", staleJobId);
  staleDatabase.close();
  const expiredPanel = await jsonRequest(
    `/api/seo-article/briefs?sessionId=${staleSessionId}&domain=example.com`,
  );
  assert.equal(expiredPanel.response.status, 200);
  assert.equal(expiredPanel.body.brief.status, "failed");
  assert.equal(expiredPanel.body.job.status, "failed");
  assert.equal(expiredPanel.body.job.errorCode, "ARTICLE_WORKER_TIMED_OUT");

  const interruptedRequest = "55555555-5555-4555-8555-555555555555";
  const queued = store.registerSeoArticleJob({
    sessionId,
    requestId: interruptedRequest,
    domain: "example.com",
    briefId: first.body.job.briefId,
    requestedTopic: "record keeping",
    topicSource: "custom",
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
