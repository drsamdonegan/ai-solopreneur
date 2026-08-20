# Scheduler — work your agent does without you

## What it is

You tell your agent, once, what you want done and when. It saves that. At the
time you asked for, it sends what you said to the agent that can do it, exactly
as though you had opened the chat and typed it in — except nobody is there.

> Every weekday at 8am, research mlai.au and tell me what changed.

It works with everything your agent already does. There is nothing to configure
per skill: the scheduler does not do the work, it just decides when the work
starts.

## Install it

```bash
npm run add-skill -- scheduler
```

Then sync the skills and restart, as with any skill:

- macOS: `./sync-skills.command` then `./start.command`
- Windows: `sync-skills-windows.cmd` then `start-windows.cmd`

## Step 1 — create the two tables

In n8n, open **16 - SETUP - Scheduled Work Data** and select *Execute
workflow*. Once, ever.

It creates `scheduled_runs`, one row per thing you have asked for, and
`schedule_results`, one row per time something ran. Both live on your own
computer, or in your own cloud agent's volume. Running it twice changes
nothing.

## Step 2 — publish the clock

Open **79 - TRIGGER - Scheduled work** and set the toggle at the top right to
**Published**.

This is the step people miss, and it fails invisibly: your agent will save a
schedule quite happily, tell you when it will run, and then nothing will ever
happen. If schedules exist and nothing has ever fired, check this first.

It ships switched off on purpose. Nothing in this project starts spending money
on its own until you say so.

## Step 3 — ask for something

Open the chat and say it in ordinary words:

> Every weekday at 8am, research mlai.au and tell me what changed.

> On the first of each month, write the monthly update.

> Every Monday at 9, look for new grants I could apply for.

> Once, tomorrow at 2pm, list my open tasks and tell me what is overdue.

Your agent reads back what it saved: what it will do, which of your five agents
will do it, when it next runs, and anything it had to guess. Correct it there
and then — saying it again with the same name changes that schedule rather than
adding a second one.

## Saying when

Times of day and relative times both work, and your agent knows what today's
date is, so nothing has to be spelled out:

> Every weekday at 8am, research mlai.au and tell me what changed.

> Run a scan of mlai.au in two minutes.

> Tomorrow at 9, list everything overdue.

The one thing it cannot do is anything shorter than a day *repeatedly*. A
one-off two minutes from now is fine; a job every two minutes is not.

## Which agent runs it

All five of your specialists can schedule work, so it does not matter which one
you have open when you ask. Left to itself, a schedule runs as the agent that
saved it.

That is usually right. Where it matters is when the work belongs to somebody
else: tools are attached to one specialist each, so a schedule pointed at the
wrong one will run, every morning, and come back saying it has no such tool.

| The work | The agent |
| --- | --- |
| Tasks, project questions, a summary of your day | Project manager |
| Looking someone up before a call | Sales |
| Websites: research, SEO, article writing | Marketing |
| Grants, funding, monthly updates | Investment |
| Books, invoices, expenses | Bookkeeping |

Your agent picks for you and tells you which it chose. If it guessed wrong, say
so and it will save it again.

## Timezones

Say nothing and times mean **Australia/Melbourne**.

That is a fixed default rather than a reading of whatever clock the agent
happens to be running on, which matters more than it sounds. An agent's own
clock is your timezone on your laptop and UTC in the cloud, so the same
schedule would mean two different times depending on where it was running, and
in the cloud 8am would fire at six in the evening. It does not any more, and
you do not need to set `GENERIC_TIMEZONE` in your hosting dashboard for
schedules to be right.

Somewhere else? Say so once and it is saved with your timezone instead:

> I'm in London. Every weekday at 8am, ...

Your agent always reads back the timezone it used, so you can correct it on the
spot. Daylight saving is handled either way: 8am stays 8am on both sides of the
change.

## What you get back

Nothing arrives in your inbox. A scheduled run has nobody to send anything to,
so the answer is saved and waits for you.

> What have my schedules turned up?

> What did the morning research find this week?

The first lists everything with the opening of its last answer. The second
reads back the full answers from that one job.

If you want a scheduled result to reach your phone, install the Telegram skill
and schedule the work on the Marketing agent — but note that the reply goes
back to whoever wrote in, so it will only reach you if you message the bot.
Delivering an unprompted scheduled result to Telegram is not built yet.

## What it costs

Exactly what asking your agent yourself costs, every time it runs. A daily
research job is a daily bill whether or not you read the results.

Start with one. See what it turns up over a week. Add another when you know the
first earns its keep.

## What it will not do

- **Nothing more often than once a day.** Daily, weekdays, weekly, monthly, or
  once on a date you name. There is no hourly, on purpose.
- **It cannot confirm anything for you.** Creating and updating tasks needs a
  confirmation phrase typed by a person. A scheduled run cannot supply one, so
  those still wait for you. Research, reading and reporting all work.
- **It cannot ask you a question.** A vague instruction comes back empty rather
  than guessed at. Write the instruction the way you would type it: the run
  gets that sentence and nothing else — no conversation, no memory of the chat
  where you set it up.
- **It does not run what it slept through.** Anything more than six hours late
  is skipped and rolled on to its next time, so opening your laptop at dinner
  does not set off the morning's work. You will see it marked as missed.
- **One job per five minutes.** The clock wakes every five minutes and starts
  the one job that has waited longest. Two things set for 8am run at 8am and
  8:05. Nothing runs to the second.
- **Ten schedules.**

## Proving it works

The fastest test is a one-off a few minutes out:

> Run a one-off two minutes from now: list my tasks and summarise them.

Wait for it, then:

> What have my schedules turned up?

## When something goes wrong

**Nothing has ever run.** Nine times out of ten, **79 - TRIGGER - Scheduled
work** is not published. Open it and check the toggle.

**It runs at the wrong hour.** Timezone. Ask your agent what is scheduled — it
reads the next run back in the timezone it saved. Anything saved without a
timezone is Melbourne, so if you are elsewhere, tell it where you are and save
the schedule again.

**It runs and comes back with nothing useful.** Ask for that schedule by name
and read the full answer. Usually the instruction assumed context the run
cannot see, or it was pointed at an agent that does not hold the tool. Both are
fixed by saying it again with the same name.

**It says missed.** The agent was not running when the job was due — a laptop
asleep, or a cloud agent restarting. Nothing is lost; it runs next time.

**The results table is empty but n8n shows executions.** The setup workflow has
not been run, so the tables do not exist. Run **16 - SETUP - Scheduled Work
Data**.

## Where the pieces are

| Workflow | What it is |
| --- | --- |
| `16 - SETUP - Scheduled Work Data` | Creates the two tables. Run once. |
| `76 - TOOL - create_schedule` | Saves one schedule. |
| `77 - TOOL - list_schedules` | Reads schedules and what they turned up. |
| `78 - TOOL - update_schedule` | Pauses, resumes, or deletes one. |
| `79 - TRIGGER - Scheduled work` | The clock. Publish this or nothing runs. |

Nothing here reaches the internet on its own. The trigger calls your own agent
over the loopback address inside your own machine; whatever that agent then
does is governed by the tools it already had.
