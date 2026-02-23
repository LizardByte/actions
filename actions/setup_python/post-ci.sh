#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

  # setup python
  python -m pip install --upgrade pip setuptools wheel

  # Convert path for Windows (Git Bash/MSYS produces Unix-style paths that pip rejects)
  if command -v cygpath > /dev/null 2>&1; then
    INSTALL_PATH="$(cygpath -w "${SCRIPT_DIR}")"
  else
    INSTALL_PATH="${SCRIPT_DIR}"
  fi
  python -m pip install --upgrade "${INSTALL_PATH}[dev]"

  python -m pytest \
    -rxXs \
    --tb=native \
    --verbose \
    --color=yes \
    -c "${SCRIPT_DIR}/setup.cfg" \
    tests/setup_python
else
  echo "Error: WITH_PARAMS environment variable not set" >&2
  exit 1
fi
