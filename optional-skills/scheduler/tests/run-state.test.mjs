// Two branches merge into one node all over these workflows, and n8n treats
// reading a node that did not execute as an error rather than an undefined.
// That is the failure that cost the funding skill an afternoon: HTTP 200, zero
// bytes, an execution record marked success, and an owner told nothing had
// happened. So every branch is exercised here with a harness that throws on an
// unexecuted node exactly as n8n does.
//
// It also pins what the trigger is allowed to do on its own: one job per beat,
// never the same job twice, and nothing run hours after the fact.
import { readFile } from "node:fs/promises";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`../workflows/${name}`, import.meta.url), "utf8"),
  );

const create = await load("76-tool-create-schedule.json");
const list = await load("77-tool-list-schedules.json");
const update = await load("78-tool-update-schedule.json");
const trigger = await load("79-trigger-scheduled-runs.json");
const code = (workflow, name) =>
  workflow.nodes.find((entry) => entry.name === name).parameters.jsCode;

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// `executed` names the nodes that ran on the branch under test. Anything else
// throws, which is what n8n does and what an unbranched read does not survive.
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

const MELBOURNE = "Australia/Melbourne";
const SESSION = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const minutesAway = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

const savedSchedule = (over = {}) => ({
  scheduleId: "sch-aaaaaaaa",
  name: "Morning research",
  instruction: "Research mlai.au and say what changed",
  agentId: "marketing",
  frequency: "daily",
  timeOfDay: "08:00",
  dayOfWeek: "",
  dayOfMonth: 0,
  onDate: "",
  timezone: MELBOURNE,
  enabled: "yes",
  savedAt: "2026-08-01T00:00:00.000Z",
  nextRunAt: minutesAway(60),
  lastRunAt: "",
  lastStatus: "",
  lastSummary: "",
  runCount: 0,
  ...over,
});

// --- the trigger picks one job, and only one -------------------------------

const pick = code(trigger, "Pick What Is Due");
const picked = attempt("Pick What Is Due with several due", () =>
  run(pick, {
    incoming: [
      savedSchedule({ scheduleId: "sch-recent", nextRunAt: minutesAgo(1) }),
      savedSchedule({ scheduleId: "sch-oldest", nextRunAt: minutesAgo(20) }),
      savedSchedule({ scheduleId: "sch-paused", enabled: "no", nextRunAt: minutesAgo(99) }),
      savedSchedule({ scheduleId: "sch-later", nextRunAt: minutesAway(30) }),
    ],
  }),
);
check(picked?.length === 1, "one beat starts one job, however many are due");
check(
  picked?.[0]?.json.scheduleId === "sch-oldest",
  "the job waiting longest goes first",
);
check(picked?.[0]?.json.waiting === 1, "the ones left over should be counted, not forgotten");
check(picked?.[0]?.json.run === true, "a job one minute late is simply late");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
check(
  UUID.test(picked?.[0]?.json.sessionId ?? "") && UUID.test(picked?.[0]?.json.requestId ?? ""),
  "the agent rejects anything that is not a real UUID, so both have to be real ones",
);
const repeat = run(pick, {
  incoming: [savedSchedule({ scheduleId: "sch-oldest", nextRunAt: minutesAgo(20) })],
});
check(
  repeat[0].json.sessionId === picked?.[0]?.json.sessionId,
  "one schedule keeps one conversation rather than meeting a stranger every day",
);

check(
  run(pick, { incoming: [savedSchedule({ nextRunAt: minutesAway(5) })] }).length === 0,
  "nothing due means nothing runs",
);
check(
  run(pick, { incoming: [savedSchedule({ enabled: "no", nextRunAt: minutesAgo(60) })] }).length === 0,
  "a paused schedule stays paused however overdue it looks",
);
check(run(pick, { incoming: [{}] }).length === 0, "an empty table is not an error");
check(
  run(pick, { incoming: [savedSchedule({ nextRunAt: "" })] }).length === 0,
  "a schedule with no next run should sit still rather than fire immediately",
);

// Six hours late means the agent was not running. Rolling it on is the point:
// opening a laptop at dinner should not set off the morning's work.
const late = run(pick, { incoming: [savedSchedule({ nextRunAt: minutesAgo(7 * 60) })] });
check(late[0].json.run === false, "a job seven hours late is skipped, not run late");
const justInside = run(pick, { incoming: [savedSchedule({ nextRunAt: minutesAgo(5 * 60) })] });
check(justInside[0].json.run === true, "a job five hours late is still worth running");

// --- what happens to the row afterwards ------------------------------------

const job = picked?.[0]?.json ?? {};
const shapeRun = code(trigger, "Shape Run Result");

