// This skill reads somebody's bank feed and their mailbox. There is deliberately
// no outbound delivery — no Slack, no Telegram, no email — so a review cannot
// reach anyone the user did not ask in the moment, and exactly one node in the
// whole skill is allowed to change anything in Xero.
//
// This test exists to keep it that way: adding a delivery hop or a second write
// path is a decision, not something to slip in while editing the canvas.
// Run with: node tests/host-allowlist.test.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeChecker } from "./_harness.mjs";

const { check, done } = makeChecker("host-allowlist");
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "workflows");
const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
const workflows = files.map((name) => [name, JSON.parse(readFileSync(join(dir, name), "utf8"))]);

check("every workflow file is loaded", workflows.length === 11, `found ${workflows.length}`);

const ALLOWED_HOSTS = ["api.xero.com", "identity.xero.com", "api.anthropic.com", "gmail.googleapis.com", "127.0.0.1"];
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const CREDENTIAL_NAMES = ["Xero (read-only)", "Xero (read-write)", "Gmail (read-only)", "Anthropic account"];
const THE_ONE_WRITE_FILE = "108-tool-prepare-green-matches.json";

const httpNodes = [];
for (const [name, workflow] of workflows) {
  for (const node of workflow.nodes ?? []) {
    if (node.type === "n8n-nodes-base.httpRequest") httpNodes.push({ file: name, node });
  }
}
check("there are HTTP nodes to check", httpNodes.length > 0);

for (const { file, node } of httpNodes) {
  const url = String(node.parameters?.url ?? "");
  // An expression URL still has to name its host literally, so it can be read here.
  const known = ALLOWED_HOSTS.some((host) => url.includes(host));
  check(`${file} · ${node.name} reaches only an allowed host`, known, url.slice(0, 90));
}

// Exactly one node, in one file, may change anything in Xero.
const xeroWrites = httpNodes.filter(({ node }) =>
  String(node.parameters?.url ?? "").includes("api.xero.com")
  && WRITE_METHODS.includes(String(node.parameters?.method ?? "GET").toUpperCase()));
check("exactly one node writes to Xero", xeroWrites.length === 1,
  xeroWrites.map((entry) => `${entry.file}·${entry.node.name}`).join(", "));
if (xeroWrites.length === 1) {
  check("the only Xero write lives in the prepare tool", xeroWrites[0].file === THE_ONE_WRITE_FILE, xeroWrites[0].file);
  check("the only Xero write is a create-only PUT", String(xeroWrites[0].node.parameters.method).toUpperCase() === "PUT");
  check("the only Xero write asks Xero not to summarise errors",
    String(xeroWrites[0].node.parameters.url).includes("SummarizeErrors=false"));
}

// The write credential must not be reachable from anything but the write tool
// and the connection check that reports on it.
const WRITE_CREDENTIAL_FILES = new Set([THE_ONE_WRITE_FILE, "100-tool-check-xero-connection.json"]);
for (const [file, workflow] of workflows) {
  for (const node of workflow.nodes ?? []) {
    for (const [type, credential] of Object.entries(node.credentials ?? {})) {
      check(`${file} · ${node.name} credential carries only id and name`,
        JSON.stringify(Object.keys(credential).sort()) === '["id","name"]');
      check(`${file} · ${node.name} uses a known credential`,
        CREDENTIAL_NAMES.includes(credential.name), credential.name);
      if (credential.name === "Xero (read-write)") {
        check(`${file} may hold the write credential`, WRITE_CREDENTIAL_FILES.has(file), file);
      }
      check(`${file} · ${node.name} credential type is plausible`, typeof type === "string" && type.length > 0);
    }
  }
}

// No outbound delivery anywhere, and no secrets in the files.
for (const [file, workflow] of workflows) {
  const source = JSON.stringify(workflow);
  for (const banned of ["slack", "telegram", "chat.postMessage", "deliverTo", "sendgrid", "mailgun", "webhook.site"]) {
    check(`${file} contains no ${banned}`, !source.toLowerCase().includes(banned.toLowerCase()));
  }
  check(`${file} carries no Anthropic secret`, !/sk-ant-|ANTHROPIC_API_KEY|"apiKey"/.test(source));
  check(`${file} ships inactive`, workflow.active === false);
}

// The report the user reads must come from the run row, and be read back by the
// tool that reports it — not regenerated somewhere else.
const runWorkflow = workflows.find(([name]) => name === "105-run-reconciliation-review.json")[1];
const runSource = JSON.stringify(runWorkflow);
check("the review saves its report to the runs table", runSource.includes("reportText"));
const getWorkflow = workflows.find(([name]) => name === "103-tool-get-reconciliation-suggestions.json")[1];
check("the read-back tool returns the saved report", JSON.stringify(getWorkflow).includes("reportText"));

// The trigger must ship off, and must not be the thing that reaches Xero itself.
const trigger = workflows.find(([name]) => name.startsWith("107-"))[1];
check("the weekly trigger ships switched off", trigger.active === false);
check("the weekly trigger makes no HTTP call of its own",
  !(trigger.nodes ?? []).some((node) => node.type === "n8n-nodes-base.httpRequest"));

done();
