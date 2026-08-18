# SEO Article Writer (optional skill)

Ask your agent to write a full article that is actually grounded in research, rather than the confident waffle you get from asking a chatbot to "write a blog post about X".

Best for: the moment you have the research and cannot face the blank page.

The difference is where the facts come from. This skill reads what your paid domain research already found — the keywords, the competitors, the pages that rank — and writes against that evidence instead of inventing it.

## Before you start

You need **[Paid Domain Research](../../paid-domain-research/skill/README.md)** installed and you need to have run it at least once for the domain you are writing about. Without that there is nothing to ground the article in, and the skill will tell you so rather than guess.

## Turn it on

```bash
node optional-skills/_installer/add-skill.mjs seo-article-writer
```

The installer will stop and tell you if Paid Domain Research is missing.

Then sync and restart:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

## Try it

Research a domain first, then ask:

```text
Write an article for example.com about the keyword you think is the best opportunity.
```

Writing takes a minute or two, because it goes away and drafts the whole thing rather than streaming a paragraph at a time. Look for the words **CHECK BEFORE PUBLISHING** in the reply — that phrase only appears when this skill is really loaded.

Ask for the draft again later and it reads back the saved copy rather than writing a new one.

## Getting good results

**Give it an angle, not just a keyword.** "Write about bookkeeping software" produces something generic. "Write about why small builders abandon bookkeeping software in the first month" produces something worth reading.

**Read the claims.** The skill is told to write "Not stated" rather than invent a statistic, but it is still a draft. Anything with a number in it deserves your eye before it goes out.

**It is a first draft, not a final one.** The point is to get past the blank page with the research already baked in.

## What it cannot do

- **It never publishes anything.** It writes a draft and saves it locally. Putting it on your website is your job, deliberately.
- **It will not write from nothing.** No research for that domain means no article.
- **It will not write from a hint.** It drafts when you ask it to, not because a document suggested a topic.
