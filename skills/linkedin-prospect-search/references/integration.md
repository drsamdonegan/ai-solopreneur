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

Generate at least these public queries:

- `site:linkedin.com/company/ "LOCATION" "INDUSTRY"`
- `site:linkedin.com/in/ "ROLE" "LOCATION" "INDUSTRY"` when a role is supplied
- one broader company query combining the same criteria with `LinkedIn`

The broader query helps when a search engine canonicalizes or omits the `site:` result. It does not relax the evidence requirements.

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
