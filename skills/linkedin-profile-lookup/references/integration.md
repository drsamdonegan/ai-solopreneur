# Integration contract

## Required connection

The skill is instructions, not a network connector. To perform a live lookup, expose a read-only agent tool named `lookup_linkedin_profile` backed by an approved professional-data provider.

The supplied Python uses this existing helper:

```python
Helper("linkedin_people_search_crustdata").call(**search_params)
```

That helper must already exist in the agent platform and must have its own Crustdata credential or managed connection. The local n8n agent does not define `params` or `Helper`, so the original snippet cannot run there unchanged. This repository instead includes `n8n/workflows/61-tool-lookup-linkedin-profile.json`, which implements the same bounded search and candidate-ranking contract with native n8n nodes and a saved Bearer Auth credential.

Crustdata's current API documentation describes separate endpoints for person search and profile enrichment. A production connection therefore normally needs:

- a Crustdata account, API credential, permission for the chosen endpoints, and sufficient credits;
- one person-search request to find candidate profile URLs;
- one person-enrichment request after a candidate is confidently selected;
- a read-only tool boundary that removes contact fields before returning data to the model.

Review the current primary documentation before implementation:

- [Crustdata Person Search](https://docs.crustdata.com/person-docs/search/introduction)
- [Crustdata Person Enrichment](https://docs.crustdata.com/person-docs/enrichment/introduction)
- [Crustdata Contact Enrich](https://docs.crustdata.com/person-docs/contact/enrich)
- [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use)

Do not automate the LinkedIn website with a logged-in learner account. Use an approved API/provider and review its terms, LinkedIn's terms, privacy obligations, retention rules, and the intended use before enabling the connection for students.

## Tool input

Expose these optional strings, requiring at least `full_name` or `email_address`:

```json
{
  "email_address": "person@company.example",
  "full_name": "Alex Morgan",
  "country_region": "Australia",
  "state_province": "South Australia",
  "city_location": "Adelaide",
  "industry": "Health care"
}
```

Prefer a full name plus at least one corroborating field. The bundled matcher intentionally refuses to perform a name-search from an email alone because the provided people-search helper has no email parameter. Email-only matching needs a separately approved reverse-email lookup endpoint.

The native n8n workflow reduces a loose industry phrase to at most four meaningful ranking terms, but deliberately does not make those terms hard provider filters. Provider taxonomies are narrower than ordinary user language and can otherwise remove the correct person before ranking. The agent must pass the name exactly as supplied, retaining titles such as `Dr`; the workflow removes them only from its core-name search while retaining them as ranking evidence. The provider search uses a contains match for the core name and a broad location scope. For Australian state capitals, it accepts the city or its state (for example, Melbourne or Victoria), so a metropolitan profile labelled `Armadale, Victoria` is not incorrectly excluded. The local matcher compares both `basic_profile.name` and `basic_profile.professional_network_name`, then scores the preserved professional title, core-name agreement, location, and industry or role context.

## Tool output

Return this stable shape:

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

Limit `profile` and each candidate to public professional fields:

- `name`
- `linkedin_url`
- `headline`
- `current_company`
- `current_title`
- `location`
- `industry`
- `public_identifier`
- `summary` when the enrichment endpoint returned it

Never return email addresses, phone numbers, private messages, raw provider payloads, API keys, or credential errors to the model.

## Adapter for the supplied helper

Install `scripts/profile_matcher.py` with the custom tool code, then adapt the platform entry point to:

```python
from profile_matcher import lookup_with_helper

results = lookup_with_helper(
    params,
    lambda search_params: Helper("linkedin_people_search_crustdata").call(
        **search_params
    ),
)
return results
```

This adapter improves on the original snippet by masking the email, ranking all returned candidates, returning at most three safe candidate summaries, and refusing to call the first hit a match when the evidence is weak.

The search helper appears to return only summary fields. It does not, by itself, scrape or fully enrich the selected profile. Add a separate, approved profile-enrichment call after a high-confidence match if the user needs work history, education, skills, or an About summary.

## Repository installation

Once this branch is pushed, a student can fetch only the skill folder without merging the branch:

```text
git fetch https://github.com/drsamdonegan/ai-solopreneur.git skill/linkedin-profile-lookup
git checkout FETCH_HEAD -- skills/linkedin-profile-lookup
```

Adding the folder does not add the external tool. Connect and review `lookup_linkedin_profile` separately, then add `linkedin-profile-lookup` to `skills/enabled.txt` and run the project's skill sync helper.
