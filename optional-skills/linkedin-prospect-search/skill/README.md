# LinkedIn Prospect Search (optional skill)

Find up to ten possible prospects by role, sector, location, and company size. The skill uses Crustdata's indexed public professional dataset, returns only public professional fields, and makes the cost visible before every search.

## Before you install it

You need a Crustdata account with Person Search access and credits. Create a Bearer Auth credential in n8n named exactly `CRUSTDATA_API_KEY`. Never paste the key into chat or a committed file.

Each search returns at most ten rows and can cost up to 0.30 credits. The agent asks for explicit approval before every call and never retries or paginates automatically.

## Install

```bash
npm run add-skill -- linkedin-prospect-search
```

Then run the skill sync helper, restart the services, import workflow 59 if your setup does not import workflows automatically, select `CRUSTDATA_API_KEY` on its HTTP Request node, and publish the workflow.

## Try it

```text
Find up to five operations leaders at Australian logistics companies with 51-200 people. Ask me to approve the paid search before calling anything.
```

A correct result names the search criteria, reports credits used, gives evidence for each possible prospect, and does not expose contact details or claim anyone is a qualified buyer.

Use `101+` when the requested minimum is “more than 100 employees.”

Without the credential or tool, the agent must say live prospect search is unavailable. There is no Python, browser, public-search, or query-generation fallback.
