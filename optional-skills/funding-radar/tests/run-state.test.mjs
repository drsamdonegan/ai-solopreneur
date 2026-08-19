// Two branches merge into one node all over these tool workflows, and n8n
// treats reading a node that did not execute as an error rather than an
// undefined. That cost a whole afternoon: the search started, the reply died
// on the way back out, and the owner was told it had failed every time —
// while it was in fact running. So the branches are exercised here, with a
// harness that throws on an unexecuted node exactly as n8n does.
//
// It also pins what the agent is allowed to claim while a run is open. Nothing
// in the table can tell a run that is working from one the container killed,
// so past twenty minutes it has to stop saying "still running" and offer a
// way out instead.
import { readFile } from "node:fs/promises";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`../workflows/${name}`, import.meta.url), "utf8"),
  );

const start = await load("68-tool-start-funding-scan.json");
const report = await load("63-tool-get-funding-report.json");
const code = (workflow, name) =>
  workflow.nodes.find((entry) => entry.name === name).parameters.jsCode;

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// `executed` names the nodes that ran on the branch under test. Anything else
// throws, which is what n8n does and what the old code did not survive.
const run = (source, { self = {}, executed = {}, incoming = null }) => {
  const lookup = (name) => {
    if (!(name in executed)) {
      throw new Error(`Referenced node "${name}" is unexecuted`);
    }
    const rows = Array.isArray(executed[name]) ? executed[name] : [executed[name]];
    const items = rows.map((json) => ({ json }));
    return { first: () => items[0], all: () => items, item: items[0] };
  };
  const input = {
    first: () => ({ json: self }),
    all: () => (incoming ?? [self]).map((json) => ({ json })),
  };
  return new Function("$", "$json", "$input", source)(lookup, self, input);
};

const attempt = (label, fn) => {
  try {
    return fn();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    return null;
  }
};

const minutesAgo = (minutes) =>
  new Date(Date.now() - minutes * 60000).toISOString();

// --- the industry step, reached from three different branches ---------------

const noDomain = attempt("Read Industry with no domain", () =>
  run(code(start, "Read Industry"), {
    self: { runId: "r1", needsProfile: true, domain: "" },
    executed: { "Check Profile Exists": { runId: "r1", needsProfile: true } },
  }),
);
check(
  noDomain?.[0]?.json.industry === "",
  "no domain to read leaves the industry blank instead of failing the tool",
);
check(
  noDomain?.[0]?.json.runId === "r1",
  "the run carries through the industry step when there is no domain",
);

const classified = attempt("Read Industry after a classify call", () =>
  run(code(start, "Read Industry"), {
    self: {
      statusCode: 200,
      body: { content: [{ type: "text", text: "AI research and events" }] },
    },
    executed: {
      "Build Classify Request": { runId: "r2" },
      "Check Profile Exists": { runId: "r2" },
    },
  }),
);
check(
  classified?.[0]?.json.industry === "AI research and events",
  "a classified home page sets the industry",
);

// --- the reply, which only sees the industry step on one branch -------------

const savedProfile = attempt("Shape Start Result with a saved profile", () =>
  run(code(start, "Shape Start Result"), {
    executed: {
      "Check Profile Exists": {
        runId: "r3",
        needsProfile: false,
        assumptions: [],
        replacing: null,
      },
    },
  }),
);
check(
  savedProfile?.[0]?.json.response.status === "started",
  "an owner who already has a profile still gets told the search started",
);
check(
  !/business profile/.test(savedProfile?.[0]?.json.response.message ?? ""),
  "a saved profile is not read back as though it had been assumed",
);

const assumed = attempt("Shape Start Result with assumptions", () =>
  run(code(start, "Shape Start Result"), {
    executed: {
      "Check Profile Exists": {
        runId: "r4",
        needsProfile: true,
        assumptions: ["a company", "based in Sydney, New South Wales"],
        replacing: null,
      },
      "Read Industry": { industry: "AI research" },
    },
  }),
);
check(
  /working in AI research/.test(assumed?.[0]?.json.response.message ?? ""),
  "the industry read off the website joins the assumptions",
);

