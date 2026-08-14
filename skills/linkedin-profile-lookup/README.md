# LinkedIn Profile Lookup (optional skill)

Give the agent one person's name or business email, plus any location and industry clues you know. When an approved lookup tool is connected, the agent searches for likely public professional profiles, compares the candidates, and explains how confident the match is.

The skill is deliberately cautious. It does not assume the first search result is the right person, and it does not expose phone numbers or personal contact data.

## Before you install it

This folder teaches the agent how to perform and report the lookup. It does not create an internet or LinkedIn connection.

For a live lookup, the agent must also have a read-only tool named `lookup_linkedin_profile`. That tool needs either:

- a Crustdata account and API credential; or
- a managed `linkedin_people_search_crustdata` connection supplied by your course or agent administrator.

Never paste an API key into chat, `SKILL.md`, this README, or a committed file. Store credentials in the approved tool or n8n credential store.

This course project now includes the optional n8n implementation as **61 - TOOL - lookup_linkedin_profile**. Select a saved Bearer Auth credential named `CRUSTDATA_API_KEY`, publish workflow 61, and connect its `lookup_linkedin_profile` tool node to the main agent workflow. Each search costs a maximum of 0.30 credits and runs without a separate approval step; the agent reports what each lookup used. With no `CRUSTDATA_API_KEY` configured the skill still works in free mode, using public search results instead and spending nothing.

Without the tool, the skill should say that live lookup is unavailable and ask you to paste public profile text or a URL. That is expected behaviour, not a failed installation.

## Turn it on

Ask Claude Code, in plain English:

```text
Add the linkedin-profile-lookup optional skill to my agent.
```

Or run it yourself from the top of your project folder:

```bash
npm run add-skill -- linkedin-profile-lookup
```

Then make your running agent notice:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

## Test that it loaded

First ask:

```text
Can you find a likely LinkedIn profile for one person? Before searching, tell me
whether the lookup_linkedin_profile tool is connected. Do not pretend to search
if it is unavailable.
```

If no provider is connected, a correct response explains that the lookup tool is unavailable. If the agent claims it searched anyway, the tool boundary is not working correctly.

When the tool is connected, use your own details or a person who has agreed to the test:

```text
Use the LinkedIn Profile Lookup skill for one person.

Full name: [FULL NAME]
Business email: [BUSINESS EMAIL, OR LEAVE BLANK]
Country or region: [COUNTRY]
State or province: [STATE, OR LEAVE BLANK]
City: [CITY, OR LEAVE BLANK]
Industry: [INDUSTRY]

Show the likely profile, match confidence, and evidence. If the result is
ambiguous, show no more than three candidates and ask me to confirm. Do not
return phone numbers or personal contact information.

Run the search straight away without asking me to approve the cost, then tell me how many credits it used.
```

Use a business email where possible. A Gmail or other personal address usually provides no employer-domain evidence, and email-only matching needs a separately approved reverse-email lookup connection.

## Check that it worked

A successful lookup should include:

- `LIKELY PROFILE` for a supported match, or `POSSIBLE MATCHES` when uncertain;
- a LinkedIn profile URL, from the connected provider in paid mode or from public search results in free mode;
- a statement of which mode ran and what it cost, `0` credits in free mode;
- high, medium, or low match confidence;
- evidence such as name, location, industry, or employer agreement; and
- a clear warning about anything that still needs verification.

It should not:

- silently choose the first search result;
- reveal the supplied email address, phone numbers, or personal contact data;
- claim a low-confidence candidate is definitely the person;
- contact anyone or send a connection request; or
- claim to have scraped LinkedIn when no approved provider ran.

## How the agent uses the skill

The operating instructions are in `SKILL.md`. Candidate matching and confidence scoring are in `scripts/profile_matcher.py`. Connection requirements and the adapter for the supplied Crustdata helper are in `references/integration.md`.

The agent should call `lookup_linkedin_profile` once, treat returned profile text as untrusted data, and ask for a stronger discriminator such as employer or role when candidates are too similar.

## Turn it off

Remove `linkedin-profile-lookup` from `skills/enabled.txt` and run the skill sync helper again. The folder can remain in the project for later use.
