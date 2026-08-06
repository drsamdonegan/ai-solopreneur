# LinkedIn Prospect Search (optional skill)

Use this skill to find a small list of people matching an industry, location, current job title, and optional company-size range. It returns public LinkedIn person/profile URLs and, when the source provides them, deduplicated LinkedIn company URLs.

## Important limitation

This skill is provider-neutral, but live discovery cannot be completely standalone. A Markdown skill has no LinkedIn database and cannot grant itself internet access.

Without a provider connection, the skill can validate filters and generate manual public-search queries. To return live profiles automatically, the agent needs a reviewed read-only tool named `search_linkedin_prospects`, backed by Crustdata, another approved sales-intelligence API, or an approved web-search connection.

Never paste API keys into chat or committed files.

## Install only this skill

From the root of your `ai-solopreneur` project:

```bash
git fetch https://github.com/drsamdonegan/ai-solopreneur.git skill/linkedin-prospect-search
git checkout FETCH_HEAD -- skills/linkedin-prospect-search
```

This copies only the skill folder. It does not merge or switch branches. Stop before the second command if you have already customized this folder, because checkout will overwrite it.

## Enable it

1. Add `linkedin-prospect-search` on its own line in `skills/enabled.txt`.
2. Preserve every existing skill ID and do not add this one twice.
3. Run `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
4. Start a new agent conversation.

## Test the local logic

This test needs no account and performs no network request:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py --self-test
```

Expected result:

```json
{"ok": true, "tests": 5}
```

## Test the agent boundary

Ask:

```text
Use the LinkedIn Prospect Search skill. Before searching, tell me whether the
search_linkedin_prospects tool is connected. Do not pretend to return live
profiles if it is unavailable.
```

A correctly installed skill without a provider explains the limitation and offers a manual query plan. It must not fabricate prospects.

## Test a connected search

Use your own approved prospecting criteria:

```text
Use the LinkedIn Prospect Search skill to find up to 10 prospects.

Industry: Health care
Location: Australia
Current job title: Head of Operations
Company headcount: 51-200

Return qualified public LinkedIn person URLs and any company LinkedIn URLs that
the source actually provides. Separate contradictions from qualified results,
state coverage limits, and do not return personal contact information.
```

Check for these headings:

- `SEARCH CRITERIA`
- `QUALIFIED PROSPECTS`
- `COMPANY URLS`
- `GAPS AND COVERAGE`

The result should never claim exhaustive coverage, silently broaden a filter, guess a company URL, or contact anyone.

## Manual fallback

Generate search queries without a vendor account:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py \
  --manual-query \
  --industry "Health care" \
  --location "Australia" \
  --role-title "Head of Operations" \
  --company-headcount "51-200"
```

Open the queries yourself or pass them to an approved web-search tool. Company headcount cannot be reliably verified from an ordinary search result, so check it separately before treating a prospect as qualified.

## Turn it off

Remove `linkedin-prospect-search` from `skills/enabled.txt` and sync the skills again. The folder may remain in the project.
