import { readFile } from "node:fs/promises";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`../workflows/${name}`, import.meta.url), "utf8"),
  );
const scan = await load("71-run-funding-scan.json");
const trigger = await load("76-trigger-daily-funding-scan.json");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const node = (name) => scan.nodes.find((entry) => entry.name === name);

const schedule = trigger.nodes.find(
  (entry) => entry.type === "n8n-nodes-base.scheduleTrigger",
);
const interval = schedule?.parameters?.rule?.interval?.[0];
check(trigger.active === false, "daily funding trigger must ship inactive");
check(
  interval?.field === "days" &&
    interval?.daysInterval === 1 &&
    interval?.triggerAtHour === 8 &&
    interval?.triggerAtMinute === 0,
  "daily funding trigger is not scheduled for 08:00",
);
check(
  trigger.nodes.some(
    (entry) =>
      entry.name === "Run Funding Scan" &&
      entry.parameters?.workflowId?.value === "phase15RunFundingScan",
  ),
  "daily trigger does not call the shared funding scan workflow",
);
check(
  trigger.meta?.externalWrite === "none",
  "daily funding trigger claims an outbound write",
);

const guard = new Function("$input", "$", "$json", node("Guard In-Flight Run").parameters.jsCode);
const runGuard = (rows) =>
  guard(
    { all: () => rows.map((json) => ({ json })) },
    () => ({ first: () => ({ json: { runId: "new-run" } }) }),
    rows[0] ?? {},
  ).map((item) => item.json);
check(
  runGuard([
    { runId: "live", status: "running", ranAt: new Date().toISOString() },
  ])[0]?.allowed === false,
  "shared scan path did not block an in-flight run",
);
check(
  runGuard([
    {
      runId: "stale",
      status: "running",
      ranAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
    },
  ])[0]?.allowed === true,
  "a stale run blocked funding forever",
);
check(
  scan.connections?.["Run Input"]?.main?.[0]?.[0]?.node ===
    "Read In-Flight Runs" &&
    scan.connections?.["No Scan Running?"]?.main?.[0]?.[0]?.node ===
      "Load Funding Profile",
  "concurrency guard is not in the shared run path",
);

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Inactive daily schedule and shared scan concurrency checks passed.");
