// Runs the real "Score Messages" and "Plan Run" code nodes out of the workflow
// JSON against a fixture inbox, with no API calls. This is the checkpoint the
// whole skill rests on: if a month of mail does not come down to the right
// handful, nothing downstream matters.
import { readFile } from "node:fs/promises";

const WORKFLOW = new URL("../workflows/74-run-monthly-update.json", import.meta.url);
const workflow = JSON.parse(await readFile(WORKFLOW, "utf8"));
const jsOf = (name) => workflow.nodes.find((node) => node.name === name).parameters.jsCode;

function runNode(name, { input = [], nodes = {} }) {
  const fn = new Function("$input", "$", "$json", `${jsOf(name)}`);
  const wrap = (rows) => ({
    all: () => rows.map((json) => ({ json })),
    first: () => ({ json: rows[0] ?? {} }),
  });
  const lookup = (nodeName) => {
    if (!(nodeName in nodes)) throw new Error(`fixture missing node ${nodeName}`);
    return wrap(nodes[nodeName]);
  };
  return fn(wrap(input), lookup, input[0] ?? {}).map((item) => item.json);
}

// ---------------------------------------------------------------- fixtures
const PROFILE_ROW = {
  profileId: "default",
  companyName: "Northwind",
  oneLiner: "Ops software for logistics teams",
  domainAliases: "northwind.io",
  founderNames: "sam donegan,priya rao",
  teamNames: "",
  investorNames: "foundry ventures",
  investorDomains: "foundry.vc",
  customerNames: "acme,brightpath",
  customerDomains: "acme.com,brightpath.co",
  prospectNames: "",
  prospectDomains: "",
  competitorNames: "",
  competitorDomains: "",
  positiveKeywords: "ledger",
  negativeKeywords: "cycling club",
  stage: "seed",
  audience: "team",
  deliverTo: "chat-only",
};

const message = (id, { subject, from, to = "sam@northwind.io", cc = "", snippet = "", labels = ["INBOX"], headers = {} }) => ({
  statusCode: 200,
  body: {
    id,
    threadId: `t-${id}`,
    internalDate: String(Date.parse("2026-07-15T10:00:00Z")),
    snippet,
    labelIds: labels,
    payload: {
      headers: [
        { name: "Subject", value: subject },
        { name: "From", value: from },
        { name: "To", value: to },
        ...(cc ? [{ name: "Cc", value: cc }] : []),
        ...Object.entries(headers).map(([name, value]) => ({ name, value })),
      ],
    },
  },
});

const INBOX = [
  ["customer-signed", message("m1", {
    subject: "Re: Northwind pilot — we're in",
    from: "Dana Ruiz <dana@acme.com>",
    snippet: "Legal signed off this morning. 12-month contract, starting 1 August.",
  }), "keep"],
  ["investor-reply", message("m2", {
    subject: "Re: June update",
    from: "Marcus Webb <marcus@foundry.vc>",
    snippet: "Good month. Happy to make those intros, send me the list.",
  }), "keep"],
  ["customer-invoice", message("m3", {
    subject: "Signed contract + invoice details",
    from: "ap@brightpath.co",
    snippet: "Attaching the countersigned contract. Please invoice monthly.",
  }), "keep"],
  ["founder-thread", message("m4", {
    subject: "Ledger import is still the blocker",
    from: "Priya Rao <priya@northwind.io>",
    snippet: "Three accounts stalled at import this month. We should fix it first.",
  }), "keep"],
  ["outage", message("m5", {
    subject: "Incident: reporting down 40 minutes",
    from: "alerts@northwind.io",
    snippet: "Root cause was the migration. Postmortem attached.",
  }), "keep"],
  ["stripe-receipt", message("m6", {
    subject: "Your receipt from Stripe",
    from: "receipts@stripe.com",
    snippet: "Payment received. Amount $49.00",
  }), "drop"],
  ["newsletter", message("m7", {
    subject: "The Logistics Weekly — 12 things we learned",
    from: "hello@logisticsweekly.com",
    snippet: "This week in supply chain. Unsubscribe at any time.",
    headers: { "List-Unsubscribe": "<mailto:u@logisticsweekly.com>", "List-Id": "lw.logisticsweekly.com" },
  }), "drop"],
  ["linkedin", message("m8", {
    subject: "Sam, you have 3 new connection requests",
    from: "notifications@linkedin.com",
    labels: ["INBOX", "CATEGORY_SOCIAL"],
  }), "drop"],
  ["otp", message("m9", {
    subject: "Your verification code is 449021",
    from: "no-reply@somesaas.com",
    snippet: "Your one-time password expires in 10 minutes.",
  }), "drop"],
  ["calendar", message("m10", {
    subject: "Invitation: Coffee @ Thu Jul 9",
    from: "calendar-notification@google.com",
    headers: { "Auto-Submitted": "auto-generated" },
  }), "drop"],
  ["marketing-blast", message("m11", {
    subject: "50% off your first year",
    from: "sales@toolvendor.com",
    labels: ["INBOX", "CATEGORY_PROMOTIONS"],
  }), "drop"],
  ["negative-keyword", message("m12", {
    subject: "Cycling club ride on Sunday",
    from: "organiser@ridesocial.com",
    snippet: "Meeting at the usual spot, 7am.",
  }), "drop"],
];

