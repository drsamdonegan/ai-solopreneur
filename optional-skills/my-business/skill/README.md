# My Business Facts (optional skill)

Your own prices, hours, and terms, written once, so the agent stops guessing them.

**Fill this one in first.** The other optional skills are much less useful without it. Without it, every draft comes back saying `[YOU FILL IN: day rate]`. With it, your real number appears instead.

## Turn it on

Ask Claude Code, in plain English:

```text
Add the my-business optional skill to my agent.
```

Or run it yourself from the top of your project folder:

```bash
npm run add-skill -- my-business
```

Then make your running agent notice:

- macOS: double-click `sync-skills.command`, then `start.command`
- Windows: double-click `sync-skills-windows.cmd`, then `start-windows.cmd`

Open the chat and select **New conversation**.

## Check it worked

Ask the agent:

```text
What is my normal lead time?
```

It should answer with the exact words you typed into `SKILL.md`. If it says `Not stated`, that line is still `[NOT FILLED IN]`. If it makes something up, the skill is not loaded: check that `my-business` really is on its own line in `skills/enabled.txt`, then sync again.

## Please read this before you type

This file is committed to your GitHub repository, and Git history is permanent. Write only facts you would put on your own website.

**Never put a customer's name, address, phone number, email address, or order number in here.**

## Turn it off

Delete the `my-business` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored.