const answered = attempt("Shape Run Result after a real answer", () =>
  run(shapeRun, {
    self: { reply: "Nothing has changed on the site since yesterday." },
    executed: { "Pick What Is Due": { ...job, runCount: 3 } },
  }),
);
check(answered?.[0]?.json.status === "ok", "an answer is a run that worked");
check(answered?.[0]?.json.runCount === 4, "a run that worked counts");
check(
  Date.parse(answered?.[0]?.json.nextRunAt ?? "") > Date.now(),
  "the next run has to be in the future or the job fires again on the next beat",
);
check(
  answered?.[0]?.json.lastSummary.length <= 300,
  "the one-line summary is a summary, not the whole answer",
);

// The empty 200 is the shape that made every tool-using agent look healthy
// while telling the owner nothing had happened.
const emptyBody = run(shapeRun, { self: {}, executed: { "Pick What Is Due": job } });
check(emptyBody[0].json.status === "failed", "an empty answer is a failure, not a quiet success");
check(
  emptyBody[0].json.errorSummary.length > 0,
  "a failed run has to say something the owner can act on",
);
const refused = run(shapeRun, {
  self: { errorMessage: "That agent is not available yet." },
  executed: { "Pick What Is Due": job },
});
check(
  refused[0].json.errorSummary === "That agent is not available yet.",
  "the agent's own reason should be kept rather than replaced with a generic one",
);
check(
  Date.parse(refused[0].json.nextRunAt ?? "") > Date.now(),
  "a failed run still moves on; it must not retry every five minutes",
);

const oneOff = run(shapeRun, {
  self: { reply: "Done." },
  executed: { "Pick What Is Due": { ...job, frequency: "once", onDate: "2026-08-19" } },
});
check(oneOff[0].json.enabled === "no", "a one-off switches itself off after it runs");
check(oneOff[0].json.nextRunAt === "", "a one-off has no next run");

const skipped = attempt("Shape Missed Run", () =>
  run(code(trigger, "Shape Missed Run"), {
    self: {},
    executed: { "Pick What Is Due": { ...late[0].json, runCount: 2 } },
  }),
);
check(skipped?.[0]?.json.status === "missed", "a skipped run is recorded as missed");
check(
  skipped?.[0]?.json.runCount === undefined,
  "a run that never happened must not count as one",
);
check(
  Date.parse(skipped?.[0]?.json.nextRunAt ?? "") > Date.now(),
  "a missed run rolls on to its next time",
);

// --- the branch that skips the write --------------------------------------

// The invalid branch goes straight to the audit, so the audit may not read
// anything on the branch that did not run.
const refusal = run(code(create, "Validate And Plan"), {
  executed: { "Tool Input": { sessionId: "nope", requestId: "nope" } },
  incoming: [{}],
})[0].json;
attempt("Prepare Audit on the refused branch of create_schedule", () =>
  run(code(create, "Prepare Audit"), {
    self: refusal,
    executed: { "Validate And Plan": refusal },
  }),
);
const audited = run(code(create, "Prepare Audit"), {
  self: refusal,
  executed: { "Validate And Plan": refusal },
});
check(
  audited.json.error.length > 0 && audited.json.toolName === "create_schedule",
  "a refused call still has to leave an audit row saying why",
);
attempt("Return Tool Result after a refusal", () =>
  run(code(create, "Return Tool Result"), {
    self: { id: 7 },
    executed: { "Prepare Audit": audited.json },
  }),
);

// A save that silently did nothing must not be reported as saved.
const plan = run(code(create, "Validate And Plan"), {
  executed: {
    "Tool Input": {
      sessionId: SESSION,
      requestId: REQUEST,
      instruction: "Research mlai.au",
      frequency: "daily",
      time: "8am",
      timezone: MELBOURNE,
    },
  },
  incoming: [{}],
})[0].json;
const lost = run(code(create, "Shape Save Result"), {
  self: {},
  executed: { "Validate And Plan": plan },
});
check(lost[0].json.response.ok === false, "a write that returned nothing is not a save");
const saved = run(code(create, "Shape Save Result"), {
  self: { id: 3, scheduleId: plan.scheduleId },
  executed: { "Validate And Plan": plan },
});
check(saved[0].json.response.ok === true, "a write that returned a row is a save");
check(
  saved[0].json.response.notes.some((line) => line.includes("79 - TRIGGER")),
  "while nothing has ever run, the agent has to be told the trigger may not be published",
);
check(
  saved[0].json.response.notes.some((line) => line.includes("confirm")),
  "the agent has to know a scheduled run cannot confirm a write",
);

// --- pausing, resuming, deleting ------------------------------------------

const validateChange = code(update, "Validate Change");
const change = (fields, rows) =>
  run(validateChange, {
    executed: { "Tool Input": { sessionId: SESSION, requestId: REQUEST, ...fields } },
    incoming: rows,
  })[0].json;

const row = savedSchedule({ nextRunAt: minutesAgo(30) });
check(
  change({ scheduleId: row.scheduleId, action: "pause" }, [row]).enabled === "no",
  "pause switches the schedule off",
);
check(
  change({ name: "morning research", action: "delete" }, [row]).deleting === true,
  "a schedule can be found by name when the ID is not to hand",
);
check(
  change({ scheduleId: row.scheduleId, action: "" }, [row]).response?.error?.code ===
    "ACTION_REQUIRED",
  "delete cannot be undone, so the tool refuses to guess which action was meant",
);
check(
  change({ scheduleId: "sch-nothere", action: "pause" }, [row]).response?.error?.message.includes(
    row.scheduleId,
  ),
  "an unknown ID should name what does exist rather than just failing",
);

