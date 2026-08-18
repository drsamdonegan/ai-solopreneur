// The funding report goes to one place: the local funding_runs table, which
// the agent reads back in the chat. There is deliberately no outbound delivery
// — no Slack, no Telegram, no email — so a report cannot reach anyone the
// learner did not ask in the moment.
//
// This test exists to keep it that way: adding a delivery hop is a decision,
// not something to slip in while editing the canvas.
import { readFile } from "node:fs/promises";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`../workflows/${name}`, import.meta.url), "utf8"),
  );

const scan = await load("71-run-funding-scan.json");
const beat = await load("72-run-funding-beat.json");
const report = await load("63-tool-get-funding-report.json");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const node = (workflow, name) =>
  workflow.nodes.find((entry) => entry.name === name);

// Anthropic is the only host any funding workflow may reach, plus the local
// chat gateway on loopback.
const allowedHosts = ["api.anthropic.com", "127.0.0.1"];
for (const workflow of [scan, beat, report]) {
  for (const entry of workflow.nodes) {
    if (entry.type !== "n8n-nodes-base.httpRequest") {
      continue;
    }
    const url = String(entry.parameters?.url ?? "");
    check(
      allowedHosts.some((host) => url.includes(host)),
      `${workflow.name}: "${entry.name}" reaches ${url || "an unset URL"}`,
    );
  }
}

// Nothing anywhere should still be wired for a chat platform.
const source = JSON.stringify([scan, beat, report]);
for (const term of ["slack", "telegram", "chat.postMessage", "deliverTo"]) {
  check(
    !new RegExp(term, "i").test(source),
    `a funding workflow still refers to ${term}`,
  );
}

// The report has to land somewhere the read tool can find it.
const save = node(scan, "Save Run");
check(
  save?.parameters?.dataTableId?.value === "funding_runs",
  "the report is not saved to funding_runs",
);
check(
  Object.keys(save?.parameters?.columns?.value ?? {}).includes("reportText"),
  "the saved run does not carry the report text",
);
check(
  save?.parameters?.filters?.conditions?.some(
    (condition) => condition.keyName === "runId",
  ) === true,
  "the saved run is not matched on runId, so a run cannot update its own row",
);

// And the read tool has to read it back.
const read = node(report, "Read Latest Run");
check(
  read?.parameters?.dataTableId?.value === "funding_runs",
  "the read tool does not read funding_runs",
);
check(
  /reportText/.test(node(report, "Shape Report Result")?.parameters?.jsCode ?? ""),
  "the read tool does not return the saved report text",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Funding report stays local and reaches the chat. Checks passed.");
