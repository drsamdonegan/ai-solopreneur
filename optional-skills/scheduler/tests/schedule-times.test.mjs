// A schedule is only ever as good as its clock. Every bug this file pins is one
// nobody would see for weeks: an 8am job that fires at six in the evening
// because the container runs on UTC, an hour that walks by one when daylight
// saving starts, or a run that hands back the moment it just ran and therefore
// goes off again five minutes later, and again, and again.
//
// The maths lives inside a Code node, so it is lifted out of the workflow file
// and exercised directly. Nothing here talks to n8n.
import { readFile } from "node:fs/promises";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`../workflows/${name}`, import.meta.url), "utf8"),
  );

const create = await load("76-tool-create-schedule.json");
const trigger = await load("79-trigger-scheduled-runs.json");
const code = (workflow, name) =>
  workflow.nodes.find((entry) => entry.name === name).parameters.jsCode;

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// The shared block sits at the top of every Code node that needs it, ending
// where that node's own work begins.
const maths = new Function(
  code(trigger, "Shape Run Result").split("const job =")[0] +
    "\nreturn { nextRunAfter, inWords, patternInWords, zoneIsReal };",
)();

// --- the clock stays where the owner put it --------------------------------

const ZONES = [
  "Australia/Melbourne",
  "Europe/London",
  "America/New_York",
  "Pacific/Auckland",
  "Asia/Kolkata",
  "UTC",
];
const RULES = [
  { frequency: "daily", timeOfDay: "08:00" },
  { frequency: "daily", timeOfDay: "02:30" },
  { frequency: "weekdays", timeOfDay: "17:30" },
  { frequency: "weekly", timeOfDay: "09:00", dayOfWeek: "sunday" },
  { frequency: "monthly", timeOfDay: "12:00", dayOfMonth: 28 },
];

for (const timezone of ZONES) {
  for (const shape of RULES) {
    const rule = { ...shape, timezone };
    const clocks = new Set();
    let at = new Date("2026-01-01T00:00:00Z");
    let stalled = false;
    let dead = false;

    // A whole year of hops, over both daylight saving changes in every zone
    // that has them.
    for (let hop = 0; hop < 400; hop += 1) {
      const next = maths.nextRunAfter(rule, at);
      if (next === null) {
        dead = true;
        break;
      }
      if (next.getTime() <= at.getTime()) {
        stalled = true;
        break;
      }
      // Asked again at the exact instant it just ran, it has to move on. If it
      // hands back the same moment, the trigger finds it due again on the next
      // beat and the schedule runs every five minutes for ever.
      const again = maths.nextRunAfter(rule, next);
      if (again === null || again.getTime() <= next.getTime()) {
        stalled = true;
        break;
      }
      clocks.add(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(next),
      );
      at = next;
      if (at.getTime() > Date.parse("2027-01-01T00:00:00Z")) break;
    }

    const label = `${timezone} ${shape.frequency} ${shape.timeOfDay}`;
    check(!dead, `${label}: ran out of future runs inside one year`);
    check(!stalled, `${label}: handed back a run that would fire again immediately`);
    // 02:30 is the one wall time that genuinely does not exist on the morning
    // the clocks go forward, so it is allowed to slip to 03:30 that once.
    const expected = shape.timeOfDay === "02:30" ? 2 : 1;
    check(
      clocks.size <= expected,
      `${label}: the wall clock drifted to ${[...clocks].join(", ")}`,
    );
  }
}

// --- the two mornings a year the clocks move -------------------------------

const MELBOURNE = "Australia/Melbourne";
const nextIso = (rule, from) => {
  const next = maths.nextRunAfter(rule, new Date(from));
  return next === null ? null : next.toISOString();
};
const daily8 = { frequency: "daily", timeOfDay: "08:00", timezone: MELBOURNE };

// Melbourne puts its clocks forward on 4 October 2026: 8am becomes UTC+11.
check(
  nextIso(daily8, "2026-10-03T02:00:00Z") === "2026-10-03T21:00:00.000Z",
  "8am the morning the clocks go forward should be 21:00 UTC, not 22:00",
);
// And back on 5 April 2026, where 8am returns to UTC+10.
check(
  nextIso(daily8, "2026-04-04T01:00:00Z") === "2026-04-04T22:00:00.000Z",
  "8am the morning the clocks go back should be 22:00 UTC, not 21:00",
);

// --- what create_schedule makes of what a person actually says -------------

const validate = code(create, "Validate And Plan");
const SESSION = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";

const plan = (fields, rows = []) => {
  const items = (rows.length === 0 ? [{}] : rows).map((json) => ({ json }));
  const lookup = (name) => {
    if (name !== "Tool Input") {
      throw new Error(`Referenced node "${name}" is unexecuted`);
    }
    return { first: () => ({ json: { sessionId: SESSION, requestId: REQUEST, ...fields } }) };
  };
  const input = { all: () => items, first: () => items[0] };
  return new Function("$", "$json", "$input", validate)(lookup, {}, input)[0].json;
};

const asked = (fields) =>
  plan({
    instruction: "Research mlai.au and say what changed",
    frequency: "daily",
    time: "8am",
    timezone: MELBOURNE,
    ...fields,
  });

