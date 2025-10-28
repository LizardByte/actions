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
  python -m pip install --upgrade -r requirements-dev.txt

  python -m pytest \
    -rxXs \
    --tb=native \
    --verbose \
    --color=yes \
    tests/setup_python
else
  echo "Error: WITH_PARAMS environment variable not set" >&2
  exit 1
fi
