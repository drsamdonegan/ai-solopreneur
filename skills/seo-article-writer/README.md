# SEO Article Writer (optional skill)

Ask your agent to write a full article that is actually grounded in research, rather than the confident waffle you get from asking a chatbot to "write a blog post about X".

Best for: the moment you have the research and cannot face the blank page.

The difference is where the facts come from. This skill reads what Domain Research already found, researches the exact requested topic within one reviewed US$0.15 ceiling when fresh evidence is insufficient, and writes against verified pages instead of inventing facts or optimizing for volume alone.

## Before you start

You need **[Domain Research](../../domain-research/skill/README.md)** installed. The installer checks this dependency. You can run the free research first, or ask directly for an article and let the agent run the free scan before preparing the draft.

**[Paid Domain Research](../../paid-domain-research/skill/README.md)** is optional. The article writer has its own narrower topic-keyword pass: it uses only fixed reviewed endpoints, never retries, records actual provider cost, and falls back when the provider is unavailable.

## Turn it on

```bash
node optional-skills/_installer/add-skill.mjs seo-article-writer
```

The installer will stop and tell you if Domain Research is missing.

Then sync and restart:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

If this skill was already installed before the autonomous-topic release, upgrade it with:

```bash
npm run upgrade-seo-article
npm run sync-skills
npm run import-workflows
```

The upgrade preflights every installed article file and stops before writing anything if it finds local customisations.

If your installation is a private fork, merge the matching core chat-host changes before installing or upgrading. Version 1.1.7 depends on the host-side article validation route and schema reconciliation; both installers check for those capabilities and stop before writing any skill or workflow file when the core host is older.

## Try it

Research a domain first, then ask for any topic directly:

```text
Write an article for example.com about “what is artificial intelligence in simple terms?”
```

Writing takes a minute or two. A transcript-local progress bar moves through real keyword research, sourcing, drafting, checking, repair, and saving stages; it becomes the download card when the review draft is ready.

Ask for the draft again later and it reads back the saved copy rather than writing a new one.

## Getting good results

**Give it an angle, not just a keyword.** "Write about bookkeeping software" produces something generic. "Write about why small builders abandon bookkeeping software in the first month" produces something worth reading.

**Read the claims.** The skill is told to write "Not stated" rather than invent a statistic, but it is still a draft. Anything with a number in it deserves your eye before it goes out.

**It is a first draft, not a final one.** The point is to get past the blank page with the research already baked in.

## What it cannot do

- **It never publishes anything.** It writes a draft and saves it locally. Putting it on your website is your job, deliberately.
- **It will not write from nothing.** No research for that domain means no article.
- **It will not write from a hint.** It drafts when you ask it to, not because a document suggested a topic.
