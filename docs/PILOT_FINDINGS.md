# Phase 7 pilot findings

## Evidence status

Human learner pilot: **not run**.

The canonical record is `pilot/results.json`. It contains zero participants and
is intentionally evaluated as `NO_GO`. No human usability result is claimed in
this document until real anonymous sessions are recorded.

## Automated engineering findings

These checks reduce pilot risk but do not replace the pilot.

GitHub Actions run `30198827506` passed on 2026-07-26 for evidence commit
`adff923`.

| Area | Evidence | Current result |
| --- | --- | --- |
| Chat contract | Gateway unit tests cover valid requests, malformed input, timeouts, inactive webhooks, invalid credentials, exhausted credit, provider network failure, rate limiting, malformed provider output, and secret suppression | Passing locally and in CI on 2026-07-26 |
| Service health | Phase 7 smoke starts the isolated native stack, checks both health endpoints, restarts services, and checks recovery | Passing locally and in CI on 2026-07-26 |
| Occupied ports | Phase 7 smoke runs preflight from a second project while both configured ports are held by the test stack | Passing locally and in CI on 2026-07-26 |
| Pilot evidence | Unit tests prove a complete passing fixture returns `GO`, incomplete evidence returns `NO_GO`, and personal-data fields are rejected | Passing locally and in CI on 2026-07-26 |
| Browser widths | Pinned Chromium checks at 375, 768, and 1440 pixels | Passing locally and in CI on 2026-07-26 |
| Windows helpers | PowerShell files are parsed on a Windows GitHub Actions runner | Passing in CI on 2026-07-26 |
| macOS and Windows learners | Real setup, Claude account state, project-local runtime download, and instruction clarity | Pending human pilot |

The automated suite proves safe error contracts for simulated invalid-key,
exhausted-credit, and provider-network failures. It also exercises an inactive
workflow, occupied ports, native service restart, and loss of the local n8n service.
The supervised checks using real Anthropic account states and a fully offline
machine remain pending; an HTTP fixture is not evidence that those external
conditions behaved correctly.

## Browser-width verification

Date: 2026-07-26.

| Viewport | Horizontal overflow | Composer and send control visible | Keyboard focus check | Result |
| --- | --- | --- | --- | --- |
| 375 × 667 | None | Yes | Shift+Enter retained focus and inserted a newline | Pass |
| 768 × 1024 | None | Yes | Shift+Enter retained focus and inserted a newline | Pass |
| 1440 × 900 | None | Yes | Shift+Enter retained focus and inserted a newline | Pass |

This is an automated Chromium result from `scripts/test-phase7.sh`. It does not
claim Safari, Edge, assistive-technology, macOS learner, or Windows learner
coverage; those remain human-pilot evidence.

## Human session summary

Populate this section only from `pilot/results.json`.

- Participants: 0 / 5 minimum.
- First Claude response within 30 minutes: 0%.
- macOS coverage: pending.
- Windows coverage: pending.
- Instructor interventions: none recorded because the pilot has not run.
- Teams completing interface and skill customisation: 0.
- Teams demonstrating a read and confirmed write: 0.
- Cross-team handoff without verbal help: pending.

## Observations to capture

For each recurring problem, record the anonymous pilot IDs, the exact
instruction or screen involved, what the learner expected, what happened, and
the smallest proposed change. Do not collapse different causes into a single
"setup issue".
