# Xero Coding Review — working out what your transactions were

Your agent goes through the transactions sitting unreconciled in Xero and works out what each one probably is, so you are ticking off suggestions instead of typing account codes.

This walks through the four steps to switch it on, then the optional fifth that lets it prepare transactions for you. Step 2 is the only long one — it is a one-off, and it is what keeps this skill read-only.

## Install it

```bash
npm run add-skill -- xero-reconciliation
```

Then sync and restart, as with any skill:

- macOS: `./sync-skills.command` then `./start.command`
- Windows: `sync-skills-windows.cmd` then `start-windows.cmd`

## Step 1 — create the three tables

Open n8n, find **17 - SETUP - Bookkeeping Data** under *5. Setup and health*, and select **Execute workflow**.

That creates three local tables and nothing else:

| Table | Holds |
| --- | --- |
| `bookkeeping_profile` | The facts about your books that decide a suggestion: your usual suppliers, your coding rules, and the amount above which you always want to decide yourself |
| `reconciliation_suggestions` | One row per transaction the review looked at, what it thinks, and what you decided |
| `reconciliation_runs` | Each finished review, and what that review cost |

All three start empty and stay on your computer. Running the setup again is safe.

## Step 2 — connect Xero, read-only

This is the ten-minute part. You are creating your own Xero app, so that the only thing your agent can ever do with your accounts is read them.

### Why not the built-in Xero node

n8n ships a Xero node with its own credential. It is one step easier, and it asks Xero for eight read-**write** scopes — invoices, payments, bank transactions, contacts and more — with the Scope field hidden so you cannot narrow it. A credential made that way can create and delete invoices in your accounts.

This skill uses the generic **OAuth2 API** credential instead, where the Scope field is yours to set. What it asks for is read-only, and that is enforced by Xero rather than by a rule in a prompt.

### In the Xero developer portal

1. Go to <https://developer.xero.com/myapps> and sign in with your normal Xero login.
2. **New app**. Name it something you will recognise, like `My agent (read-only)`.
3. Integration type: **Web app**.
4. Company or application URL: anything you own works; `http://localhost:5678` is fine.
5. Redirect URI: exactly

   ```
   http://localhost:5678/rest/oauth2-credential/callback
   ```

   Use `localhost`, not `127.0.0.1`. Xero treats them as different addresses and only this one matches what n8n sends.
6. Create the app, then copy the **Client ID** and generate a **Client Secret**. Keep the tab open; you need both in a moment, and the secret is only shown once.

**If your agent lives on Railway** rather than your laptop, add a second redirect URI to the same app:

```
https://<your n8n address>/rest/oauth2-credential/callback
```

Your n8n address is the one in `N8N_PUBLIC_URL`. One app can hold both, so the same credentials work locally and in the cloud.

### In n8n

Credentials → **Create credential** → search for **OAuth2 API** (the generic one, not "Xero OAuth2 API") → name it **exactly**:

```
Xero (read-only)
```

The name matters. It is how the workflows find it on import.

Then fill in:

| Field | Value |
| --- | --- |
| Grant Type | Authorization Code |
| Authorization URL | `https://login.xero.com/identity/connect/authorize` |
| Access Token URL | `https://identity.xero.com/connect/token` |
| Client ID | from the Xero portal |
| Client Secret | from the Xero portal |
| Scope | `offline_access accounting.transactions.read accounting.contacts.read accounting.settings.read accounting.reports.read` |
| Authentication | Header |

n8n shows its own **OAuth Redirect URL** on this screen. Check it matches what you put in Xero, character for character.

Select **Connect my account**. Xero opens its own sign-in window, then asks which organisation to connect.

**Read the permission screen before you approve it.** It should say the app wants to *view* your accounting data. If it offers to create, update or delete anything, the Scope field is wrong: go back and fix it rather than approving.

### Checking it worked

Ask your agent in the chat:

> "Is Xero connected?"

It will tell you which organisation it can see.

### Reconnecting later

A Xero refresh token stops working after 60 days without use. If your agent says Xero is refusing the connection after a quiet couple of months, open the same credential and select **Connect my account** again. Nothing else needs redoing.

## Step 3 — tell your agent about your books

The review has nothing to reason from until you do this. In the chat:

> "We're a design studio. Uber is always 429 Travel, Officeworks is 461 Printing. Anything over two thousand dollars I want to decide myself."

Three things are worth saying, and the third matters most:

- the suppliers you pay regularly, and what each spend is for
- any coding rules you already follow, in your own words
- the dollar amount above which you always want to decide yourself

That last one is a hard floor. Above it, every suggestion is handed to you however obvious it looks.

## Step 4 — ask for a review

> "Go through my Xero transactions."

It answers straight away and works in the background for a few minutes. Then:

> "What did you find?"

