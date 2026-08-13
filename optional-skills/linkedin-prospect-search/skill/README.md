# Free LinkedIn Prospect Search (optional skill)

This skill helps the agent find publicly indexed LinkedIn company URLs using industry, location, job title, and optional company-size clues. It uses ordinary public web search when the agent has a general search capability. It does not use a paid prospect database and does not need a Crustdata, Apollo, or other prospect-data API key.

The result is a researched shortlist, not a complete copy of LinkedIn. Search engines may show incomplete or stale snippets, and employee count is often not visible. The agent labels those gaps instead of guessing.

## Install only this skill

From the root of your `ai-solopreneur` project:

```bash
git fetch https://github.com/drsamdonegan/ai-solopreneur.git skill/linkedin-prospect-search
git checkout FETCH_HEAD -- skills/linkedin-prospect-search
```

This copies only the skill folder. It does not merge or switch branches. If you have already customized this folder, stop before the second command because it would replace that folder.

## Enable it

1. Add `linkedin-prospect-search` on its own line in `skills/enabled.txt`.
2. Preserve every existing skill ID and do not add this one twice.
3. Run `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
4. Start a new agent conversation.

## Test the local logic

This test needs no account, credential, or network request:

```bash
python3 skills/linkedin-prospect-search/scripts/prospect_search.py --self-test
```

Expected result:

```json
{"ok": true, "tests": 6}
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
