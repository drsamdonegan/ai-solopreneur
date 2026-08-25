# Monthly Update — reading a month of email

Your agent reads the last month of your inbox and writes the company update that comes out of it: what worked, what was hard, what you learned, what is next.

This walks through the four steps to switch it on, then what it costs and how to spend less. Step 2 is the only long one — it is a one-off, and it is what keeps this skill read-only.

## Install it

```bash
npm run add-skill -- monthly-update
```

Then sync and restart, as with any skill:

- macOS: `./sync-skills.command` then `./start.command`
- Windows: `sync-skills-windows.cmd` then `start-windows.cmd`

## Step 1 — create the three tables

Open n8n, find **15 - SETUP - Monthly Update Data** under *5. Setup and health*, and select **Execute workflow**.

That creates three local tables and nothing else:

| Table | Holds |
| --- | --- |
| `company_profile` | The facts about your company that decide which emails count as news |
| `update_evidence` | Every fact pulled out of your email, with the message IDs it came from |
| `update_runs` | Each finished update, and what that run cost |

All three start empty and stay on your computer. Running the setup again is safe.

## Step 2 — connect Gmail, read-only

This is the ten-minute part. You are creating your own Google app, so that the only thing your agent can ever do with your mail is read it.

### Why not the built-in Gmail node

n8n ships a Gmail node with its own credential. It is one step easier, and it asks Google for `https://mail.google.com/` — full access, including send and delete. This skill only ever needs to read, so it asks for `gmail.readonly` and nothing else. That is enforced by Google, not by a rule in a prompt: even if something went badly wrong, this credential cannot send a message.

### In Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project. Call it anything.
2. Open **APIs & Services → Library**, search for **Gmail API**, and enable it.
3. Open **APIs & Services → OAuth consent screen**. Choose **External**, fill in the app name and your own email, and save.
4. On **Audience**, add your own Google account under **Test users**.
5. Then **publish the app**. While an app sits in Testing, Google expires its refresh token after seven days — the update would work, then silently stop a week later. Publishing an app used only by you does not require verification; Google shows an "unverified app" warning at sign-in, which you click through.
6. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose **Web application**.
7. Leave the redirect URL blank for a moment — the next step gives you the exact one to paste.

### In n8n

8. Open **Credentials → Create credential**, and choose **Google OAuth2 API**. Not "Gmail OAuth2 API" — the generic Google one, which is the one with an editable scope.
9. Name it exactly **`Gmail (read-only)`**. Step 15 is what links it to the workflows, and it matches on that name, so a typo here is the one thing that stops it.
10. Copy the **OAuth Redirect URL** that n8n shows you, paste it into your Google OAuth client's **Authorised redirect URIs**, and save in Google.
11. Paste the **Client ID** and **Client Secret** from Google into n8n.
12. In the **Scope** field, put exactly this and nothing else:

    ```
    https://www.googleapis.com/auth/gmail.readonly
    ```

13. Select **Connect my account**, sign in, click through the unverified-app warning, and grant access. Google's consent screen will say the app wants to *view* your email. If it says anything about sending or deleting, the scope field is wrong — go back to step 12.
14. Save.

### Then link it to the workflows

15. Run the import helper once: double-click `import-workflows.command` on macOS, or
    `import-workflows-windows.cmd` on Windows.

That one step is not optional, and skipping it looks exactly like a Google problem.
The workflows ship with a placeholder where the credential goes, because the skill is
built before your credential exists. n8n fills that placeholder in by name, and it only
does so while importing. Until the import runs, the workflows are still pointing at the
placeholder, so your agent keeps saying your email is not connected no matter how many
times you reconnect it.

Importing leaves the main agent unpublished, so finish the job the same way you set it up:
open **00 - START HERE - Project Partner** in n8n and select **Publish**. See
[N8N_AGENT_SETUP.md](N8N_AGENT_SETUP.md).

You only do this the first time. Reconnecting later reuses the same credential, so the
link holds and your agent picks it straight back up.

### Checking it worked

Ask your agent:

```text
Is my email connected?
```

It checks and tells you which mailbox it is connected to. It will also refuse to start an update run while the connection is missing, rather than spending several minutes and a couple of dollars failing.

### Reconnecting later, without hunting for the screen

When the connection is missing or has lapsed, your agent gives you a **Connect Gmail** button that opens n8n on the right credential. Select **Connect my account** and grant access. You do not need to come back and say so — the chat watches for Gmail to start answering and carries on by itself.

The button goes through the chat rather than to a fixed n8n address, so it is correct whether you run this on your own computer or against a hosted n8n.

Your agent cannot connect Gmail for you and cannot make Google's sign-in window appear. The Google client secret lives in n8n's encrypted credential store, and nothing can read it back out, so n8n is the only thing that can run the sign-in. That is also why the secret is not in a `.env` file. Your agent will never ask you for a Google password or a verification code; if anything ever does, something is wrong.

## Step 3 — tell your agent about your company

Open the chat, start a new conversation, and describe your company in your own words:

```text
We're Northwind, our email is northwind.io. Sam and Priya are the founders.
Our customers are Acme and Brightpath — acme.com and brightpath.co. Our
investors are Foundry Ventures. The product is called Ledger, and we're at
seed stage.
```

Your agent saves that and reads it back. Correct anything it misheard, and answer whatever it says is still missing.

**This step decides how good the update is.** The scan works by matching every email against these names and domains. If it does not know Acme is a customer, the thread where Acme signed looks like any other email. You can add to it any time — "Brightpath churned, add Coastal as a customer" — and only what you mention changes.

The company name and your email domain are required. Everything else makes it better.

