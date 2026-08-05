# Signal Research (optional skill)

Ask your agent to go and find people who have the problem you fix. It reads public YouTube comments and brings back what real people said, in their own words, with a link to each one.

Best for: the moment you realise you have been describing your business in *your* words rather than your customers'.

Two things come out of it, and the second is the one that surprises people:

1. **People worth talking to.** Someone who typed "I gave up on this" last month has a problem you can help with.
2. **The words your buyers actually use.** Nobody types "operational inefficiency" into a comment box. They type "I spend every Sunday on invoices". Once you know the real phrasing, everything you write gets better — your website, your emails, your posts.

## Before you start

This skill is the first one that reaches outside your computer, so it needs a free key from Google. It takes about ten minutes, costs nothing, and needs no card.

Follow **[docs/YOUTUBE_SIGNALS.md](../../docs/YOUTUBE_SIGNALS.md)**. It walks through every click.

You will end up with:

- A **YouTube API Key** credential saved in n8n, the same way you saved your Claude key
- A table called `signals` where everything it finds is stored

Do not skip the two safety steps in that guide (restricting the key in Google, and restricting the domain in n8n). They take twenty seconds each and mean a leaked key is close to worthless.

## Turn it on

1. Open `skills/enabled.txt` and add this line at the end:

   ```text
   signal-research
   ```

2. Save the file. Do not change any other line in it.
3. Make sure the local app is running, then sync:
   - macOS: double-click `sync-skills.command`
   - Windows: double-click `sync-skills-windows.cmd`
4. Wait for **Enabled skills synced successfully**. This takes up to three minutes on an older laptop, because n8n restarts twice. A long quiet pause is normal.
5. Open the chat and select **New conversation**.

## Try it

Paste this into the chat exactly as it is:

```text
Find people who are frustrated with their bookkeeping software.
Look for the phrases: gave up, too expensive, hate, so confusing
```

You should get back a handful of real comments, each with who said it, which video it came from, and a link. Every one is also saved in the `signals` table, which you can open in n8n under **Data tables**.

If it comes back with nothing, that is a normal result and not a fault. Try again with shorter phrases, or a topic closer to the problem people have.

## Getting good results

This takes a little practice. The tool is simple; choosing what to look for is the skill.

**Search for the problem, not for what you sell.** Searching for your own product finds videos about that product, and the comments fill up with people who already know about it — plus your competitors. Searching for the problem finds people who are still stuck.

**Use short phrases.** `not technical` finds far more than `I am not technical at all`, because it matches every way somebody might phrase it.

**Expect some rubbish.** A phrase match only means those words appeared somewhere. When this was tested, `don't know where to start` matched somebody recommending a book about meditation. If a phrase keeps bringing back nonsense, make it more specific.

**Let the results teach you.** The best phrases come from reading what you found, not from guessing beforehand. Spot a way of describing the problem you had not thought of, and use it as a phrase next time.

## What it cannot do

- **It never contacts anybody.** It reads public pages and saves what it read. It cannot post a comment, send a message, or reply to anyone.
- **It cannot work out who somebody is.** If a person has not said who they are, the skill keeps their words and leaves them anonymous. Working out someone's real identity from a username is not something it will do.
- **It only reads YouTube.** Not LinkedIn, not Facebook, not Reddit.

There is a daily limit from Google of about ninety searches a day, which resets overnight. You will not get near it.

## One thing to be careful with

These are real people who wrote something in public.

Turning up in someone's comments with a sales pitch is the fastest way to get reported as spam, and it costs you the account. If you find a comment section full of the right people, the useful move is to take part in that conversation properly as yourself. Your agent will not draft a reply for you to post, and that is deliberate.
