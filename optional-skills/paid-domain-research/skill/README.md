# Paid Domain Research (optional skill)

Ask your agent to research a business's website properly: where it ranks on Google, who it is really competing against for those searches, and which keywords are worth going after.

Best for: the moment you want to stop guessing what your competitors are winning on.

This is the paid big brother of [Domain Research](../../domain-research/skill/README.md). The free one reads a company's own home page and tells you what the business says about itself. This one asks a search-data provider what Google actually thinks of it.

## Before you start

This skill spends real money, a few cents at a time, so it needs an account with **DataForSEO** and a card on file.

You will end up with:

- A **DataForSEO** credential saved in n8n, the same way you saved your Claude key
- The free Domain Research skill already installed, because this skill falls back to it whenever a paid call fails

Typical cost for one standard lookup is about **US$0.20**. A deeper lookup is capped at **US$0.50**, and a refresh at **US$0.10**. The agent is told those ceilings and will not go past them, and it will not run the same research twice for one request.

## Turn it on

```bash
node optional-skills/_installer/add-skill.mjs paid-domain-research
```

Then sync and restart:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

## Try it

Paste this into the chat, using a real business domain:

```text
Research example.com and tell me what they rank for.
```

You should get back rankings, the competitors showing up for the same searches, keyword ideas, and a note of what the lookup cost. Look for the words **SEO COMPETITORS** in the reply — that phrase only appears when this skill is really loaded.

Everything it finds is saved, so asking follow-up questions afterwards costs nothing.

## What it cannot do

- **It never buys anything except the lookup you asked for.** It cannot call other endpoints at the provider, and arbitrary requests are switched off.
- **It never publishes or contacts anyone.** It reads search data and saves it locally.
- **It will not research from a hint.** If a domain merely appears in a document or an earlier message, that is not a request. You have to ask.

If the paid provider is unavailable or returns nothing useful, the agent falls back to the free website-only research once, and tells you that it did.
