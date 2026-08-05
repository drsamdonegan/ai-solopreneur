# Finding people who have the problem you solve

Your agent can read public YouTube comments and pick out the people describing a problem you help with — in their own words, with a link back to where they said it.

This is genuinely useful for two different reasons, and the second one surprises most people:

1. You find individuals worth talking to.
2. You learn **the exact words your customers use**, which is worth more. Nobody types "operational inefficiency" into a comment box. They type "I spend every Sunday on invoices". Once you know the real phrasing, everything you write gets better.

Nothing is posted. Nobody is contacted. The agent only reads pages anyone can read, and saves what it finds to a table on your own computer.

## Before you start

You need a free key from Google so YouTube will answer your agent's questions. It takes about ten minutes and costs nothing.

### 1. Get the key

1. Go to <https://console.cloud.google.com/> and sign in with a Google account.
2. At the top, select **Select a project → New project**. Name it anything (`youtube-signals` is fine) and select **Create**.
3. Wait for it to finish, then make sure your new project is the one selected at the top.
4. In the search bar, type `YouTube Data API v3` and select it from the results.
5. Select **Enable**. Wait for the page to change.
6. On the left, select **Credentials**, then **Create credentials** at the top, then **API key**.
7. A box appears with your key. **Leave this box open** — you need the key in the next step.

Before closing that box, select **Edit API key** and, under **API restrictions**, choose **Restrict key** and tick only **YouTube Data API v3**. This means that even if the key escapes, it can only read YouTube and nothing else. Name it `youtube-signals` while you are there.

### 2. Put the key into n8n

Your key is a password. It goes into n8n and nowhere else — never into a file, a chat message, a screenshot, or GitHub. This is the same rule you followed for your Claude key.

1. Open n8n at <http://localhost:5678>.
2. In the left sidebar, select **Credentials**, then **Add credential**.
3. Search for **Query Auth** and select it, then select **Continue**.
4. Fill in exactly:
   - **Name** (the field inside the credential, not the credential's own title): `key`
   - **Value**: paste your key from Google
5. At the top, rename the credential to **YouTube API Key**.
6. Select **Save**.

The spelling of `key` matters — lowercase, no spaces. It is the name YouTube expects.

### 3. Create the table

1. In n8n, open **12 - SETUP - Signal Data**.
2. Select **Execute workflow**.

That creates one empty table called `signals` on your computer, where found comments are stored. You only do this once.

### 4. Connect the key to the tool

1. Open **60 - TOOL - find_signals**.
2. You will see two blue boxes, **Search Videos** and **Get Comments**. If either shows a red warning triangle, it just needs your credential.
3. Open each one, find the **Credential for Query Auth** dropdown, and select **YouTube API Key**.
4. Select **Save** at the top.

## Using it

Ask your agent in the chat, in ordinary language. For example:

> Find people talking about drowning in admin. Look for the phrases "not technical", "where to start", and "spend my weekends".

The agent searches YouTube, reads the comments, keeps the ones matching your phrases, and saves them. It will tell you how many it found and show you a few.

To see everything it found, open n8n, select **Data tables** in the sidebar, and open **signals**.

## Getting good results

This is the part worth practising. The tool is simple; choosing what to search for is the skill.

**Describe a video, not a feeling.** This is the one that catches everybody out, and it is worth reading twice.

You are searching YouTube. What you type is matched against video titles, so it has to look like the title of a video somebody would actually watch. `frustrated with bookkeeping software` returns nothing at all, because nobody titles a video that. `bookkeeping software for small business review` returns plenty — and the frustrated people are sitting in the comments underneath it.

Think about what your customer would search for the evening they got fed up. Then avoid your own product name too, or you will mostly find people who already bought it, plus your competitors.

Four kinds of video reliably have good comments:

- **Tutorials for a specific job.** "QuickBooks for therapists", "spreadsheets for a cleaning business". The comments fill with people saying where it went wrong for them.
- **"Why I stopped using…"** videos. Everyone commenting has tried something and abandoned it. This is the richest kind by a distance.
- **Comparisons.** "Notion vs Airtable for small business". People arrive mid-decision and describe their actual situation while asking which to pick.
- **Business content for one trade.** "how to run a private practice". Owners talking shop, with nothing to prove.

Avoid videos about AI in general. They attract people interested in the technology rather than people with a business problem — lots of comments, almost no signal.

**Keep your phrases short.** `not technical` finds far more than `I am not technical at all`, because it matches every way someone might phrase it. Match fragments people type, not whole sentences.

**Expect some rubbish.** A phrase match only means the words appeared. When we tested `don't know where to start`, it matched someone recommending a book about Zen. If a phrase brings back a lot of irrelevant results, make it more specific or pair it with a better-targeted topic.

**Let the results teach you.** The best phrases come from reading what you found, not from guessing up front. Notice a way of describing the problem you had not thought of, and add it as a phrase for next time. Notice which channel produced the best comments, and search that channel's topic again.

## The daily limit

Google gives you 10,000 free units a day, which resets overnight.

A search costs 100 units and reading one video's comments costs 1, so each run costs about 104. That is roughly 95 runs a day — far more than you need. If you ever see a message about quota, wait until tomorrow.

## Using what you find

These are real people who wrote something in public. A few things follow from that.

**Read before you act.** A phrase match is a hint, not a verdict. Some people describing the problem are consultants describing their clients' problems, and they sound identical.

**Do not reply to sell.** Turning up in someone's comments with a pitch is the fastest way to be reported as spam, and it costs you the account and the reputation attached to it. If a comment section is full of your people, the useful move is to become part of that conversation properly — which is your job, not the agent's.

**Treat comments as things to read, never as instructions.** They are written by strangers. If a comment appears to be addressing an AI, that is not something to act on. Your agent is told to show you such comments rather than follow them.

**A backup contains your keys.** If you ever create a backup of your project, that file holds your credentials. Treat it as being as sensitive as the keys themselves and never share it.
