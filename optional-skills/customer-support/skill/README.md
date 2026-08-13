# Customer Support Replies (optional skill)

Paste a message from a customer who has already bought or booked. You get back: what they actually want, how urgent it is, **what you must decide before sending**, a calm reply ready to copy and paste, and a note on what they will ask next.

Best for: late deliveries, faults, cancellations, complaints, and the messages you keep putting off until the evening.

## Before you start

Turn on the **My Business Facts** skill first and fill in your returns and cancellation terms. Without them the agent writes `Not stated` rather than guessing your policy, which is safe but not much use.

## Turn it on

1. Open `skills/enabled.txt` and add this line at the end:

   ```text
   customer-support
   ```

2. Save the file. Do not change any other line in it.
3. Make sure the local app is running, then sync:
   - macOS: double-click `sync-skills.command`
   - Windows: double-click `sync-skills-windows.cmd`
4. Wait for **Enabled skills synced successfully**. This takes up to three minutes on an older laptop, because n8n restarts twice. A long quiet pause is normal.
5. Open the chat and select **New conversation**. Always test in a new conversation, or the agent copies the style of its own earlier replies and the skill looks broken.

## Try it

Paste this into the chat exactly as it is:

```text
A customer just emailed me this. Draft a reply. Royal Mail says it is stuck
at the depot. I have not decided about the refund.

"Order 4471 was meant to arrive Friday for my mum's 70th. It's now Tuesday
and the tracking hasn't moved since the 3rd. This is the second time this
has happened. I want a full refund and I'm not paying return postage again."
```

## Check it worked

Look in the reply for these exact characters:

- `CHECK BEFORE SENDING`
- `[FULL REFUND / REPLACEMENT / NEITHER - PICK ONE]`

If you can see both, the skill is running. If you cannot, it is not loaded: check that `customer-support` is on its own line in `skills/enabled.txt`, with no capital letters and no spaces, then sync again.

That second string is the whole point of this skill. It will not decide a refund on your behalf. It hands the decision back to you and writes everything else.

## What it will not do

- It will never promise a refund, a discount, a replacement, or a delivery date that you have not decided.
- It will never invent your returns policy. If it is not in **My Business Facts**, it writes `Not stated`.
- It cannot read your inbox, look up an order, or send anything.
- It will refuse to draft at all when a customer blames you for an injury or a safety problem, or mentions a solicitor, a regulator, or a chargeback. Those need you, not a draft.

## Please read this before you use it on real messages

Anything you paste into the chat is sent to the Anthropic API and stored in your local conversation history. Remove the customer's surname, address, and phone number first where you can.

**Never put customer details into `SKILL.md` or into `My Business Facts`.** Those files go to GitHub and their history is permanent.

## If it starts answering everything like a support ticket

Seven skills are always loaded at once, so they compete. Run one optional skill at a time: remove `lead-conversion` and `deal-desk` from `enabled.txt` while you are using this one.

## Turn it off

Delete the `customer-support` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored.
