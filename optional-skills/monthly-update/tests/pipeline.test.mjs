// Exercises the rest of the code nodes offline: thread cleaning and
// compaction, the hallucinated-ID guard, evidence collection, and rendering.
import { readFile } from "node:fs/promises";

const url = (name) => new URL(`../workflows/${name}`, import.meta.url);
const run = JSON.parse(await readFile(url("74-run-monthly-update.json"), "utf8"));
const thread = JSON.parse(await readFile(url("75-run-thread-extraction.json"), "utf8"));
const connection = JSON.parse(await readFile(url("69-tool-check-gmail-connection.json"), "utf8"));
const start = JSON.parse(await readFile(url("65-tool-start-monthly-update.json"), "utf8"));
const progress = JSON.parse(await readFile(url("68-internal-monthly-update-progress.json"), "utf8"));

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

// ---------------------------------------- 68/74: progress and auto-delivery
const now = new Date().toISOString();
const runningProgress = runNode(progress, "Shape Progress", {
  input: [{
    runId: "mu-live",
    status: "running",
    monthLabel: "July 2026",
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    errorSummary: JSON.stringify({
      hb: 1,
      note: "Choosing what belongs in the update",
      step: 4,
      of: 7,
      at: now,
    }),
  }],
  nodes: {},
})[0];
check(runningProgress.running === true, "a live monthly run was not reported as running");
check(runningProgress.step === 4 && runningProgress.of === 7, "the monthly progress step was lost");
check(/Choosing what belongs/.test(runningProgress.note), "the monthly progress note was lost");

const finishedProgress = runNode(progress, "Shape Progress", {
  input: [{
    runId: "mu-done",
    status: "completed",
    monthLabel: "July 2026",
    startedAt: now,
    finishedAt: now,
    errorSummary: "",
  }],
  nodes: {},
})[0];
check(finishedProgress.running === false, "a finished monthly run still appeared to be running");
check(finishedProgress.runId === "mu-done" && finishedProgress.finishedAt === now,
  "the completion signal cannot identify the finished run");

const noteNodes = run.nodes.filter((node) => node.name.startsWith("Note "));
check(noteNodes.length === 6, `expected 6 monthly progress milestones, got ${noteNodes.length}`);
const steps = noteNodes.map((node) => Number(/step: (\d+)/.exec(node.parameters.jsCode)?.[1]));
check(steps.join(",") === "1,2,3,4,5,6", `monthly progress steps were ${steps.join(",")}`);
check(String(run.nodes.find((node) => node.name === "Mark Running")?.parameters?.columns?.value?.errorSummary)
  .includes("step: 0"), "the monthly run does not publish its starting heartbeat");

const automaticStart = runNode(start, "Describe Automatic Delivery", {
  input: [{ response: {
    ok: true,
    status: "queued",
    message: "I am reading July 2026 now. Ask me for it again in a few minutes and I will read it back.",
  } }],
  nodes: {},
})[0].response.message;
check(/progress bar/.test(automaticStart) && /appear here automatically/.test(automaticStart),
  "the start result does not promise visible progress and automatic delivery");
check(!/Ask me for it again/.test(automaticStart),
  "the start result still makes the user retrieve the update manually");

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

// ------------------------------------------ 69/65: the Gmail connection
// The probe asks Gmail directly, through n8n's own credential. The client
// secret lives in that credential and cannot be read back out, so n8n is the
// only thing that can hold it and the only thing that can run the OAuth dance.
const probe = (input) => runNode(connection, "Read Gmail Probe", { input: [input], nodes: {} })[0];

const live = probe({ statusCode: 200, body: { emailAddress: "founder@acme.com", messagesTotal: 40213 } });
check(live.connected === true && live.state === "connected", "a working connection was not recognised");
check(live.emailAddress === "founder@acme.com", "the connected mailbox was not reported");

const expired = probe({ statusCode: 401, body: { error: { message: "Invalid Credentials" } } });
check(expired.connected === false && expired.state === "needs_reauth", `401 gave state "${expired.state}"`);
check(/Testing/.test(expired.message), "the seven-day Testing-mode cause was not explained");

// No credential selected at all: n8n fails the node, so there is no status.
const absent = probe({ error: { message: "Credentials not found for type googleOAuth2Api" } });
check(absent.connected === false && absent.state === "not_connected", `a missing credential gave "${absent.state}"`);

const flaky = probe({ statusCode: 503, body: {} });
check(flaky.connected === false && flaky.state === "unknown", `a 503 gave "${flaky.state}"`);
check(!/reconfigure/i.test(flaky.message), "a transient failure told the user to reconfigure");