You get three groups: the ones it can prepare, the ones to match by hand in Xero, and the ones it wants you to decide. It leads with the ones that need you.

**Two things it might be reviewing.** Whether Xero hands back your bank feed
lines through the API depends on your organisation, so the review works it out
and tells you. If it can see the feed, it is going through the lines still
waiting to be reconciled. If it cannot, it falls back to the transactions
already entered in Xero but not yet reconciled, says so in the report, and
Step 5 is unavailable for those — they already exist, so creating them again
would double them up. The suggestions are just as useful either way; you type
them into Xero rather than ticking them off.

If the Monthly Update skill's `Gmail (read-only)` credential happens to be connected, reviews also look in your own mailbox for the matching receipt. There is nothing to configure, and everything works without it.

## Step 5, optional — letting it prepare transactions for you

By default the agent suggests and you type. If you would rather tick things off, it can create the accepted suggestions in Xero as new unreconciled transactions, already coded, so all that is left is reconciling them.

Xero decides what it offers as a suggested match — it goes on your bank rules, transactions you have reconciled before, and what the statement line says. So some will be sitting on the **Match** tab ready to click **OK** on, and any that are not are found with **Find & Match** on the matching statement line. Either way you are not typing the account code again.

It still never reconciles anything. That click stays yours, every time.

For this you create a **second** credential, exactly as in Step 2 but named:

```
Xero (read-write)
```

Same Xero app, same Client ID and Secret. The only difference is the Scope:

```
offline_access accounting.transactions
```

This permission screen will say Xero wants to *view **and update*** your business transactions. That is the deliberate difference, and it is why this is a separate credential: your read-only one stays read-only, and you can see at a glance which is which. You should never see the word "update" on the first credential.

### If connecting this one breaks the first one

Xero issues refresh tokens per Xero account rather than per organisation, and
they are single use. That means it is possible — not certain, and it depends on
your setup — that consenting the second credential invalidates the first one's
token.

The symptom is unmistakable: reviews worked, you connected the write credential,
and now your agent says Xero is refusing the read connection.

The fix is to give the write credential **its own Xero app**. Go back to
<https://developer.xero.com/myapps>, create a second app exactly as in Step 2
with the same redirect URI, and use *its* Client ID and Secret for the
`Xero (read-write)` credential. Two apps means two independent grants, and
neither can disturb the other.

Then, in the chat:

> "Prepare the first three so I can tick them off." 

It shows you exactly what it will create, waits for a plain yes, and creates only what you named. Anything that changed since you accepted it is refused rather than created, and it tells you which and why.

**If one is wrong**, delete it inside Xero: open the transaction, then **Options → Delete**. It was never reconciled, so deleting is safe.

## Running it on a schedule

**107 - TRIGGER - Reconciliation Review** runs a review every Monday morning, so the suggestions are waiting rather than you having to ask. It ships **switched off**; turn it on with the toggle at the top right in n8n.

Turning it on does not let it write to Xero. Preparing transactions always needs you to accept suggestions in the chat first.

## What it costs

A few tens of cents of Anthropic usage per review, and less over time: every decision you record becomes a rule the deterministic pass applies before any model is asked. At one review a week, a dollar or two a month.

Xero's API is free. Its rate limits at the time of writing are 60 calls a minute and 5,000 a day; one review uses a few dozen. Those are Xero's current numbers, not a promise.

## What is sent where

Starting a review sends transaction descriptions, amounts, payee names, your chart of accounts and any matching receipt text from your own mailbox to Anthropic's API to be classified. Anthropic does not train on API data by default, this project uses it for inference only, and Xero's developer terms prohibit using Xero data to train AI models — nothing here does. Nothing is sent anywhere else: there is no Slack, no email, no Telegram, and a test in the skill exists to keep it that way.

## What it will not do

- It never marks anything reconciled. That is your click in Xero, and only you can make it.
- It never edits or deletes anything in your accounts. The one write it has only ever creates new unreconciled transactions.
- It is not your accountant. It will not tell you something is deductible, that a GST treatment is right, or that your books are compliant.
- It does not open email attachments. When your mailbox is connected it reads the body text of a matching receipt, not the PDF.

## When something goes wrong

**"There is no working Xero connection yet."** The credential does not exist, or is not named exactly `Xero (read-only)`. Check the spelling and the brackets.

**"Xero is refusing the connection."** Usually the 60-day expiry. Reconnect from the same credential screen. If it started immediately after you connected the `Xero (read-write)` credential, give that one its own Xero app instead — see Step 5.

**The review refuses to start.** It needs a bookkeeping profile first. Tell it about your books, as in Step 3.

**"A review is already running."** One takes a few minutes. If it has been more than half an hour, it will treat the old one as interrupted and start fresh on its own.

**Everything comes back needing a person.** That usually means a thin profile. The coding rules and the always-check-with-me amount are what let it be confident about anything.
