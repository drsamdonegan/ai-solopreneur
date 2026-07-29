#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAT_PORT="3330"
DOCUMENT_WORKER_PORT="3185"
N8N_PORT="5708"
TEST_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
SESSION_A="11111111-1111-4111-8111-111111111111"
SESSION_B="22222222-2222-4222-8222-222222222222"
SESSION_C="33333333-3333-4333-8333-333333333333"
SESSION_D="44444444-4444-4444-8444-444444444444"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-solopreneur-phase5.XXXXXX")"
COPY_ROOT="${TEMP_ROOT}/project-copy"
TEMP_DIRECTORY="${TEMP_ROOT}/results"
MOCK_LOG="${TEMP_ROOT}/anthropic-mock.log"
MOCK_PID=""

copy_local() {
  (
    cd "${COPY_ROOT}"
    AI_SOLO_FORCE_PORTABLE_NODE=1 \
      NPM_CONFIG_LOGLEVEL=error \
      ./scripts/run-local.sh "$@"
  )
}

cleanup() {
  if [[ "${KEEP_PHASE5_SMOKE:-0}" == "1" ]]; then
    printf '\nKeeping the isolated Phase 5 native stack running for inspection.\n'
    printf '  Chat: http://localhost:%s\n' "${CHAT_PORT}"
    printf '  n8n:  http://localhost:%s\n' "${N8N_PORT}"
    printf '  Copy: %s\n' "${COPY_ROOT}"
  else
    if [[ -f "${COPY_ROOT}/scripts/local.mjs" ]]; then
      copy_local stop >/dev/null 2>&1 || true
    fi
    if [[ -n "${MOCK_PID}" ]]; then
      kill "${MOCK_PID}" >/dev/null 2>&1 || true
      wait "${MOCK_PID}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${TEMP_ROOT}" && "${TEMP_ROOT}" == "${TMPDIR:-/tmp}/ai-solopreneur-phase5."* ]]; then
      find "${TEMP_ROOT}" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
      rmdir "${TEMP_ROOT}" >/dev/null 2>&1 || true
    fi
  fi
}

fail() {
  printf 'Phase 5 smoke test failed: %s\n' "$1" >&2
  exit 1
}

expect_contains() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "${actual}" != *"${expected}"* ]]; then
    printf 'Expected %s to contain:\n  %s\nActual:\n  %s\n' \
      "${label}" "${expected}" "${actual}" >&2
    exit 1
  fi
}

expect_not_contains() {
  local actual="$1"
  local unexpected="$2"
  local label="$3"
  if [[ "${actual}" == *"${unexpected}"* ]]; then
    printf 'Expected %s not to contain:\n  %s\nActual:\n  %s\n' \
      "${label}" "${unexpected}" "${actual}" >&2
    exit 1
  fi
}

post_webhook() {
  local path="$1"
  local body="$2"
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/${path}" \
    -H 'Content-Type: application/json' \
    --data "${body}"
}

chat() {
  local session_id="$1"
  local message="$2"
  jq -n \
    --arg sessionId "${session_id}" \
    --arg message "${message}" \
    '{sessionId:$sessionId,message:$message}' |
    curl --fail --silent --show-error \
      -X POST "http://127.0.0.1:${CHAT_PORT}/api/chat" \
      -H 'Content-Type: application/json' \
      --data-binary @-
}

publish_workflow() {
  copy_local n8n publish:workflow --id="$1" >/dev/null
}

mock_metrics() {
  curl --fail --silent --show-error "http://127.0.0.1:3401/metrics"
}

list_tasks() {
  local session_id="$1"
  post_webhook \
    "phase4-test-list" \
    "{\"sessionId\":\"${session_id}\",\"status\":\"all\",\"priority\":\"all\"}"
}

trap cleanup EXIT INT TERM

printf 'Validating workflows, skills, and tool policy...\n'
node "${PROJECT_ROOT}/scripts/validate-workflows.mjs"
node "${PROJECT_ROOT}/tests/phase5/test-skills.mjs"

