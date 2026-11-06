#!/usr/bin/env bash
set -euo pipefail

mkdir -p build/org-sync-ci
jq -n --arg org "${GITHUB_REPOSITORY_OWNER}" '[$org]' > build/org-sync-ci/organizations.json
jq -n --arg repository "${GITHUB_REPOSITORY}" '
{
  "version": 1,
  "include_source": true,
  "rules": [
    {"id": "smoke", "repositories": [$repository], "files": [{"source": "README.md", "destination": "org-sync-ci.md"}]}
  ]
}
' > build/org-sync-ci/policy.json

cat > build/org-sync-ci/properties.json <<'EOF'
{
  "properties": [
    {"property_name": "org_sync_ci_marker", "value_type": "string"}
  ]
}
EOF
