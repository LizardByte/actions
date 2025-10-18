#!/bin/bash

# Extract python-version from WITH_PARAMS environment variable
if [ -n "$WITH_PARAMS" ]; then
  RELEASE_TAG=$(echo "$WITH_PARAMS" | jq -r '.["tag"]')
  echo "Extracted TAG: ${RELEASE_TAG}"

  # wait a little for release to be created
  sleep 60

  # delete the release
  gh_release_extra_args=""
  if [[ "${RELEASE_TAG}" != *"-draft" ]]; then
    gh_release_extra_args="--cleanup-tag"
  fi
  gh release delete "${RELEASE_TAG}" ${gh_release_extra_args} --yes
else
  echo "Error: WITH_PARAMS environment variable not set" >&2
  exit 1
fi