printf 'Creating an isolated native project and Anthropic API mock...\n'
mkdir -p "${COPY_ROOT}" "${TEMP_DIRECTORY}"
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
  -cf - . | tar -C "${COPY_ROOT}" -xf -
{
  printf 'CHAT_PORT=%s\n' "${CHAT_PORT}"
  printf 'DOCUMENT_WORKER_PORT=%s\n' "${DOCUMENT_WORKER_PORT}"
  printf 'N8N_PORT=%s\n' "${N8N_PORT}"
  printf 'GENERIC_TIMEZONE=Australia/Melbourne\n'
  printf 'N8N_ENCRYPTION_KEY=%s\n' "${TEST_ENCRYPTION_KEY}"
} >"${COPY_ROOT}/.env"
node -e "
const fs = require('fs');
const path = '${COPY_ROOT}/tests/phase3/fixtures/mock-anthropic-credential.json';
const rows = JSON.parse(fs.readFileSync(path, 'utf8'));
rows[0].data.url = 'http://127.0.0.1:3401';
fs.writeFileSync(path, JSON.stringify(rows, null, 2) + '\\n');
"
node "${COPY_ROOT}/tests/phase5/anthropic-mock.mjs" >"${MOCK_LOG}" 2>&1 &
MOCK_PID=$!
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:3401/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:3401/health" >/dev/null

printf 'Installing and starting the isolated native stack...\n'
copy_local setup >/dev/null

printf 'Importing the test credential, workflows, and test harnesses...\n'
copy_local n8n import:credentials \
  --input="${COPY_ROOT}/tests/phase3/fixtures/mock-anthropic-credential.json" >/dev/null
copy_local n8n import:workflow \
  --separate \
  --input="${COPY_ROOT}/n8n/workflows" >/dev/null
copy_local n8n import:workflow \
  --separate \
  --input="${COPY_ROOT}/tests/phase4/workflows" >/dev/null
copy_local n8n import:workflow \
  --separate \
  --input="${COPY_ROOT}/tests/phase5/workflows" >/dev/null

workflow_list="$(copy_local n8n list:workflow)"
for expected_workflow in \
  "phase3StartHere|00 - START HERE - Project Partner" \
  "phase4TaskSetup|10 - SETUP - Local Task Data" \
  "phase5SyncEnabledSkills|11 - SETUP - Sync Enabled Skills" \
  "phase4ListTasks|20 - TOOL - list_tasks" \
  "phase4CreateTask|21 - TOOL - create_task" \
  "phase4UpdateTaskStatus|22 - TOOL - update_task_status" \
  "phase5ProposeCreateTask|30 - TOOL - Propose create_task" \
  "phase5ProposeTaskStatus|31 - TOOL - Propose update_task_status" \
  "phase5ConfirmTaskWrite|40 - CONFIRM - Task Write" \
  "phase4TestHarness|PHASE 4 TEST HARNESS" \
  "phase5TestHarness|PHASE 5 TEST HARNESS"; do
  expect_contains "${workflow_list}" "${expected_workflow}" "imported workflow list"
done

printf 'Publishing setup, runtime dependencies, harnesses, and the agent...\n'
for workflow_id in \
  phase4TaskSetup \
  phase5SyncEnabledSkills \
  phase4ListTasks \
  phase4CreateTask \
  phase4UpdateTaskStatus \
  phase5ProposeCreateTask \
  phase5ProposeTaskStatus \
  phase5ConfirmTaskWrite \
  phase4TestHarness \
  phase5TestHarness \
  phase3StartHere; do
  publish_workflow "${workflow_id}"
done
copy_local restart >/dev/null

printf 'Creating local tables and syncing only enabled skills...\n'
setup_response="$(
  curl \
    --retry 30 \
    --retry-delay 1 \
    --retry-all-errors \
    --fail \
    --silent \
    --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/setup-task-data"
)"
repeat_setup_response="$(
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/setup-task-data"
)"
expect_contains "${setup_response}" '"ok":true' "task setup response"
expect_contains "${repeat_setup_response}" '"ok":true' "repeated task setup response"

