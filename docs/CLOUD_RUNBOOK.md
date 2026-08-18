# Putting your agent in the cloud

Your agent currently lives on your computer. That means it is awake only when
your laptop is, and nothing outside your computer can reach it.

Moving it to the cloud changes one thing: it gets a permanent web address. That
is what lets an inbox or a schedule start it while you are
doing something else.

**What it costs.** You can start free. Railway gives new accounts **US$5 of
credit for 30 days with no card**, and this agent uses about US$6 a month, so
that free credit runs it for roughly **three and a half weeks**.

After that it is about **US$6–9 a month**, so roughly AU$10–15. Your Claude
usage is separate and unchanged.

**Two things to know about the free credit before you rely on it:**

- Railway decides whether to give you the full free trial by looking at **how
  old your GitHub account is and how much you have used it**. It is automatic,
  and there is nobody to ask. If you made your GitHub account for this course,
  you may land on the limited version, which cannot reach the internet properly
  — your agent will deploy but fail to answer. Check before you need it, at
  `railway.com/verify`.
- When the free credit runs out your agent pauses, and **30 days later Railway
  deletes its storage**. So either upgrade, or keep the `.agentpack` file from
  Step 1 somewhere safe. It is the only copy of what was in there.

**What does not change.** Your agent on your own computer keeps working exactly
as it does now. Nothing here removes it, and you do not need Docker.

---

## Before you start

- [ ] Everything you have built is merged into `main` and pushed.
- [ ] Your agent runs on your computer right now.
- [ ] You know your GitHub sign-in.

If your work is spread across branches, sort that out first — the cloud runs
one branch. Merging cannot lose your conversations or credentials: those live
outside Git entirely, in a folder that is never committed.

---

## Step 1 — Pack your agent (5 minutes, on your computer)

Double-click **pack-agent**, or run:

```bash
npm run pack
```

Choose a passphrase. Write it down somewhere you will still have it in ten
minutes. If you lose it, nobody can open the file, including you.

You get one file in `backups/`, ending in `.agentpack`. It holds your
credentials, your workflows, your conversations and your business facts.

**This file holds your API keys.** Do not email it, do not put it in Dropbox or
Google Drive, and do not move it out of `backups/` — that folder is already
kept out of GitHub for you.

**Leave it there when you are done.** It is not rubbish to clear up; it is your
only copy of your agent if the cloud one goes away, which is exactly what
happens a month after free credit runs out.

## Step 2 — Deploy (10 minutes, mostly waiting)

1. Sign in to `railway.com` with GitHub.
2. **New Project** → **Deploy from GitHub repo** → choose your own repository.

   Pick the repository your agent is actually in. If the build fails almost
   immediately saying it could not work out how to build the app, and lists
   only a `README.md`, you have chosen the wrong one — a real agent repository
   has a `Dockerfile` in it.

3. It starts building. **This takes five to ten minutes the first time.**
   Nothing is wrong. Later deploys take about two minutes.

   When it finishes, open your agent's address. It will say **"Nearly there"**
   and list what it still needs. That is expected — the next two steps are
   those things.
4. **Settings** → **Volumes** → **Add Volume**. Mount path, exactly:

   ```
   /data
   ```

   This is where your agent keeps everything. Without it, every conversation
   and credential is erased on the next deploy — so your agent refuses to
   start until it exists, and tells you so.

5. **Settings** → **Networking** → **Generate Domain**, target port `3000`.
   This is **your agent**. Write it down.
6. **Generate Domain** again, target port `5678`. This is **your workshop**.
   Write it down too.
7. **Variables** → add two:

   | Name | Value |
   | --- | --- |
   | `N8N_PUBLIC_URL` | your workshop address from step 6 |
   | `AGENT_PASSCODE` | at least 8 characters, not a password you use elsewhere |

8. Redeploy.

Two addresses, and they are the same two doors you already know: your agent
was `localhost:3000`, your workshop was `localhost:5678`.

## Step 3 — Bring your agent across (5 minutes)

Open **your agent** address. It asks for three things:

- Your `.agentpack` file from Step 1.
- The passphrase you chose.
- The passcode you just set in Railway.

Then it starts. Everything is already there — your credentials, your
workflows, your conversations.

**You do not retype any API keys.** Your Anthropic key and every other
credential you have saved came across inside the pack, already working. There
is no list of secrets to copy into the hosting dashboard, and there should
never be one — a key pasted into a dashboard is a key sitting in a web page.

