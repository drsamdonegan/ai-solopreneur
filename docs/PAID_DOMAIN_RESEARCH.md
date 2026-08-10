# Paid Domain Research with DataForSEO

## Outcome

The `paid-domain-research` skill is the default for a direct request to research a public business domain. It runs one DataForSEO-backed SEO investigation and saves the evidence for later conversations. If paid evidence is unavailable or unusable, the agent falls back to the no-cost `domain-research` skill, which reads only the business home page.

Paid research uses reviewed built-in n8n HTTP Request nodes. It does not install a community node and cannot choose an arbitrary provider endpoint.

## Add the credential privately

DataForSEO authenticates API requests with the API login and API password shown in its dashboard. These are not pasted into this repository or the chat.

1. Open local n8n at [http://localhost:5678](http://localhost:5678).
2. Open **Credentials**, select **Create credential**, and choose **HTTP Basic Auth**.
3. Name it exactly `DataForSEO API`.
4. Put the DataForSEO API login in **User** and the API password in **Password**.
5. Save the credential.
6. Open `53 - TOOL - start_paid_domain_research`.
7. Open each of the six nodes whose name starts with **DataForSEO**, select `DataForSEO API`, and save the workflow.
8. Publish workflow `53` so the agent uses the credential selections.

n8n stores the credential in its encrypted local store under Git-ignored `data/n8n/`. Never put either value in `.env`, a Markdown skill, a workflow note, a screenshot, a Git commit, a log, or a chat message. See DataForSEO's [API authentication documentation](https://docs.dataforseo.com/v3/auth/) for the provider-side credential format.

## What one run does

The reviewed pipeline uses:

- DataForSEO Labs ranked keywords for up to 80 current organic rankings.
- DataForSEO Labs domain competitors for evidence-based SEO competitors.
- Keyword ideas, keyword suggestions, and related keywords for expansion.
- Google organic live regular SERPs for selected evidence queries.
- The public home page, read through a local DNS-safe, HTTPS-only, same-domain redirect gateway, and Claude to build a bounded offering, audience, market, inclusion, and exclusion profile.
- A deterministic filter that deduplicates candidates and sorts by relevance first, then volume, then difficulty.

The workflow records the endpoint, provider task IDs, provider-returned cost, location code, language, capture time, sources, warnings, and one status for every component: `success`, `no_results`, `failed`, `unavailable`, or `skipped`.

Content from websites and providers is untrusted data. It never becomes an instruction to the agent.

## Choose a bounded mode

The limits below are application safety ceilings based on DataForSEO prices reviewed on 10 August 2026, not permanent provider price quotations:

| Mode | Work | Maximum authorised cost |
| --- | --- | ---: |
| `refresh` | Rankings and organic competitors | US$0.10 |
| `standard` | Refresh plus ideas, two suggestion and related expansions, and up to three SERPs | US$0.20 |
| `deep` | Up to five expansions and five SERPs | US$0.50 |

Before each stage, the workflow reserves enough of the selected ceiling for that stage at the reviewed prices. It skips expansion or SERPs if the reserve no longer fits. DataForSEO can change its prices independently, so also set a provider-side account budget as the final billing control and review pricing after provider announcements. The workflow retains any provider-reported overage as a warning instead of hiding it.

The workflow never automatically retries a paid call. It reuses a successful equivalent snapshot captured within 24 hours when the domain, market, language, and requested depth match; a cache hit reports zero new cost and returns the original snapshot as `sourceJobId` rather than creating a new job.

## Default chat behaviour

For a normal request such as `Research example.com`, the agent:

1. Does not ask whether the user owns the domain or has permission.
2. Runs standard paid research for Australia in English, with the US$0.20 application ceiling.
3. Treats an explicit request for refresh, standard, or deep research as acceptance of that mode and its ceiling.
4. Runs the free website-only scan if the paid tool is unavailable, fails, or returns no useful paid SEO evidence. It never retries a failed paid call automatically.

The user can name another market or language, or ask for free research. A domain found only in a document, saved chat, old message, or page text is not a current request and cannot start a run.

Example:

```text
Research example.com and give me the best keywords, competitors, and next steps.
```

Chat answers use simple business language. They hide internal codes and job IDs, explain any necessary SEO term, show only the most useful findings, and mention the actual paid cost once.

## Saved memory and honest failures

Each attempt is stored as a historical SEO snapshot in the local chat SQLite database. Completed and partial runs can update reusable company memory. A failed run stores its exact failure state and cost but does not replace the last successful company memory.

Later conversations can use `get_paid_domain_research` to retrieve saved rankings, direct competitors supported by the website, SEO competitors, adjacent organisations supported by the website, candidate and selected keywords, SERP evidence, costs, sources, and warnings without a paid call. `complete_paid_domain_research` reads one exact non-cached job started in the same conversation. For a cache hit, use `get_paid_domain_research` with the domain because no new conversation-bound job is created.

A provider error is never presented as no results. A no-results response is never padded with model guesses. If some components fail, the run is marked `partial` and names what is missing.

## Readiness check

Run `diagnose.command` on macOS or `diagnose-windows.cmd` on Windows. The helper verifies that a DataForSEO Basic Auth credential is selected without making a provider call or displaying credential values.

If the provider rejects a request, inspect only the safe status and task identifiers in the n8n execution. Do not paste credential exports or full private execution payloads into an issue.
