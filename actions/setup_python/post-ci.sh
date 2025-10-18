#!/bin/bash

# Extract python-version from WITH_PARAMS environment variable
if [[ -n "$WITH_PARAMS" ]]; then
  PYTHON_VERSION=$(echo "$WITH_PARAMS" | jq -r '.["python-version"]')
  echo "Extracted Python Version: ${PYTHON_VERSION}"
  export INPUT_PYTHON_VERSION="${PYTHON_VERSION}"

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
