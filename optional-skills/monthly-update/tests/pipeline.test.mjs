// Exercises the rest of the code nodes offline: thread cleaning and
// compaction, the hallucinated-ID guard, evidence collection, and rendering.
import { readFile } from "node:fs/promises";

const url = (name) => new URL(`../workflows/${name}`, import.meta.url);
const run = JSON.parse(await readFile(url("74-run-monthly-update.json"), "utf8"));
const thread = JSON.parse(await readFile(url("75-run-thread-extraction.json"), "utf8"));
const connection = JSON.parse(await readFile(url("69-tool-check-gmail-connection.json"), "utf8"));
const start = JSON.parse(await readFile(url("65-tool-start-monthly-update.json"), "utf8"));

const jsOf = (workflow, name) => workflow.nodes.find((node) => node.name === name).parameters.jsCode;

function runNode(workflow, name, { input = [], nodes = {} }) {
  const fn = new Function("$input", "$", "$json", jsOf(workflow, name));
  const wrap = (rows) => ({
    all: () => rows.map((json) => ({ json })),
    first: () => ({ json: rows[0] ?? {} }),
  });
  return fn(wrap(input), (n) => {
    if (!(n in nodes)) throw new Error(`fixture missing node ${n}`);
    return wrap(nodes[n]);
  }, input[0] ?? {}).map((item) => item.json);
}

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const b64url = (text) => Buffer.from(text, "utf8").toString("base64url");

const PROFILE = {
  companyName: "Northwind",
  companyAliases: ["northwind"],
  positiveKeywords: ["ledger"],
  founderNames: ["sam donegan"],
  teamNames: [],
  investorNames: [],
  customerNames: ["acme"],
  prospectNames: [],
  highSignalTerms: ["contract", "signed", "churn"],
  domainAliases: ["northwind.io"],
  stage: "seed",
};

// ---------------------------------------------- 75: cleaning + compaction
const REPLY_WITH_QUOTE = [
  "Legal signed off this morning. 12-month contract starting 1 August.",
  "",
  "On Mon, 14 Jul 2026 at 09:12, Sam Donegan <sam@northwind.io> wrote:",
  "> Any word from legal?",
  "> Sam",
  "",
  "--",
  "Dana Ruiz | Acme",
].join("\n");

const threadResponse = {
  statusCode: 200,
  body: {
    id: "t-1",
    messages: [
      {
        id: "m1", threadId: "t-1", internalDate: "1752480000000", snippet: "Kicking off the pilot",
        payload: {
          headers: [
            { name: "Subject", value: "Northwind pilot" },
            { name: "From", value: "Sam Donegan <sam@northwind.io>" },
            { name: "To", value: "dana@acme.com" },
          ],
          mimeType: "text/plain",
          body: { data: b64url("Kicking off the pilot on Monday.") },
        },
      },
      {
        id: "m2", threadId: "t-1", internalDate: "1752566400000", snippet: "Legal signed off",
        payload: {
          headers: [
            { name: "Subject", value: "Re: Northwind pilot" },
            { name: "From", value: "Dana Ruiz <dana@acme.com>" },
            { name: "To", value: "sam@northwind.io" },
          ],
          parts: [
            { mimeType: "text/plain", body: { data: b64url(REPLY_WITH_QUOTE) } },
            { mimeType: "application/pdf", filename: "Acme-Northwind-MSA-signed.pdf", body: { attachmentId: "att1", size: 91234 } },
          ],
        },
      },
      {
        id: "m3", threadId: "t-1", internalDate: "1752652800000", snippet: "html only",
        payload: {
          headers: [
            { name: "Subject", value: "Re: Northwind pilot" },
            { name: "From", value: "billing@acme.com" },
          ],
          parts: [
            { mimeType: "text/html", body: { data: b64url("<p>Please invoice <b>monthly</b>.</p><script>bad()</script>") } },
          ],
        },
      },
    ],
  },
};

