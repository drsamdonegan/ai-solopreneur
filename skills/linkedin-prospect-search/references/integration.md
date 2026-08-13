# Public-search integration contract

## Capability boundary

This free skill contains no network client, vendor SDK, credential, or hidden data source. It can always validate criteria and generate public search-engine queries. When the host agent already has a general web-search capability, the agent may use it to inspect publicly indexed results without asking the learner to configure a prospect-data API key.

Do not automate a learner's logged-in LinkedIn account, bypass robots or access controls, or describe search-engine snippets as a direct LinkedIn scrape.

## Input

```json
{
  "industry": "Technology, not for profit",
  "location": "Melbourne, Victoria, Australia",
  "role_title": "Founder, Community Lead",
  "company_headcount": "11-50",
  "max_results": 10
}
```

Require industry and location. Role title and company headcount are optional. Keep `max_results` between 1 and 25.

## Search strategy

`build_public_queries` returns a `query_plan` ladder, ordered narrow to broad:

| Scope | Query shape |
| --- | --- |
| `focused` | `site:linkedin.com/company/ "CITY" "INDUSTRY PHRASE 1" "INDUSTRY PHRASE 2"` |
| `widened industry` | `site:linkedin.com/company/ "CITY" ("PHRASE 1" OR "PHRASE 2" OR …)` |
| `location only` | `site:linkedin.com/company/ "CITY"` |
| `off-site fallback` | `LinkedIn company "CITY" "INDUSTRY PHRASE 1" …` |
| `people` | `site:linkedin.com/in/ ("ROLE 1" OR "ROLE 2") "CITY" …` when a role is supplied |

Run the ladder from the top and stop at the first scope with usable results. The off-site fallback helps when a search engine canonicalizes or omits the `site:` result. Widening changes what was searched, never what counts as evidence.

Never quote a whole criterion as one phrase. `"Melbourne, Victoria, Australia"` and `"Technology, not for profit"` are exact strings that essentially no page contains, so the query returns zero and that zero is indistinguishable from a genuine absence of prospects. Only the most specific location component and at most `MAX_QUERY_TERMS` industry phrases constrain a query; remaining location components, surplus industry phrases, and company headcount are returned in `ranking_only_criteria` and scored locally instead.

This mirrors the provider-side rule in LinkedIn Profile Lookup, where live testing showed that *every* location filter — `full_location`, and `country` with either `(.)` or `=` — returned HTTP 200 with `total_count: 0`, so each location-qualified lookup failed silently and looked exactly like a genuine no-match. In both skills the outbound query stays deliberately broad and precision is enforced by local ranking. Neither skill should add a query constraint that has not been shown, against the live service, to leave results intact.

When `rank_public_results` finds nothing, it returns a `message` stating that an empty result is not evidence of absence. Surface that distinction rather than reporting "no prospects found".

## Candidate input for local ranking

The local script accepts candidate objects shaped like:

```json
{
  "url": "https://www.linkedin.com/company/example-org",
  "title": "Example Org | LinkedIn",
  "snippet": "Melbourne technology community and not-for-profit organisation",
  "source_query": "site:linkedin.com/company/ ..."
}
```

Only `url`, `title`, and `snippet` are needed. The script canonicalizes LinkedIn URLs, rejects non-LinkedIn hosts and unsafe schemes, scores visible criteria, and leaves missing evidence unverified.

## Output

```json
{
  "ok": true,
  "mode": "public_search_results",
  "companies": [],
  "people_evidence": [],
  "excluded": [],
  "total_count": 0,
  "search_criteria": {},
  "coverage": "Publicly indexed results only; bounded and potentially stale"
}
```

Never return guessed URLs, personal contact details, raw private page content, or a claim of exhaustive coverage. A company-headcount value is qualified only when the public title or snippet explicitly supports it; otherwise label it unverified.
