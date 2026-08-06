# Integration contract

## Capability boundary

The skill can validate criteria, build provider parameters, clean returned records, and generate manual search queries without an account. It cannot discover live LinkedIn records without an external source of current public data.

Expose a read-only agent tool named `search_linkedin_prospects`. It may be backed by Crustdata, another reviewed sales-intelligence API, or an approved generic web-search service. Keep the tool name and output contract provider-neutral so the skill can move between providers.

Do not automate a learner's logged-in LinkedIn account. LinkedIn's official profile API is authenticated and restricted; it is not a general-purpose prospect-search API. Review current provider terms, LinkedIn terms, privacy obligations, retention rules, permitted prospecting uses, and per-result costs before enabling a live connection.

Primary documentation:

- [Crustdata Person Search](https://docs.crustdata.com/person-docs/search/introduction)
- [Crustdata Person Search reference](https://docs.crustdata.com/person-docs/search/reference)
- [Crustdata Company Search](https://docs.crustdata.com/company-docs/search/introduction)
- [LinkedIn Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api)

## Tool input

```json
{
  "industry": "Health care",
  "location": "Australia",
  "role_title": "Head of Operations",
  "company_headcount": "51-200",
  "max_results": 10,
  "search_type": "Performance optimized"
}
```

Require the first three fields. Keep `max_results` between 1 and 50. Treat `company_headcount` as an optional provider-specific value; do not silently translate it to a different range.

## Tool output

Return a stable, provider-neutral shape:

```json
{
  "ok": true,
  "profiles": [],
  "profile_urls": [],
  "companies": [],
  "company_urls": [],
  "excluded_profiles": [],
  "total_count": 0,
  "credits_cost": null,
  "search_criteria": {},
  "coverage": "Bounded provider result; not exhaustive"
}
```

Each profile may contain only:

- `name`
- `current_title`
- `company`
- `location`
- `profile_url`
- `company_profile_url` when returned by the source
- `headline`
- `industry`
- `company_headcount`
- `criteria_status`
- `match_evidence`
- `unverified_criteria`

Never return raw provider payloads, credentials, personal contact details, or private fields.

## Adapter for the supplied helper

Install `scripts/prospect_search.py` with the custom tool code, then adapt the platform entry point to:

```python
from prospect_search import search_with_helper

results = search_with_helper(
    params,
    lambda search_params: Helper("linkedin_people_search_crustdata").call(
        **search_params
    ),
)
return results
```

The adapter preserves the supplied helper parameters:

- `INDUSTRY`
- `REGION`
- `CURRENT_TITLE`
- `COMPANY_HEADCOUNT`
- `LIMIT`
- `search_type`

It also fixes several portability and quality issues in the original snippet:

- validate required parameters instead of raising an accidental `KeyError`;
- cap result count and reject invalid limits;
- accept common flat and nested response field shapes;
- recognize both `profile_url` and `linkedin_url`;
- canonicalize and deduplicate public LinkedIn URLs;
- return company URLs only when the provider supplied them;
- keep missing fields as `null`, not the misleading string `N/A`;
- return provider failures without exposing raw credential or API errors; and
- avoid logging sample profiles or other prospect data in traces.

## Company URLs versus person URLs

A title such as `Head of Operations` describes a person, not a company. The supplied helper therefore searches people. The adapter returns their public person/profile URLs and deduplicates current-employer LinkedIn URLs when those URLs are present in the response.

If company URLs are the only required output, use a reviewed company-search endpoint for industry, location, and headcount. A separate people search is still required to prove that a company has a person with the requested current title. Do not guess a LinkedIn company slug from the employer name.

## No-credential fallback

Run:

```bash
python3 scripts/prospect_search.py --manual-query \
  --industry "Health care" \
  --location "Australia" \
  --role-title "Head of Operations" \
  --company-headcount "51-200"
```

This prints search-engine query strings for a human or an approved generic web-search tool. It does not execute them and does not claim that the results satisfy company headcount, which normally requires a structured data source.
