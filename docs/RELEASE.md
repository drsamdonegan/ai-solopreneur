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

The learner path is locked by npm: the root `package.json` and
`package-lock.json` pin the exact n8n release, and learners install it with
`npm ci` during setup.

The Docker-based smoke tests and the future cloud deployment additionally use
versioned image tags plus multi-platform manifest digests:

| Purpose | Image |
| --- | --- |
| n8n runtime | `docker.n8n.io/n8nio/n8n:2.30.5@sha256:450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f` |
| Chat build/runtime and helpers | `node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a` |
| Document-reader runtime | `node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a` |
| Browser validation | `mcr.microsoft.com/playwright:v1.61.0-noble@sha256:57b65fdc9ceabe0ef613124c7bbe2babcf9362c4d85e382fe3b03604e84b428a` |

JavaScript dependencies are locked by `apps/chat/package-lock.json`,
`services/document-worker/package-lock.json`, and
`tests/phase7/package-lock.json`. The npm pin and the n8n image digest must
reference the same n8n version; release validation enforces this. The local
images are named `ai-solopreneur-chat:0.2.0` and
`ai-solopreneur-document-worker:0.1.0`.

## Owner release decision

The planned non-technical pilot was not run. On 2026-07-27, the repository owner
reviewed the local experience, accepted its current state, and explicitly
authorised Phase 8. `pilot/results.json` remains truthful and the automated
evaluator remains `NO_GO`; the owner waiver is recorded in
[GO_NO_GO.md](GO_NO_GO.md).

## Build the instructor kit

The kit packages the optional Docker path (images, workflows, source archive)
for venues where registries are blocked. Learners on the standard Node.js path
do not need it — asking them to run `setup.command` or `setup-windows.cmd` at
home downloads everything in advance instead.

The kit is generated locally and is ignored by Git because its Docker archive
is large and architecture-specific. Building it requires Docker Desktop on the
instructor's machine.

### macOS

Double-click `prepare-instructor-pack.command`.

### Windows

Double-click `prepare-instructor-pack-windows.cmd`.

The helper:

1. validates the release metadata and workflows;
2. pulls the locked images;
3. builds the versioned chat and document-reader images;
4. saves the runtime images for the current computer architecture;
5. copies the canonical workflow exports;
6. creates a source archive from the current Git commit;
7. writes checksums and offline-loading instructions.

The output is below `instructor-pack/v0.2.0-PLATFORM-ARCHITECTURE/`.

Do not put `.env`, n8n volume data, local backups, API keys, or credentials in
the kit. The helper refuses to run from a dirty Git worktree so the source
archive and recorded commit cannot disagree.

## Use the kit at a venue with weak internet

Prepare separate packs on the same architecture learners will use. An Apple
Silicon image archive does not replace an x86_64 Windows archive.

Before the workshop:

1. Copy the appropriate pack to the instructor machine.
2. Follow `LOAD_IMAGES.md` inside the pack.
3. Confirm `docker image ls` includes the n8n, chat, and document-reader images.
4. Give learners the source ZIP or the GitHub template.
5. Internet is still required for real Claude calls.

The image archive helps when Docker registries are slow or blocked. It does not
make Anthropic API calls work offline.

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
./scripts/test-phase8.sh
```

CI additionally repeats the Phase 3–5 and 7 Docker integration tests and the
Phase 6 native learner-path smoke on Linux and Windows. A release is not valid
if the tag, `VERSION`, version pins, documentation, or checksums disagree.
