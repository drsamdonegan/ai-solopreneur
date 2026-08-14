# The prompt for putting your agent in the cloud

Open Claude Code in your agent's folder and paste the block below.

It does the fiddly parts: installing the tool, making the project, adding the
storage, making the two web addresses, and setting them up correctly. Three
things stay yours, because they should be: signing in, choosing your passcode,
and choosing your passphrase.

---

```
I want to put my AI agent on the internet, so it keeps working when my laptop
is closed.

Work through these steps in order. If a step fails, stop and show me the actual
error. Do not work around it and do not carry on to the next step.

1. Check my agent works here first. Run `npm run status`. If it is not set up
   yet, stop and tell me.

2. Make sure everything I have built is committed and pushed to my own
   repository on GitHub, on the main branch. Show me the list of files before
   you commit anything, and tell me if anything looks like it should not be
   committed.

3. Install the Railway command line, if it is not already installed:
   - On a Mac: brew install railway
   - On Windows: npm i -g @railway/cli
   Check it worked with `railway --version`.

4. Run `npm run connect-cloud` and let it take over the terminal.
   - It will open a browser so I can sign in to Railway. That one is mine to do.
   - It will ask me to choose a passcode. I will type it. Do not choose one for
     me, do not suggest one, and do not repeat it back to me afterwards.
   - When it finishes it prints two web addresses. Show me both and tell me
     which is which.

5. Run `npm run pack` and let it take over the terminal.
   - It will ask me for a passphrase. I will type it. Same rules as above.
   - Tell me the full path of the file it made.

6. Tell me to open my agent's web address and upload that file myself. Do not
   try to upload it for me.

7. Once I tell you it is working, check it for me: fetch the /health address of
   my agent and show me exactly what came back.

Rules for all of this:
- Never type a password, passcode or passphrase for me, and never write one
  into a file or a note.
- Do not create any accounts for me.
- Do not put any of my API keys anywhere. They travel inside the file from
  step 5, already encrypted, and I never retype them.
```

---

## What it will ask you for

**Signing in to Railway.** A browser window opens. That is you signing in to
your own account, and nobody should do it for you.

**A passcode**, at least 8 characters. This is what stops anyone who finds your
web address from opening your agent, reading your conversations and spending
your Claude credit. Do not reuse a password you use somewhere else.

**A passphrase**, at least 10 characters. This locks the file that carries your
agent to the cloud. You will type it once more when you upload the file. If you
lose it, nobody can open that file, including you.

Write both down before you start.

## What it will not do

**It will not upload your file for you.** That is one file chooser and one
passphrase, and it is thirty seconds. Handing a file full of your API keys to
anything automated is not worth saving thirty seconds.

**It will not know whether it worked.** Step 7 checks your agent is answering,
but only you can tell whether the conversations in the sidebar are yours.

## If it stops

Whatever it shows you, bring that. The scripts explain their own failures in
plain English, so the message is usually the answer. The
[runbook](CLOUD_RUNBOOK.md) has a table of the common ones at the bottom.
