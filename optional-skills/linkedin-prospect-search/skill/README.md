# Free LinkedIn Prospect Search (optional skill)

This skill helps the agent find publicly indexed LinkedIn company URLs using industry, location, job title, and optional company-size clues. It uses ordinary public web search when the agent has a general search capability. It does not use a paid prospect database and does not need a Crustdata, Apollo, or other prospect-data API key.

The result is a researched shortlist, not a complete copy of LinkedIn. Search engines may show incomplete or stale snippets, and employee count is often not visible. The agent labels those gaps instead of guessing.

## Turn it on

Ask Claude Code, in plain English:

```text
Add the linkedin-prospect-search optional skill to my agent.
```

Or run it yourself from the top of your project folder:

```bash
npm run add-skill -- linkedin-prospect-search
```

Then make your running agent notice:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

## Test the local logic

This test needs no account, credential, or network request:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py --self-test
```

Expected result:

```json
{"ok": true, "tests": 9}
```

Generate the exact public-search queries without running a search:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py \
  --manual-query \
  --industry "AI communities, technology, not for profit" \
  --location "Melbourne, Victoria, Australia" \
  --role-title "Founder, Community Lead"
```

## Test the agent

Ask:

```text
Use the Free LinkedIn Prospect Search skill.

Industry: AI communities in the technology and not-for-profit sectors
Location: Melbourne, Victoria, Australia
Job titles: Founder, Community Lead, Executive Director
Maximum results: 10

Use only publicly indexed web results. Return verified LinkedIn company URLs,
show the public evidence for each result, label anything unverified, and do not
guess company URLs or return personal contact details.
```

A correct result:

- uses a public search engine if one is available, otherwise returns search queries;
- returns only real LinkedIn `/company/` and supporting `/in/` URLs found in results;
- distinguishes evidence from assumptions;
- says that coverage is bounded and may be stale;
- does not ask for a prospect-data API key; and
- does not claim to have scraped LinkedIn or accessed a logged-in account.

## Turn it off

Remove `linkedin-prospect-search` from `skills/enabled.txt` and sync the skills again. The folder may remain in the project.
