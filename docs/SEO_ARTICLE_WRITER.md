# SEO Article Writer

`seo-article-writer` creates a complete Markdown review draft. It works on its own or immediately after either domain-research skill. It does not connect to MLAI Content Factory.

## The simple user journey

1. The user asks to research a website. Paid DataForSEO research runs first; the website-only research is the automatic fallback.
2. The chat shows up to three useful article ideas as large buttons.
3. The user chooses an idea, asks the agent to choose, or types another topic.
4. If an essential business detail is missing, the agent asks one short question containing every missing detail.
5. Writing runs in the background. A progress card updates automatically and becomes a local Markdown download when the draft is ready.

The user does not need to know about skills, keywords, snapshots, job IDs, workflow names, or DataForSEO settings.

## What is required

Every article needs:

- a website;
- one selected idea or user-supplied topic;
- **Who** the business helps;
- the **Offer** it sells that audience.

The chat fills Who and Offer from saved user facts first, then suggests what the official website says. Choosing an article accepts the displayed suggestions for that article only; it does not silently change My Business.

Two fields are required only when they matter:

- **Price** for pricing, cost, fee, package, rate, quote, or buying articles. “Do not mention price” is valid.
- **Boundaries** for comparisons, promises, sensitive advice, or regulated topics. “No special limits” is valid.

Voice is optional. The default is simple, clear, friendly, conversational, and jargon-free. Saved writing samples can guide style but never support factual claims.

## Running it without prior research

A direct request such as “Write an SEO article for example.com about bookkeeping for freelancers” still works. The agent runs normal paid domain research first, uses the free website-only fallback if needed, and then prepares the article. It never asks the user about ownership, payment, API keys, job IDs, or technical setup.

The article workflow itself makes no DataForSEO purchase. It uses the exact saved research and business context pinned to the article brief.

## Safety and quality

- The draft is saved for review and is never published automatically.
- The compiler safely fetches public HTTPS sources and rechecks every redirect.
- At least four readable pages are required. Search snippets alone are not evidence.
- Factual claims need supporting sources. Unsupported claims receive one repair pass.
- Final deterministic checks run before a new immutable article version is saved.
- A failed or interrupted run is reported honestly and never replaces an earlier successful draft.

The finished Markdown contains the article, SEO metadata, sources, a claim ledger, warnings, and its quality report. Its status is always `ready_for_review`.

## Setup

The workflow uses the existing n8n credential named `Anthropic account`. After switching to this branch:

1. Run the normal local setup/update helper so workflows 56–58 are imported.
2. Run `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
3. Restart the local stack and open [http://localhost:3000](http://localhost:3000).

Common honest failures are no usable research, missing required business details, fewer than four readable sources, a model timeout, unsupported claims after repair, or a final quality-check failure.