// A model passes on the words it was given, so the tool reads the words.
for (const [spoken, expected] of [
  ["8am", "08:00"],
  ["8 AM", "08:00"],
  ["08:00", "08:00"],
  ["0800", "08:00"],
  ["5:30pm", "17:30"],
  ["5.30 pm", "17:30"],
  ["17:30", "17:30"],
  ["noon", "12:00"],
  ["midnight", "00:00"],
  ["12am", "00:00"],
  ["12pm", "12:00"],
]) {
  check(
    asked({ time: spoken }).timeOfDay === expected,
    `"${spoken}" should be read as ${expected}`,
  );
}
for (const nonsense of ["", "soon", "in the morning", "25:00", "8:99"]) {
  check(
    asked({ time: nonsense }).response?.error?.code === "TIME_REQUIRED",
    `"${nonsense}" is not a time and should send the agent back to ask`,
  );
}

for (const [spoken, expected] of [
  ["tuesday", "tuesday"],
  ["Tuesdays", "tuesday"],
  ["tue", "tuesday"],
  ["SAT", "saturday"],
]) {
  check(
    asked({ frequency: "weekly", dayOfWeek: spoken }).dayOfWeek === expected,
    `"${spoken}" should be read as ${expected}`,
  );
}

for (const [spoken, expected] of [
  ["daily", "daily"],
  ["every day", "daily"],
  ["weekdays", "weekdays"],
  ["work days", "weekdays"],
  ["every week", "weekly"],
  ["monthly", "monthly"],
  ["once", "once"],
]) {
  check(
    asked({ frequency: spoken }).frequency === expected,
    `"${spoken}" should be read as ${expected}`,
  );
}

// Nothing shorter than a day, whatever it is called.
for (const tooOften of ["hourly", "every hour", "every 5 minutes", "continuously"]) {
  check(
    asked({ frequency: tooOften }).response?.error?.code === "FREQUENCY_NOT_RECOGNISED",
    `"${tooOften}" should be refused rather than rounded to daily`,
  );
}

// A day that does not exist in February would silently never run.
check(
  asked({ frequency: "monthly", dayOfMonth: "31" }).dayOfMonth === 28,
  "the 31st of every month should be pulled back to the 28th",
);
check(
  asked({ frequency: "monthly", dayOfMonth: "31" }).assumptions.length > 0,
  "pulling the 31st back to the 28th has to be reported, not done quietly",
);

// The agent that owns the skill is the one that can run it.
check(
  asked({ agent: "marketing" }).agentId === "marketing",
  "a named agent should be kept",
);
check(
  asked({ agent: "" }).agentId === "project-manager",
  "no named agent falls back to the project manager",
);
check(
  asked({ agent: "legal" }).response?.error?.code === "AGENT_NOT_RECOGNISED",
  "an agent that does not exist should be refused, not silently swapped",
);

// A guessed timezone is the failure nobody sees, so it is always reported.
const guessed = asked({ timezone: "" });
check(
  guessed.assumptions.some((line) => line.includes("timezone")) ||
    guessed.warnings.some((line) => line.includes("UTC")),
  "a timezone the tool had to guess must come back as an assumption or a warning",
);
check(
  asked({ timezone: "Mars/Olympus" }).response?.error?.code === "TIMEZONE_NOT_RECOGNISED",
  "a timezone that does not exist should be refused",
);

// A one-off in the past would sit there for ever looking scheduled.
check(
  asked({ frequency: "once", date: "2020-01-01" }).response?.error?.code === "TIME_ALREADY_PAST",
  "a one-off whose date has gone should be refused",
);

// Asking for the same thing twice is a correction, not a second schedule.
const existing = {
  scheduleId: "sch-abc12345",
  name: "Funding check",
  createdAt: "2026-01-01T00:00:00.000Z",
  enabled: "yes",
  runCount: 4,
};
const again = plan(
  {
    name: "funding  CHECK",
    instruction: "Look for grants",
    frequency: "daily",
    time: "7am",
    timezone: MELBOURNE,
  },
  [existing],
);
check(again.scheduleId === "sch-abc12345", "the same name should land on the same schedule");
check(again.replaced === true, "replacing an existing schedule has to be reported");
check(again.runCount === 4, "replacing a schedule must not lose how often it has run");
check(
  again.createdAt === "2026-01-01T00:00:00.000Z",
  "replacing a schedule must not rewrite when it was created",
);

// Ten is the limit, and the eleventh has to say so rather than fail oddly.
const ten = Array.from({ length: 10 }, (unused, index) => ({
  scheduleId: `sch-0000000${index}`,
  name: `Job ${index}`,
  enabled: "yes",
}));
check(
  plan(
    { name: "One more", instruction: "Do a thing", frequency: "daily", time: "8am" },
    ten,
  ).response?.error?.code === "TOO_MANY_SCHEDULES",
  "an eleventh schedule should be refused with a reason",
);
check(
  plan(
    { name: "Job 3", instruction: "Do a thing", frequency: "daily", time: "8am" },
    ten,
  ).valid === true,
  "changing one of the ten is not adding an eleventh",
);

// An instruction is read on its own later, so there has to be one.
check(
  asked({ instruction: "" }).response?.error?.code === "INSTRUCTION_REQUIRED",
  "a schedule with nothing to do should be refused",
);
check(
  plan({ instruction: "Do a thing", time: "8am", sessionId: "not-a-uuid" }).response?.error
    ?.code === "INVALID_SESSION",
  "a schedule cannot be saved without a real conversation ID",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Schedule times, timezones, and what a person actually says. Checks passed.");
