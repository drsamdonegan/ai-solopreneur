#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Finder opens a double-clicked .command in the home folder, not here. Commands
# that read the project's own git remote must run from the project itself.
cd "${PROJECT_ROOT}"

COMMAND="${1:-}"

if [[ -z "${COMMAND}" ]]; then
  printf 'A local-runner command is required.\n' >&2
  exit 2
fi
shift

NODE_PATH="$("${PROJECT_ROOT}/scripts/node-runtime.sh" --install)"
PATH="$(dirname "${NODE_PATH}"):${PATH}"
export PATH

exec "${NODE_PATH}" "${PROJECT_ROOT}/scripts/local.mjs" "${COMMAND}" "$@"
