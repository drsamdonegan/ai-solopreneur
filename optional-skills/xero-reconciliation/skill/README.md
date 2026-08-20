# Xero Coding Review

Goes through the transactions sitting unreconciled in your Xero organisation and works out what each one probably is, so you are ticking off suggestions instead of typing account codes.

## How you use it

Pick the Bookkeeping agent in the chat, then talk to it:

> "Uber is always 429 Travel, and anything over two thousand dollars I want to decide myself."

> "Go through my Xero transactions."

> "Prepare the first three so I can tick them off."

## What comes back

```
I checked 34 outstanding transactions. I can prepare 19 now, and I need your
help with 6.

Ready to prepare:
- 14 Jul  -$88.00  Officeworks: I think this should be coded to 461 Printing &
  Stationery, using INPUT. Why: every past payment to them was coded there.
- 15 Jul  -$42.35  Uber: I think this should be coded to 429 Travel - National,
  using INPUT. Why: it follows a rule you already gave me.

Match these in Xero yourself:
- 18 Jul  -$1320.00  Bright Studio: This looks like invoice INV-0042. Open Find
  and Match in Xero and tick it.

I need your help with:
- 21 Jul  -$650.00  DIRECT DEBIT 8841: I left this untouched. I could not
  confidently identify who this payment was for.
- 22 Jul  -$2400.00  Kestrel Group: I left this untouched. This is above the
  $2000 you asked me to always check with you, so I have not suggested a code.

Nothing here is reconciled. A transaction is reconciled when you click OK in
Xero, and not before.
```

## The bit that makes it worth having

Most of the work never reaches a language model at all. A deterministic pass runs first, in this order: rules you have already given it, then an exact invoice match, then a transaction you had already entered in Xero, then a supplier you have coded the same way at least twice before. Only what is genuinely unclear costs a model call.

And it learns from you. Every time you accept a suggestion or give it a different code, that becomes a rule it applies first next time.

It is built to decline. Amount alone never identifies a payment, two invoices that both fit become a question rather than a guess, and an account code it cannot find in your own chart of accounts is thrown away rather than used.

## Before you start

You need a Xero developer app and one credential in n8n. It is about ten minutes, once. `docs/XERO_RECONCILIATION.md` has every click.

Then tell your agent three things: your usual suppliers, any coding rules you already follow, and the amount above which you always want to decide yourself.

## What it costs

A few tens of cents of Anthropic usage per review, and less as you record more decisions. Xero's API is free. The weekly trigger ships switched off.

## Two things it will never do

It will never click OK for you. Reconciling is your click, in Xero, every time.

It will never tell you something is deductible or that a GST treatment is right. That is your bookkeeper's call, and it will say so.

## What it cannot see

Attachments on emails. When your mailbox is connected it reads the body text of a matching receipt, but it does not open PDFs.

Sometimes your bank feed. Whether Xero hands back statement lines through its API depends on your organisation. If it will not, the review falls back to the transactions already entered in Xero but not yet reconciled, tells you it has, and cannot prepare those for you — they already exist, so creating them again would double them up. You still get the coding suggestions; you type them in rather than ticking them off. Nothing needs configuring either way.
