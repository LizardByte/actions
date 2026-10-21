#!/bin/bash

set -euo pipefail

revision=$(git rev-parse HEAD)
formula_file=./build/release_homebrew/hello_world.rb

mkdir -p "$(dirname "${formula_file}")"
sed "s/@GIT_REVISION@/${revision}/g" ./tests/release_homebrew/Formula/hello_world.rb > "${formula_file}"
echo "# Created from ${GITHUB_REPOSITORY}@${revision}" >> "${formula_file}"
