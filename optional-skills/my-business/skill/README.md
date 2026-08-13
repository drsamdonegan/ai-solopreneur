# My Business Facts (optional skill)

Your own prices, hours, and terms, written once, so the agent stops guessing them.

**Fill this one in first.** The other optional skills are much less useful without it. Without it, every draft comes back saying `[YOU FILL IN: day rate]`. With it, your real number appears instead.

## Turn it on

1. Open `SKILL.md` in this folder and replace each `[NOT FILLED IN]` with your own facts. Leave any line you do not want to answer exactly as it is.
2. Open `skills/enabled.txt` and add this line at the end:

   ```text
   my-business
   ```

3. Save both files. Do not change any other line in `enabled.txt`.
4. Make sure the local app is running, then sync:
   - macOS: double-click `sync-skills.command`
   - Windows: double-click `sync-skills-windows.cmd`
5. Wait for **Enabled skills synced successfully**. This takes up to three minutes on an older laptop, because n8n restarts twice. A long quiet pause is normal.
6. Open the chat and select **New conversation**.

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
