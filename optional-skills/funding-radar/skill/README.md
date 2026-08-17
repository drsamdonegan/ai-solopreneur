# Funding Radar (optional skill)

Every morning at 8, your agent goes looking for money you can apply for — grants, rebates, tax incentives, vouchers, and credit programs — and leaves you a short report about what changed.

Best for: the nagging sense that there is money out there for a business like yours, and no time to go and find out.

## The bit that makes it worth having

Anyone can ask a chatbot "what grants can I get?" once. You get a plausible list, you skim it, and you never do it again.

This is different in two ways.

**It only tells you what changed.** It remembers every program it has ever found, so tomorrow's report is not today's list again. A program that opens, an amount that moves, a deadline arriving in two weeks — those are news. Everything else stays quiet.

**It checks before it tells you.** Every new program gets a second look: the agent opens the program's own official page and reads the amount, the dates, and the eligibility rules off it. If the page turns out not to describe the program at all, it gets dropped before it ever reaches you. Grant listings are full of consultants' lead magnets and rounds that closed in 2019, and this is what keeps them out.

## What you get, most mornings

```
Funding scan — 2026-08-15

1 new, 1 closing soon.

NEW
1. Digital Solutions Program — up to $10,000
   Who runs it: business.gov.au
   For: software, digital tooling, and advice for small business
   Closes: 30 September 2026 (46 days)
   The size and location criteria are met on the profile you gave me.
   What to check yourself: whether your industry code is on their eligible list.
   https://business.gov.au/...

CLOSING SOON
- Export Market Development Grant closes in 9 days. I first flagged it on 2026-08-02.

Checked: national, regional, nongov.
```

And on a quiet day, honestly:

```
Nothing new today.

I checked national, regional, nongov sources and found nothing new.
```

## Before you start

You need the Anthropic key you already saved in n8n. Nothing else — no new accounts, no new credentials.

Three steps, in **docs/FUNDING_RADAR.md**:

1. Run the setup workflow once. It creates three local tables.
2. Tell your agent about your business, in the chat, in your own words. It saves a profile.
3. Switch the 8am scan on in n8n. It ships switched off.

## What it costs

Roughly a dollar a morning at the settings it ships with — about **$20 a month**, or **$15** if you switch it to weekdays. That is Anthropic API usage: web searches are billed at $10 per thousand, and the rest is tokens.

Every run writes down its own searches and tokens, so after a week you can read your real number instead of trusting that estimate. `docs/FUNDING_RADAR.md` shows where, and which dial to turn if it is too much.

## Two things it will never do

**It will never tell you that you are eligible.** Only the body running the program can decide that. It tells you what the published criteria say and names the one thing you need to check yourself.

**It will never apply for anything, or contact anyone.** It finds and reports. Deciding what to chase, and filling in the form, stays with you — grant conditions are legal commitments, and an agent should not be signing you up to one while you sleep.

## Where it looks

Official sources first, always. For Australia that means business.gov.au, GrantConnect, industry.gov.au, austrade.gov.au, the ATO, and your own state's business site; the United States, United Kingdom, Canada, and New Zealand each ship their own list.

Government searches are locked to those domains, which is what keeps the scam sites out. One beat deliberately looks wider — charitable foundations, corporate and startup programs, competitions, and platform credits such as cloud or software credits — and anything found there is labelled as unconfirmed so you know to look twice.

## If the report says a beat failed

That is the system telling you the truth rather than quietly returning less. A source that timed out is named in the NOTES section. Nothing is wrong with your setup; try again tomorrow, or run the scan by hand from n8n.
