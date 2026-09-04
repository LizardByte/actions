#!/bin/bash

set -euo pipefail

package_path=$(jq -r '.package_path' <<< "${WITH_PARAMS}")
mkdir -p "${package_path}"
touch \
  "${package_path}/helloworld_1.2.3-1+ubuntu22.04_amd64.deb" \
  "${package_path}/HelloWorld-1.2.3-1.fc44.x86_64.rpm" \
  "${package_path}/HelloWorld-1.2.3-1.suse.lp156.aarch64.rpm"