const restarted = attempt("Shape Start Result after an interrupted run", () =>
  run(code(start, "Shape Start Result"), {
    executed: {
      "Check Profile Exists": {
        runId: "r5",
        needsProfile: false,
        assumptions: [],
        replacing: { runId: "old", age: 41, reason: "interrupted" },
      },
    },
  }),
);
check(
  /stopped 41 minutes ago/.test(restarted?.[0]?.json.response.message ?? ""),
  "replacing a dead run says what happened to the last one",
);

// --- what the guard does with an open run ----------------------------------

const decide = (rows, force = false) =>
  run(code(start, "Decide Run"), {
    incoming: rows,
    executed: { "Validate Start Input": { valid: true, runId: "new", force } },
  })[0].json;

const live = decide([{ runId: "a", status: "running", ranAt: minutesAgo(3) }]);
check(live.shouldQueue === false, "a search in flight is not started twice");
check(
  live.response.startedMinutesAgo === 3,
  "the owner is told how long the running search has been going",
);
// Pinned as intent rather than wording, because the wording has since been
// rewritten once already and the test went red instead of the behaviour.
check(
  /force/.test(live.response.message) &&
    /never refuse|fresh one now|search again/i.test(live.response.message),
  "waiting on a running search always comes with a way out",
);

check(
  decide([{ runId: "a", status: "running", ranAt: minutesAgo(24) }])
    .replacing?.reason === "interrupted",
  "a run older than twenty minutes is wreckage, not a reason to refuse",
);
check(
  decide([{ runId: "a", status: "running", ranAt: minutesAgo(2) }], true)
    .replacing?.reason === "forced",
  "the owner can override a running search on request",
);
check(
  decide([{ runId: "a", status: "ok", ranAt: minutesAgo(1) }]).shouldQueue === true,
  "a finished run never blocks the next search",
);
check(decide([]).shouldQueue === true, "the first ever search starts");

// --- what the read tool says while a run is open ---------------------------

const shape = (row) =>
  run(code(report, "Shape Report Result"), {
    incoming: [],
    executed: {
      "Validate Report Input": { filter: "open" },
      "Read Latest Run": row ? [row] : [],
    },
  })[0].json.response;

check(
  shape({ runId: "a", status: "running", ranAt: minutesAgo(2) }).running === true,
  "a search that started moments ago reads as running",
);
check(
  /longer than one usually takes/.test(
    shape({ runId: "a", status: "running", ranAt: minutesAgo(7) }).message,
  ),
  "a slow search is flagged as slow rather than promised",
);
// The two tools read the same row and used to disagree about when it goes
// stale: for the ten minutes in between, asking for the report insisted a
// search was in progress while asking to search started a new one.
const windowOf = (source) =>
  Number(source.match(/const DEAD_AFTER = (\d+);/)?.[1] ?? NaN);
check(
  windowOf(code(report, "Shape Report Result")) <=
    windowOf(code(start, "Decide Run")),
  "the report never calls a run live that the start tool would already replace",
);

const dead = shape({ runId: "a", status: "running", ranAt: minutesAgo(38) });
check(dead.interrupted === true, "a run that never came back reads as interrupted");
check(
  dead.running !== true,
  "a dead run is never still described as running, however old the row is",
);
check(
  shape(null).hasRun === false,
  "no run at all is reported as nothing found yet",
);

// --- the report, which does not sit next to the search that made it ---------

