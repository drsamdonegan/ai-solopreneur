#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' <"${PROJECT_ROOT}/VERSION")"
NODE_VERSION="$(tr -d '[:space:]' <"${PROJECT_ROOT}/.node-version")"
N8N_VERSION="$(node -p "require('${PROJECT_ROOT}/package.json').dependencies.n8n")"
OUTPUT_ROOT="${PROJECT_ROOT}/instructor-pack"
METADATA_ONLY=false

usage() {
  printf 'Usage: ./scripts/prepare-instructor-pack.sh [--output DIRECTORY] [--metadata-only]\n'
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output)
      [[ "$#" -ge 2 ]] || {
        usage >&2
        exit 2
      }
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --metadata-only)
      METADATA_ONLY=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "${METADATA_ONLY}" == "true" ]]; then
  PACK_KIND="metadata-test"
  COMMIT="uncommitted-validation"
else
  if [[ -n "$(git -C "${PROJECT_ROOT}" status --porcelain)" ]]; then
    printf 'The Git worktree has uncommitted changes.\n' >&2
    printf 'Commit or discard them before creating a release kit so its source and commit agree.\n' >&2
    exit 1
  fi
  PACK_KIND="source"
  COMMIT="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
fi

PACK_DIR="${OUTPUT_ROOT}/v${VERSION}-${PACK_KIND}"
if [[ -e "${PACK_DIR}" ]]; then
  printf 'Instructor pack already exists:\n  %s\n' "${PACK_DIR}" >&2
  printf 'Move or remove that specific folder before creating it again.\n' >&2
  exit 1
fi

mkdir -p "${PACK_DIR}/workflows"
node "${PROJECT_ROOT}/scripts/validate-release.mjs"
node "${PROJECT_ROOT}/scripts/validate-workflows.mjs"
cp "${PROJECT_ROOT}"/n8n/workflows/*.json "${PACK_DIR}/workflows/"

{
  printf 'AI Solopreneur instructor kit\n'
  printf 'Version: %s\n' "${VERSION}"
  printf 'Commit: %s\n' "${COMMIT}"
  printf 'Node.js runtime: %s\n' "${NODE_VERSION}"
  printf 'n8n package: %s\n' "${N8N_VERSION}"
  printf 'Generated UTC: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >"${PACK_DIR}/RELEASE-METADATA.txt"

cat >"${PACK_DIR}/START_HERE.md" <<EOF
# Start the workshop project

This kit contains AI Solopreneur **v${VERSION}**, the reviewed workflow exports,
and checksums for every included file.

For a full release kit:

1. Extract \`ai-solopreneur-v${VERSION}-source.tar.gz\`.
2. Open the extracted folder in Claude Code.
3. Ask Claude Code to run the setup helper for this project.
4. Open the local chat URL printed by setup.

The setup helper uses an existing Node.js 24+ runtime when available. Otherwise
it downloads a checksum-verified private runtime into the project. The first
setup requires internet access for the runtime/packages and real Claude messages
require each learner's private Anthropic API key.
EOF

if [[ "${METADATA_ONLY}" == "false" ]]; then
  git -C "${PROJECT_ROOT}" archive \
    --format=tar.gz \
    --prefix="ai-solopreneur-v${VERSION}/" \
    --output="${PACK_DIR}/ai-solopreneur-v${VERSION}-source.tar.gz" \
    HEAD
fi

(
  cd "${PACK_DIR}"
  find . -type f ! -name SHA256SUMS -print |
    LC_ALL=C sort |
    while IFS= read -r file; do
      shasum -a 256 "${file#./}"
    done >SHA256SUMS
)

printf '\nInstructor kit created at:\n  %s\n' "${PACK_DIR}"
if [[ "${METADATA_ONLY}" == "true" ]]; then
  printf 'Metadata-only mode did not save the Git source archive.\n'
else
  printf 'Keep the kit private until you have checked it and copied it securely.\n'
fi
