# Competitor Content Remix (optional skill)

Point your agent at a competitor. It works out which of their posts genuinely did better than their own average, tells you what those posts have in common, and hands you a prompt that writes the same *shape* of post about your business, in your words.

Best for: the moment you know you should be posting more, and have no idea what to post.

The prompt is the thing to keep. A good one is reusable for months.

## Read this first, it saves an argument

Your agent **cannot** read LinkedIn, Instagram, X or TikTok. Nobody's can. None of those networks let an app read another company's posts, and tools that claim otherwise are scraping, which gets accounts banned.

So the split is:

- **Automatic:** their YouTube channel, and their blog if it has a feed.
- **Copy and paste:** everything else. Your agent will show you exactly what to copy.

Pasting ten posts takes about five minutes and is the honest version of what paid competitor tools do behind the curtain.

## Before you start

Run **13 - SETUP - Competitor Data** in n8n once. It creates a local table called `competitor_posts`. That is all it does.

If you want the YouTube half to work, you also need a free Google key. Follow **[docs/COMPETITOR_CONTENT.md](../../docs/COMPETITOR_CONTENT.md)** — about ten minutes, no card needed. Skip it if your competitors are not on YouTube; everything else still works.

## Turn it on

Ask Claude Code, in plain English:

```text
Add the competitor-content optional skill to my agent.
```

Or run it yourself from the top of your project folder:

```bash
npm run add-skill -- competitor-content
```

Then make your running agent notice:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

## Check it loaded

Ask:

```text
Have a look at what competitorname.com is posting.
```

If the skill is live, the reply asks you for their social links and offers you a paste template, and later replies are organised under the headings `WHAT WORKED`, `THE PATTERN` and `YOUR REMIX PROMPT`.

If you get a general answer with none of those, the sync did not take. Check the line in `enabled.txt` and run the sync again.

## Getting good results

**Paste ten to fifteen posts, not three.** The whole method is comparing a post against that account's *own* normal. With three posts there is no normal, and whichever has the most likes wins by default. This is the one thing that decides whether the output is any good.

**Paste their recent posts, not their greatest hits.** If you only paste the ones you already thought were good, you have told it the answer and it will agree with you.

**Do not round the numbers.** "About 300" for a post that got 47 will send the ranking sideways for every other post in the set.

**Pick a real competitor, not an aspirational one.** A national brand with 200,000 followers wins on distribution you do not have. Someone one size ahead of you is where the copyable formats are.

## How it decides what "performed well" means

Not by likes. Likes measure how many followers an account has.

It compares each post with that same account's typical post. A score of 1.0 is an ordinary post for them, 2.0 is twice their usual. That is what makes a small competitor's genuinely good post visible next to a big competitor's ordinary one.

For YouTube it counts views per day since publishing, so an old video does not win just for having been up longer.

## What it will not do

- **It will not copy their posts.** It takes the structure — the kind of opening, the order things arrive in, the length, the sign-off — and never the sentences. Ask it to go closer to the original and it will decline and explain why, which is the correct behaviour: their words are their copyright, and their claims and numbers are about their business, not yours.
- **It will not post anything.** No publishing, no scheduling, no following, no messaging. It reads and writes to your own computer.
- **It cannot tell you whether a post made them money.** Engagement is attention. A post with 400 comments and no buyers is a real thing that happens.

Everything it reads is saved in the `competitor_posts` table, which you can open in n8n under **Data tables**.