const compacted = runNode(thread, "Compact Thread", {
  input: [threadResponse],
  nodes: {
    "Thread Input": [{
      runId: "mu-test", threadId: "t-1", profileJson: JSON.stringify(PROFILE),
      monthLabel: "July 2026", monthBucket: "2026-07-01",
      windowStart: "2026-07-01", windowEnd: "2026-08-01", classifierReason: "customer contract",
    }],
  },
})[0];

check(compacted.ready === true, `Compact Thread refused a good thread: ${compacted.error}`);
const bodyText = JSON.stringify(compacted.bundle);
check(bodyText.includes("Legal signed off this morning"), "the real reply text was lost");
check(!bodyText.includes("Any word from legal?"), "quoted history was not stripped");
check(!bodyText.includes("Dana Ruiz | Acme"), "the signature after -- was not stripped");
check(bodyText.includes("Please invoice"), "HTML-only message did not fall back to stripped HTML");
check(!bodyText.includes("bad()"), "a script tag survived HTML stripping");
check(bodyText.includes("Acme-Northwind-MSA-signed.pdf"), "attachment filename was not surfaced");
check(compacted.allMessageIds.join(",") === "m1,m2,m3", `message IDs were ${compacted.allMessageIds}`);

const extractionRequest = runNode(thread, "Build Extraction Request", { input: [compacted], nodes: {} })[0].requestBody;
check(extractionRequest.tool_choice?.name === "report_thread_evidence", "extraction does not force its tool");
check(extractionRequest.system.includes("Attachment filenames are listed but their contents are NOT provided"),
  "extraction prompt lost the attachment warning");

// A thread Gmail refused must not become a silent zero-evidence success.
const refused = runNode(thread, "Compact Thread", {
  input: [{ statusCode: 403, body: { error: { message: "Insufficient Permission" } } }],
  nodes: { "Thread Input": [{ threadId: "t-9" }] },
})[0];
check(refused.ready === false && /reconnect/i.test(refused.error), `403 handling was "${refused.error}"`);

// ------------------------------------------- 75: invented IDs are dropped
const claudeExtraction = {
  statusCode: 200,
  body: {
    usage: { input_tokens: 1200, output_tokens: 300 },
    content: [{
      type: "tool_use",
      input: {
        events: [
          { canonicalKey: "acme_contract", eventType: "customer_win", title: "Acme signed", summary: "12-month contract.", eventDate: "2026-07-15", datePrecision: "day", sentiment: "positive", importance: 5, confidence: 0.9, evidenceMessageIds: ["m2"], needsReview: false },
          { canonicalKey: "invented", eventType: "fundraising", title: "Raised a round", summary: "Not in the thread.", eventDate: "", datePrecision: "unknown", sentiment: "positive", importance: 5, confidence: 0.9, evidenceMessageIds: ["m99"], needsReview: false },
        ],
        metrics: [
          { metricKey: "customerCount", metricName: "Customers", valueText: "1", valueNumber: "1", unit: "", summary: "One signed.", confidence: 0.8, evidenceMessageIds: ["m2"], needsReview: false },
        ],
      },
    }],
  },
};

const shaped = runNode(thread, "Shape Extraction", {
  input: [claudeExtraction],
  nodes: { "Compact Thread": [compacted] },
})[0];
check(shaped.ok === true, "a good extraction was reported as failed");
check(shaped.events.length === 1, `expected 1 surviving event, got ${shaped.events.length}`);
check(shaped.events[0].canonicalKey === "acme_contract", "the wrong event survived");
check(shaped.droppedForEvidence === 1, "the invented-message-ID event was not dropped");
check(shaped.metrics.length === 1, "the metric was lost");

// ----------------------------------- 74: invented IDs dropped at classify
const plan = runNode(run, "Plan Run", {
  input: [],
  nodes: {
    "Run Input": [{ runId: "mu-test", month: "2026-07", audience: "team" }],
    "Load Company Profile": [{
      profileId: "default", companyName: "Northwind", domainAliases: "northwind.io",
      customerNames: "acme", audience: "team", stage: "seed", deliverTo: "chat-only",
    }],
  },
})[0];

