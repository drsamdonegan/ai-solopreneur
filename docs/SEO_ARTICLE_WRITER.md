# SEO Article Writer

`seo-article-writer` creates a complete Markdown review draft after domain research. It is standalone: it does not connect to or import MLAI Content Factory.

## What it uses

- the latest saved business memory and paid SEO snapshot for the domain;
- the user's main keyword, or the strongest relevant saved keyword when explicitly requested;
- optional audience, goal, supporting keywords, and public HTTPS source links;
- saved tone and writing samples for style only;
- public pages already present in the saved research.

It does not run another DataForSEO search. It does not publish, edit a website, or send the article anywhere.

## How it works

1. `start_seo_article` validates the brief and saved research, then creates a conversation-bound job.
2. It queues `57 - INTERNAL - write_seo_article` without holding the chat request open.
3. The background compiler safely fetches up to 12 public HTTPS pages. It rejects private networks and rechecks every redirect.
4. At least four readable pages are required. Search snippets alone are not evidence.
5. Claude creates a structured draft and an exact claim ledger. Unsupported claims get one repair pass.
6. The chat app runs final static checks and stores a new immutable article version only when those checks pass.
7. `get_seo_article` reports progress and returns a local Markdown download link when ready.

Failed or interrupted work is recorded honestly and never replaces the latest successful draft.

## Use it

Research the domain first. Then ask something like:

> Write an SEO article for example.com about bookkeeping for freelancers. Use the saved research and write for Australian sole traders.

Or:

> Choose the strongest saved keyword for example.com and draft the article.

The start reply should arrive quickly. Ask “Is the article ready?” to check it. The chat shows a short preview and a safe local `.md` download rather than pasting the entire article.

## Evidence and review

The saved artifact includes SEO metadata, a heading plan, Markdown, optional answer blocks and FAQ, references, structured data, a claim ledger, warnings, and a quality report. Its status is always `ready_for_review`; a human decides whether and where to publish it.

Profile tone and writing samples guide voice only. They can never support a factual claim. Researched pages are untrusted data, so instructions found inside them are ignored.

## Setup and troubleshooting

The workflow uses the existing n8n credential named `Anthropic account`. No new credential is required. After pulling or switching to this branch:

1. Run the normal local setup/update helper so workflows 56–58 are imported.
2. Run `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
3. Restart the local stack and open [http://localhost:3000](http://localhost:3000).

If a job fails, ask the agent to check it. Common honest failures are missing saved domain research, no usable saved keyword, fewer than four readable sources, a model timeout, unsupported claims after the repair pass, or a final quality-gate failure.