// Load Closing Soon is wired between Shape Findings and Write Report, so the
// item arriving at Write Report is a stored opportunity row rather than the
// search. Reading the input instead of naming the node threw away a full
// ten-minute search and reported it as a missing business profile.
const scan = await load("71-run-funding-scan.json");
const storedRow = {
  fingerprint: "abc",
  programName: "Some older program",
  closesAt: "2026-12-01",
};
const searchResult = {
  beatsRun: ["national"],
  beatsAttempted: 1,
  beatsSucceeded: 1,
  failedBeats: [],
  candidates: [{ fingerprint: "f1" }],
  droppedInVerification: [],
  skippedForBudget: 0,
  judgeFailed: false,
  searchCount: 3,
  inputTokens: 100,
  outputTokens: 50,
  findings: [{ fingerprint: "f1" }],
  reportable: [
    {
      fingerprint: "f1",
      programName: "Export Market Development Grant",
      change: "new",
      amountText: "up to $150,000",
      officialUrl: "https://austrade.gov.au/emdg",
      verdictReason: "The published criteria fit a company of this size.",
      deciderCriterion: "Whether the spend counts as eligible promotional expense.",
      sourceTrust: "official",
      closesAt: "2026-09-30",
    },
  ],
};

const written = attempt("Write Report with a search behind it", () =>
  run(code(scan, "Write Report"), {
    self: storedRow,
    incoming: [storedRow],
    executed: {
      "Check Profile": { runId: "r7", staleDays: null },
      "Shape Findings": searchResult,
      "Load Closing Soon": [storedRow],
    },
  }),
);
check(
  written?.[0]?.json.status === "ok",
  "a search that ran is reported as a search that ran",
);
check(
  /Export Market Development Grant/.test(written?.[0]?.json.reportText ?? ""),
  "the programs found reach the report",
);
check(
  !/do not know enough about the business/.test(written?.[0]?.json.reportText ?? ""),
  "a finished search is never reported as a missing business profile",
);
check(
  written?.[0]?.json.searchCount === 3,
  "what the search cost is carried onto the run",
);

const blocked = attempt("Write Report with no search at all", () =>
  run(code(scan, "Write Report"), {
    self: { ready: false },
    executed: { "Check Profile": { runId: "r8", staleDays: null } },
  }),
);
check(
  blocked?.[0]?.json.status === "blocked",
  "a run stopped before searching still writes a run rather than throwing",
);
check(
  /do not know enough about the business/.test(blocked?.[0]?.json.reportText ?? ""),
  "a genuinely empty profile still asks for the business details",
);

const unreadable = attempt("Write Report when the profile could not be read", () =>
  run(code(scan, "Write Report"), {
    self: { ready: false },
    executed: {
      "Check Profile": {
        runId: "r9",
        staleDays: null,
        diagnostic: { rowsReturned: 1, nonEmptyRows: 1, matchedProfileRow: 1 },
      },
    },
  }),
);
check(
  /fault on my side/.test(unreadable?.[0]?.json.reportText ?? ""),
  "details that are saved but unreadable are owned, not blamed on the owner",
);

// --- a search that never reached the web ------------------------------------
// Every beat answers even when its web search never ran, and it answers with
// an empty list. That was written up as "I checked national, regional, nongov
// sources and found nothing new" — a confident account of work that did not
// happen, indistinguishable from genuine good news, and the owner was then
// told their business details were probably too thin.
const searchless = attempt("Write Report when no search ran", () =>
  run(code(scan, "Write Report"), {
    self: storedRow,
    incoming: [storedRow],
    executed: {
      "Check Profile": { runId: "r10", staleDays: null },
      "Shape Findings": {
        ...searchResult,
        beatsRun: ["national", "regional", "nongov"],
        beatsAttempted: 3,
        beatsSucceeded: 3,
        searchCount: 0,
        candidates: [],
        findings: [],
        reportable: [],
      },
      "Load Closing Soon": [],
    },
  }),
);
check(
  searchless?.[0]?.json.status === "failed",
  "a run that searched nothing is not recorded as a clean run",
);
check(
  !/found nothing new/.test(searchless?.[0]?.json.reportText ?? ""),
  "a run that searched nothing never claims to have checked the sources",
);
check(
  /could not search the web/.test(searchless?.[0]?.json.reportText ?? ""),
  "a run that searched nothing says so",
);
check(
  /nothing you need to fix/.test(searchless?.[0]?.json.reportText ?? ""),
  "a fault on this side is not handed to the owner as homework",
);

