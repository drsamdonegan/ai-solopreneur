# Funding Radar — finding money you can apply for

Ask your agent to go looking for grants, rebates, tax incentives, and credit programs your business could apply for. It searches, checks each program against its own official page, and reports what it found.

It searches when you ask. There is no schedule — that arrives later, as its own skill.

## Install it

```bash
npm run add-skill -- funding-radar
```

Then sync and restart, as with any skill:

- macOS: `./sync-skills.command` then `./start.command`
- Windows: `sync-skills-windows.cmd` then `start-windows.cmd`

**On a cloud agent**, commit and push instead. The deploy imports the workflows, switches the tools on, and builds the three tables by itself — there is nothing to click in n8n.

## Step 1 — create the three tables

Running locally, open n8n, find **14 - SETUP - Funding Data** under *5. Setup and health*, and select **Execute workflow**. On a cloud agent this already happened during the deploy.

| Table | Holds |
| --- | --- |
| `funding_profile` | The facts about your business that decide what you can apply for |
| `funding_opportunities` | Every program a search has ever found, so the next one is not a repeat |
| `funding_runs` | A copy of each report, and what that search cost |

All three start empty and stay on your own agent. Running the setup again is safe.

## Step 2 — tell your agent about your business

Nothing works until a profile exists. This is deliberate: eligibility turns on facts nothing else in this project holds.

Open the chat and say it in your own words:

> We're a Pty Ltd in Melbourne, four staff, turning over about $600k, trading three years. No grants before.

Your agent saves it and reads it back. Correct anything it misheard, and answer whatever it still asks for.

**It will not guess.** If you do not mention turnover, it asks rather than estimating — a guessed number produces a wrong verdict every time it searches.

What matters, roughly in order:

1. **Country** — required. It picks which official sources may be read.
2. **State or region** — unlocks your state's programs, usually the most winnable.
3. **Entity type** — a large share of programs are closed to sole traders.
4. **Headcount and turnover** — the two most common eligibility cuts anywhere.
5. **Years trading, R&D, exports, apprentices** — each unlocks a category of program.

To change something later, just say so: "we're up to six staff now". Anything you do not mention keeps its saved value.

## Step 3 — ask it to look

> Go and find funding we could apply for.

It replies straight away to say it has started. **That reply is not the result.** The search takes a few minutes: it runs three searches, opens up to four new programs on their own pages to check amounts and dates, and then reads the criteria against your profile.

Then ask:

> What did you find?
> What's closing soon?

That reads the saved report. It does not search again, so the answer is instant and free.

The report is deliberately short — five items at most. A report you scroll past is a report you stop reading.

## What it costs

About **a few dollars per search, and about an hour**: up to thirty web searches per source group, eight page checks, one eligibility pass. The source groups run one after another, which is where the hour goes. Every run records what it actually used in `funding_runs`, so you can read the real number after a few goes. It only runs when you ask, so you control the bill.

Those are estimates. Your real numbers are recorded on every run in `funding_runs`: `searchCount`, `inputTokens`, `outputTokens`. After a few searches, read those instead of trusting this page.

Where the money goes: web searches are billed at $10 per thousand; the searching and page-checking run on Claude Sonnet 5; the eligibility pass runs on Claude Opus 5, because reading legal criteria against a business profile is the part worth paying for.

To spend less, drop a beat. A search covers national sources, your state, and non-government money (foundations, corporate programs, platform credits). Tell your agent to drop one if you do not need it.

## What it will not do

- **It never says you are eligible.** It says what the published criteria say, and names the one thing you have to check yourself. Only the body running the program can decide.
- **It never applies for anything, and never contacts anyone.** Grant conditions are legal commitments; that decision stays with you.
- **It never searches on its own.** Every search is one you asked for.
- **It never sends the report anywhere.** No Slack, no email, no phone. It is saved on your agent and read back in the chat when you ask.

## Running it on a schedule

Not yet, and deliberately so.

The searching lives in its own workflow, **71 - RUN - Funding Scan**, which does not care what starts it. Today your agent starts it when you ask. When the scheduler skill lands, it will start the same workflow on a clock — no change to this skill, and no second copy of the search to keep in step.

If you want to run one by hand in the meantime, open that workflow in n8n and select **Execute workflow**.

## When something goes wrong

The report tells you, in a NOTES section at the bottom. It is written to name gaps rather than quietly return less.

| What you see | What it means |
| --- | --- |
| "I could not reach the *regional* sources today" | One search failed. The rest still ran. Ask again later. |
| "I dropped X because its official page does not describe this program" | Working as intended — that check is what keeps stale and invented programs out. |
| "N more programs are waiting to be checked" | More was found than the four-per-search verification budget. The next search picks them up. |
| "I could not assess eligibility this morning" | The final pass failed, so the verdicts are placeholders. The programs and links are still good. |
| The agent asks for your business details | Step 2 has not happened, or the profile has no country. |
| "A funding search is already running" | One is in flight. It tells you how long it has been going; ask again shortly, or tell it to search again anyway. |
| "That search never reported back" | The agent restarted while a search was working — a deploy does this. Nothing was saved. Ask for a fresh one. |

A failed search still writes its run, so `What did you find?` tells you it failed rather than going quiet.

## Where it looks

Official domains, per country. Australia ships with `business.gov.au`, `grants.gov.au`, `industry.gov.au`, `austrade.gov.au`, `ato.gov.au`, and `arena.gov.au`, plus your own state's business site. The United States, United Kingdom, Canada, and New Zealand each have their own list.

Government searches are restricted to those domains. That restriction is the single most useful thing in this skill: "government grants for small business" is one of the most SEO-farmed queries on the internet, and an unrestricted search returns consultants' lead magnets and outright scams.

One part of the search deliberately looks wider — foundations, corporate and startup programs, competitions with prize money, and platform credits such as cloud, API, or software credits. Anything found there is marked as unconfirmed in the report.

If your country is not one of the five, the profile tool says so rather than guessing which websites are official. Adding another country means adding its domains to `64-tool-set-funding-profile.json`.
