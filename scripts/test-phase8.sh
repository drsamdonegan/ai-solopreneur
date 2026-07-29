#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' <"${PROJECT_ROOT}/VERSION")"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-solopreneur-phase8.XXXXXX")"
PACK_ROOT="${TEMP_ROOT}/kit"
PACK_DIR="${PACK_ROOT}/v${VERSION}-metadata-test"

cleanup() {
  if [[ -n "${TEMP_ROOT}" && "${TEMP_ROOT}" == "${TMPDIR:-/tmp}/ai-solopreneur-phase8."* ]]; then
    find "${TEMP_ROOT}" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${TEMP_ROOT}" >/dev/null 2>&1 || true
  fi
}

fail() {
  printf 'Phase 8 release test failed: %s\n' "$1" >&2
  exit 1
}

trap cleanup EXIT INT TERM

printf 'Validating release metadata, template contents, workflows, and links...\n'
node "${PROJECT_ROOT}/scripts/validate-workflows.mjs"
node "${PROJECT_ROOT}/scripts/validate-template-readiness.mjs"
node "${PROJECT_ROOT}/scripts/validate-release.mjs"

printf 'Building a metadata-only instructor kit...\n'
"${PROJECT_ROOT}/scripts/prepare-instructor-pack.sh" \
  --metadata-only \
  --output "${PACK_ROOT}" >/dev/null

for required in \
  RELEASE-METADATA.txt \
  LOAD_IMAGES.md \
  SHA256SUMS; do
  [[ -s "${PACK_DIR}/${required}" ]] ||
    fail "instructor kit is missing ${required}"
done

workflow_count="$(
  find "${PACK_DIR}/workflows" \
    -mindepth 1 \
    -maxdepth 1 \
    -type f \
    -name '*.json' |
    wc -l |
    tr -d '[:space:]'
)"
[[ "${workflow_count}" == "11" ]] ||
  fail "instructor kit contains ${workflow_count} workflows, expected 11"

(
  cd "${PACK_DIR}"
  shasum -a 256 -c SHA256SUMS >/dev/null
)

if find "${PACK_DIR}" -type f -print0 |
  xargs -0 grep -Il . |
  xargs grep -E \
    'sk-ant-api03-[A-Za-z0-9_-]{20,}|N8N_ENCRYPTION_KEY=|ANTHROPIC_API_KEY=' \
    >/dev/null 2>&1; then
  fail "instructor kit appears to contain a credential or encryption key"
fi

if find "${PACK_DIR}" -type f \( \
  -name '.env' -o \
  -path '*/backups/*' -o \
  -name 'n8n-data.tar.gz' \
\) | grep -q .; then
  fail "instructor kit contains a local secret or backup artifact"
fi

printf '\nPhase 8 release test passed.\n'
printf '  Version and image digests:       locked\n'
printf '  Beginner getting-started guide:  complete\n'
printf '  Incremental course exercises:    8\n'
printf '  Canonical workflow backup:       11 files\n'
printf '  Instructor kit checksums:        verified\n'
printf '  Secret and local-data exclusions: verified\n'
