#!/usr/bin/env bash
set -euo pipefail

mkdir -p build/org-sync-ci
jq -n --arg org "${GITHUB_REPOSITORY_OWNER}" '[$org]' > build/org-sync-ci/organizations.json
jq -n --arg repository "${GITHUB_REPOSITORY}" --arg org "${GITHUB_REPOSITORY_OWNER}" '
{
  "version": 1,
  "files": {
    "include_source": true,
    "rules": [
      {"id": "smoke", "repositories": [$repository], "files": [{"source": "README.md", "destination": "org-sync-ci.md"}]}
    ]
  },
  "properties": [{"property_name": "org_sync_ci_marker", "value_type": "string"}],
  "administration": {"source_organization": $org}
}
' > build/org-sync-ci/policy.json