skill_bundle="$(node "${PROJECT_ROOT}/scripts/compile-skills.mjs")"
expect_contains "${skill_bundle}" '"project-assistant"' "compiled skill bundle"
expect_contains "${skill_bundle}" '"task-capture"' "compiled skill bundle"
expect_contains "${skill_bundle}" '"weekly-status"' "compiled skill bundle"
expect_contains "${skill_bundle}" '"meeting-analysis"' "compiled skill bundle"
copy_local n8n unpublish:workflow --id=phase5SyncEnabledSkills >/dev/null
skill_response="$(copy_local sync-skills)"
repeat_skill_response="$(copy_local sync-skills)"
expect_contains \
  "${skill_response}" \
  "Enabled skills synced successfully" \
  "skill sync response"
expect_contains \
  "${repeat_skill_response}" \
  "Enabled skills synced successfully" \
  "repeated skill sync response"

config_response="$(
  curl \
    --retry 30 \
    --retry-delay 1 \
    --retry-all-errors \
    --fail \
    --silent \
    --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/phase5-test-config"
)"
expect_contains "${config_response}" '"count":1' "agent config"
expect_contains "${config_response}" 'project-assistant' "agent config"
expect_not_contains "${config_response}" 'DISABLED_SKILL_MARKER' "agent config"

copy_local n8n unpublish:workflow --id=phase4TaskSetup >/dev/null
copy_local restart >/dev/null
setup_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/setup-task-data"
)"
skill_sync_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/sync-enabled-skills"
)"
[[ "${setup_status}" == "404" ]] ||
  fail "temporary setup webhook remained available (${setup_status})"
[[ "${skill_sync_status}" == "404" ]] ||
  fail "temporary skill-sync webhook remained available (${skill_sync_status})"

curl \
  --retry 30 \
  --retry-delay 1 \
  --retry-all-errors \
  --fail \
  --silent \
  --show-error \
  "http://127.0.0.1:${N8N_PORT}/webhook/phase5-test-config" >/dev/null

printf 'Starting the learner chat with three seeded tasks...\n'
copy_local status >/dev/null
initial_list="$(list_tasks "${SESSION_A}")"
expect_contains "${initial_list}" '"count":3' "initial task list"

printf 'Preparing a write while proving plain yes and unrelated phrases cannot approve it...\n'
first_proposal="$(
  chat "${SESSION_A}" "Create a task to invite the pilot group"
)"
expect_contains "${first_proposal}" 'No task has changed yet' "first proposal"
first_phrase="$(
  printf '%s' "${first_proposal}" |
    jq -r '.reply | capture("(?<phrase>CONFIRM [A-F0-9]{8})").phrase'
)"
[[ "${first_phrase}" =~ ^CONFIRM\ [A-F0-9]{8}$ ]] ||
  fail "agent did not return an exact confirmation phrase"
expect_contains "$(list_tasks "${SESSION_A}")" '"count":3' "tasks after proposal"

plain_yes="$(chat "${SESSION_A}" "yes")"
expect_contains "${plain_yes}" 'does not confirm a write' "plain yes response"
expect_contains "$(list_tasks "${SESSION_A}")" '"count":3' "tasks after plain yes"

cross_session="$(
  chat "${SESSION_B}" "${first_phrase}"
)"
expect_contains \
  "${cross_session}" \
  'does not match a proposal in this conversation' \
  "cross-session confirmation"
expect_contains "$(list_tasks "${SESSION_A}")" '"count":3' "tasks after cross-session phrase"

last_character="${first_phrase: -1}"
replacement_character="0"
if [[ "${last_character}" == "0" ]]; then
  replacement_character="1"
fi
altered_phrase="${first_phrase:0:${#first_phrase}-1}${replacement_character}"
altered_result="$(chat "${SESSION_A}" "${altered_phrase}")"
expect_contains "${altered_result}" 'does not match a proposal' "altered phrase"
expect_contains "$(list_tasks "${SESSION_A}")" '"count":3' "tasks after altered phrase"

printf 'Superseding the old proposal and confirming the new exact action...\n'
second_proposal="$(
  chat "${SESSION_A}" "Create another task to invite the pilot group"
)"
second_phrase="$(
  printf '%s' "${second_proposal}" |
    jq -r '.reply | capture("(?<phrase>CONFIRM [A-F0-9]{8})").phrase'
)"
[[ "${second_phrase}" != "${first_phrase}" ]] ||
  fail "a newer proposal reused the old confirmation phrase"

