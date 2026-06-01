#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_uv() {
  if command -v uv >/dev/null 2>&1; then
    return 0
  fi

  echo "Installing uv"
  if [[ "${RUNNER_OS:-}" == "Windows" ]]; then
    powershell.exe \
      -NoProfile \
      -ExecutionPolicy Bypass \
      -Command "irm https://astral.sh/uv/install.ps1 | iex"
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi

  export PATH="${HOME}/.local/bin:${PATH}"
  if [[ -n "${USERPROFILE:-}" ]] && command -v cygpath >/dev/null 2>&1; then
    user_profile_home=$(cygpath -u "${USERPROFILE}")
    export PATH="${user_profile_home}/.local/bin:${PATH}"
  fi

  if ! command -v uv >/dev/null 2>&1; then
    echo "Error: uv installation failed" >&2
    exit 1
  fi
}

# Source the version determination script
# shellcheck source=actions/setup_python/determine_version.sh
source "${SCRIPT_DIR}/determine_version.sh"

# Extract python-version and python-version-file from WITH_PARAMS environment variable
if [[ -n "$WITH_PARAMS" ]]; then
  PYTHON_VERSION=$(echo "$WITH_PARAMS" | jq -r '.["python-version"] // empty')
  PYTHON_VERSION_FILE=$(echo "$WITH_PARAMS" | jq -r '.["python-version-file"] // empty')

  echo "Input python-version: ${PYTHON_VERSION:-<not set>}"
  echo "Input python-version-file: ${PYTHON_VERSION_FILE:-<not set>}"

  # Determine the Python version(s) using the shared function
  if ! determine_python_version "${PYTHON_VERSION}" "${PYTHON_VERSION_FILE}"; then
    echo "Error: Failed to determine Python version" >&2
    exit 1
  fi

  echo "All Python versions: ${PYTHON_VERSIONS:-<not set>}"
  echo "Default Python version: ${DEFAULT_PYTHON_VERSION:-<not set>}"

  ACTION_PYTHON_PATH=$(command -v python)
  if [[ -z "${ACTION_PYTHON_PATH}" ]]; then
    echo "Error: python not found in PATH" >&2
    exit 1
  fi

  if command -v cygpath > /dev/null 2>&1; then
    ACTION_PYTHON_PATH=$(cygpath -w "${ACTION_PYTHON_PATH}")
  fi

  echo "Action Python path: ${ACTION_PYTHON_PATH}"
  export ACTION_PYTHON_PATH

  install_uv

  uv run \
    --project "${SCRIPT_DIR}" \
    --frozen \
    --extra dev \
    --python 3.14 \
    python -m pytest -c "${SCRIPT_DIR}/setup.cfg" tests/setup_python
else
  echo "Error: WITH_PARAMS environment variable not set" >&2
  exit 1
fi
