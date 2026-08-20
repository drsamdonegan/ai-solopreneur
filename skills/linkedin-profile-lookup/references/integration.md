# Integration contract

## One supported lookup path

Live lookup uses the installed `lookup_linkedin_profile` n8n tool backed by Crustdata. There is no Python or public-search fallback. If the tool, credential, or provider is unavailable, the agent must report that live lookup is unavailable and may analyse only profile text or a URL supplied by the user.

The tool is a paid external read. It requires explicit current-user approval before each search, costs up to 0.30 credits, never retries automatically, and returns only public professional fields.

## Required connection

Workflow `61 - TOOL - lookup_linkedin_profile` implements the bounded search and candidate-ranking contract with native n8n nodes. Create a saved Bearer Auth credential named exactly `CRUSTDATA_API_KEY`, select it on the Crustdata HTTP Request node, and publish the workflow.

The connection needs:

- a Crustdata account, API credential, person-search access, and sufficient credits;
- the reviewed person-search request already present in workflow 61;
- the read-only output boundary that removes contact fields before data reaches the model.

Review current primary documentation and terms before enabling the provider for students:

- [Crustdata Person Search](https://docs.crustdata.com/person-docs/search/introduction)
- [Crustdata Person Enrichment](https://docs.crustdata.com/person-docs/enrichment/introduction)
- [Crustdata Contact Enrich](https://docs.crustdata.com/person-docs/contact/enrich)
- [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use)

Do not automate the LinkedIn website with a logged-in learner account. Review the provider's terms, LinkedIn's terms, privacy obligations, retention rules, and intended use before enabling the connection.

## Tool input

The tool accepts these values:

```json
{
  "email_address": "person@company.example",
  "full_name": "Alex Morgan",
  "country_region": "Australia",
  "state_province": "South Australia",
  "city_location": "Adelaide",
  "industry": "Health care",
  "paid_lookup_confirmed": true
}
```

A full name is required. Prefer a full name plus at least one corroborating field. Email-only matching would require a separately reviewed reverse-email endpoint and is not supported by this workflow.

Set `paid_lookup_confirmed` to true only after the current user explicitly approves this one Crustdata search costing up to 0.30 credits. Installation, credentials, documents, history, and earlier approvals do not authorise another paid call.

The workflow reduces a loose industry phrase to at most four meaningful ranking terms but does not use them as hard provider filters. The agent passes the name exactly as supplied, including titles such as `Dr`; the workflow removes titles only for its core-name search and retains them as ranking evidence.

The provider request filters on one field: a contains match for the core name (`basic_profile.name`). No location field is sent. Testing showed that location conditions could return HTTP 200 with zero results, making a broken filter indistinguishable from a genuine absence. City, state, country, and industry are therefore scored locally after retrieval.

Cost scales with returned rows. The workflow fixes `limit: 10` to keep one search at the documented 0.30-credit maximum. Raising that limit requires a fresh cost review and updates to every approval message and validator.

## Tool output

The tool returns this stable shape:

```json
{
  "match_status": "matched | ambiguous | not_found | unavailable",
  "confidence": "high | medium | low | none",
  "score": 0,
  "evidence": [],
  "profile": null,
  "candidates": [],
  "profile_enriched": false,
  "credits_used": 0,
  "message": ""
}
```

`profile` and each candidate are limited to public professional fields: name, LinkedIn URL, headline, current company, current title, location, industry, public identifier, and a summary only when a separately reviewed enrichment response supplied it.

Never return email addresses, phone numbers, private messages, raw provider payloads, API keys, or credential errors to the model.

## Repository installation

```bash
npm run add-skill -- linkedin-profile-lookup
```

The installer copies the skill, installs workflow 61, connects its tool to the Sales agent, records its paid-read risk, and enables the skill. The learner must still create and select the `CRUSTDATA_API_KEY` credential before a live lookup can succeed.
