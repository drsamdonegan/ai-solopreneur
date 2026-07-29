# Move a Visual n8n Change Back into Git

## Outcome

A technical contributor can edit one workflow on the n8n canvas, export a reviewable copy, promote only the intended change into `n8n/workflows/`, validate it, and commit it without including local ownership metadata or an instance-specific credential reference.

Learners do not need this process to customise the chat or Markdown skills.

## Before editing

1. Create a private local backup.
2. Start from a clean Git branch.
3. Identify one canonical workflow file and its fixed workflow ID.
4. Open that workflow in n8n.
5. Make the smallest visual change.
6. Execute the affected path with non-secret test input.

Do not edit the ignored `n8n/exports/` folder and assume it changes the template. It is a review area only.

## Export all reviewed workflows

### macOS or Linux

```bash
./scripts/export-workflows.sh
```

### Windows PowerShell

```powershell
.\scripts\windows\export-workflows.ps1
```

The helper writes a timestamped directory below `n8n/exports/`. It then:

- Unwraps n8n's one-item export arrays.
- Removes timestamps, local project ownership, sharing records, counters, and runtime state.
- Forces committed workflows to remain inactive.
- Restores the reviewed canonical credential references.
- Keeps the visually edited nodes, connections, settings, and new workflow version ID.

If a new node introduces a credential boundary that the canonical workflow does not already contain, normalisation stops for manual security review.

## Review one diff

Replace `TIMESTAMP` and the filename:

```bash
git diff --no-index \
  n8n/workflows/00-start-here-project-partner.json \
  n8n/exports/TIMESTAMP/00-start-here-project-partner.json
```

`git diff --no-index` returns a non-zero status when it finds an ordinary difference. Read the diff; the status alone does not mean the export failed.

Check:

- Only the intended nodes, positions, sticky notes, or connections changed.
- The workflow ID did not change.
- `active` remains `false`.
- Credential references contain only the reviewed `id` and `name`.
- No API key, task content, user email, local project ID, or execution data appears.
- Safety limits and confirmation boundaries remain intact.

Do not promote every exported file merely because the helper created it.

## Promote the reviewed file

After reviewing one file:

```bash
cp \
  n8n/exports/TIMESTAMP/00-start-here-project-partner.json \
  n8n/workflows/00-start-here-project-partner.json
```

Then validate:

```bash
node scripts/validate-workflows.mjs
```

Run the smoke test for the phase the workflow affects. For current confirmation or skill paths:

```bash
./scripts/test-phase5.sh
```

For onboarding, import, diagnostics, or checklist changes:

```bash
./scripts/test-phase6.sh
```

## Save the change

1. Open GitHub Desktop.
2. Review the canonical workflow diff again.
3. Confirm `n8n/exports/`, `.env`, and `backups/` are not listed.
4. Commit the single intended outcome.
5. Push the branch and open a pull request.
6. Include the exact smoke tests and n8n version in the pull-request description.

If the diff is wrong, discard the canonical file change in GitHub Desktop. The ignored export copy remains available for another review.