const scoreChunks = [{
  hasCandidates: true, chunkIndex: 0, candidateCount: 2,
  messagesListed: 2, messagesExamined: 2, metadataFailures: 0,
  candidates: [
    { messageId: "m1", threadId: "t-1", score: 90, subject: "Acme signed", from: "dana@acme.com" },
    { messageId: "m2", threadId: "t-2", score: 40, subject: "Random", from: "x@y.com" },
  ],
}];

const selected = runNode(run, "Select Threads", {
  input: [{
    statusCode: 200,
    body: {
      usage: { input_tokens: 500, output_tokens: 100 },
      content: [{ type: "tool_use", input: { results: [
        { messageId: "m1", label: "update_worthy", score: 0.9, reason: "customer contract" },
        { messageId: "m2", label: "irrelevant", score: 0.1, reason: "noise" },
        { messageId: "GHOST", label: "update_worthy", score: 0.99, reason: "does not exist" },
      ] } }],
    },
  }],
  nodes: { "Plan Run": [plan], "Score Messages": scoreChunks },
});
check(selected.length === 1, `expected 1 thread, got ${selected.length}`);
check(selected[0].threadId === "t-1", "the wrong thread was selected");
check(selected.every((row) => row.threadId !== "GHOST"), "an invented message ID reached thread selection");

// Everything classified as noise must stop the run, not draft from nothing.
const nothing = runNode(run, "Select Threads", {
  input: [{
    statusCode: 200,
    body: { usage: {}, content: [{ type: "tool_use", input: { results: [
      { messageId: "m1", label: "irrelevant", score: 0.1, reason: "noise" },
      { messageId: "m2", label: "background", score: 0.2, reason: "background" },
    ] } }] },
  }],
  nodes: { "Plan Run": [plan], "Score Messages": scoreChunks },
})[0];
check(nothing.hasThreads === false, "a fully-irrelevant month still selected threads");
check(nothing.stopReason === "nothing_worth_reporting", `stopReason was "${nothing.stopReason}"`);

const quiet = runNode(run, "Finish Early", { input: [nothing], nodes: { "Plan Run": [plan] } })[0];
check(/nothing in it rose to the level/.test(quiet.updateText), "the quiet-month message was not used");
check(quiet.status === "completed", "a quiet month was reported as a failure");

// -------------------------------------------------- 74: drafting + render
const evidence = runNode(run, "Collect Evidence", {
  input: [shaped, { threadId: "t-2", ok: false, error: "timeout", events: [], metrics: [], inputTokens: 0, outputTokens: 0 }],
  nodes: { "Plan Run": [plan], "Select Threads": [selected[0]] },
})[0];
check(evidence.evidenceExtracted === 2, `expected 2 facts, got ${evidence.evidenceExtracted}`);
check(evidence.threadFailures === 1, "the failed thread was not counted");
check(evidence.evidence[0].index === 0 && evidence.evidence[1].index === 1, "facts were not indexed");

const curationRequest = runNode(run, "Build Curation Request", { input: [evidence], nodes: {} })[0];
check(curationRequest.requestBody.tool_choice?.name === "report_curation", "curation does not force its tool");

const drafted = runNode(run, "Build Draft Request", {
  input: [{
    statusCode: 200,
    body: { usage: { input_tokens: 900, output_tokens: 200 }, content: [{ type: "tool_use", input: { decisions: [
      { index: 0, includeDecision: "include", includeScore: 0.9, suggestedSection: "what_worked", whyItMatters: "First deal above $20k.", excludeReason: "" },
      { index: 1, includeDecision: "exclude", includeScore: 0.2, suggestedSection: "exclude", whyItMatters: "", excludeReason: "Trivial." },
    ] } }] },
  }],
  nodes: { "Collect Evidence": [evidence] },
})[0];
check(drafted.evidenceIncluded === 1, `expected 1 included fact, got ${drafted.evidenceIncluded}`);
check(drafted.curationFailed === false, "curation was wrongly marked failed");
check(drafted.requestBody.system.includes("Never attribute a fact to where it came from"),
  "the draft prompt lost the no-attribution rule");
