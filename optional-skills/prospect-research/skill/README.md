# Prospect Research (optional skill)

Name someone you want to approach who has never contacted you, paste whatever you already have about them, and get back: what you actually know as opposed to what you are guessing, three reasons they might care, the one specific detail worth opening with, a cold email under 120 words, and two follow-ups.

Best for: the person you met at a conference, the clinic you would like to work with, the name a client mentioned.

## Before you start

This skill draws its one line of proof from facts about your own business. There is no skill holding those any more, so every draft leaves `[YOU FILL IN: nearest client example]` for you to complete by hand. Paste your own proof point into the chat alongside the prospect's details and it will use that instead.

## How to get the information to paste

There is no internet access in this project. The agent cannot look anyone up, and it will tell you so rather than pretend.

You supply the material, which takes about fifteen seconds:

1. Open the person's LinkedIn profile, or their company's About or Services page, in your normal browser.
2. Select their **About** section and their current role, and copy it.
3. Paste it into the chat under their name and company.

You are reading a page you are allowed to read, which is why this works without any subscription, plugin, or scraping tool.

## Turn it on

Ask Claude Code, in plain English:

```text
Add the prospect-research optional skill to my agent.
```

Or run it yourself from the top of your project folder:

```bash
npm run add-skill -- prospect-research
```

Then make your running agent notice:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

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

Every enabled skill sits in the prompt for every message, so they compete. Run one optional skill at a time: remove the others from `enabled.txt` while you are using this one.

## Turn it off

Delete the `prospect-research` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored.
