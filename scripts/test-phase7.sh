#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAT_PORT="3350"
DOCUMENT_WORKER_PORT="3191"
N8N_PORT="5728"
TEST_ENCRYPTION_KEY="789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456"
SESSION_ID="77777777-7777-4777-8777-777777777777"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-solopreneur-phase7.XXXXXX")"
STACK_ROOT="${TEMP_ROOT}/stack-copy"
PREFLIGHT_ROOT="${TEMP_ROOT}/preflight-copy"

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

copy_local() {
  (
    cd "${STACK_ROOT}"
    AI_SOLO_FORCE_PORTABLE_NODE=1 \
      NPM_CONFIG_LOGLEVEL=error \
      ./scripts/run-local.sh "$@"
  )
}

copy_project() {
  local destination="$1"
  mkdir -p "${destination}"
  tar \
    -C "${PROJECT_ROOT}" \
    --exclude='./.git' \
    --exclude='./.env' \
    --exclude='./backups/*' \
    --exclude='./n8n/exports/*' \
    --exclude='./node_modules' \
    --exclude='./.runtime' \
    --exclude='./data' \
    --exclude='./apps/chat/node_modules' \
    --exclude='./apps/chat/dist' \
    --exclude='./services/document-worker/node_modules' \
    -cf - . | tar -C "${destination}" -xf -
}

write_test_env() {
  local destination="$1"
  {
    printf 'CHAT_PORT=%s\n' "${CHAT_PORT}"
    printf 'DOCUMENT_WORKER_PORT=%s\n' "${DOCUMENT_WORKER_PORT}"
    printf 'N8N_PORT=%s\n' "${N8N_PORT}"
    printf 'GENERIC_TIMEZONE=Australia/Melbourne\n'
    printf 'N8N_ENCRYPTION_KEY=%s\n' "${TEST_ENCRYPTION_KEY}"
  } >"${destination}/.env"
}

chat_status_and_body() {
  curl --silent --show-error --write-out $'\n%{http_code}' \
    -X POST "http://127.0.0.1:${CHAT_PORT}/api/chat" \
    -H 'Content-Type: application/json' \
    --data "{\"sessionId\":\"${SESSION_ID}\",\"message\":\"Hello\"}"
}

stop_n8n_only() {
  local pid
  pid="$(
    node -e "
const fs = require('fs');
const record = JSON.parse(fs.readFileSync('${STACK_ROOT}/data/run/n8n.pid', 'utf8'));
process.stdout.write(String(record.pid));
"
  )"
  kill -TERM -- "-${pid}" >/dev/null 2>&1 || kill -TERM "${pid}" >/dev/null 2>&1 || true
  for attempt in $(seq 1 30); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  kill -KILL -- "-${pid}" >/dev/null 2>&1 || kill -KILL "${pid}" >/dev/null 2>&1 || true
}

cleanup() {
  if [[ -f "${STACK_ROOT}/scripts/local.mjs" ]]; then
    copy_local stop >/dev/null 2>&1 || true
  fi
  if [[ -n "${TEMP_ROOT}" && "${TEMP_ROOT}" == "${TMPDIR:-/tmp}/ai-solopreneur-phase7."* ]]; then
    find "${TEMP_ROOT}" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${TEMP_ROOT}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

printf 'Running pilot evidence and chat contract tests with local Node.js...\n'
node --test "${PROJECT_ROOT}/tests/phase7/test-pilot-evaluator.mjs"
node "${PROJECT_ROOT}/scripts/evaluate-pilot.mjs" --allow-pending
npm ci --prefix "${PROJECT_ROOT}/apps/chat" --ignore-scripts >/dev/null
npm test --prefix "${PROJECT_ROOT}/apps/chat"

printf 'Starting an isolated unconfigured native stack...\n'
copy_project "${STACK_ROOT}"
write_test_env "${STACK_ROOT}"
copy_local setup >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

printf 'Checking the chat at mobile, tablet, and desktop widths...\n'
[[ -x "${PROJECT_ROOT}/tests/phase7/node_modules/.bin/playwright" ]] ||
  fail "Playwright is not installed; run npm ci --prefix tests/phase7 first"
(
  cd "${PROJECT_ROOT}"
  BASE_URL="http://127.0.0.1:${CHAT_PORT}" \
    node tests/phase7/browser-widths.mjs
)

printf 'Checking the inactive-workflow learner error...\n'
inactive_response="$(chat_status_and_body)"
inactive_status="${inactive_response##*$'\n'}"
inactive_body="${inactive_response%$'\n'*}"
[[ "${inactive_status}" == "503" ]] ||
  fail "inactive workflow returned ${inactive_status}, not 503"
expect_contains "${inactive_body}" '"code":"AGENT_UNAVAILABLE"' "inactive workflow response"
expect_contains "${inactive_body}" 'workflow is active' "inactive workflow response"

printf 'Checking native restart recovery and health...\n'
copy_local restart >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

printf 'Checking occupied-port diagnostics from a separate project copy...\n'
copy_project "${PREFLIGHT_ROOT}"
write_test_env "${PREFLIGHT_ROOT}"
set +e
preflight_output="$("${PREFLIGHT_ROOT}/scripts/preflight.sh" 2>&1)"
preflight_status=$?
set -e
[[ "${preflight_status}" -ne 0 ]] ||
  fail "preflight passed while configured ports were occupied"
expect_contains \
  "${preflight_output}" \
  "Port ${CHAT_PORT} is already in use by another application" \
  "occupied chat-port diagnostic"
expect_contains \
  "${preflight_output}" \
  "Port ${N8N_PORT} is already in use by another application" \
  "occupied n8n-port diagnostic"

printf 'Checking loss-of-service handling...\n'
stop_n8n_only
unavailable_response="$(chat_status_and_body)"
unavailable_status="${unavailable_response##*$'\n'}"
unavailable_body="${unavailable_response%$'\n'*}"
[[ "${unavailable_status}" == "503" ]] ||
  fail "unavailable n8n returned ${unavailable_status}, not 503"
expect_contains "${unavailable_body}" '"code":"AGENT_UNAVAILABLE"' "unavailable response"

if rg -F "${TEST_ENCRYPTION_KEY}" "${STACK_ROOT}/data/logs" >/dev/null 2>&1; then
  fail "the test encryption key appeared in service logs"
fi

printf '\nPhase 7 automated smoke test passed.\n'
printf '  Pilot evidence schema/evaluator: ok\n'
printf '  Invalid key, no credit, no network: safe gateway contracts\n'
printf '  Inactive workflow:                 actionable 503\n'
printf '  Occupied ports:                    detected\n'
printf '  Native restart and health:         recovered\n'
printf '  Browser widths:                    375, 768, and 1440 px\n'