check(drafted.requestBody.system.includes("Never write about missing data"),
  "the draft prompt lost the no-missing-data rule");
check(!JSON.stringify(drafted.requestBody.messages).includes("Trivial"),
  "an excluded fact was still sent to the drafting step");

// A curation call that dies must not silently promote everything.
const curationDied = runNode(run, "Build Draft Request", {
  input: [{ statusCode: 529, body: { error: { message: "overloaded" } } }],
  nodes: { "Collect Evidence": [evidence] },
})[0];
check(curationDied.curationFailed === true, "a dead curation call was not flagged");
check(curationDied.evidenceIncluded === 0, "a dead curation call still counted facts as included");

const DRAFT = {
  title: "Monthly update — July 2026",
  topline: "A good month: our first deal above $20k.",
  kpiSnapshot: [{ metricKey: "customerCount", label: "Customers", value: "1" }],
  metricSuggestions: [{ metricKey: "demoRequests", label: "Demo requests", reason: "Worth counting now inbound has started." }],
  whatWorked: ["Acme signed a 12-month contract after their pilot."],
  challenges: [{ text: "Onboarding is still manual and took nine days.", response: "We are writing the setup guide first." }],
  learnings: ["Every account that stalled, stalled at import."],
  next30Days: ["Ship self-serve import."],
  asks: ["Intros to ops leads at logistics companies."],
  sourceNotes: ["m2"],
  status: "draft",
};

const verifyRequest = runNode(run, "Build Verify Request", {
  input: [{ statusCode: 200, body: { usage: { input_tokens: 2000, output_tokens: 700 }, content: [{ type: "tool_use", input: DRAFT }] } }],
  nodes: { "Build Draft Request": [drafted] },
})[0];
check(verifyRequest.draftFailed === false, "a good draft was marked failed");
check(verifyRequest.requestBody.tool_choice?.name === "report_verification", "verify does not force its tool");

const rendered = runNode(run, "Render Update", {
  input: [{ statusCode: 200, body: { usage: { input_tokens: 800, output_tokens: 150 }, content: [{ type: "tool_use", input: { verdict: "passed", notes: [], unsupportedClaims: [] } }] } }],
  nodes: { "Build Verify Request": [verifyRequest] },
})[0];

