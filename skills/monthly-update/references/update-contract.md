# What a monthly update is, and what it is not

The rules the drafting step works to. Read this when you want to change the shape of the update, or when one comes out reading wrong and you want to know which rule was missed.

## The sections

Every update has the same skeleton. Sections with nothing in them are left out entirely rather than filled with something weak.

| Section | What belongs in it |
| --- | --- |
| **Title and topline** | One short paragraph. What kind of month it was, in a sentence a reader could repeat. |
| **The numbers** | Only metrics with an explicit value from this period. No estimates, no aspirations, no blanks. |
| **What worked** | Wins, launches, customer signal, operating progress. One bullet per distinct thing. |
| **Challenges** | What was hard — each one paired with what is being done about it. |
| **What we learned** | Retrospective insight only. What the month taught, not what happened in it. |
| **Next 30 days** | Upcoming work, priorities, deadlines. Nothing retrospective. |
| **Asks** | Specific things a reader could actually help with. |
| **Worth starting to track** | Suggested metrics for a company with few numbers yet. Never presented as results. |

Learnings and next-30-days are the two that get muddled. A learning looks backwards; a next-30-day looks forwards. "We should ship self-serve import" is not a learning, it is a plan.

## Voice

First person, always. "We shipped", never "the company shipped" and never "Northwind shipped". "I" only where a founder would naturally say it — usually an ask.

Warm but crisp. A short email to people who already know you, not a market report and not a press release.

Each bullet is a complete natural sentence that reads well on its own and flows when read with the others. Several short bullets beat one long paragraph.

If the user's profile has `voiceNotes`, that is how they actually write, and it wins over any of the above.

## The four things it must never write

These are the failure modes worth naming, because each one is a plausible-looking sentence that makes the update worse.

**1. Never attribute a fact to where it came from.** Not "an email from Northwind shows", not "the data indicates", not "according to the thread", not "as of the latest sync". The reader does not care how you know. Just say what happened.

**2. Never write about missing data.** Not "the evidence does not include revenue figures", not "no metrics were available this month", not "this is a partial view". If something was not measured, leave it out. A bullet whose only content is the absence of content is the single most common way these updates go wrong.

**3. Never invent a number.** A figure in the update has to appear in an email. Not derived from two other figures, not rounded from a range, not a plausible total. The verification pass checks exactly this, and it is the reason to trust the rest.

**4. Never write a challenge with no response.** A challenge that says only what went wrong is a complaint. Every one says what is being done about it, even if that is "we have not decided yet".

## Audience

Three settings, saved on the profile or passed per run. They change emphasis and what is safe to include — never the honesty.

**`investor`** — crisp and specific about numbers, risks, and asks. Financial detail is expected. Nothing is softened.

**`team`** — the default. Candid and human. Internal detail is welcome; personal or HR-sensitive material is not.

**`community`** — public. Plain and warm. Never runway, sensitive revenue, investor negotiations, confidential customers, or private partner terms. The curation step excludes those before the draft is written, and the verification step checks that none leaked through.

## Where the sections come from

The pipeline decides in three passes, and it is worth knowing which one to blame when something is wrong.

1. **Extraction** turns each email thread into facts, each bound to its message IDs. If a fact is simply absent, it was never extracted — the thread may not have survived the filter.
2. **Curation** decides which facts earn a place and which section they belong in. If something true but boring made it in, this is where.
3. **Drafting** writes the prose from the approved facts only. If the wording is wrong but the facts are right, this is where.

Then **verification** reads the draft back against the facts and flags anything that overreaches. It does not rewrite; it only reports.
