# The prompt for putting your agent in the cloud

Before you start, make yourself a [Railway](https://railway.com) account and a
[GitHub](https://github.com) account if you do not have them. Those two are
yours to make. Nothing else here needs an account.

Then open Claude Code in your agent's folder and paste the block below.

It does the fiddly parts: installing the tool, making the project, adding the
storage, making the two web addresses, and setting them up correctly. Three
things stay yours, because they should be: signing in, choosing your passcode,
and choosing your passphrase.

---

```
I want to put my AI agent on the internet, so it keeps working when my laptop
is closed. I have just made a Railway account and nothing else is set up yet.

Work through these steps in order. If a step fails, stop and show me the actual
error, word for word. Do not work around it and do not carry on to the next
step.

1. Check my agent works here first. Run `./status.command` on a Mac, or
   `status-windows.cmd` on Windows. If it is not set up yet, stop and tell me.

2. Get everything I have built onto my own GitHub account, on the main branch.
   The cloud reads my code from GitHub, so this has to happen before anything
   else works.
   - First check whether this folder already pushes to a repository of mine.
   - If it does not, ask me before creating one, and make it private unless I
     say otherwise.
   - Show me the list of files before you commit anything. Tell me if anything
     in it should not be committed: my own name, email or accounts in places
     they do not belong, anything that looks like a key or a password, or
     anything personal I may not have meant to publish.
   - Then commit and push.

3. Install the Railway command line, if it is not already installed:
   - On a Mac: brew install railway
   - On a Mac with no Homebrew, or on Windows: npm i -g @railway/cli
   Check it worked with `railway --version`.

4. Tell me to run the cloud connector myself, and wait for me:
   - On a Mac: double-click `connect-cloud.command`
   - On Windows: double-click `connect-cloud-windows.cmd`
   It needs its own terminal window, because it opens a browser so I can sign
   in to Railway, and then asks me to choose a passcode. Both are mine to do.
   Do not choose a passcode for me, do not suggest one, and do not repeat it
   back to me afterwards.
   - When it finishes it prints two web addresses. I will paste them to you.
     Show me both and tell me which is which.

5. Tell me to run the packer myself, the same way:
   - On a Mac: double-click `pack-agent.command`
   - On Windows: double-click `pack-agent-windows.cmd`
   - It will ask me for a passphrase. I will type it. Same rules as above.
   - Tell me the full path of the file it made.

6. Tell me to open my agent's web address and upload that file myself. Do not
   try to upload it for me.

7. Once I tell you it is working, check it for me: fetch the /health address of
   my agent and show me exactly what came back.

Rules for all of this:
- Never type a password, passcode or passphrase for me, and never write one
  into a file or a note. Do not choose one for me or suggest one, and do not
  repeat one back to me afterwards.
- Do not create any accounts for me.
- Do not put any of my API keys anywhere. They travel inside the file from
  step 5, already encrypted, and I never retype them.
- Do not upload the file from step 5 for me.
- If Railway says something about a plan or a limit, show me its exact words
  and stop. That is about my account, not about my computer, and reinstalling
  things will not fix it.
```

---

## What it will ask you for

**Signing in to Railway.** A browser window opens. That is you signing in to
your own account, and nobody should do it for you. A brand-new Railway account
sometimes has to confirm an email address or add a card before it will run
anything; if it asks, that is Railway's rule and not something the scripts can
work around.

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

One of them is worth knowing in advance, because it is not about your computer
at all. If the connector stops with **"Free plan resource provision limit
exceeded"**, that is Railway telling you your account will not run another
agent on its free plan. It usually means you already have one. Either use the
project you have — the connector reconnects to it by itself if it can find a
service named after your repository — or remove the old one in the Railway
dashboard before you try again.