The one thing to know: **never add a variable called `N8N_ENCRYPTION_KEY`.**
That is the key that unlocks your credentials, it travels inside your pack, and
setting a different one by hand makes every saved credential unreadable. Your
agent checks for this and refuses to start rather than letting you find out
later.

Open your workshop address and create an n8n login. That is a separate login
from your passcode, and it is only for the workshop.

## Step 4 — Check it

- [ ] Open your agent address, enter your passcode, ask it something.
- [ ] Open your workshop, check **00 - START HERE** says **Published**.
- [ ] Leave your `.agentpack` where it is. It is your backup now.

---

### Connecting something new, later

Anything that needs your agent's web address has to be set up **after** you
deploy, not before — because before today it did not have an address. That
includes anything you sign in to with a Google or Microsoft button rather than
by pasting a key.

Those you set up once, in your cloud workshop. They are new connections, not
repeats of something you already did.

From now on your cloud agent is where your credentials live. If you add a new
key to the agent on your laptop afterwards, it stays on your laptop — add it in
the cloud workshop instead.

## Afterwards

**Changing your agent.** Push to `main`. Railway rebuilds and your change goes
live in a couple of minutes. If you changed a workflow, the deploy updates it.
If you did not, your workshop is left alone — anything you edited there by hand
stays edited.

**Undo.** In Railway, open the previous deployment and press **Redeploy**. That
puts the old version back. It is the closest thing you have to an undo button
and it is worth trying once, before you need it.

**Keeping the bill honest.** Set a usage limit in Railway. A workflow stuck in
a loop can otherwise run all month.

**Your laptop agent still works.** Nothing here changed it. It is worth keeping
as the place you experiment, and pushing only what works.

---

## When something is wrong

Work down this list in order. The first three cover almost everything.

### My agent will not start at all

First open your agent's address in a browser. If anything is missing it will
tell you there, on a page headed **"Nearly there"**, with the exact menus to go
to. You should not need the logs.

If you do want them, open **Deployments** in Railway. The agent explains itself
in plain English inside a box.

| What you see | What to do |
| --- | --- |
| `Free plan resource provision limit exceeded` | Railway will not run a second agent on a free account. The connector reconnects to an existing project by itself when it finds a service named after your repository, so this usually means an older project under a different name. Remove it in the Railway dashboard, or link to it with `railway link`, then run the connector again. |
| "Nearly there" and a list | Add what it lists, then deploy again. |
| Build fails at once, log lists only `README.md` | Wrong repository. Point the service at the one with your agent in it. |
| `Your agent has two different credential keys` | Delete the `N8N_ENCRYPTION_KEY` variable. You never need to set it — the key that unlocks your credentials travels inside your pack. |
| Red text during the build, before any of the above | The build failed, not your agent. Check whether the same commit runs on your own computer. |

### It starts, but I cannot get in

| What you see | What it is |
| --- | --- |
| The passcode page rejects a passcode you are sure of | Check for a trailing space in the Railway variable. |
| "Too many attempts" | Wait. It clears on its own — five seconds at first, longer if you keep going. Fifteen quiet minutes resets it completely. |
| You have genuinely forgotten it | Change `AGENT_PASSCODE` in Railway and redeploy. There is no reset email. |

### It answers, but badly

| What you see | What it is |
| --- | --- |
| "The local agent is not ready" | **00 - START HERE** is not published. Open your workshop and publish it. |
| It replies but never uses a tool | The tool workflows are not published, or your skills did not sync. Redeploy. |
| Every answer mentions your Anthropic key | The credential did not come across. Open the workshop, **Credentials**, check `Anthropic account` is there. |

### A trigger does nothing

This is the quiet one: nothing breaks, nothing appears.

1. Is the trigger workflow **Published**? This is the answer most of the time.
2. Open **Executions** in your workshop. Nothing listed at all means the
   outside service is not reaching you — the address it has is wrong.
3. An execution listed but red means it reached you and failed. Open it; the
   failing step is highlighted.

### Start again from scratch

Set `AGENT_RESTORE=1` in Railway and redeploy. You get the setup page back and
can upload a pack again. Remove the variable afterwards.

---

## What to bring if you are stuck

A screenshot of the log, including the box with the explanation in it. Which
step you were on. What you expected to happen. That is enough to sort out
almost anything in a couple of minutes.