// A 403 from Google is two completely different problems wearing the same
// number. An unenabled Gmail API is not a lapsed connection, and telling the
// learner to sign in again sends them round a loop that cannot ever fix it:
// the sign-in already worked.
const apiOff = probe({
  statusCode: 403,
  body: {
    error: {
      code: 403,
      message:
        "Gmail API has not been used in project 241792255360 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=241792255360 then retry.",
      errors: [{ reason: "accessNotConfigured", domain: "usageLimits" }],
    },
  },
});
check(apiOff.state === "api_not_enabled", `an unenabled Gmail API gave "${apiOff.state}"`);
check(apiOff.fixUrl.includes("gmail.googleapis.com"), "the unenabled API did not carry the address that fixes it");
check(/switched off|disabled|not been used/i.test(apiOff.message),
  "the unenabled API was not named as the cause");
check(!/lapsed|expired|needs reconnecting/i.test(apiOff.message),
  "an unenabled API was described as a lapsed connection");

const badScope = probe({
  statusCode: 403,
  body: {
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      errors: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
    },
  },
});
check(badScope.state === "wrong_scope", `an insufficient scope gave "${badScope.state}"`);

// The chat linkifies exactly one address. Every state that the learner can act
// on has to carry it, and the agent has to be told to reproduce it verbatim or
// the learner gets plain text. It is a route on the chat rather than an n8n
// address, so it is right on a hosted kit as well as a local one.
const CREDENTIAL_URL = "/api/gmail/connect";
for (const result of [live, expired, absent, flaky, apiOff, badScope]) {
  check(result.credentialUrl === CREDENTIAL_URL, "the probe lost the credential address");
  check(result.linkInstruction.includes(CREDENTIAL_URL), "the probe lost the link instruction");
  check(result.scope === "https://www.googleapis.com/auth/gmail.readonly", "the probe reports the wrong scope");
}
check(!/localhost:5678/.test(JSON.stringify([live, expired, absent, flaky, apiOff, badScope])),
  "the probe still hardcodes a local n8n address, which is wrong on a hosted kit");

// The one Gmail problem the chat cannot help with must not offer the button.
const shapedApiOff = runNode(connection, "Shape Connection Result", {
  input: [apiOff],
  nodes: { "Validate Connection Input": [{ sessionId: "s", requestId: "r", proposedInput: {} }] },
})[0];
check(!shapedApiOff.response.nextStep.includes(CREDENTIAL_URL),
  "an unenabled Gmail API still offered the connect button");
check(shapedApiOff.response.fixUrl.includes("gmail.googleapis.com"),
  "the unenabled API refusal did not pass on the address that fixes it");

const shaped69 = runNode(connection, "Shape Connection Result", {
  input: [absent],
  nodes: { "Validate Connection Input": [{ sessionId: "s", requestId: "r", proposedInput: {} }] },
})[0];
check(shaped69.response.nextStep.includes(CREDENTIAL_URL),
  "check_gmail_connection does not tell the agent to emit the credential link");
check(/carries on by itself|starts on its own/.test(shaped69.response.nextStep),
  "the agent is not told the run resumes when the learner returns");

// Starting a run without Gmail must refuse rather than queue and burn money.
const startRefused = runNode(start, "Shape Auth Needed", {
  input: [absent],
  nodes: {
    "Decide Run": [{ sessionId: "s", requestId: "r", runId: "mu-x", monthLabel: "July 2026", proposedInput: {} }],
    "Read Gmail Probe": [absent],
  },
})[0];
check(startRefused.response.ok === false, "a missing Gmail connection still reported success");
check(startRefused.response.credentialUrl === CREDENTIAL_URL, "the refusal does not carry the credential link");
check(startRefused.response.nextStep.includes(CREDENTIAL_URL), "the refusal does not tell the agent to emit the link");

const startNodes = new Set(start.nodes.map((n) => n.name));
check(startNodes.has("Probe Gmail"), "start_monthly_update has no Gmail pre-flight check");
const queueSources = Object.entries(start.connections)
  .filter(([, out]) => (out.main ?? []).some((b) => b.some((target) => target.node === "Queue Background Run")))
  .map(([source]) => source);
check(queueSources.length === 1 && queueSources[0] === "Gmail Ready?",
  `the background run is reachable from ${queueSources.join(", ") || "nothing"} rather than only the Gmail check`);

// Every Gmail call goes through n8n's own credential. Nothing may reach for a
// token from the chat gateway: that path is gone, and the secret is in n8n.
for (const [name, wf] of [["74", run], ["75", thread], ["65", start], ["69", connection]]) {
  for (const node of wf.nodes) {
    const url = String(node.parameters?.url ?? "");
    if (url.includes("gmail.googleapis.com")) {
      check(node.credentials?.googleOAuth2Api?.name === "Gmail (read-only)",
        `${name}: "${node.name}" calls Gmail without the n8n credential`);
    }
    check(!url.includes("/api/gmail/"),
      `${name}: "${node.name}" still calls the removed chat-gateway Gmail endpoint`);
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
