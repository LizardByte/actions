#!/usr/bin/env bash
set -euo pipefail

mkdir -p build/org-sync-ci
jq -n --arg org "${GITHUB_REPOSITORY_OWNER}" '[$org]' > build/org-sync-ci/organizations.json
cat > build/org-sync-ci/policy.json <<'EOF'
{
  "version": 1,
  "rules": [
    {"id": "smoke", "files": [{"source": "README.md", "destination": "org-sync-ci.md"}]}
  ]
}
EOF