const emptyButSearched = attempt("Write Report when the search found nothing", () =>
  run(code(scan, "Write Report"), {
    self: storedRow,
    incoming: [storedRow],
    executed: {
      "Check Profile": { runId: "r11", staleDays: null },
      "Shape Findings": {
        ...searchResult,
        searchCount: 9,
        candidates: [],
        findings: [],
        reportable: [],
      },
      "Load Closing Soon": [],
    },
  }),
);
check(
  emptyButSearched?.[0]?.json.status === "ok",
  "a search that looked and found nothing is still a good run",
);
check(
  /I ran 9 searches/.test(emptyButSearched?.[0]?.json.reportText ?? ""),
  "an empty result says how hard it looked, so it can be told from a dud run",
);
check(
  /without a single program to look at/.test(emptyButSearched?.[0]?.json.reportText ?? ""),
  "searching hard and seeing nothing at all is called out as odd, not as no news",
);

const toolBroke = attempt("Write Report when web searches errored", () =>
  run(code(scan, "Write Report"), {
    self: storedRow,
    incoming: [storedRow],
    executed: {
      "Check Profile": { runId: "r12", staleDays: null },
      "Shape Findings": {
        ...searchResult,
        searchCount: 4,
        toolErrors: ["max_uses_exceeded", "max_uses_exceeded"],
      },
      "Load Closing Soon": [],
    },
  }),
);
check(
  toolBroke?.[0]?.json.status === "partial",
  "searches that failed outright downgrade the run rather than passing silently",
);
check(
  /max_uses_exceeded/.test(toolBroke?.[0]?.json.reportText ?? ""),
  "the reason the web went missing reaches the report",
);

// --- what the agent is told when the report is empty ------------------------
// With nothing to go on, the agent invented an explanation and picked the
// worst available one: that the owner had not told it enough about their
// business. The search only runs once a profile is saved, so that is never it.
const emptyRead = run(code(report, "Shape Report Result"), {
  incoming: [],
  executed: {
    "Validate Report Input": { filter: "open" },
    "Read Latest Run": [
      { runId: "a", status: "ok", ranAt: minutesAgo(3), reportText: "Funding scan", searchCount: 0, errorSummary: "no web searches ran" },
    ],
  },
})[0].json.response;
check(
  emptyRead.searchCount === 0,
  "how many searches ran is visible to the agent reading the report",
);
check(
  /never suggest the business profile is missing details/.test(emptyRead.message),
  "the agent is told not to blame the profile for an empty report",
);

// --- what the beat saw, not just what it returned ---------------------------
// Nine real web searches came back with an empty candidate list and no way to
// tell whether that meant everything found had closed or nothing was found at
// all. The two need different fixes and the report said the same words for
// both, so the beat now hands up its working.
const beat = await load("72-run-funding-beat.json");
const shapeBeat = (payload) => {
  const checked = {
    beat: "national",
    scope: "national funding",
    searchCount: 3,
    failed: false,
    firstBody: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  };
  return run(code(beat, "Shape Beat Result"), {
    self: checked,
    executed: { "Check Search Response": checked },
  }).json;
};

const sawAndDropped = attempt("a beat that saw programs and kept none", () =>
  shapeBeat({
    candidates: [],
    considered: 12,
    rejected: [
      { programName: "One", reason: "closed" },
      { programName: "Two", reason: "closed" },
      { programName: "Three", reason: "not-applicable" },
    ],
  }),
);
check(
  sawAndDropped?.considered === 12,
  "how many programs a beat looked at survives the beat",
);
check(
  sawAndDropped?.rejected?.length === 3,
  "the reason each one was set aside survives the beat",
);
check(
  sawAndDropped?.ok === true,
  "reporting its working does not make a good beat look failed",
);

