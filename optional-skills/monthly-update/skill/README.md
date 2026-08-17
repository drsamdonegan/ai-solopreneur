# Monthly Update (optional skill)

Once a month, your agent reads the last month of your inbox and writes you the update you have been putting off — what worked, what was hard, what you learned, and what is next — in your own voice.

Best for: the update to investors, your team, or your community that you know you should send and never quite get to, because writing it means going back through four weeks of email.

## The bit that makes it worth having

Anyone can paste a few emails into a chatbot and get a summary. This is different in three ways.

**It reads the whole month, not the bits you remember.** A month is four hundred emails. The wins you forgot are in there — the customer who said yes in week two, the renewal that quietly went through, the thing that broke and got fixed before anyone noticed.

**It throws almost all of it away first.** Before a single model call, every message is scored against your own company profile: your domain, your customers, your investors, your product names. Receipts, newsletters, one-time codes, LinkedIn notifications and calendar invites are gone before anything expensive happens. Typically 400 emails come down to about 100 worth a second look, and 40 threads worth actually reading. That filter is the difference between an update and a summary of your spam folder.

**Every line traces to a real email.** Each fact carries the message IDs it came from, and a separate pass checks the finished update against them. Ask "where did that come from?" and you get an answer. A claim nothing supports gets flagged before you send it, not after.

## What you get

```
Monthly update — July 2026

July was our first month with more inbound than outbound. Three of the four
pilots we started in June converted, and we finally shipped the reporting
work that had been sliding since May.

What worked
- Northwind signed a 12-month contract after their pilot, our first deal
  above $20k.
- We shipped the reporting rebuild on 14 July, two weeks later than planned
  but with the export format three customers had asked for.
- Two inbound demo requests came through the new pricing page with no
  outbound at all.

Challenges
- Onboarding is still manual and took nine days for Northwind. We are
  writing the setup guide first and automating account creation next.
- We lost Brightpath at renewal. They never got past the import step, which
  is the same thing two other accounts have told us.

What we learned
- Every account that stalled, stalled at import. That is one problem, not
  three, and it is the next thing we fix.

Next 30 days
- Ship self-serve import.
- Get the two July inbounds into pilots.
- Hire the support contractor.

Asks
- Intros to anyone running ops at a 50 to 200 person logistics company.

Based on 34 email threads from July 2026. Every line traces back to a
specific email; ask me for the source of any of them.
```

And on a genuinely quiet month, honestly:

```
I read through July 2026 and nothing in it rose to the level of a monthly
update. That is a real answer, not a failure.
```

## Before you start

Two things:

- The Anthropic key you already saved in n8n.
- A read-only Gmail connection, which takes about ten minutes to set up once. **docs/MONTHLY_UPDATE.md** walks through it.

Then, in order:

1. Run the setup workflow once. It creates three local tables.
2. Create the Gmail credential.
3. Tell your agent about your company, in the chat, in your own words. It saves a profile.
4. Ask it for last month's update.

The monthly schedule ships switched off. Turn it on once you have seen an update you are happy with.

## It can only read your email

The connection asks Google for exactly one permission: `gmail.readonly`.

That is not a promise in a prompt. It is what Google will let this credential do. It **cannot** send, reply, draft, label, archive, or delete, and neither can anything written inside an email it reads. If you ask it to send the update, it will tell you it can't and hand you the text instead.

n8n ships its own Gmail node, which is one step easier to set up and asks Google for full mailbox access including send and delete. This skill deliberately does not use it.

## What it costs

Roughly **$1.50 to $2.50** per monthly run. That is Anthropic API usage; the Gmail API is free.

Every run writes down its own token counts, so after two months you can read your real number instead of trusting that estimate. `docs/MONTHLY_UPDATE.md` shows where, and which two dials to turn if it is too much.

## What it does not do

**It does not read attachments.** It can see that a signed contract was attached, and it will say so, but it cannot read what is inside the PDF. Anything that only exists in an attachment is missing from the update.

**It only sees email.** Work that happened entirely in Slack, Linear, or your own head is not in there. What comes out is the story your inbox can prove, which is usually more than you remember and less than everything that happened.

**On a very heavy month it reads the newest mail first.** It examines up to 600 messages. If your month had more than that, the oldest are not looked at, and the update says how many there were so you know.

**It never sends anything to anyone.** It writes the update and hands it to you. Deciding whether it is right, and who gets it, stays with you.

## If an update comes back needing review

That is the system telling you the truth rather than quietly sounding confident. A line the emails do not support gets named, and your agent will point at it before you send. Fix the line, or ask where it came from and decide for yourself.
