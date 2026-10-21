#!/bin/bash

set -euo pipefail

python3 ./tests/release_homebrew/render_formula.py ./build/release_homebrew/hello_world.rb
