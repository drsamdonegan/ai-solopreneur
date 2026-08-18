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
check(
  /search again anyway/.test(live.response.message),
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
    shape({ runId: "a", status: "running", ranAt: minutesAgo(14) }).message,
  ),
  "a slow search is flagged as slow rather than promised",
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Funding run state survives every branch. Checks passed.");
