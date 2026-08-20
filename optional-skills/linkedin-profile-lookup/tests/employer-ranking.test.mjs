// A search for "Caitlin Shepard" returns forty-eight people, and until now the
// only things separating them were the name itself and a location that half of
// LinkedIn leaves blank. The employer the owner actually named — "who works at
// Stone & Chalk" — was dropped before the request was built, so the answer came
// back as three Americans matched on name alone.
//
// These run the tool's own two code nodes over a fixture of that search.
import { readFile } from "node:fs/promises";

const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`../workflows/${name}`, import.meta.url), "utf8"),
  );

const lookup = await load("61-tool-lookup-linkedin-profile.json");
const code = (name) =>
  lookup.nodes.find((entry) => entry.name === name).parameters.jsCode;

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const run = (source, { self = {}, executed = {} }) => {
  const lookupNode = (name) => {
    if (!(name in executed)) {
      throw new Error(`Referenced node "${name}" is unexecuted`);
    }
    const items = [executed[name]].flat().map((json) => ({ json }));
    return { first: () => items[0], all: () => items, item: items[0] };
  };
  const input = { first: () => ({ json: self }), all: () => [{ json: self }] };
  return new Function("$", "$json", "$input", source)(lookupNode, self, input);
};

const validate = (fields) =>
  run(code("Validate Lookup Input"), {
    self: {
      session_id: "s",
      request_id: "r",
      full_name: "Caitlin Shepard",
      paid_lookup_confirmed: true,
      ...fields,
    },
  }).json;

// --- the company reaches the tool at all -----------------------------------
const asked = validate({
  company_name: "Stone & Chalk",
  country_region: "Australia",
  city_location: "Melbourne",
});
check(
  asked.companyName === "Stone & Chalk",
  "the employer the owner named survives validation instead of being dropped",
);
check(
  JSON.stringify(asked.companyTerms ?? []) === JSON.stringify(["stone", "chalk"]),
  `the employer is reduced to its distinctive words, got ${JSON.stringify(asked.companyTerms)}`,
);
check(
  JSON.stringify(validate({ company_name: "Stone and Chalk Pty Ltd" }).companyTerms ?? []) ===
    JSON.stringify(["stone", "chalk"]),
  "how a person says the name and how a profile writes it come to the same terms",
);
check(
  (validate({}).companyTerms ?? []).length === 0,
  "no employer named is no employer scored, not a crash",
);

// --- the ranking, over the search that failed -------------------------------
const profile = (name, company, location) => ({
  basic_profile: {
    name,
    location: { full_location: location },
    professional_network_name: name,
  },
  experience: { employment_details: { current: [{ is_default: true, name: company }] } },
  social_handles: {
    professional_network_identifier: {
      profile_url: `https://linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${company.toLowerCase().replace(/[^a-z]+/g, "")}`,
    },
  },
});

const rank = (input, profiles) =>
  run(code("Rank Safe Candidates"), {
    self: { statusCode: 200, body: { profiles, total_count: profiles.length }, headers: {} },
    executed: { "Validate Lookup Input": input },
  }).json.response;

// Her profile carries no location, which is ordinary on LinkedIn and is
// precisely when the employer is the only thing that can tell her apart. With
// a location on it the old scoring already found her; without one it could not,
// and that is the search the owner actually ran.
const rightPerson = profile("Caitlin Shepard", "Stone & Chalk", "");
const namesakes = [
  profile("Caitlin Shepard", "Kaiser Permanente", "Denver, Colorado, United States"),
  profile("Caitlin Shepard", "Wells Fargo", "Charlotte, North Carolina, United States"),
  profile("Caitlin Shepard", "Target", "Minneapolis, Minnesota, United States"),
];

