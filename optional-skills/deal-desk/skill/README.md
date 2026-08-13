# Deal Desk (optional skill)

Paste your messy notes from a sales call you have already had. You get back: what they said in their own words, the three things you still need to confirm, a recap email under 200 words, a proposal skeleton with an explicit **out of scope** line, and the two objections to expect.

Best for: the gap between "that call went well" and "I still have not sent the proposal".

## Before you start

Turn on the **My Business Facts** skill first and fill it in. Without it, every price in the proposal comes back as `[YOU FILL IN: day rate]` and you will get tired of it.

## Turn it on

1. Open `skills/enabled.txt` and add this line at the end:

   ```text
   deal-desk
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
I just had this call. Help me follow it up.

call w/ Priya + Tom, wedding 12 Sept, venue is Coombe Lodge. 80 guests day,
130 evening. want full day from bridal prep. Tom asked about a second
shooter - said maybe. Priya's main thing is her mum is unwell and she wants
family group shots done fast, not 40 mins standing around. Budget they said
"we've put aside about 2k but it's flexible for the right person". Getting
quotes from 2 others. Wants album but might do that later. Said they'd
decide by end of the month.
```

## Check it worked

Look in the reply for these exact characters:

- `OBJECTIONS TO EXPECT`
- `WHAT TO CONFIRM`

If you can see both, the skill is running. If you cannot, it is not loaded: check that `deal-desk` is on its own line in `skills/enabled.txt`, with no capital letters and no spaces, then sync again.

The best part of the answer is usually the **out of scope** line in the proposal skeleton. It is the line that stops an argument three months later.

## What it will not do

It will not price the job for you. It takes prices from your **My Business Facts** skill or from your own notes, and leaves a bracket everywhere else. That is deliberate: a made-up day rate in a real proposal is worse than a blank.

It cannot look a company up, and it cannot send anything. You send everything yourself.

## Two skills that overlap with this one

`meeting-analysis` is switched on by default and also reacts to notes and transcripts. If your recaps come back looking like meeting minutes instead of a proposal, remove `meeting-analysis` from `enabled.txt` while you are using Deal Desk.

Seven skills are always loaded at once, so they compete. Run one optional skill at a time.

## Turn it off

Delete the `deal-desk` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored.
