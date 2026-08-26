import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = JSON.parse(
  await readFile(join(root, "workflows/59-tool-search-linkedin-prospects.json"), "utf8"),
);
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const code = (name) =>
  workflow.nodes.find((node) => node.name === name)?.parameters?.jsCode;

const validate = new Function("$json", code("Validate Prospect Input"));
let validated = validate({
  session_id: "session",
  request_id: "request",
  job_titles: "Head of Operations",
  sector: "Logistics",
  location: "Australia",
  company_size: "51-200",
  result_limit: 99,
  paid_search_confirmed: false,
}).json;
assert.equal(validated.valid, false);
assert.equal(validated.errorCode, "PAID_SEARCH_APPROVAL_REQUIRED");
assert.equal(validated.searchBody.limit, 10);

validated = validate({
  session_id: "session",
  request_id: "request",
  job_titles: "Head of Operations, COO",
  sector: "Logistics",
  location: "Australia",
  company_size: "51-200",
  result_limit: 5,
  paid_search_confirmed: true,
}).json;
assert.equal(validated.valid, true);
assert.equal(validated.maxCredits, 0.3);
assert.equal(validated.searchBody.limit, 5);
assert.deepEqual(validated.jobTitles, ["Head of Operations", "COO"]);
assert.match(JSON.stringify(validated.searchBody.filters), /current\.title/);
assert.match(JSON.stringify(validated.searchBody.filters), /company_industries/);
assert.match(JSON.stringify(validated.searchBody.filters), /full_location/);
assert.deepEqual(
  validated.searchBody.filters.conditions.filter(
    (condition) => condition.field === "experience.employment_details.current.company_headcount_latest",
  ),
  [
    {
      field: "experience.employment_details.current.company_headcount_latest",
      type: "=>",
      value: 51,
    },
    {
      field: "experience.employment_details.current.company_headcount_latest",
      type: "=<",
      value: 200,
    },
  ],
);

const minimumSize = validate({
  session_id: "session",
  request_id: "request",
  job_titles: "Engineering Manager",
  sector: "Technology",
  location: "Australia",
  company_size: "101+",
  result_limit: 10,
  paid_search_confirmed: true,
}).json;
assert.equal(minimumSize.valid, true);
assert.deepEqual(
  minimumSize.searchBody.filters.conditions.filter(
    (condition) => condition.field === "experience.employment_details.current.company_headcount_latest",
  ),
  [
    {
      field: "experience.employment_details.current.company_headcount_latest",
      type: "=>",
      value: 101,
    },
  ],
);

const rank = new Function("$json", "$", code("Rank Safe Prospects"));
const originalUrl = globalThis.URL;
let ranked;
try {
  // n8n Code nodes do not expose the URL constructor. Keep this test aligned
  // with production instead of accidentally exercising Node's richer global.
  globalThis.URL = undefined;
  ranked = rank(
    {
      statusCode: 200,
      headers: { "x-credits-used": "0.03" },
      body: {
        total_count: 1,
        profiles: [
          {
            basic_profile: {
              name: "Alex Morgan",
              headline: "Operations leader in logistics",
              current_title: "Head of Operations",
              location: { full_location: "Melbourne, Australia" },
              email: "must-not-leak@example.com",
            },
            experience: {
              employment_details: {
                current: [
                  {
                    is_default: true,
                    title: "Head of Operations",
                    name: "Example Logistics",
                    company_industries: ["Logistics"],
                    company_headcount_latest: 120,
                    phone: "+61 400 000 000",
                  },
                ],
              },
            },
            social_handles: {
              professional_network_identifier: {
                profile_url: "https://www.linkedin.com/in/alex-morgan-example",
              },
            },
          },
        ],
      },
    },
    (name) => ({ first: () => ({ json: name === "Validate Prospect Input" ? validated : {} }) }),
  ).json.response;
} finally {
  globalThis.URL = originalUrl;
}

assert.equal(ranked.ok, true);
assert.equal(ranked.search_status, "complete");
assert.equal(ranked.credits_used, 0.03);
assert.equal(ranked.prospects.length, 1);
assert.equal(ranked.returned_matches, 1);
assert.deepEqual(ranked.prospects[0].evidence, [
  "current role",
  "sector",
  "location",
  "company size",
]);
assert.equal(ranked.prospects[0].company_headcount, 120);
assert.doesNotMatch(JSON.stringify(ranked), /must-not-leak|400 000/);

const unreadable = rank(
  {
    statusCode: 200,
    headers: { "x-credits-used": "0.03" },
    body: {
      total_count: 1,
      profiles: [
        {
          basic_profile: { name: "Unsafe URL" },
          social_handles: {
            professional_network_identifier: {
              profile_url: "https://example.com/in/not-linkedin",
            },
          },
        },
      ],
    },
  },
  (name) => ({ first: () => ({ json: name === "Validate Prospect Input" ? validated : {} }) }),
).json.response;
assert.equal(unreadable.ok, false);
assert.equal(unreadable.search_status, "unavailable");
assert.equal(unreadable.returned_matches, 1);
assert.equal(unreadable.error.code, "PROFILE_URLS_UNREADABLE");
assert.equal(unreadable.prospects.length, 0);

assert.equal(manifest.policyEntries[0].risk, "paid_external_read");
assert.equal(manifest.policyEntries[0].mode, "explicit_per_search_credit_approval");
assert.match(manifest.agentTools[0].parameters.description, /up to 0\.30 credits/);
assert.equal(workflow.meta.maximumCreditsPerRun, 0.3);
assert.equal(workflow.meta.maximumResultsPerRun, 10);
assert.equal(
  workflow.nodes.filter((node) => node.name === "Search Crustdata Prospects").length,
  1,
);

process.stdout.write("Prospect criteria, approval, cost, evidence, and contact-data boundaries passed.\n");
