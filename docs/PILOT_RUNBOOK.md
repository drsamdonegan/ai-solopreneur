# Non-technical learner pilot runbook

## Purpose

Use this protocol to decide whether the local workshop is ready. The pilot is
not a product demonstration: participants should work from the same repository
and documentation the class will receive.

The current workshop decision is tracked in [the go/no-go checklist](GO_NO_GO.md).
Anonymous session evidence belongs in `pilot/results.json`.

## Recruit the pilot

Recruit at least five people who did not develop or review this repository.
Cover both supported environments:

- At least one current macOS computer.
- At least one Windows 10/11 x64 computer; include Windows 11 ARM when the
  cohort may use it.

Participants may work in teams, but record one session per participant. Use only
anonymous participant and team IDs. Ask participants to disclose a work computer
whose policy may prevent GitHub, nodejs.org downloads, project-local executables,
or Anthropic access so that path can be tested deliberately.

Prepare one extra private Anthropic API key with limited credit for recovery.
Never put it in the repository, observation notes, chat, or screenshots.

## Stage 1: project-local setup preflight

Run this as a short session before the main pilot.

1. Give participants only [Workshop prerequisites](WORKSHOP_PREREQUISITES.md).
2. Ask them to create their template copy and bring it into Claude Code.
3. Ask Claude Code to follow the README and run the one-click setup.
4. Confirm setup selects or prepares the exact reviewed Node.js 24.18.0/npm
   11.16.0 pair.
5. Run `preflight.command` on macOS or `preflight-windows.cmd` on Windows.
6. On Windows, confirm at least 6 GB is free and the project uses a short local
   folder outside OneDrive and network/UNC paths.
7. Record every point where an instructor must touch the computer or give a
   direction not present in the guide.

`preflightCompleted` means the helper passes. An intervention is still recorded
when the participant later completes the step.

## Stage 2: first useful response

Start the timer when the participant begins at README step 1, not after setup.
Do not provide verbal help unless the participant is about to expose a secret,
delete unrelated data, or has been unable to continue for five minutes.

The observer records:

- Start and finish time.
- Time to the first real Claude response.
- Operating system, browser, and browser viewport width.
- Every intervention, its category, minutes used, and what resolved it.
- The last self-service instruction the participant tried.

A successful first response must travel through the custom chat, n8n, and the
real Claude API. The repository's mock tests do not count.

## Stage 3: learner outcomes

Without demonstrating the clicks first, ask each participant or team to:

1. Change the interface name, welcome copy, colour, or prompts.
2. Change one Markdown skill and sync it.
3. Ask the agent to list local tasks.
4. Propose a task change and approve it with the exact confirmation phrase.
5. Stop and start the stack, then confirm all three local services recover.

Record a boolean only after observing the result. A verbal explanation is not a
demonstration.

## Stage 4: cross-team handoff

After teams have customised their projects:

1. Team A pushes its repository changes without local secrets or generated data.
2. Give Team A's repository URL to Team B.
3. Team B follows only that repository's README on a clean clone.
4. The instructor may observe but gives no verbal help.
5. Record the handoff on Team B's session, including Team A's anonymous team ID.

At least one successful handoff is required. If Team B needs undocumented help,
record the intervention, improve the repository, and repeat with a fresh clone.

## Failure-scenario protocol

Use test credentials and disposable local data. Restore the normal configuration
after each scenario.

| Scenario | How to exercise it | Expected learner-facing result |
| --- | --- | --- |
| Invalid Claude credential | Save a deliberately invalid test key in the n8n Anthropic credential and send a message | Chat shows a safe workflow error; n8n execution points the instructor to the Anthropic node; no key appears in the browser |
| Exhausted API credit | Use a test Anthropic workspace with no usable credit | Chat shows a safe workflow error; provider billing details remain in the private n8n execution only |
| Inactive main workflow | Unpublish `00 - START HERE - Project Partner` and send a message | Chat reports that n8n and the active workflow should be checked |
| Occupied ports | Start another local listener on a configured service or task-broker port, then run preflight | Preflight names the occupied port and tells the learner to close the app or change `.env` |
| Native-process restart | Stop and start the stack | Health checks recover and persistent n8n data remains |
| No internet | Disconnect networking after packages are present and send a message, then test a clean setup separately | Existing UI opens locally; Claude calls fail safely; a clean setup clearly names the download it cannot complete |

The automated suite covers the stable error boundary, occupied-port diagnostic,
inactive workflow, native-process recovery, and local health. The two real Anthropic
account states and clean offline setup remain supervised manual checks because a
mock cannot prove provider-account behaviour.

## Complete the evidence

1. Update `pilot/results.json` after every session.
2. Keep `pilotStatus` as `in_progress` until all planned sessions and the handoff
   have been completed.
3. Summarise observed friction in [Pilot findings](PILOT_FINDINGS.md).
4. Rank fixes in [Prioritised usability fixes](USABILITY_FIXES.md).
5. Double-click `evaluate-pilot.command` on macOS or
   `evaluate-pilot-windows.cmd` on Windows. Technical contributors may run
   `./scripts/evaluate-pilot.sh`.

6. Copy the decision and metrics into [the go/no-go checklist](GO_NO_GO.md).

Do not begin Phase 8 while the evaluator returns `NO_GO` or `INVALID`.
