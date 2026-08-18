import { readFile } from "node:fs/promises";

const workflow = JSON.parse(
  await readFile(
    new URL("../workflows/71-run-funding-scan.json", import.meta.url),
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Funding Slack delivery checks passed.");
