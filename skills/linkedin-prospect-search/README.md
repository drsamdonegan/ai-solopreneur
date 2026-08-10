# LinkedIn Prospect Search (optional skill)

This skill helps the agent build a small, evidence-backed list of public
LinkedIn people or company pages. It supports industry, location, role title,
keywords, company headcount, and a bounded result count.

It can work in two ways:

- without an account, it creates public search-engine queries for a person to
  check manually;
- with the reviewed n8n workflow and Crustdata credential, it searches
  Crustdata's indexed people or company database and returns sourced LinkedIn
  URLs. It does not request personal emails, phone numbers, or other contact
  enrichment.

## Configure the n8n credential

Crustdata requires bearer-token authentication. Use n8n's **Bearer Auth**
credential so the saved secret contains only the raw API key and n8n adds the
`Authorization: Bearer` prefix when it sends each request.

n8n cannot reveal or migrate a masked value between credential types. Create a
new **Bearer Auth** credential after retrieving the key from your Crustdata
account:

| n8n field | Value |
| --- | --- |
| Credential display name | `CRUSTDATA_API_KEY` |
| Bearer Token | `YOUR_RAW_CRUSTDATA_KEY` (starts with `cd_`; do not add `Bearer`) |
| Allowed HTTP Request Domains | `api.crustdata.com` |

Do not paste the key into chat, a Code node, an environment file, or Git. The
workflow supplies the non-secret `x-api-version: 2025-11-01` header itself.

After importing the branch workflows, open
`23 - TOOL - search_linkedin_prospects`, select the new
`CRUSTDATA_API_KEY` credential on **Crustdata Indexed Search**, and save.

## Install only this skill

From the root of your `ai-solopreneur` project:

```bash
git fetch https://github.com/drsamdonegan/ai-solopreneur.git skill/linkedin-prospect-search
git checkout FETCH_HEAD -- skills/linkedin-prospect-search
```

This copies only the skill instructions and local test helper. It does not
merge or switch branches and does not overwrite files outside this skill
folder. If the destination skill folder already contains custom changes,
commit or back it up before checkout.

Live Crustdata research additionally needs the reviewed n8n workflow and main
agent wiring from this branch. Copying only the skill folder intentionally does
not change an existing agent's tools.

## Enable it

1. Add `linkedin-prospect-search` on its own line in `skills/enabled.txt`.
2. Preserve every existing skill ID and do not add this one twice.
3. Run `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
4. Start a new agent conversation.

## Test the local logic (free)

This test uses no account and performs no network request:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py --self-test
```

Expected result:

```json
{"ok": true, "tests": 8}
```

You can also test company-mode query generation without a vendor:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py \
  --manual-query \
  --mode companies \
  --industry "Technology, Nonprofit" \
  --location "Melbourne, Victoria, Australia" \
  --keywords "AI communities"
```

## Test the no-spend agent boundary

Ask:

```text
Use the LinkedIn Prospect Search skill in companies mode.

Industry: Technology, Nonprofit
Location: Melbourne, Victoria, Australia
Keywords: AI communities
Maximum results: 5

Preview the search and cost. Do not spend credits yet.
```

With the tool connected, the result should contain the normalized criteria, a
maximum of `0.15` credits, and an exact phrase matching
`APPROVE CRUSTDATA 0.15 CREDITS XXXXXXXX`, where the final eight-character code
binds the approval to those criteria and the five-result limit. It must contain
no company results because the preview makes no provider request.

Without the tool, the agent should explain the limitation and offer a manual
query. It must never fabricate prospects.

## Run a minimal live test (costs up to 0.03 credits)

First preview this one-result search:

```text
Use the LinkedIn Prospect Search skill in companies mode.
Industry: Software Development
Location: Australia
Maximum results: 1
Preview only and show me the exact maximum-credit approval phrase.
```

Only after checking the preview, send the exact returned approval phrase as a
separate message. A correct live result reports `creditsUsed`, returns at most
one sourced `/company/` URL, and never includes personal contact data. Crustdata
may return no match, in which case the charged amount should be zero under its
current indexed-search pricing.

## Cost and quality controls

- Indexed Person Search and Company Search are currently documented at `0.03`
  credits per returned result. Confirm current pricing in your account.
- Every request defaults to 10 and is capped at 25 results.
- The tool never retries or broadens filters automatically.
- People mode uses explicit hard filters and optional hybrid semantic ranking
  inside the exact filtered result set.
- Company mode searches companies directly; it does not claim a named job title
  exists unless a separate people search proves it.
- Results are bounded and provider-dependent, never exhaustive.

## Turn it off

Remove `linkedin-prospect-search` from `skills/enabled.txt` and sync the skills
again. The folder and unused n8n credential may remain in the project.
