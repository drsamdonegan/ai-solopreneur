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
// Nothing but the name, and that is now a measured fact rather than an
// assumption. Location filters make Crustdata return nobody, and a live search
// for "Caitlin Shepard" at "Stone & Chalk" filtered on
// experience.employment_details.current.name came back empty the same way. So
// the employer is scored over the results instead, and the search body has to
// stay a single name condition or every search silently finds no one.
const narrowed = validate({ company_name: "Stone & Chalk", city_location: "Melbourne", country_region: "Australia" });
check(
  JSON.stringify(narrowed.searchBody.filters) ===
    JSON.stringify({ field: "basic_profile.name", type: "(.)", value: "Caitlin Shepard" }),
  "the search asks for the name and nothing else, whatever else the owner gave",
);
// Only the filters, not the fields: the employer is still *retrieved* from
// each result, which is what the local scoring reads.
check(
  !JSON.stringify(narrowed.searchBody.filters).toLowerCase().includes("location") &&
    !JSON.stringify(narrowed.searchBody.filters).includes("employment_details"),
  "neither location nor employer goes back into the filters, which empties them",
);
check(
  JSON.stringify(narrowed.searchBody.fields).includes("employment_details.current"),
  "the employer is still asked for in the results, or there is nothing to score",
);
check(
  narrowed.maxCredits === 0.3,
  `one search, one ceiling, got ${narrowed.maxCredits}`,
);
check(
  narrowed.searchScope === "name only",
  "the scope says name only, so a wide result is never read as a targeted one",
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

// --- the work email as an employer, from #20 --------------------------------
// The other half of knowing where someone works. An address at the company
// domain says it as plainly as the owner naming it, and for a name shared by
// forty-eight people it is the difference between a match and a shrug.
const byEmail = validate({ email_address: "caitlin@stoneandchalk.com.au" });
check(
  byEmail.employerHint === "stoneandchalk",
  `the registrable label is the employer, got ${byEmail.employerHint}`,
);
check(
  validate({ email_address: "caitlin@gmail.com" }).employerHint === "",
  "a free-mail address says nothing about an employer and is not treated as one",
);
check(
  validate({ email_address: "caitlin@stone-chalk.co.uk" }).employerHint === "stonechalk",
  "a two-part suffix is stripped to the registrable label, not the country",
);
check(
  validate({}).employerHint === "",
  "no email is no hint, not a crash",
);

const domainMatch = rank(byEmail, [
  ...namesakes,
  profile("Caitlin Shepard", "Stoneandchalk", ""),
]);
check(
  domainMatch.match_status === "matched",
  `a work email domain matching the employer is enough to decide it, got ${domainMatch.match_status}`,
);
check(
  (domainMatch.evidence ?? []).includes("work email domain matches employer"),
  "the reply can say the email domain is why",
);

// Both signals point at one fact, so they are worth 22 between them, not 44.
const both = rank(
  validate({ company_name: "Stone & Chalk", email_address: "caitlin@stoneandchalk.com.au" }),
  [profile("Caitlin Shepard", "Stone & Chalk", "")],
);
check(
  both.score === 76,
  `the owner saying it and the email saying it is one fact scored once, got ${both.score}`,
);
check(
  (both.evidence ?? []).includes("named employer"),
  "the evidence still names why, even when only one of the two signals lands",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Employer reaches the lookup and decides it. Checks passed.");
