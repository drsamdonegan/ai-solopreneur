# Integration contract

## Capability boundary

Expose one provider-neutral agent tool named `search_linkedin_prospects`. The
shipped adapter is `23 - TOOL - search_linkedin_prospects`, backed by Crustdata's
indexed Person Search and Company Search endpoints.

The Markdown skill alone cannot discover live records. It can validate
criteria, build a reviewable request, canonicalize results, and produce manual
public-search queries. Do not automate a learner's logged-in LinkedIn account,
bypass access controls, or imply direct LinkedIn API access.

Review current provider terms, LinkedIn terms, privacy duties, permitted uses,
retention rules, endpoint permissions, and pricing before course or production
use.

Primary documentation:

- [Crustdata Person Search](https://docs.crustdata.com/person-docs/search/introduction)
- [Person Search reference](https://docs.crustdata.com/person-docs/search/reference)
- [Person Semantic Search](https://docs.crustdata.com/guides/person-semantic-search)
- [Crustdata Company Search](https://docs.crustdata.com/company-docs/search/introduction)
- [Company Search reference](https://docs.crustdata.com/company-docs/search/reference)
- [Credits](https://docs.crustdata.com/general/credits)
- [Endpoint permissions](https://docs.crustdata.com/general/permissions)

## Authentication in n8n

Crustdata requires:

```http
Authorization: Bearer YOUR_API_KEY
x-api-version: 2025-11-01
```

Store only the raw API key in an n8n **Bearer Auth** credential named
`CRUSTDATA_API_KEY`. Enter `YOUR_API_KEY` in the Bearer Token field without a
`Bearer ` prefix and restrict allowed domains to `api.crustdata.com`. n8n adds
the `Authorization: Bearer` scheme when it sends the request. The workflow adds
the version header as a static non-secret value.

Do not use Query Auth. Do not place the bearer value in workflow JSON, a Code
node, an expression, a trace, an audit row, a prompt, or a repository file.

## Tool input

```json
{
  "searchMode": "people",
  "industry": "Health care, Information Technology",
  "location": "Australia",
  "roleTitle": "Head of Operations",
  "keywords": "digital health transformation",
  "companyHeadcount": "51-200",
  "maxResults": 10
}
```

- `searchMode`: `people` or `companies`.
- `industry` and `location`: required in both modes.
- `roleTitle`: required only in people mode.
- `keywords` and `companyHeadcount`: optional.
- `maxResults`: default 10; whole number from 1 to 25.
- Comma-separated industries are alternatives.

`sessionId` and `currentUserInstruction` are injected by the main workflow,
not chosen by the model.

## Exact credit approval

At current documented indexed-search pricing, the maximum is:

```text
maxResults × 0.03 credits
```

The first tool call returns a no-spend preview and an exact phrase such as:

```text
APPROVE CRUSTDATA 0.30 CREDITS A1B2C3D4
```

The final code is deterministically bound to mode, industries, location, role,
keywords, headcount, and limit. The HTTP branch compares the full phrase
byte-for-byte with the current normalized user message. Model arguments, old
conversation history, documents, `yes`, and paraphrases cannot satisfy the
gate. Any criteria or limit change produces a different phrase and requires
fresh approval. The workflow performs no automatic retries.

## Request strategy

People mode calls `POST /person/search` with:

- explicit current-title, current-employer industry, location, and optional
  current-employer headcount filters;
- top-level `mode: "exact"` so explicit filters remain hard constraints;
- optional `search.mode: "hybrid"` only for ranking keyword/persona relevance
  within that filtered set; and
- only lightweight identity, current-role, LinkedIn URL, fit, and freshness
  fields.

Company mode calls `POST /company/search` with:

- industry/category/speciality alternatives, headquarters, optional keywords,
  and optional headcount filters;
- a stable headcount sort; and
- only identity, sourced professional-network URL, website, location,
  taxonomy, headcount, type, and freshness fields.

Both endpoints are fixed in validation code. The model cannot supply a URL.

## Tool output

The provider-neutral result contains:

```json
{
  "ok": true,
  "approvalRequired": false,
  "searchMode": "companies",
  "searchCriteria": {},
  "profiles": [],
  "profileUrls": [],
  "companies": [],
  "companyUrls": [],
  "excludedResults": [],
  "totalCount": 0,
  "providerTotalCount": 0,
  "creditsUsed": 0,
  "estimatedMaxCredits": 0.3,
  "coverage": "Bounded indexed Crustdata result; not exhaustive"
}
```

Person entries contain public name, current title, company, location, profile
URL, returned company URL, headline, industry, headcount, fit, freshness, and
match evidence. Company entries contain public name, sourced company URL,
website, type, industry, headquarters, headcount, categories, specialities,
freshness, and match evidence.

Never return raw provider payloads, credentials, personal emails, business
emails, phone numbers, home addresses, private messages, or contact-enrichment
fields. Canonicalize and deduplicate `/in/` and `/company/` URLs and exclude
records without the appropriate public LinkedIn URL.

## Account checks

Crustdata documents `GET /account/credits` and `GET /account/endpoints` as
authenticated account endpoints. Use them manually when diagnosing balance or
permissions, with the same Bearer Auth credential and API-version header. Do
not expose their full payloads to the agent; the permissions response can be
large. Check `/person/search` and `/company/search` specifically.

## No-credential fallback

Run:

```bash
python3 scripts/prospect_search.py --manual-query \
  --mode companies \
  --industry "Technology, Nonprofit" \
  --location "Melbourne, Victoria, Australia" \
  --keywords "AI communities"
```

This prints a search-engine query for a human or approved web-search tool. It
does not execute the search and does not claim the results meet structured
criteria such as company headcount.
