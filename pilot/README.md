# Pilot evidence

This folder is the source of truth for the Phase 7 learner pilot.

`results.json` starts with `pilotStatus: "not_run"` and no sessions. Do not add
invented participants or copy the synthetic fixtures from `tests/phase7`.

## Record a session

1. Copy the object in `session-template.json`.
2. Add it to the `sessions` array in `results.json`.
3. Replace the anonymous IDs and observations during or immediately after the
   session.
4. Set the top-level status to `in_progress` once the first session starts.
5. Update `updatedAt` with an ISO date-time.
6. After all planned sessions and the cross-team handoff, set the status to
   `complete`.

Use anonymous IDs such as `P01` and `T01`. Do not record names, email addresses,
phone numbers, API keys, passwords, repository tokens, or screenshots containing
credentials.

Use `macos` or `windows` for `operatingSystem`. Record a blocked or interrupted
project-local Node.js download with the `runtime-download` intervention category.

Validate the file without deciding that the workshop is ready (technical
contributors):

```bash
./scripts/evaluate-pilot.sh --allow-pending
```

Make the actual go/no-go decision:

- macOS: double-click `evaluate-pilot.command`.
- Windows: double-click `evaluate-pilot-windows.cmd`.
- Terminal: run `./scripts/evaluate-pilot.sh`.

The evaluator exits successfully only when the real evidence passes every
criterion. See [the pilot runbook](../docs/PILOT_RUNBOOK.md) for the complete
session protocol.
