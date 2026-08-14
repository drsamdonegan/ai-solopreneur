#!/usr/bin/env bash

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
"${PROJECT_ROOT}/scripts/run-local.sh" connect-cloud

printf '\nYou can close this window.\n'
