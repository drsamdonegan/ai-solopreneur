# Scheduler

Ask your agent to do something at a time instead of right now.

> Every weekday at 8am, research mlai.au and tell me what changed.

> On the first of each month, write the monthly update.

> Every Monday at 9, look for new grants I could apply for.

It works with any skill your agent already has. The scheduler does not do the
work itself — it saves what you asked for, and at the right time it sends that
sentence to the agent that owns the skill, exactly as though you had typed it
into the chat yourself.

## Setting it up

**1. Create the tables.** In n8n, open **16 - SETUP - Scheduled Work Data** and
select *Execute workflow*. Once, ever.

**2. Publish the clock.** Open **79 - TRIGGER - Scheduled work** and set the
toggle at the top right to **Published**.

Step 2 is the one everybody misses. Without it your agent will save a schedule,
tell you when it will run, and then nothing will ever happen. If you find
yourself wondering why nothing fired, check this first.

Then open the chat and just say it.

## Which agent runs it

Your agent is really five specialists, and each one holds different tools. A
schedule has to name the one that can actually do the job — the same one you
would pick in the chat.

| What you asked for | Who runs it |
| --- | --- |
| Tasks, project questions, a summary of your day | Project manager |
| Looking someone up before a call | Sales |
| Websites: research, SEO, writing | Marketing |
| Grants, funding, monthly updates | Investment |
| Books, invoices, expenses | Bookkeeping |

You do not have to work this out yourself — say what you want and your agent
picks. It reads the choice back to you, so you can correct it if it guessed
wrong.

## Timezones

If you say nothing, times mean **Melbourne** time. That is a fixed default, not
your computer's clock, so a schedule means the same thing whether your agent is
running on your laptop or in the cloud — and 8am stays 8am on both sides of
daylight saving.

Somewhere else? Say so once — "I'm in London" — and it is saved with your
timezone instead. Your agent always reads back the timezone it used, so you can
correct it on the spot.

## What you get back

Nothing arrives in your inbox. A scheduled run has nobody to send anything to,
so the answer is saved and waits for you.

> What have my schedules turned up?

> What did the morning research find this week?

Your agent reads them back.

## What it will not do

- **It never runs more often than once a day.** Daily, weekdays, weekly,
  monthly, or once on a date you name. There is no hourly, on purpose.
- **It cannot confirm anything on your behalf.** Creating and changing tasks
  needs a confirmation phrase from you, and a schedule cannot give one. Those
  still wait for you.
- **It cannot ask you a question.** If the instruction is vague, the run comes
  back empty rather than guessing.
- **It does not run things it slept through.** A job more than six hours late —
  your laptop was shut, the cloud agent was restarting — is skipped and rolled
  on to its next time, so opening your laptop at dinner does not set off the
  morning's work. You will see it marked as missed.
- **Ten schedules, maximum.**

## What it costs

Exactly what asking your agent yourself costs. A daily research job is a daily
bill, and it keeps arriving whether or not you read the results. Start with one,
see what it turns up, and add more when you know they earn their keep.

## Proving it works

The fastest test is a one-off a few minutes from now:

> Run a one-off five minutes from now: list my tasks and summarise them.

Wait, then ask:

> What have my schedules turned up?

The clock wakes every five minutes, so anything you set fires within five
minutes of its time — not to the second.

## If nothing happens

1. Is **79 - TRIGGER - Scheduled work** published? This is the answer nine
   times out of ten.
2. Ask your agent what is scheduled. It will tell you when each one next runs.
   If a time looks wrong by several hours, it is the timezone.
3. Ask for the results of one by name. A run that failed says why.
