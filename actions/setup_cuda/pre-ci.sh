#!/bin/bash

set -euo pipefail

echo "Pre-CI: Freeing up disk space for CUDA installation..."
echo ""

# Detect OS
OS_TYPE=$(uname -s)

# Skip on macOS
if [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "macOS detected - skipping cleanup (CUDA not supported on macOS)"
    echo "Pre-CI setup complete!"
    exit 0
fi

# Skip on Windows
if [[ "$OS_TYPE" == MINGW* ]] || [[ "$OS_TYPE" == MSYS* ]] || [[ "$OS_TYPE" == CYGWIN* ]]; then
    echo "Windows detected - skipping cleanup (Windows runners have sufficient space)"
    echo "Pre-CI setup complete!"
    exit 0
fi

echo "Linux detected - running cleanup script..."
echo ""

# Determine which branch/ref to use for downloading the cleanup script
# If we're running in the LizardByte/actions repository itself, use the current commit SHA
# Otherwise, use master branch
if [[ "${GITHUB_REPOSITORY:-}" == "LizardByte/actions" ]]; then
    # Running in the actions repo - use the current commit SHA
    # GITHUB_SHA is reliable for both PRs and branches
    CLEANUP_REF="${GITHUB_SHA:-master}"
    echo "Detected LizardByte/actions repository, using commit: ${CLEANUP_REF}"
else
    # Running in a different repository - use master
    CLEANUP_REF="master"
fi

# Download the cleanup script from more_space action
# Using the raw GitHub URL to get the script from the same repository
CLEANUP_SCRIPT_URL="https://raw.githubusercontent.com/LizardByte/actions/${CLEANUP_REF}/actions/more_space/cleanup.sh"
CLEANUP_SCRIPT="/tmp/cleanup_more_space.sh"

echo "Downloading cleanup script from more_space action..."
if curl -fsSL -o "${CLEANUP_SCRIPT}" "${CLEANUP_SCRIPT_URL}"; then
    echo "✓ Downloaded cleanup script"
else
    echo "✗ Failed to download cleanup script, trying wget..."
    if wget -q -O "${CLEANUP_SCRIPT}" "${CLEANUP_SCRIPT_URL}"; then
        echo "✓ Downloaded cleanup script with wget"
    else
        echo "✗ Failed to download cleanup script"
        exit 1
    fi
fi

# Make the script executable
chmod +x "${CLEANUP_SCRIPT}"

# Run the cleanup script with options suitable for CUDA installation
# Clean most things but keep JVM which might be needed for tests
bash "${CLEANUP_SCRIPT}" \
    --remove-android=true \
    --remove-codeql=true \
    --remove-docker-images=true \
    --remove-docs-linux=true \
    --remove-dotnet=true \
    --remove-haskell=true \
    --remove-jvm=false \
    --remove-swift=true \
    --remove-tool-cache=true

# Clean up the downloaded script
rm -f "${CLEANUP_SCRIPT}"

echo ""
echo "Pre-CI cleanup complete!"
echo ""