old_result="$(chat "${SESSION_A}" "${first_phrase}")"
expect_contains "${old_result}" 'newer proposal replaced' "superseded phrase"
expect_contains "$(list_tasks "${SESSION_A}")" '"count":3' "tasks after superseded phrase"

model_calls_before_confirm="$(mock_metrics | jq -r '.messageCalls')"
confirmed_create="$(chat "${SESSION_A}" "${second_phrase}")"
model_calls_after_confirm="$(mock_metrics | jq -r '.messageCalls')"
expect_contains "${confirmed_create}" 'Confirmed. Created task #' "confirmed create"
[[ "${model_calls_before_confirm}" == "${model_calls_after_confirm}" ]] ||
  fail "exact confirmation unexpectedly reached the model"
after_create="$(list_tasks "${SESSION_A}")"
expect_contains "${after_create}" '"count":4' "tasks after confirmed create"
expect_contains "${after_create}" '"title":"Invite the pilot group"' "created task"

reused_create="$(chat "${SESSION_A}" "${second_phrase}")"
expect_contains "${reused_create}" 'already used' "reused confirmation"
expect_contains "$(list_tasks "${SESSION_A}")" '"count":4' "tasks after reused phrase"

printf 'Rejecting an expired proposal without a task write...\n'
expired_proposal="$(
  post_webhook \
    "phase5-test-propose-create" \
    "{\"sessionId\":\"${SESSION_C}\",\"title\":\"Expired proposal task\",\"description\":\"This must never be written.\",\"status\":\"todo\",\"priority\":\"low\",\"dueDate\":\"\"}"
)"
expired_phrase="$(printf '%s' "${expired_proposal}" | jq -r '.confirmation.phrase')"
pending_before_expiry="$(
  curl --fail --silent --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/phase5-test-pending"
)"
expired_action="$(
  printf '%s' "${pending_before_expiry}" |
    jq -r --arg phrase "${expired_phrase}" \
      '.actions[] | select(.confirmationText==$phrase) | .actionId'
)"
post_webhook \
  "phase5-test-expire" \
  "{\"actionId\":\"${expired_action}\"}" >/dev/null
expired_result="$(
  post_webhook \
    "phase5-test-confirm" \
    "{\"sessionId\":\"${SESSION_C}\",\"confirmationText\":\"${expired_phrase}\"}"
)"
expect_contains "${expired_result}" '"code":"CONFIRMATION_EXPIRED"' "expired phrase"
expect_contains "$(list_tasks "${SESSION_C}")" '"count":4' "tasks after expired phrase"

printf 'Confirming an exact status update and rejecting its reuse...\n'
update_proposal="$(chat "${SESSION_A}" "Mark task #1 done")"
expect_contains "${update_proposal}" 'No task has changed yet' "update proposal"
update_phrase="$(
  printf '%s' "${update_proposal}" |
    jq -r '.reply | capture("(?<phrase>CONFIRM [A-F0-9]{8})").phrase'
)"
before_update="$(
  post_webhook \
    "phase4-test-list" \
    "{\"sessionId\":\"${SESSION_A}\",\"status\":\"todo\",\"priority\":\"high\"}"
)"
expect_contains "${before_update}" '"title":"Confirm the project outcome"' "task before update"
confirmed_update="$(chat "${SESSION_A}" "${update_phrase}")"
expect_contains "${confirmed_update}" 'Task #1 is now done' "confirmed update"
after_update="$(
  post_webhook \
    "phase4-test-list" \
    "{\"sessionId\":\"${SESSION_A}\",\"status\":\"done\",\"priority\":\"high\"}"
)"
expect_contains "${after_update}" '"title":"Confirm the project outcome"' "task after update"
expect_contains "$(chat "${SESSION_A}" "${update_phrase}")" 'already used' "reused update"

