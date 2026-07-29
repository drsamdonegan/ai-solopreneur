# Template Release Checklist

## Outcome

This repository becomes a safe GitHub template only after the complete learner experience is present on the default branch. GitHub generates from the default branch unless a user deliberately includes every branch, so enabling the setting before the stacked phase PRs are merged would produce an incomplete project.

## Merge gate

Merge the stacked pull requests from the bottom upward:

1. Product baseline into `main`.
2. Local Docker foundation.
3. Learner chat interface.
4. Visual n8n agent.
5. Local task tools.
6. Skills and safe confirmation.
7. Beginner packaging.
8. Learner-pilot validation.
9. Local release and course delivery.

Then check out and pull `main`.

Do not squash or merge a later stacked PR directly into `main` before its base. Its diff is intentionally relative to the previous phase.

## Validate the default branch

From the repository root:

```bash
node scripts/validate-template-readiness.mjs

./scripts/test-phase6.sh
./scripts/test-phase7.sh
./scripts/test-phase8.sh
./scripts/evaluate-pilot.sh
```

The readiness check verifies the expected learner entry points, documentation, screenshots, workflow set, executable macOS helpers, Markdown links, ignored secret locations, and absence of Git LFS pointers.

The planned pilot was explicitly waived by the repository owner on 2026-07-27.
The evaluator remains `NO_GO` and must not be changed with invented evidence.
Review [GO_NO_GO.md](GO_NO_GO.md), then run the instructor's fresh-copy check in
[INSTRUCTOR_CHECKLIST.md](INSTRUCTOR_CHECKLIST.md) before enabling the template
setting.

## Enable the repository setting

An administrator can use either route.

### GitHub website

1. Open the repository on GitHub.
2. Select **Settings**.
3. Under **General**, select **Template repository**.
4. Return to the repository page and confirm **Use this template** appears.

### GitHub CLI

```bash
gh api \
  --method PATCH \
  repos/drsamdonegan/ai-solopreneur \
  -F is_template=true
```

Verify without changing anything:

```bash
gh api repos/drsamdonegan/ai-solopreneur --jq '{default_branch,is_template}'
```

Expected:

```json
{"default_branch":"main","is_template":true}
```

GitHub documents that generated repositories use the default branch unless the creator chooses all branches in [Creating a template repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository).

## Prove generation

1. Select **Use this template → Create a new repository**.
2. Create a private disposable repository with **Include all branches** off.
3. Clone it with GitHub Desktop.
4. Confirm the root includes `README.md`, `compose.yaml`, `setup.command`, `setup-windows.cmd`, `diagnose.command`, and `diagnose-windows.cmd`.
5. Follow only its README through first setup.
6. Confirm no inherited open phase branches or Git history are needed.
7. Delete the disposable repository when the check is complete.

## Release metadata

Before teaching:

- Set a concise repository description.
- Add topics such as `n8n`, `claude`, `nodejs`, `ai-agent`, and `beginner-friendly`.
- Record the tested n8n release and release commit.
- Generate and verify the architecture-specific instructor kit in [RELEASE.md](RELEASE.md).
- Create the annotated `v0.2.0` tag only after the release commit's CI is green.
- Keep the repository private until its intended audience and secret-handling process are agreed.
- Never include Git LFS assets; GitHub template repositories do not support them.
