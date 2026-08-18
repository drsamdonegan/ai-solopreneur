import { readFile } from "node:fs/promises";

const workflow = JSON.parse(
  await readFile(
    new URL("../workflows/71-run-funding-scan.json", import.meta.url),
    "utf8",
  ),
);
const dailyTrigger = JSON.parse(
  await readFile(
    new URL("../workflows/76-trigger-daily-funding-scan.json", import.meta.url),
    "utf8",
  ),
);
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const node = (name) => workflow.nodes.find((entry) => entry.name === name);
const runNode = (name, { input, nodes }) => {
  const fn = new Function(
    "$input",
    "$",
    "$json",
    node(name).parameters.jsCode,
  );
  const wrap = (rows) => ({
    all: () => rows.map((json) => ({ json })),
    first: () => ({ json: rows[0] ?? {} }),
  });
  return fn(
    wrap(input),
    (nodeName) => wrap(nodes[nodeName] ?? []),
    input[0] ?? {},
  ).map((item) => item.json);
};

const post = node("Post To Slack");
check(
  post?.credentials?.httpHeaderAuth?.name === "Slack bot token",
  "funding Slack delivery has no named Header Auth credential",
);
check(
  post?.parameters?.options?.response?.response?.neverError === true,
  "funding Slack delivery does not preserve the response body on failure",
);

const failed = runNode("Read Slack Delivery", {
  input: [{ statusCode: 200, body: { ok: false, error: "not_in_channel" } }],
  nodes: {
    "Write Report": [
      { runId: "fund-slack", errorSummary: "one source failed" },
    ],
  },
});
check(
  failed.length === 1 && failed[0].runId === "fund-slack",
  "a failed funding Slack delivery did not identify its run",
);
check(
  failed[0].errorSummary.includes("not_in_channel"),
  "a failed funding Slack delivery did not record Slack's error",
);
check(
  runNode("Read Slack Delivery", {
    input: [{ statusCode: 200, body: { ok: true } }],
    nodes: { "Write Report": [{ runId: "fund-slack", errorSummary: "" }] },
  }).length === 0,
  "a successful funding Slack delivery was recorded as a failure",
);

const failureUpdate = node("Record Slack Failure");
check(
  failureUpdate?.parameters?.operation === "update" &&
    failureUpdate?.parameters?.dataTableId?.value === "funding_runs" &&
    failureUpdate?.parameters?.filters?.conditions?.some(
      (condition) => condition.keyName === "runId",
    ),
  "funding Slack failures are not written back to the matching run",
);

const schedule = dailyTrigger.nodes.find(
  (entry) => entry.type === "n8n-nodes-base.scheduleTrigger",
);
const interval = schedule?.parameters?.rule?.interval?.[0];
check(dailyTrigger.active === false, "daily funding trigger must ship inactive");
check(
  interval?.field === "days" &&
    interval?.daysInterval === 1 &&
    interval?.triggerAtHour === 8 &&
    interval?.triggerAtMinute === 0,
  "daily funding trigger is not scheduled for 08:00",
);
check(
  dailyTrigger.nodes.some(
    (entry) =>
      entry.name === "Run Funding Scan" &&
      entry.parameters?.workflowId?.value === "phase15RunFundingScan",
  ),
  "daily trigger does not call the shared funding scan workflow",
);

const recentRun = runNode("Guard In-Flight Run", {
  input: [{ runId: "already-running", status: "running", ranAt: new Date().toISOString() }],
  nodes: { "Run Input": [{ runId: "new-run" }] },
});
check(
  recentRun[0]?.allowed === false &&
    recentRun[0]?.blockingRunId === "already-running",
  "shared scan path did not block an in-flight run",
);
const staleRun = runNode("Guard In-Flight Run", {
  input: [
    {
      runId: "stale-run",
      status: "running",
      ranAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
    },
  ],
  nodes: { "Run Input": [{ runId: "new-run" }] },
});
check(staleRun[0]?.allowed === true, "a stale run blocked funding forever");
check(
  workflow.connections?.["Run Input"]?.main?.[0]?.[0]?.node ===
    "Read In-Flight Runs" &&
    workflow.connections?.["No Scan Running?"]?.main?.[0]?.[0]?.node ===
      "Load Funding Profile",
  "concurrency guard is not in the shared run path",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Funding delivery, daily schedule, and concurrency checks passed.");
