// A webhook trigger node without a `webhookId` gets its production path built
// from its own name: `{workflowId}/{encodeURIComponent(name.toLowerCase())}/webhook`.
// n8n stores that path encoded, but looks up incoming requests by the DECODED
// path (Express decodes route params). So a node whose name contains a space
// is stored as "telegram%20message" and looked up as "telegram message", and
// the production webhook can never match — n8n answers every real message with
// "not registered" while the workflow sits there looking published and healthy.
//
// Pinning a `webhookId` sidesteps the whole naming question: the path becomes
// "{webhookId}/webhook", which has nothing in it to encode. It must stay
// stable, because changing it changes the URL n8n hands to the outside service.
//
// This test exists because the failure is invisible from the editor: the only
// symptom is a bot that never answers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// Trigger nodes whose provider calls back over a webhook.
const WEBHOOK_TRIGGERS = new Set(["n8n-nodes-base.telegramTrigger"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

for (const dir of ["n8n/workflows", "optional-skills/telegram-trigger/workflows"]) {
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url)).sort()) {
    if (!name.endsWith(".json")) continue;
    const workflow = JSON.parse(
      readFileSync(new URL(`../${join(dir, name)}`, import.meta.url), "utf8"),
    );
    for (const node of workflow.nodes ?? []) {
      if (!WEBHOOK_TRIGGERS.has(node?.type)) continue;
      const where = `${dir}/${name} -> "${node.name}"`;
      check(
        typeof node.webhookId === "string" && UUID.test(node.webhookId),
        `${where} needs a stable uuid webhookId, or its path is derived from its name and a space in that name makes it unreachable`,
      );
    }
  }
}

// The two copies of a skill's workflow are shipped as one thing; a webhookId
// that differs between them is a bot that works until the skill is reinstalled.
const idIn = (path) => {
  const workflow = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  return workflow.nodes.find((node) => node.type === "n8n-nodes-base.telegramTrigger")?.webhookId;
};
check(
  idIn("n8n/workflows/70-trigger-telegram-message.json") ===
    idIn("optional-skills/telegram-trigger/workflows/70-trigger-telegram-message.json"),
  "the shipped and installed copies of the Telegram trigger disagree on webhookId",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Webhook triggers have stable, encoding-proof paths. Checks passed.");
