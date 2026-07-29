#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="${AI_SOLO_RUNTIME_DIR:-${PROJECT_ROOT}/.runtime}"
NODE_VERSION="$(tr -d '[:space:]' <"${PROJECT_ROOT}/.node-version")"
FORCE_PORTABLE="${AI_SOLO_FORCE_PORTABLE_NODE:-0}"
INSTALL_IF_MISSING=0

if [[ "${1:-}" == "--install" ]]; then
  INSTALL_IF_MISSING=1
elif [[ -n "${1:-}" ]]; then
  printf 'Usage: %s [--install]\n' "$0" >&2
  exit 2
fi

if [[ ! "${NODE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'The pinned Node.js version in .node-version is invalid: %s\n' "${NODE_VERSION}" >&2
  exit 1
fi

system_node() {
  local candidate=""
  local major=""

  candidate="$(command -v node 2>/dev/null || true)"
  [[ -n "${candidate}" ]] || return 1

  major="$("${candidate}" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  [[ "${major}" =~ ^[0-9]+$ ]] || return 1
  ((major >= 24)) || return 1

  printf '%s\n' "${candidate}"
}

platform_details() {
  local os=""
  local machine=""

  os="$(uname -s)"
  machine="$(uname -m)"

  case "${os}" in
    Darwin)
      NODE_PLATFORM="darwin"
      NODE_ARCHIVE_EXTENSION="tar.gz"
      ;;
    Linux)
      NODE_PLATFORM="linux"
      NODE_ARCHIVE_EXTENSION="tar.xz"
      ;;
    *)
      printf 'Automatic Node.js setup supports macOS and Linux here; found %s.\n' "${os}" >&2
      exit 1
      ;;
  esac

  case "${machine}" in
    arm64 | aarch64)
      NODE_ARCH="arm64"
      ;;
    x86_64 | amd64)
      NODE_ARCH="x64"
      ;;
    *)
      printf 'Automatic Node.js setup does not support this processor: %s.\n' "${machine}" >&2
      exit 1
      ;;
  esac
}

expected_checksum() {
  case "${NODE_PLATFORM}-${NODE_ARCH}" in
    darwin-arm64)
      printf '%s\n' "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1"
      ;;
    darwin-x64)
      printf '%s\n' "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080"
      ;;
    linux-arm64)
      printf '%s\n' "58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6"
      ;;
    linux-x64)
      printf '%s\n' "55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
      ;;
    *)
      return 1
      ;;
  esac
}

file_checksum() {
  local archive="$1"

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${archive}" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${archive}" | awk '{print $1}'
    return
  fi

  printf 'A SHA-256 tool is required to verify the Node.js download.\n' >&2
  exit 1
}

cleanup_temporary_directory() {
  local directory="$1"

  if [[ -d "${directory}" && "${directory}" == "${RUNTIME_ROOT}/node-download."* ]]; then
    find "${directory}" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${directory}" >/dev/null 2>&1 || true
  fi
}

platform_details

ARCHIVE_BASENAME="node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}"
INSTALL_DIRECTORY="${RUNTIME_ROOT}/${ARCHIVE_BASENAME}"
PORTABLE_NODE="${INSTALL_DIRECTORY}/bin/node"

if [[ "${FORCE_PORTABLE}" != "1" ]]; then
  if SYSTEM_NODE="$(system_node)"; then
    printf '%s\n' "${SYSTEM_NODE}"
    exit 0
  fi
fi

if [[ -x "${PORTABLE_NODE}" ]]; then
  printf '%s\n' "${PORTABLE_NODE}"
  exit 0
fi

if [[ "${INSTALL_IF_MISSING}" != "1" ]]; then
  printf 'Node.js 24+ is not available yet. Run setup.command first.\n' >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  printf 'Setup needs curl to download Node.js, but curl was not found.\n' >&2
  exit 1
fi
if ! command -v tar >/dev/null 2>&1; then
  printf 'Setup needs tar to unpack Node.js, but tar was not found.\n' >&2
  exit 1
fi

mkdir -p "${RUNTIME_ROOT}"
TEMP_DIRECTORY="$(mktemp -d "${RUNTIME_ROOT}/node-download.XXXXXX")"
trap 'cleanup_temporary_directory "${TEMP_DIRECTORY}"' EXIT INT TERM

ARCHIVE_NAME="${ARCHIVE_BASENAME}.${NODE_ARCHIVE_EXTENSION}"
ARCHIVE_PATH="${TEMP_DIRECTORY}/${ARCHIVE_NAME}"
DOWNLOAD_URL="https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE_NAME}"

printf 'Node.js 24+ was not found. Downloading a private project copy of Node.js %s...\n' "${NODE_VERSION}" >&2
curl \
  --fail \
  --location \
  --proto '=https' \
  --show-error \
  --silent \
  --output "${ARCHIVE_PATH}" \
  "${DOWNLOAD_URL}"

EXPECTED_CHECKSUM="$(expected_checksum)"
ACTUAL_CHECKSUM="$(file_checksum "${ARCHIVE_PATH}")"
if [[ "${ACTUAL_CHECKSUM}" != "${EXPECTED_CHECKSUM}" ]]; then
  printf 'The Node.js download failed its SHA-256 safety check.\n' >&2
  printf 'Expected: %s\n' "${EXPECTED_CHECKSUM}" >&2
  printf 'Actual:   %s\n' "${ACTUAL_CHECKSUM}" >&2
  exit 1
fi

printf 'Verified the official Node.js download. Unpacking it inside this project...\n' >&2
case "${NODE_ARCHIVE_EXTENSION}" in
  tar.gz)
    tar -xzf "${ARCHIVE_PATH}" -C "${TEMP_DIRECTORY}"
    ;;
  tar.xz)
    tar -xJf "${ARCHIVE_PATH}" -C "${TEMP_DIRECTORY}"
    ;;
esac

EXTRACTED_DIRECTORY="${TEMP_DIRECTORY}/${ARCHIVE_BASENAME}"
if [[ ! -x "${EXTRACTED_DIRECTORY}/bin/node" ]]; then
  printf 'The Node.js archive did not contain the expected executable.\n' >&2
  exit 1
fi

if [[ ! -d "${INSTALL_DIRECTORY}" ]]; then
  mv "${EXTRACTED_DIRECTORY}" "${INSTALL_DIRECTORY}"
fi

INSTALLED_VERSION="$("${PORTABLE_NODE}" --version)"
if [[ "${INSTALLED_VERSION}" != "v${NODE_VERSION}" ]]; then
  printf 'The project-local Node.js version is unexpected: %s\n' "${INSTALLED_VERSION}" >&2
  exit 1
fi

printf 'Project-local Node.js %s is ready. Nothing was installed globally.\n' "${NODE_VERSION}" >&2
printf '%s\n' "${PORTABLE_NODE}"
