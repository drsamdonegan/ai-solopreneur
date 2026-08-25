// What a cloud deploy will actually do with this skill's files.
//
// This runs the real functions out of scripts/cloud-workflows.mjs rather than
// restating the rules, because the rules are the thing that changes. A deploy
// that silently fails to publish a tool is not an error anybody sees: it is an
// agent that quietly cannot do the thing it was just given. And a setup
// workflow with no webhook means the learner's tables are never created in the
// cloud at all, which is a bug this repo has already shipped once.
// Run with: node tests/cloud-deploy.test.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeChecker } from "./_harness.mjs";
import { requiredWorkflowIds, setupWebhookPaths, readWorkflowFiles } from "../../../scripts/cloud-workflows.mjs";

const { check, done } = makeChecker("cloud-deploy");
const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "workflows");

const published = requiredWorkflowIds(workflowsDir);
const files = readWorkflowFiles(workflowsDir);

// Every tool the agent can call has to be live, or it is wired to nothing.
const MUST_PUBLISH = [
  "phase19BookkeepingSetup",
  "phase19CheckXeroConnection",
  "phase19SetBookkeepingProfile",
  "phase19StartReconciliationReview",
  "phase19GetReconciliationSuggestions",
  "phase19RecordReconciliationDecision",
  "phase19PrepareGreenMatches",
  "phase19RunReconciliationReview",
  "phase19RunTransactionMatching",
  "phase19RunReceiptLookup",
];
for (const id of MUST_PUBLISH) {
  check(`${id} is published on deploy`, published.includes(id));
}
check("nothing else is published", published.length === MUST_PUBLISH.length,
  published.filter((id) => !MUST_PUBLISH.includes(id)).join(", "));

// The weekly trigger must NOT be published. A review that starts itself on a
// fresh cloud deploy would read somebody's books and spend their money before
// they had asked for anything.
check("the weekly trigger is not published by a deploy", !published.includes("phase19ReconciliationTrigger"));
const trigger = files.find(({ name }) => name.startsWith("107-"));
check("the trigger file exists to be left alone", Boolean(trigger));
check("the trigger ships inactive", trigger.workflow.active === false);
check("the trigger is named so the deploy skips it", /^\d+-trigger-/.test(trigger.name));

// The setup workflow announces itself, so a cloud learner's tables get built
// without them having to find and run anything.
const webhooks = setupWebhookPaths(workflowsDir);
check("the setup workflow announces a webhook", webhooks.includes("setup-bookkeeping-data"), webhooks.join(", "));
check("exactly one setup webhook is announced", webhooks.length === 1, webhooks.join(", "));

// The naming convention is what all of the above keys off, so it is asserted
// directly rather than left implicit.
const LIVE_PREFIX = /^\d+-(tool|setup|internal|confirm|run)-/;
for (const { name, workflow } of files) {
  const isTrigger = /^\d+-trigger-/.test(name);
  if (isTrigger) {
    check(`${name} is not matched by the publish rule`, !LIVE_PREFIX.test(name));
  } else {
    check(`${name} is matched by the publish rule`, LIVE_PREFIX.test(name));
    check(`${name} has an id to publish`, typeof workflow.id === "string" && workflow.id.length > 0);
  }
}

// Every file is in this skill's own numbering block, so a deploy alongside any
// other skill cannot collide.
for (const { name } of files) {
  const number = Number(name.match(/^(\d+)/)[1]);
  const ours = number === 17 || (number >= 100 && number <= 109);
  check(`${name} sits in this skill's reserved numbers`, ours, String(number));
}
check("eleven workflow files ship", files.length === 11, String(files.length));

// The spike is deliberately outside workflows/, so no deploy can ever see it.
check("the spike is not among the deployable files",
  !files.some(({ name }) => name.includes("spike")));

done();