// A schedule left off for a fortnight must not fire the moment it comes back.
const resumed = change({ scheduleId: row.scheduleId, action: "resume" }, [
  savedSchedule({ enabled: "no", nextRunAt: minutesAgo(20000) }),
]);
check(resumed.enabled === "yes", "resume switches it back on");
check(
  Date.parse(resumed.nextRunAt) > Date.now(),
  "resume works the next run out from now, not from when it was paused",
);
check(
  change({ scheduleId: row.scheduleId, action: "resume" }, [
    savedSchedule({ enabled: "no", frequency: "once", onDate: "2020-01-01" }),
  ]).response?.error?.code === "CANNOT_RESUME",
  "a one-off whose time has gone cannot be resumed",
);

// Both branches merge into one node, so neither may read the other.
const deleting = change({ scheduleId: row.scheduleId, action: "delete" }, [row]);
const pausing = change({ scheduleId: row.scheduleId, action: "pause" }, [row]);
for (const [label, plan_, result] of [
  ["delete", deleting, { id: 12, scheduleId: row.scheduleId }],
  ["pause", pausing, { id: 12, scheduleId: row.scheduleId }],
]) {
  const shaped = attempt(`Shape Change Result after ${label}`, () =>
    run(code(update, "Shape Change Result"), {
      self: result,
      executed: { "Validate Change": plan_ },
    }),
  );
  check(shaped?.[0]?.json.response.ok === true, `${label} that worked should be reported as done`);
}
const missed = run(code(update, "Shape Change Result"), {
  self: {},
  executed: { "Validate Change": deleting },
});
check(
  missed[0].json.response.ok === false,
  "a change that altered no row must not be reported as done",
);

// --- reading it all back ---------------------------------------------------

const shapeList = code(list, "Shape List Result");
const listed = (wanted, schedules, results) =>
  run(shapeList, {
    executed: {
      "Validate List Input": { sessionId: SESSION, requestId: REQUEST, scheduleId: wanted },
      "Read Schedules": schedules.length === 0 ? [{}] : schedules,
    },
    incoming: results.length === 0 ? [{}] : results,
  })[0].json.response;

check(
  listed("", [], []).schedules.length === 0 && listed("", [], []).ok === true,
  "nothing scheduled is an answer, not an error",
);

const ran = savedSchedule({
  runCount: 3,
  lastRunAt: minutesAgo(90),
  lastStatus: "ok",
  lastSummary: "Nothing changed.",
});
const results = [
  {
    scheduleId: ran.scheduleId,
    ranAt: minutesAgo(90),
    status: "ok",
    reply: "Nothing has changed on the site since yesterday.",
    errorSummary: "",
  },
  {
    scheduleId: ran.scheduleId,
    ranAt: minutesAgo(1530),
    status: "failed",
    reply: "",
    errorSummary: "The agent returned an empty answer.",
  },
];

const overview = listed("", [ran], results);
check(overview.schedules[0].runsWhen === "every day at 8:00 am", "when it runs, in words");
check(overview.schedules[0].nextRun.includes(MELBOURNE), "the next run is read in the owner's own timezone");
check(
  overview.schedules[0].lastResult.opening.length > 0,
  "the overview carries the opening of the last answer so the owner can see it worked",
);

const paused = listed("", [savedSchedule({ enabled: "no" })], []);
check(paused.schedules[0].status === "paused", "a paused schedule says so");
check(paused.schedules[0].nextRun === "", "a paused schedule has no next run to promise");
check(
  paused.notes.some((line) => line.includes("79 - TRIGGER")),
  "when nothing has ever run, say the trigger may not be published",
);

const one = listed(ran.scheduleId, [ran], results);
check(one.recentRuns.length === 2, "asking about one schedule reads back what it actually said");
check(
  one.recentRuns[0].reply.includes("Nothing has changed"),
  "the full answer is what the owner wanted, not a summary of a summary",
);
check(
  listed("sch-nothere", [ran], results).error?.code === "SCHEDULE_NOT_FOUND",
  "an ID that does not exist should say so rather than list everything",
);

// A long answer must not crowd out the conversation it is read into.
const huge = Array.from({ length: 5 }, (unused, index) => ({
  scheduleId: ran.scheduleId,
  ranAt: minutesAgo(index * 1440),
  status: "ok",
  reply: "x".repeat(9000),
  errorSummary: "",
}));
const capped = listed(ran.scheduleId, [ran], huge);
check(
  capped.recentRuns.reduce((total, entry) => total + entry.reply.length, 0) <= 7000,
  "five long answers have to be trimmed before they are handed to the agent",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Branches, run state, and what the agent is allowed to claim. Checks passed.");