// ------------------------------------------------------------------- plan
const plan = runNode("Plan Run", {
  input: [],
  nodes: {
    "Run Input": [{ runId: "mu-test", month: "2026-07", audience: "" }],
    "Load Company Profile": [PROFILE_ROW],
  },
})[0];

const failures = [];
if (!plan.ready) failures.push(`Plan Run refused a valid profile: ${plan.errorSummary}`);
if (plan.monthLabel !== "July 2026") failures.push(`month label was "${plan.monthLabel}"`);
if (!plan.query.includes("-category:promotions")) failures.push("query is missing the category exclusions");
if (plan.profile.domainAliases[0] !== "northwind.io") failures.push("domain alias did not survive into the profile");

// ------------------------------------------------------------------ score
const scored = runNode("Score Messages", {
  input: INBOX.map(([, response]) => response),
  nodes: {
    "Plan Run": [plan],
    "Collect Message Ids": [{ messagesListed: INBOX.length, messagesExamined: INBOX.length }],
  },
});

const survivors = new Map();
for (const chunk of scored) {
  for (const candidate of chunk.candidates ?? []) survivors.set(candidate.messageId, candidate);
}

console.log(`Fixture inbox: ${INBOX.length} messages -> ${survivors.size} candidates\n`);
const idFor = (index) => `m${index + 1}`;
for (const [index, [label, , expected]] of INBOX.entries()) {
  const id = idFor(index);
  const candidate = survivors.get(id);
  const actual = candidate ? "keep" : "drop";
  const mark = actual === expected ? "ok  " : "FAIL";
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  console.log(`  ${mark} ${label.padEnd(18)} ${actual.padEnd(5)} ${candidate ? `score ${candidate.score}` : ""}`);
}

// ---------------------------------------------------- empty-inbox handling
const empty = runNode("Score Messages", {
  input: INBOX.filter(([, , expected]) => expected === "drop").map(([, response]) => response),
  nodes: {
    "Plan Run": [plan],
    "Collect Message Ids": [{ messagesListed: 7, messagesExamined: 7 }],
  },
});
if (empty[0].hasCandidates !== false) failures.push("an inbox of pure noise still produced candidates");
if (empty[0].stopReason !== "no_candidates") failures.push(`noise-only inbox stopReason was "${empty[0].stopReason}"`);

// ------------------------------------------------------- no profile at all
const noProfile = runNode("Plan Run", {
  input: [],
  nodes: { "Run Input": [{ runId: "mu-test", month: "", audience: "" }], "Load Company Profile": [] },
})[0];
if (noProfile.ready !== false || noProfile.stopReason !== "no_profile") {
  failures.push("a missing profile did not stop the run");
}

// ------------------------------------------- classification request shape
const request = scored[0].requestBody;
if (request.tool_choice?.name !== "report_classifications") failures.push("classifier does not force its tool");
if (!request.system.includes("never invent a message ID")) failures.push("classifier prompt lost the invented-ID rule");
if (request.messages[0].content.includes("northwind.io") === false) failures.push("classifier prompt lost the company context");

console.log("");
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All scorer checks passed.");
