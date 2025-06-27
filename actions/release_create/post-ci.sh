#!/bin/bash

# Extract python-version from WITH_PARAMS environment variable
if [ -n "$WITH_PARAMS" ]; then
  RELEASE_TAG=$(echo "$WITH_PARAMS" | jq -r '.["tag"]')
  echo "Extracted TAG: ${RELEASE_TAG}"

  # wait a little for release to be created
  sleep 60

  # delete the release
  gh release delete "${RELEASE_TAG}" --cleanup-tag --yes
else
  echo "Error: WITH_PARAMS environment variable not set"
  exit 1
fi