const badLink = attempt("a beat whose candidate had no usable link", () =>
  shapeBeat({
    candidates: [{ programName: "Program with no link", officialUrl: "" }],
    considered: 1,
    rejected: [],
  }),
);
check(
  (badLink?.rejected ?? []).some((entry) => entry.reason === "no usable link"),
  "a candidate dropped for a broken link is no longer dropped in silence",
);

const noCount = attempt("a beat that forgot to count", () =>
  shapeBeat({ candidates: [], rejected: [{ programName: "One", reason: "closed" }] }),
);
check(
  noCount?.considered === 1,
  "a beat that omits the count still accounts for what it rejected",
);

const allClosed = attempt("Write Report when everything found had closed", () =>
  run(code(scan, "Write Report"), {
    self: storedRow,
    incoming: [storedRow],
    executed: {
      "Check Profile": { runId: "r13", staleDays: null },
      "Shape Findings": {
        ...searchResult,
        searchCount: 9,
        candidates: [],
        findings: [],
        reportable: [],
        considered: 12,
        rejected: [
          { programName: "One", reason: "closed" },
          { programName: "Two", reason: "closed" },
          { programName: "Three", reason: "not-applicable" },
        ],
      },
      "Load Closing Soon": [],
    },
  }),
);
check(
  /looked at 12 programs/.test(allClosed?.[0]?.json.reportText ?? ""),
  "a report that found nothing still says how much it went through",
);
check(
  /2 closed/.test(allClosed?.[0]?.json.reportText ?? ""),
  "the reasons are tallied, so a run of closed rounds reads differently from a dud",
);
check(
  !/without a single program to look at/.test(allClosed?.[0]?.json.reportText ?? ""),
  "a beat that saw plenty is not described as having seen nothing",
);

// --- a beat whose request never came back ------------------------------------
// A dropped connection loses the beat's own name with it, and the report then
// said "I could not reach the unknown sources today", which tells nobody which
// sources went missing or whether it matters.
const collect = (results, asked) =>
  run(code(scan, "Collect Candidates"), {
    incoming: results,
    executed: { "Build Beats": asked.map((beat) => ({ beat })) },
  })[0].json;

const oneBeatDied = attempt("Collect Candidates with a beat that never answered", () =>
  collect(
    [
      { beat: "national", ok: true, candidates: [], searchCount: 3, considered: 2, rejected: [{ programName: "One", reason: "closed" }] },
      { beat: "regional", ok: true, candidates: [], searchCount: 3, considered: 0, rejected: [] },
      { error: "The connection was aborted, perhaps the server is offline" },
    ],
    ["national", "regional", "nongov"],
  ),
);
check(
  (oneBeatDied?.failedBeats ?? []).some((entry) => entry.beat === "nongov"),
  "a beat that died is named, so the report can say which sources went missing",
);
check(
  !(oneBeatDied?.beatsRun ?? []).includes("unknown"),
  "no beat is ever reported to the owner as 'unknown'",
);
check(
  oneBeatDied?.considered === 2 && (oneBeatDied?.rejected ?? []).length === 1,
  "the surviving beats' working is still totalled when one of them dies",
);
check(
  (oneBeatDied?.rejected ?? [])[0]?.beat === "national",
  "each rejection carries the beat it came from",
);

// --- the search budget, which the model kept hitting -------------------------
const searchRequest = code(beat, "Build Search Request");
check(
  /max_uses: 10/.test(searchRequest),
  "the beat gets more than three searches, having been refused thirteen times on three",
);
check(
  !/open now or open within the next 90 days/.test(searchRequest),
  "the wide step no longer has to certify a program is open before returning it",
);
check(
  /cannot tell whether it is open/.test(searchRequest),
  "the wide step is told what to do when it cannot tell, rather than left to guess",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Funding run state survives every branch. Checks passed.");
