# Article contract

The stored result is one immutable version with `ready_for_review` status. It contains:

- Markdown with one H1 and a useful H2/H3 structure;
- SEO title, meta description, slug, and optional canonical suggestion;
- primary and supporting keyword map;
- up to three short answer blocks only when the sources support real questions;
- a visible FAQ only when every answer is supported;
- references to fetched public pages;
- Article JSON-LD and FAQPage JSON-LD only when the visible FAQ exists;
- a claim ledger and deterministic quality report;
- warnings and an honest `completed` or `partial` result.

## Evidence minimum

Aim for 8–12 useful public pages. Require at least four readable sources, preferably across three domains. Search-result snippets can help select pages but are not proof. A source must be fetched safely before it can support a claim.

Every checkable claim records its exact sentence, source IDs, short supporting excerpts, and one of `entailed`, `partial`, or `unsupported`. Unsupported claims must be removed or carefully qualified. Re-check the final assembled article, including metadata, answer blocks, FAQ, CTA, and structured data. Allow one bounded repair pass; fail honestly if material unsupported claims remain.

## Quality gates

Reject or repair drafts with missing metadata or heading structure, unsupported facts, fake statistics or quotes, keyword stuffing, repeated openings, excessive bullets, formulaic filler, mismatched FAQ structured data, or links that were not verified. A quality failure must not replace the latest successful draft.