printf 'Racing two identical confirmations to prove single-use consumption...\n'
race_proposal="$(
  post_webhook \
    "phase5-test-propose-create" \
    "{\"sessionId\":\"${SESSION_D}\",\"title\":\"Run the confirmation race\",\"description\":\"This row must appear exactly once.\",\"status\":\"todo\",\"priority\":\"medium\",\"dueDate\":\"\"}"
)"
race_phrase="$(printf '%s' "${race_proposal}" | jq -r '.confirmation.phrase')"
post_webhook \
  "phase5-test-confirm" \
  "{\"sessionId\":\"${SESSION_D}\",\"confirmationText\":\"${race_phrase}\"}" \
  >"${TEMP_DIRECTORY}/race-one.json" &
race_one_pid=$!
post_webhook \
  "phase5-test-confirm" \
  "{\"sessionId\":\"${SESSION_D}\",\"confirmationText\":\"${race_phrase}\"}" \
  >"${TEMP_DIRECTORY}/race-two.json" &
race_two_pid=$!
wait "${race_one_pid}"
wait "${race_two_pid}"
race_results="$(
  jq -s '.' \
    "${TEMP_DIRECTORY}/race-one.json" \
    "${TEMP_DIRECTORY}/race-two.json"
)"
expect_contains "${race_results}" '"ok": true' "concurrent confirmation results"
expect_contains \
  "${race_results}" \
  '"code": "CONFIRMATION_ALREADY_USED"' \
  "concurrent confirmation results"
after_race="$(list_tasks "${SESSION_D}")"
expect_contains "${after_race}" '"count":5' "task count after confirmation race"
race_title_count="$(
  printf '%s' "${after_race}" |
    jq '[.tasks[] | select(.title=="Run the confirmation race")] | length'
)"
[[ "${race_title_count}" == "1" ]] ||
  fail "concurrent confirmation created ${race_title_count} matching tasks"

printf 'Checking visible state, audit evidence, skills, and tool exposure...\n'
pending_response="$(
  curl --fail --silent --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/phase5-test-pending"
)"
expect_contains "${pending_response}" '"status":"superseded"' "pending actions"
expect_contains "${pending_response}" '"status":"consumed"' "pending actions"
expect_contains "${pending_response}" '"status":"expired"' "pending actions"

audit_response="$(
  curl --fail --silent --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/phase4-test-audit"
)"
expect_contains "${audit_response}" '"toolName":"create_task_proposal"' "tool audit"
expect_contains \
  "${audit_response}" \
  '"toolName":"update_task_status_proposal"' \
  "tool audit"
expect_contains "${audit_response}" '"toolName":"create_task"' "tool audit"
expect_contains "${audit_response}" '"toolName":"update_task_status"' "tool audit"

agent_list="$(chat "${SESSION_A}" "What tasks exist in my local project?")"
expect_contains "${agent_list}" 'I found 5 local tasks' "agent list response"
metrics="$(mock_metrics)"
expect_contains "${metrics}" '"list_tasks"' "model-visible tools"
expect_contains "${metrics}" '"create_task"' "model-visible tools"
expect_contains "${metrics}" '"update_task_status"' "model-visible tools"
expect_not_contains "${metrics}" '"delete_task"' "model-visible tools"
expect_not_contains "${metrics}" '"archive_task"' "model-visible tools"
expect_not_contains "${metrics}" '"bulk_change_tasks"' "model-visible tools"
expect_contains "${metrics}" '# Project Assistant' "agent system instructions"
expect_contains "${metrics}" '# Task Capture' "agent system instructions"
expect_contains "${metrics}" '# Weekly Status' "agent system instructions"
expect_not_contains "${metrics}" 'DISABLED_SKILL_MARKER' "agent system instructions"

if rg -F "${TEST_ENCRYPTION_KEY}" "${COPY_ROOT}/data/logs" "${MOCK_LOG}" >/dev/null 2>&1; then
  fail "a test encryption key appeared in service logs"
fi

printf '\nPhase 5 smoke test passed.\n'
printf '  Enabled Markdown skills:       4\n'
printf '  Automatic read tools:          list_tasks\n'
printf '  Confirmation-gated writes:     create and status update\n'
printf '  Cross-session/altered/old yes: rejected\n'
printf '  Expiry and single-use:          enforced\n'
printf '  Concurrent duplicate writes:   prevented\n'
printf '  Destructive tools exposed:      0\n'
