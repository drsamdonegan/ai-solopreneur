# Lead Conversion (optional skill)

Paste a new enquiry from someone who has not bought from you yet. You get back: whether it is real or spam, what you actually know as opposed to what you are guessing, a first reply under 150 words, and three follow-up nudges.

Best for: website contact forms, Instagram and Facebook messages, and cold email.

## Before you start

Turn on the **My Business Facts** skill first and fill it in. Without it, every price and lead time in the draft comes back as a bracket for you to complete.

## Turn it on

1. Open `skills/enabled.txt` and add this line at the end:

   ```text
   lead-conversion
   ```

2. Save the file. Do not change any other line in it.
3. Make sure the local app is running, then sync:
   - macOS: double-click `sync-skills.command`
   - Windows: double-click `sync-skills-windows.cmd`
4. Wait for **Enabled skills synced successfully**. This takes up to three minutes on an older laptop, because n8n restarts twice. A long quiet pause is normal.
5. Open the chat and select **New conversation**. Always test in a new conversation, or the agent copies the style of its own earlier replies and the skill looks broken.

## Try it

Paste this into the chat exactly as it is, with nothing else:

```text
From: WordPress <wordpress@stonebridgejoinery.co.uk>
Subject: New submission from Contact Form

Name: Priya Nandra
Email: p.nandra@harlowdental.co.uk
Phone: (not provided)
How did you hear about us: Google
Message:
Hi - we're refitting our waiting room and reception desk before we reopen
in the autumn. Do you do fitted furniture for commercial spaces? Roughly
what would something like that cost? We'd need it done during a two week
closure.
```

## Check it worked

Look in the reply for these exact characters:

- `NEXT TOUCHES`
- `(Inferred from`

If you can see both, the skill is running. If you cannot, it is not loaded: check that `lead-conversion` is on its own line in `skills/enabled.txt`, with no capital letters and no spaces, then sync again.

Then paste the same enquiry with the message replaced by a sales pitch. It should refuse to draft a reply and tell you why.

## What it will not do

It cannot send email, and it cannot look anyone up on the internet. There is no web access in this project. It works only from the words in front of it, which is why it labels every line `(Stated)`, `(Inferred from ...)`, or `Not stated`. If you want it to know more about a lead, paste their website or profile text into the chat and it will read that.

## If it starts answering everything like a sales enquiry

Seven skills are always loaded at once, so they compete. Run one optional skill at a time: remove `deal-desk` and `customer-support` from `enabled.txt` while you are using this one.

## Turn it off

Delete the `lead-conversion` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored.
