# Integration contract

The only live path is workflow `59 - TOOL - search_linkedin_prospects`, calling `POST https://api.crustdata.com/person/search` with API version `2025-11-01` and the saved Bearer Auth credential `CRUSTDATA_API_KEY`.

The request uses reviewed Person Search fields for current title, current-company industry, public location, and current-company headcount. Company-size bands and the supported `101+` minimum are applied by Crustdata; returned headcount is used only for evidence and display. The workflow never calls contact enrichment.

The provider documents Person Search at 0.03 credits per returned row. The workflow fixes the maximum result count at 10, so every approval message uses a 0.30-credit ceiling. Raising the limit requires a fresh cost review and updates to the workflow metadata, manifest, policy, tests, README, and `SKILL.md`.

The stable output contains possible prospects, public profile URLs, current professional fields, matching evidence, warnings, result counts, and credits used. It excludes emails, phones, private messages, raw provider payloads, and credentials.
