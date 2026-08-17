# Funding Radar — the daily money scan

Your agent looks for grants, rebates, tax incentives, and credit programs every morning at 8, and leaves you a short report about what changed.

This walks through the three steps to switch it on, then what it costs and how to spend less.

## Install it

```bash
npm run add-skill -- funding-radar
```

Then sync and restart, as with any skill:

- macOS: `./sync-skills.command` then `./start.command`
- Windows: `sync-skills-windows.cmd` then `start-windows.cmd`

## Step 1 — create the three tables

Open n8n, find **14 - SETUP - Funding Data** under *5. Setup and health*, and select **Execute workflow**.

That creates three local tables and nothing else:

| Table | Holds |
| --- | --- |
| `funding_profile` | The facts about your business that decide what you can apply for |
| `funding_opportunities` | Every program the scan has ever found, so tomorrow is not a repeat of today |
| `funding_runs` | A copy of each morning's report, and what that run cost |

All three start empty and stay on your computer. Running the setup again is safe.

## Step 2 — tell your agent about your business

The scan does nothing until a profile exists. This is deliberate: eligibility turns on facts nothing else in this project holds.

Open the chat and say it in your own words:

> We're a Pty Ltd in Melbourne, four staff, turning over about $600k, trading three years. No grants before.

Your agent saves it and reads it back. Correct anything it misheard, and answer whatever it still asks for.

**It will not guess.** If you do not mention turnover, it asks rather than estimating — a guessed number produces a wrong verdict every morning until somebody notices.

What actually matters, roughly in order:

1. **Country** — required. It picks which official sources are allowed to be read.
2. **State or region** — unlocks your state's programs, which are usually the most winnable.
3. **Entity type** — a large share of programs are closed to sole traders.
4. **Headcount and turnover** — the two most common eligibility cuts anywhere.
5. **Years trading, R&D, exports, apprentices** — each unlocks a category of program.

To change something later, just say so: "we're up to six staff now". Anything you do not mention keeps its saved value.

### Getting it in Slack instead

If you installed the **slack-trigger** skill, the report can arrive as a Slack message. Tell your agent:

> Send the funding report to slack:C012ABCDEF

Use the channel ID, not the name. It reuses the same Slack credential the Slack trigger already uses; if you have not set that up, leave it as `chat-only` and just ask your agent each morning.

## Step 3 — switch the scan on

Open **71 - TRIGGER - Daily Funding Scan** under *5. Ways your agent gets started* and switch it on with the toggle at the top right.

It ships switched off, like every workflow in this project.

Two things to know:

- **8am means 8am in your `GENERIC_TIMEZONE`**, which is set in `.env` and defaults to your computer's timezone.
- **It only runs while n8n is running.** On a laptop that means the laptop is awake at 8. If you want it to run regardless, that is what the cloud deploy is for.

To see it work now rather than tomorrow, select **Execute workflow** on that canvas. It runs the whole scan immediately.

## Reading the report

Ask your agent any time:

> What funding did you find this morning?
> What's closing soon?

It reads the saved report. It does not go and search again, so the answer is instant and free.

The report is deliberately short — five items at most. A daily report you scroll past is a daily report you stop reading.

## What it costs

At the settings it ships with: three searches per beat, four page checks, one eligibility pass. Roughly **nine searches and a dollar or less per morning** — about **$20 a month**, or **$15** on weekdays only.

Those are estimates. Your real numbers are recorded on every run, in `funding_runs`: `searchCount`, `inputTokens`, `outputTokens`. After a week, read those instead of trusting this page.

Where the money goes: web searches are billed at $10 per thousand; the searching and page-checking run on Claude Sonnet 5; the eligibility pass runs on Claude Opus 5, because reading legal criteria against a business profile is the part worth paying for.

### Spending less

Three dials, in order of effect:

1. **Drop a beat.** Each one is a search call and a slice of the bill. The scan runs `national`, your state, and `nongov` (foundations, corporate programs, and platform credits). Tell your agent to drop one if you do not need it.
2. **Weekdays only.** Government portals do not publish on Sunday. Open the trigger, change the schedule's **Trigger Interval** from *Days* to *Weeks*, and tick Monday to Friday. That removes about 30% of the bill for almost no loss of coverage.
3. **Turn it off for a while.** The toggle at the top right. Everything it has already found stays in the table, and the closing-soon warnings resume when you switch it back on.

## What it will not do

- **It never says you are eligible.** It says what the published criteria say, and names the one thing you have to check yourself. Only the body running the program can decide.
- **It never applies for anything, and never contacts anyone.** Grant conditions are legal commitments; that decision stays with you.
- **Your agent cannot start the scan.** It is an entry point, like the Slack trigger — started by the clock, not by a conversation and not by anything written on a web page.

## When something goes wrong

The report tells you, in a NOTES section at the bottom. It is written to name gaps rather than quietly return less.

| What you see | What it means |
| --- | --- |
| "I could not reach the *regional* sources today" | One search failed. The rest of the scan still ran. Try again tomorrow. |
| "I dropped X because its official page does not describe this program" | Working as intended — that is the check that keeps stale and invented programs out. |
| "N more programs are waiting to be checked" | More was found than the four-a-day verification budget. They are picked up tomorrow. |
| "I could not assess eligibility this morning" | The final pass failed, so the verdicts are placeholders. The programs and links are still good. |
| The report asks for a profile | Step 2 has not happened, or the profile has no country. |
| No report at all | The trigger is still switched off, or n8n was not running at 8. Check the executions list in n8n. |

If a run failed completely, no Slack message is sent. A cheerful morning message about a scan that did not happen is worse than silence.

## Where it looks

Official domains, per country. Australia ships with `business.gov.au`, `grants.gov.au`, `industry.gov.au`, `austrade.gov.au`, `ato.gov.au`, and `arena.gov.au`, plus your own state's business site. The United States, United Kingdom, Canada, and New Zealand each have their own list.

Government searches are restricted to those domains. That restriction is the single most useful thing in this skill: "government grants for small business" is one of the most SEO-farmed queries on the internet, and an unrestricted search returns consultants' lead magnets and outright scams.

One beat deliberately searches wider — foundations, corporate and startup programs, competitions with prize money, and platform credits such as cloud, API, or software credits. Anything found there is marked as unconfirmed in the report.

If your country is not one of the five, the profile tool says so rather than guessing which websites are official. Adding another country means adding its domains to `64-tool-set-funding-profile.json`.
