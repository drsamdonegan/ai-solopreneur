# Instructor Checklist

## Outcome

Use this list to prepare and run a workshop in which non-technical teams reach a real Claude response, inspect a factual read, approve one safe write, and save one customisation.

## One week before

- [x] Confirm the repository owner's documented pilot waiver in the [workshop decision](GO_NO_GO.md). Do not present it as completed pilot evidence.
- [ ] If your organisation requires its own learner pilot, complete the [pilot runbook](PILOT_RUNBOOK.md) and receive `GO` before delivery.
- [ ] Merge the release phase branches in order and complete [TEMPLATE_RELEASE.md](TEMPLATE_RELEASE.md).
- [ ] Generate a disposable repository from the template with **Include all branches** off.
- [ ] Follow only that generated repository's README on one supported Mac and one Windows computer.
- [ ] Confirm a clean project downloads and uses its verified private Node.js 24 runtime without admin access.
- [ ] Run `setup.command` and `setup-windows.cmd` on a computer without existing project data.
- [ ] Confirm all eleven workflows appear and the four Data Tables are created.
- [ ] Run diagnostics before configuration and confirm its `[next]` actions are accurate.
- [ ] Add a disposable Anthropic credential, publish workflows `00` and `90`, and confirm diagnostics become all green.
- [ ] Test a planning reply, factual task read, rejected plain `yes`, and accepted exact confirmation.
- [ ] Create, inspect, restore, and securely remove a disposable backup.
- [ ] Confirm reset requires the exact `RESET` word.
- [ ] Test the current screenshots and every learner-facing link.
- [ ] Record any managed-network, VPN, proxy, or npm-registry policy constraints.
- [ ] Generate and test the versioned instructor kit using [RELEASE.md](RELEASE.md).

## Learner preflight

For each learner or team, record:

| Check | Ready when |
| --- | --- |
| GitHub | Signed in and allowed to create a repository |
| GitHub Desktop | Signed in and able to clone |
| Project runtime | One-click setup prepares Node.js 24.18.0 inside `.runtime/` when needed |
| Local ports | 3000 and 5678 are available, or `.env` alternatives are agreed |
| Browser | Current Chrome or Edge |
| Anthropic Console | API key exists and the workspace has a small credit balance |
| Network | GitHub, registry.npmjs.org, and Anthropic API are reachable |
| Security | Learner knows the key goes only into the n8n credential |

Resolve account access and any managed-device restriction on project-local executables before the main session.

## Workshop kit

- [ ] Released template repository and a ZIP archive fallback.
- [ ] Current repository commit ID recorded.
- [ ] Downloaded copies of pinned container images if venue connectivity is uncertain.
- [ ] One spare supported Mac and one spare Windows computer where practical.
- [ ] Private process for assisting with keys without seeing or copying them.
- [ ] Projector-safe demo credential that can be revoked immediately.
- [ ] The [troubleshooting table](TROUBLESHOOTING.md) open in a separate tab.
- [ ] A timer and a simple intervention log.
- [ ] The [eight-exercise course guide](COURSE_GUIDE.md) and released learner guide available offline.

## Suggested 90-minute run

| Time | Outcome |
| --- | --- |
| 0–10 min | Create from template and clone with GitHub Desktop |
| 10–25 min | Run one-click setup and create the local n8n owner |
| 25–40 min | Walk through the visual learner checklist |
| 40–50 min | Add the private Claude credential and publish workflows `00` and `90` |
| 50–60 min | Run diagnostics until every check is green |
| 60–70 min | Demonstrate planning, factual task reading, rejected `yes`, and exact confirmation |
| 70–82 min | Customise the chat and one Markdown skill |
| 82–90 min | Commit and push in GitHub Desktop; create a local backup |

## Demonstration safety

- Never ask a learner to paste a key into chat, email, Slack, an issue, a workflow note, or the projector.
- Turn off screen sharing while a learner creates or pastes the credential.
- Do not open decrypted credential exports.
- Use only the supplied local URLs.
- Explain that this release is not a production or public deployment.
- Treat `backups/` as secret material because it contains encrypted credentials and the matching encryption key.
- Revoke the instructor demo key after the session.

## Team completion gate

Every team should demonstrate:

- [ ] `diagnose.command` or `diagnose-windows.cmd` reports all green.
- [ ] The browser chat receives one real Claude response.
- [ ] `list_tasks` returns only rows visible in the local `tasks` table.
- [ ] Plain `yes` does not approve a write.
- [ ] One exact confirmation creates or updates exactly one task.
- [ ] The learner can point to the relevant nodes in workflow `00`.
- [ ] The learner changes the chat presentation.
- [ ] The learner changes and syncs one Markdown skill.
- [ ] GitHub Desktop shows a pushed customisation commit.
- [ ] The team knows how to start, stop, diagnose, and back up the local project.

## Intervention log

Record anonymous sessions in `pilot/results.json` using the fields and privacy
rules in the [pilot runbook](PILOT_RUNBOOK.md). A compact working view is:

| Anonymous team | OS | Time to first response | Intervention | Root cause | Follow-up |
| --- | --- | --- | --- | --- | --- |
| T01 | Windows 11 | 24 min | Runtime download blocked | Managed-device policy | Prepare a paired fallback |

Do not record API keys, passwords, full logs, or sensitive task content.

## End of session

- [ ] Confirm no API keys were committed.
- [ ] Ask teams to stop the local stack.
- [ ] Confirm customisations were pushed and local data was backed up when needed.
- [ ] Revoke temporary instructor credentials.
- [ ] Collect intervention logs and prioritise recurring friction for the learner-testing phase.