check(rendered.groundednessStatus === "passed", "verdict was not carried through");
check(rendered.status === "partial", "a run with a failed thread should be partial");
check(!/[*#`]|\|---/.test(rendered.updateText), "the rendered update contains markdown the chat cannot show");
for (const heading of ["What worked", "Challenges", "What we learned", "Next 30 days", "Asks"]) {
  check(rendered.updateText.includes(heading), `the rendered update is missing "${heading}"`);
}
check(rendered.updateText.includes("We are writing the setup guide first"), "the challenge lost its response");
check(rendered.updateText.includes("could not be read"), "the unread thread was not disclosed to the reader");
check(rendered.inputTokens === 800 + 2000 + 900 + 1200 + 500, `token total was ${rendered.inputTokens}`);

// A failed verification must be surfaced, not buried.
const flagged = runNode(run, "Render Update", {
  input: [{ statusCode: 200, body: { usage: {}, content: [{ type: "tool_use", input: {
    verdict: "failed", notes: ["One number is not supported."],
    unsupportedClaims: [{ claim: "our first deal above $20k", why: "No email states the contract value." }],
  } }] } }],
  nodes: { "Build Verify Request": [verifyRequest] },
})[0];
check(flagged.status === "partial", "a failed verification did not mark the run partial");
check(flagged.updateText.includes("Before you send this"), "the review section is missing");
check(flagged.updateText.includes("No email states the contract value"), "the unsupported claim was not named");

// ------------------------------------- 69/65: Gmail connection, via the chat
// The probe now asks the chat gateway, not Gmail: the gateway owns the OAuth
// connection and knows the difference between "no Google client configured",
// "configured but nobody has connected", and "connected but Google stopped
// renewing it". Those need different advice.
const probe = (input) => runNode(connection, "Read Gmail Probe", { input: [input], nodes: {} })[0];
const status = (body) => probe({ statusCode: 200, body });

const live = status({ configured: true, connected: true, emailAddress: "founder@acme.com", lastError: "" });
check(live.connected === true && live.state === "connected", "a working connection was not recognised");
check(live.message.includes("founder@acme.com"), "the connected mailbox was not named");

const unconfigured = status({ configured: false, connected: false });
check(unconfigured.state === "not_configured", `no OAuth client gave "${unconfigured.state}"`);
check(/\.env/.test(unconfigured.message), "the missing-client message does not mention .env");

const unconnected = status({ configured: true, connected: false });
check(unconnected.state === "not_connected", `configured-but-unconnected gave "${unconnected.state}"`);
check(/one click/i.test(unconnected.message), "the not-connected message does not say it is one click");

const stale = status({ configured: true, connected: true, emailAddress: "a@b.com", lastError: "invalid_grant" });
check(stale.state === "needs_reauth", `a dead refresh token gave "${stale.state}"`);
check(/Testing/.test(stale.message), "the seven-day Testing-mode cause was not explained");

const gatewayDown = probe({ statusCode: 0, body: {} });
check(gatewayDown.state === "unknown", `an unreachable gateway gave "${gatewayDown.state}"`);
check(!/reconfigure|\.env/i.test(gatewayDown.message), "a transient failure told the user to reconfigure");

// The chat only linkifies this exact path, so every state has to carry it and
// the agent has to be told to reproduce it verbatim.
for (const result of [live, unconfigured, unconnected, stale, gatewayDown]) {
  check(result.connectUrl === "/api/gmail/connect", "the probe lost the connect path");
  check(result.linkInstruction.includes("/api/gmail/connect"), "the probe lost the link instruction");
  check(result.scope === "https://www.googleapis.com/auth/gmail.readonly", "the probe reports the wrong scope");
}

// Starting a run without Gmail must refuse rather than queue and burn money.
const startRefused = runNode(start, "Shape Auth Needed", {
  input: [unconnected],
  nodes: {
    "Decide Run": [{ sessionId: "s", requestId: "r", runId: "mu-x", monthLabel: "July 2026", proposedInput: {} }],
    "Read Gmail Probe": [unconnected],
  },
})[0];
check(startRefused.response.ok === false, "a missing Gmail connection still reported success");
check(startRefused.response.connectUrl === "/api/gmail/connect", "the refusal does not carry the connect link");

const startNodes = new Set(start.nodes.map((n) => n.name));
check(startNodes.has("Probe Gmail"), "start_monthly_update has no Gmail pre-flight check");
const queueSources = Object.entries(start.connections)
  .filter(([, out]) => (out.main ?? []).some((b) => b.some((target) => target.node === "Queue Background Run")))
  .map(([source]) => source);
check(queueSources.length === 1 && queueSources[0] === "Gmail Ready?",
  `the background run is reachable from ${queueSources.join(", ") || "nothing"} rather than only the Gmail check`);

// No workflow may still carry an n8n Google credential, and every Gmail call
// must take its token from the gateway.
for (const [name, wf] of [["74", run], ["75", thread], ["65", start], ["69", connection]]) {
  for (const node of wf.nodes) {
    check(!("googleOAuth2Api" in (node.credentials ?? {})),
      `${name}: "${node.name}" still uses the n8n Google credential`);
    const url = String(node.parameters?.url ?? "");
    if (url.includes("gmail.googleapis.com")) {
      const headers = node.parameters?.headerParameters?.parameters ?? [];
      check(headers.some((h) => h.name === "Authorization" && h.value.includes("Get Gmail Token")),
        `${name}: "${node.name}" calls Gmail without the gateway token`);
    }
  }
}

console.log("\n--- rendered update ---\n");
console.log(rendered.updateText);
console.log("\n-----------------------\n");

if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All pipeline checks passed.");