### Getting it in Slack instead

Tell your agent to deliver to a Slack channel, and give it the channel ID:

```text
Send my monthly update to Slack channel C01234567 instead of just the chat.
```

That needs one outbound-only Slack credential. It does not need the deleted
inbound Slack trigger, an Events API request URL, or permission to read any
channel.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and choose **Create New App** → **From scratch**.
2. Under **OAuth & Permissions**, add the bot token scope `chat:write` and no read scopes.
3. Select **Install to Workspace**, then copy the **Bot User OAuth Token**. It begins `xoxb-`.
4. In n8n, open **Credentials** → **New** → **Header Auth**.
5. Name the credential exactly `Slack bot token`.
6. Set **Name** to `Authorization` and **Value** to `Bearer xoxb-...` — the word `Bearer`, one space, then the token.
7. Open the monthly-update workflow and confirm **Post To Slack** uses `Slack bot token`.

Keep the token in Slack and n8n. Never paste it into this chat, a skill file,
or a screenshot. Invite the bot to a private channel before using that
channel's ID. The workflow only posts the finished update; it cannot read
messages, mentions, or direct messages.

## Step 4 — ask for an update

```text
Write my monthly update for last month.
```

Your agent starts a background run and tells you so. It takes a few minutes: it lists the month's mail, filters it, reads the threads that survive, and writes the update. Ask again in a few minutes:

```text
Is my monthly update ready?
```

### Running it on a schedule

Once you have seen an update you are happy with, open **73 - TRIGGER - Monthly Update** under *5. Ways your agent gets started* and switch it on with the toggle at the top right. It ships off.

From then on it runs at 9am on the 1st of each month and reads the month that just ended. You still ask your agent for the update whenever you like; it reads what the schedule already produced.

## Reading the result

Ask for it in plain language — "what does my update say", "what were the challenges last month", "where did the Northwind line come from". The last one works because every fact keeps the Gmail message IDs it came from.

When an update comes back **needing review**, your agent will name the specific lines that the emails do not fully support. That is the system being honest rather than sounding confident. Check those lines before you send it.

## What it costs

About **$1.50 to $2.50** a run, so about that much a month with the schedule on. The Gmail API is free; this is all Anthropic usage.

Checking the connection is free: it reads only the mailbox address and message count, and calls no model.

| Stage | Calls | Model |
| --- | --- | --- |
| Deciding which emails are worth reading | about 12 | Haiku 4.5 |
| Reading the threads that survive | up to 40 | Sonnet 5 |
| Deciding what belongs in the update | 1 | Sonnet 5 |
| Writing it | 1 | Opus 5 |
| Checking it against the emails | 1 | Sonnet 5 |

Every run records its own token counts in `update_runs`, so after two months you can read your real number rather than trusting that table.

### Spending less

Open **74 - RUN - Monthly Update** in n8n and find the **Plan Run** node. At the bottom are the two dials that matter:

- `maxThreads` (default 40) — how many email threads get read in full. This is most of the bill. Halving it roughly halves the cost.
- `maxCandidates` (default 120) — how many messages reach the cheap first-pass filter.

Turning both down gives you a shorter update built on less. Turning `maxThreads` up costs more and rarely finds much: the threads are already ranked, so number 60 is usually noise.

## What it will not do

- **It cannot send anything.** The Gmail scope is read-only, so send, reply, label, archive, and delete are not available to it. It hands you the text; you decide who gets it.
- **It cannot read attachments.** It sees that a contract was attached and says so, but not what is inside the PDF.
- **It only knows what is in your email.** Work that happened in Slack, in Linear, or in your head is not in the update.
- **It reads the newest 600 messages of a month.** A heavier month than that has its oldest mail left out, and the update tells you how many there were.

## When something goes wrong

**"No company profile is saved yet."** Step 3. Describe your company in the chat.

**"Your Gmail is not connected" straight after you connected it.** The workflows are still
on the placeholder. Run step 15 — `import-workflows.command`, or `import-workflows-windows.cmd`
on Windows — then publish the main agent again and ask once more. Reconnecting in Google a
second time will not help, because Google is not the thing that is refusing.

**"Gmail refused the request."** Ask your agent "is my email connected?" — it separates the three causes, which need three different fixes. If it says the connection has lapsed, reconnect; about a week after setup that means the consent screen is still in Testing, so go back to step 2 and publish the app. If it says the permission was granted without read access, the Scope field is wrong: fix it and connect the account again.

**"The Gmail API is switched off for this project."** Signing in again cannot fix this one, and the agent will say so rather than send you round in a circle. It means step 2's *enable the Gmail API* was missed, or was done on a different Google Cloud project. Your agent gives you the exact address to open; select **Enable** there, wait a minute for Google to catch up, and ask again. A newly enabled API takes a few minutes to start working, so one more refusal straight afterwards is normal.

**"Nothing looked like company news."** Almost always a thin profile. If the scan does not know your customers, investors, or product names, it cannot tell their email apart from everything else. Add more and run it again.

**"I read through the month and nothing rose to the level of an update."** Sometimes true, and worth taking at face value on a quiet month. If it happens twice in a row on a month you know was busy, check that your own email domain is right in the profile — that one field carries more weight than any other.

**The update mentions the process, or says what data was missing.** That is a drafting failure, not a data problem. `optional-skills/monthly-update/skill/references/update-contract.md` lists the rules it works to and which pass to blame.

**A run seems stuck.** Open **74 - RUN - Monthly Update** in n8n and look at its executions. A run over 40 threads takes several minutes; anything much longer has usually hit a Gmail timeout, and running it again is safe.
