# Prospect Research (optional skill)

Name someone you want to approach who has never contacted you, paste whatever you already have about them, and get back: what you actually know as opposed to what you are guessing, three reasons they might care, the one specific detail worth opening with, a cold email under 120 words, and two follow-ups.

Best for: the person you met at a conference, the clinic you would like to work with, the name a client mentioned.

## Before you start

Turn on the **My Business Facts** skill first and fill it in. This skill draws its one line of proof from your own facts, so without it every draft says `[YOU FILL IN: nearest client example]`.

## How to get the information to paste

There is no internet access in this project. The agent cannot look anyone up, and it will tell you so rather than pretend.

You supply the material, which takes about fifteen seconds:

1. Open the person's LinkedIn profile, or their company's About or Services page, in your normal browser.
2. Select their **About** section and their current role, and copy it.
3. Paste it into the chat under their name and company.

You are reading a page you are allowed to read, which is why this works without any subscription, plugin, or scraping tool.

## Turn it on

1. Open `skills/enabled.txt` and add this line at the end:

   ```text
   prospect-research
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
I want to approach this person. Here is their LinkedIn About section.

Name: Dr Meera Sundaram
Company: Riverbank Allied Health, Geelong

"Clinical lead at Riverbank Allied Health. We've grown from two clinicians to
fourteen in three years across physio, OT and speech. Most of my week now goes
on rosters, onboarding and trying to keep our intake process from falling over
at the front desk. Passionate about early intervention and about not losing the
small-practice feel while we grow."
```

Then try it a second time with **only** the name and company and nothing pasted. It should write `No hook found` and tell you what to paste, rather than inventing a detail. That refusal is the whole point of the skill.

## Check it worked

Look in the reply for these exact characters:

- `THE HOOK`
- `IF THEY DO NOT REPLY`

If you can see both, the skill is running. If you cannot, it is not loaded: check that `prospect-research` is on its own line in `skills/enabled.txt`, with no capital letters and no spaces, then sync again.

## What it will not do

- It will not look anyone up. It has no web access at all.
- It will not invent a job title, an employer, a qualification, a mutual contact, or a previous conversation. Anything it is not sure of comes back as `Not stated` or `(Inferred from ...)`.
- It will not manufacture an opening line. No pasted material means `No hook found`.
- It cannot send anything. You copy the draft into your own email application.

## Before you send a cold email

In Australia the Spam Act 2003 requires consent for commercial email. Business addresses published in connection with someone's role can carry inferred consent, but that is a judgement about each contact, not a blanket permission. Say who you are, and make it easy to be told no. The UK and EU have their own equivalents.

The skill will remind you once. It is a drafting tool, not advice about your obligations.

## If it starts answering everything like a cold email

Seven skills are always loaded at once, so they compete. Run one optional skill at a time: remove `lead-conversion` and `deal-desk` from `enabled.txt` while you are using this one.

## Turn it off

Delete the `prospect-research` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored.