const withCompany = rank(asked, [...namesakes, rightPerson]);
check(
  withCompany.profile?.current_company === "Stone & Chalk",
  `the person at the named employer is the one returned, got ${withCompany.profile?.current_company}`,
);
check(
  withCompany.match_status === "matched",
  `name plus employer is enough to call it a match, got ${withCompany.match_status}`,
);
check(
  (withCompany.evidence ?? []).includes("named employer"),
  "the reply can say the employer is why, rather than asserting a match",
);

// The same search without the employer is the one the owner got: four people
// who share a name, nothing to choose between them.
const withoutCompany = rank(validate({}), [...namesakes, rightPerson]);
check(
  withoutCompany.match_status !== "matched",
  "a name on its own still refuses to guess, which was right all along",
);
check(
  withoutCompany.profile === null || withoutCompany.profile?.current_company !== "Stone & Chalk",
  "without the employer there is nothing to raise her above three namesakes",
);

// An employer named and nobody at it: say so, rather than leaving the owner to
// wonder whether it was used.
const noneThere = rank(asked, namesakes);
check(
  noneThere.match_status !== "matched",
  "namesakes elsewhere are not promoted just because the list is short",
);

// A partial hit — "Stone" alone — should help, but not as much as both words.
const partial = rank(asked, [profile("Caitlin Shepard", "Stone Group", "Sydney, Australia")]);
check(
  (partial.candidates ?? partial.evidence ?? []).length >= 0 && partial.match_status !== "matched",
  "half an employer name is not a match on its own",
);

// --- what the provider is actually asked ------------------------------------
// The whole search was one condition on the name. Location is deliberately not
// a filter — it makes Crustdata return nobody — so "in Melbourne" only ever
// re-ranked whoever the name brought back. The employer now narrows the search
// itself, with the name-only search kept as a fallback so a filter the
// provider does not honour can never leave the owner worse off than before.
const narrowed = validate({ company_name: "Stone & Chalk", city_location: "Melbourne", country_region: "Australia" });
const conditions = narrowed.searchBody.filters.conditions ?? [narrowed.searchBody.filters];
check(
  conditions.some((c) => c.field === "basic_profile.name"),
  "the name is still asked for",
);
check(
  conditions.some((c) => String(c.field).includes("employment_details.current")),
  "the employer is asked of the provider, not just scored over what comes back",
);
check(
  !JSON.stringify(narrowed.searchBody).includes("location"),
  "location stays out of the filters, which is what empties the result set",
);
check(
  JSON.stringify(narrowed.fallbackBody?.filters) ===
    JSON.stringify({ field: "basic_profile.name", type: "(.)", value: "Caitlin Shepard" }),
  "a name-only search is kept ready for when the narrowed one finds nobody",
);
check(
  narrowed.maxCredits === 0.6,
  `two searches means two searches' worth of ceiling, got ${narrowed.maxCredits}`,
);

const plain = validate({ city_location: "Melbourne" });
check(
  (plain.fallbackBody ?? null) === null && plain.maxCredits === 0.3,
  "no employer named means one search and the ceiling it always had",
);
check(
  JSON.stringify(plain.searchBody.filters) ===
    JSON.stringify({ field: "basic_profile.name", type: "(.)", value: "Caitlin Shepard" }),
  "without an employer the search is what it always was",
);

// --- how much the agent is allowed to see -----------------------------------
// It was shown three of forty-eight and told the owner none of the forty-eight
// were at Stone & Chalk or in Melbourne, which it had no way of knowing.
const many = Array.from({ length: 20 }, (_, index) =>
  profile("Caitlin Shepard", `Company ${index}`, "Somewhere"),
);
const shown = rank(validate({}), many);
check(
  (shown.candidates ?? []).length === 10,
  `ten candidates reach the agent, not three, got ${(shown.candidates ?? []).length}`,
);
check(
  shown.candidates_shown === 10 && shown.total_matches === 20,
  "the agent is told how many it is looking at against how many exist, so it stops describing the rest",
);
check(
  typeof shown.searched_on === "string" && shown.searched_on.length > 0,
  "the reply can say which search produced it",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Employer reaches the lookup and decides it. Checks passed.");
