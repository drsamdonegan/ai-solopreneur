# Funding Radar (optional skill)

Ask your agent to go and find money you can apply for — grants, rebates, tax incentives, vouchers, and credit programs — and it comes back with what you could actually go for, the deadline, and the official link.

Best for: the nagging sense that there is money out there for a business like yours, and no time to go and find out.

## How you use it

Three things, in your own words, in the chat.

**Tell it about your business, once.**

> We're a Pty Ltd in Melbourne, four staff, about $600k a year, trading three years.

**Ask it to look.**

> Go and find funding we could apply for.

It goes quiet for a few minutes — it is searching official sources, opening each program's own page, and reading the criteria against your business.

**Ask what it found.**

> What did you find?

## What comes back

```
Funding scan — 2026-08-18

1 new, 1 closing soon.

NEW
1. Digital Solutions Program — up to $10,000
   Who runs it: business.gov.au
   For: software, digital tooling, and advice for small business
   Closes: 30 September 2026 (43 days)
   The size and location criteria are met on the profile you gave me.
   What to check yourself: whether your industry code is on their eligible list.
   https://business.gov.au/...

CLOSING SOON
- Export Market Development Grant closes in 9 days. I first flagged it on 2026-08-02.

Checked: national, regional, nongov.
```

And when there is nothing, it says so rather than padding:

```
Nothing new today.

I checked national, regional, nongov sources and found nothing new.
```

## The bit that makes it worth having

**It remembers.** Every program it has ever found is stored, so the second search does not hand you the same list again. It tells you what is *new*, what *changed*, and what is about to close. That is what makes it worth asking twice.

**It checks before it tells you.** Every new program gets a second look: the agent opens the program's own official page and reads the amount, the dates and the eligibility off it. If the page turns out not to describe that program at all, it is dropped before you ever see it. Grant listings are full of consultants' lead magnets and rounds that closed years ago, and this is what keeps them out.

## Before you start

You need the Anthropic key you already saved in n8n. Nothing else — no new accounts, no new credentials.

1. Run the setup workflow once in n8n. It creates three local tables.
2. Tell your agent about your business, in the chat. It saves a profile.

That is it. Then just ask. Full walkthrough in **docs/FUNDING_RADAR.md**.

## What it costs

About **a dollar per search**. It only searches when you ask, so you decide the bill.

Every search records its own cost — searches used, tokens in and out — in the `funding_runs` table, so after a few goes you can read your real number instead of trusting that estimate.

## Where it looks

Official sources first, always. For Australia that means business.gov.au, GrantConnect, industry.gov.au, austrade.gov.au, the ATO, and your own state's business site. The United States, United Kingdom, Canada, and New Zealand each ship their own list.

Government searches are locked to those domains, which is what keeps the scam sites out. One part of the search deliberately looks wider — charitable foundations, corporate and startup programs, competitions, and platform credits such as cloud or software credits — and anything found there is labelled as unconfirmed so you know to look twice.

## Two things it will never do

**It will never tell you that you are eligible.** Only the body running the program can decide that. It tells you what the published criteria say and names the one thing you need to check yourself.

**It will never apply for anything, or contact anyone.** It finds and reports. Deciding what to chase, and filling in the form, stays with you — grant conditions are legal commitments, and an agent should not be signing you up to one on your behalf.

## Where the report goes

Into the chat, and nowhere else.

The report is saved on your own agent, and your agent reads it back when you ask. It is not emailed, posted to Slack, or sent to a phone. That is deliberate: the only person who sees what your business might be eligible for is you, in the window you are already looking at.

## Running it on a schedule

The optional workflow **76 - TRIGGER - Daily Funding Scan** runs at 8am in n8n's configured timezone. It ships switched off.

Run a search in the chat first, check its result and recorded cost, then enable workflow 76 only if you are comfortable running that spend every day. Chat and scheduled starts share the guarded **71 - RUN - Funding Scan** workflow, so an in-flight run blocks another for 20 minutes.

If an older `funding_runs` table does not have a text column named `runId`, add it before enabling the trigger. The setup workflow does not alter an existing table.
