#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="ai-solopreneur-phase7-smoke"
CHAT_PORT="3350"
DOCUMENT_WORKER_PORT="3191"
N8N_PORT="5728"
TEST_ENCRYPTION_KEY="789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456"
SESSION_ID="77777777-7777-4777-8777-777777777777"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-solopreneur-phase7.XXXXXX")"
COPY_ROOT="${TEMP_ROOT}/preflight-copy"

export COMPOSE_PROJECT_NAME="${PROJECT_NAME}"
export CHAT_PORT
export N8N_PORT
export GENERIC_TIMEZONE="Australia/Melbourne"
export N8N_ENCRYPTION_KEY="${TEST_ENCRYPTION_KEY}"

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    -p "${PROJECT_NAME}" \
    -f "${PROJECT_ROOT}/compose.yaml" \
    "$@"
}

cleanup() {
  if [[ "${KEEP_PHASE7_SMOKE:-0}" == "1" ]]; then
    printf '\nKeeping the isolated Phase 7 stack for inspection.\n'
    printf '  Chat: http://localhost:%s\n' "${CHAT_PORT}"
    printf '  n8n:  http://localhost:%s\n' "${N8N_PORT}"
  else
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ -n "${TEMP_ROOT}" && "${TEMP_ROOT}" == "${TMPDIR:-/tmp}/ai-solopreneur-phase7."* ]]; then
    find "${TEMP_ROOT}" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${TEMP_ROOT}" >/dev/null 2>&1 || true
  fi
}

fail() {
  printf 'Phase 7 smoke test failed: %s\n' "$1" >&2
  exit 1
}

expect_contains() {
  local value="$1"
  local expected="$2"
  local label="$3"
  [[ "${value}" == *"${expected}"* ]] ||
    fail "${label} did not contain ${expected}"
}

chat_status_and_body() {
  curl --silent --show-error --write-out $'\n%{http_code}' \
    -X POST "http://127.0.0.1:${CHAT_PORT}/api/chat" \
    -H 'Content-Type: application/json' \
    --data "{\"sessionId\":\"${SESSION_ID}\",\"message\":\"Hello\"}"
}

trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
  fail "Docker Desktop is not running"
fi

printf 'Running pilot evidence and chat contract tests in pinned Node containers...\n'
docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node --test tests/phase7/test-pilot-evaluator.mjs
docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node scripts/evaluate-pilot.mjs --allow-pending
docker run --rm \
  -v "${PROJECT_ROOT}/apps/chat:/workspace" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  sh -c "npm ci --ignore-scripts && npm test"

printf 'Starting an isolated unconfigured stack...\n'
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up -d --build --wait --wait-timeout 240

curl --fail --silent --show-error \
  "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

printf 'Checking the chat at mobile, tablet, and desktop widths...\n'
docker build \
  -f "${PROJECT_ROOT}/tests/phase7/Dockerfile.browser" \
  -t ai-solopreneur-phase7-browser-test:local \
  "${PROJECT_ROOT}" >/dev/null
chat_container="$(compose ps -q chat)"
[[ -n "${chat_container}" ]] ||
  fail "chat container was not available for browser-width tests"
docker run --rm \
  --network "container:${chat_container}" \
  -e BASE_URL=http://127.0.0.1:3000 \
  ai-solopreneur-phase7-browser-test:local

printf 'Checking the inactive-workflow learner error...\n'
inactive_response="$(chat_status_and_body)"
inactive_status="${inactive_response##*$'\n'}"
inactive_body="${inactive_response%$'\n'*}"
[[ "${inactive_status}" == "503" ]] ||
  fail "inactive workflow returned ${inactive_status}, not 503"
expect_contains "${inactive_body}" '"code":"AGENT_UNAVAILABLE"' "inactive workflow response"
expect_contains "${inactive_body}" 'workflow is active' "inactive workflow response"

printf 'Checking container restart recovery and health...\n'
compose restart n8n chat >/dev/null
compose up -d --wait --wait-timeout 240 >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

printf 'Checking occupied-port diagnostics from a separate project copy...\n'
mkdir -p "${COPY_ROOT}"
tar \
  -C "${PROJECT_ROOT}" \
  --exclude='./.git' \
  --exclude='./.env' \
  --exclude='./backups/*' \
  --exclude='./n8n/exports/*' \
  --exclude='./node_modules' \
  --exclude='./data' \
  --exclude='./apps/chat/node_modules' \
  --exclude='./apps/chat/dist' \
  --exclude='./services/document-worker/node_modules' \
  -cf - . | tar -C "${COPY_ROOT}" -xf -
{
  printf 'CHAT_PORT=%s\n' "${CHAT_PORT}"
  printf 'DOCUMENT_WORKER_PORT=%s\n' "${DOCUMENT_WORKER_PORT}"
  printf 'N8N_PORT=%s\n' "${N8N_PORT}"
  printf 'GENERIC_TIMEZONE=Australia/Melbourne\n'
  printf 'N8N_ENCRYPTION_KEY=%s\n' "${TEST_ENCRYPTION_KEY}"
} >"${COPY_ROOT}/.env"
# The running Compose stack occupies both configured ports, so the native
# preflight's connection test must report them as taken.
set +e
preflight_output="$(
  env \
    -u COMPOSE_PROJECT_NAME \
    -u CHAT_PORT \
    -u N8N_PORT \
    -u N8N_ENCRYPTION_KEY \
    "${COPY_ROOT}/scripts/preflight.sh" 2>&1
)"
preflight_status=$?
set -e
[[ "${preflight_status}" -ne 0 ]] ||
  fail "preflight passed while both configured ports were occupied"
expect_contains \
  "${preflight_output}" \
  "Port ${CHAT_PORT} is already in use by another application" \
  "occupied chat-port diagnostic"
expect_contains \
  "${preflight_output}" \
  "Port ${N8N_PORT} is already in use by another application" \
  "occupied n8n-port diagnostic"

printf 'Checking loss-of-service handling (the local no-network equivalent)...\n'
compose stop n8n >/dev/null
unavailable_response="$(chat_status_and_body)"
unavailable_status="${unavailable_response##*$'\n'}"
unavailable_body="${unavailable_response%$'\n'*}"
[[ "${unavailable_status}" == "503" ]] ||
  fail "unavailable n8n returned ${unavailable_status}, not 503"
expect_contains "${unavailable_body}" '"code":"AGENT_UNAVAILABLE"' "unavailable response"

if compose logs n8n chat | grep -q "${TEST_ENCRYPTION_KEY}"; then
  fail "the test encryption key appeared in container logs"
fi

printf '\nPhase 7 automated smoke test passed.\n'
printf '  Pilot evidence schema/evaluator: ok\n'
printf '  Invalid key, no credit, no network: safe gateway contracts\n'
printf '  Inactive workflow:                 actionable 503\n'
printf '  Occupied ports:                    detected\n'
printf '  Container restart and health:      recovered\n'
printf '  Browser widths:                    375, 768, and 1440 px\n'
