# Prioritised usability fixes

## Prioritisation rule

- **P0:** risks secrets/data or prevents most participants from completing.
- **P1:** blocks a participant or requires instructor intervention.
- **P2:** causes repeated hesitation or avoidable delay.
- **P3:** polish with no meaningful effect on completion.

Fix P0 items before another session. Fix or explicitly mitigate P1 items before
a go decision. Combine evidence only when the cause and proposed fix are the
same.

## Pre-pilot engineering fixes

| Priority | Friction found during implementation | Change | Verification | Status |
| --- | --- | --- | --- | --- |
| P1 | A new n8n instance previously required manual workflow import | One-click setup now imports reviewed workflows, sample data, and enabled skills | Phase 6 clean-copy smoke | Fixed |
| P1 | Learners could not tell whether the credential and workflows were ready | Added learner checklist plus non-secret diagnostics | Phase 6 diagnostics smoke | Fixed |
| P1 | Provider and connection errors could expose technical output or be meaningless | Gateway normalises errors and suppresses upstream bodies; explicit credential, credit, and network contracts were added | Gateway contract tests | Fixed |
| P1 | Port collisions appeared only after startup failed | Preflight names each occupied port and remediation | Phase 7 occupied-port smoke | Fixed |
| P1 | n8n could report healthy briefly before newly published webhooks were registered | macOS and Windows import helpers retry only the idempotent setup and skill-sync calls; smoke tests wait on a published endpoint after restart | Native CI smoke | Fixed |
| P2 | Pilot readiness could be declared from incomplete or invented notes | Added anonymous structured evidence and a fail-closed evaluator | Phase 7 evaluator tests | Fixed |

## Human-pilot fixes

No human-pilot issue is recorded yet. Add rows only after a real observation.

| Priority | Evidence | Root cause | Smallest fix | Owner | Retest | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Pending | Pilot not run | Unknown | Run the five-person pilot | Instructor | Fresh participant | Open |

## Change discipline

After each fix:

1. Link it to anonymous pilot IDs.
2. Add or update an automated test when the behaviour is deterministic.
3. Retest the affected instruction with a person who did not author the fix.
4. Update `pilot/results.json`; never rewrite a failed observation as though it
   did not occur.
