# Local release and instructor kit

## Release identity

- Product version: `0.2.0`
- Intended tag: `v0.2.0`
- Release type: local-first workshop release
- Release date: 2026-07-29
- Public/cloud deployment: not included

The root `VERSION` file is authoritative. `CHANGELOG.md` records learner-visible
changes.

## Reproducibility lock

The reviewed runtime pair is pinned in `.node-version` and `.npm-version`. The
root `package.json` and `package-lock.json` pin the exact n8n release.
JavaScript dependencies are locked by:

- `package-lock.json`
- `apps/chat/package-lock.json`
- `services/document-worker/package-lock.json`
- `tests/phase7/package-lock.json`

The setup helper verifies the private Node.js runtime download with the official
SHA-256 checksum and verifies its bundled npm version before using it. Release
validation confirms the version files, lockfiles, native launchers, workflows,
documentation, and instructor-kit metadata agree.

## Owner release decision

The planned non-technical pilot was not run. On 2026-07-27, the repository owner
reviewed the local experience, accepted its current state, and explicitly
authorised Phase 8. `pilot/results.json` remains truthful and the automated
evaluator remains `NO_GO`; the owner waiver is recorded in
[GO_NO_GO.md](GO_NO_GO.md).

## Build the instructor kit

The kit contains:

- a source archive from the exact release commit;
- the eleven canonical workflow exports;
- pinned Node.js, npm, and n8n version metadata;
- native setup instructions;
- SHA-256 checksums for every included file.

### macOS

Double-click `prepare-instructor-pack.command`.

### Windows

Double-click `prepare-instructor-pack-windows.cmd`.

The full helper refuses to run from a dirty Git worktree so the source archive
and recorded commit cannot disagree. Output is written below
`instructor-pack/v0.2.0-source/`.

Do not put `.env`, local `data/`, backups, API keys, or credentials in the kit.

## Use the kit at a venue with weak internet

Before the workshop:

1. Copy the source kit to the instructor machine.
2. Verify it with `SHA256SUMS`.
3. Extract the source archive.
4. Run the setup helper once on each workshop machine while connectivity is
   available so its verified runtime and locked npm packages are cached.
5. Give learners the prepared source folder or the GitHub template.

Real Claude calls still require internet access and each learner's private
Anthropic API key.

## Create and verify the tag

Tag only the commit whose complete CI run is green:

```bash
git tag -a v0.2.0 -m "AI Solopreneur local release v0.2.0"
git push origin v0.2.0
```

Reproduce the release later:

```bash
git clone --branch v0.2.0 --depth 1 \
  https://github.com/drsamdonegan/ai-solopreneur.git
cd ai-solopreneur
node scripts/local.mjs setup
```

Then follow [Getting started](GETTING_STARTED.md) from the cloned tag.

## Release verification

Run:

```bash
node scripts/validate-release.mjs
./scripts/test-phase5.sh
./scripts/test-phase6.sh
./scripts/test-phase7.sh
./scripts/test-phase8.sh
```

CI repeats the native learner-path smoke on Linux, macOS, Windows x64, and
Windows 11 ARM. The Windows jobs exercise the root `.cmd` launchers under
Windows PowerShell 5.1 and prove fallback from an incompatible system Node.
Separate jobs run the native agent, resilience, and browser checks. A release is
not valid if the tag, `VERSION`, version pins, documentation, workflows, or
checksums disagree.
