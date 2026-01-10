#!/bin/bash

set -euo pipefail

echo "Verifying screenshot was created..."

SCREENSHOT_NAME="screenshot.png"

# Check if screenshot.png exists
if [[ -f "$SCREENSHOT_NAME" ]]; then
    echo "✓ $SCREENSHOT_NAME exists"

    # Get file size
    if [[ "$OSTYPE" == "darwin"* ]]; then
        FILE_SIZE=$(stat -f%z "$SCREENSHOT_NAME")
    else
        FILE_SIZE=$(stat -c%s "$SCREENSHOT_NAME" 2>/dev/null || stat -f%z "$SCREENSHOT_NAME")
    fi

    echo "  File size: ${FILE_SIZE} bytes"

    # Verify file is not empty
    if [[ $FILE_SIZE -eq 0 ]]; then
        echo "✗ $SCREENSHOT_NAME is empty (0 bytes)"
        exit 1
    fi

    # Verify file is a reasonable size (at least 100 bytes for a valid PNG)
    if [[ $FILE_SIZE -lt 100 ]]; then
        echo "✗ $SCREENSHOT_NAME is too small (${FILE_SIZE} bytes), likely not a valid PNG"
        exit 1
    fi

    echo "✓ $SCREENSHOT_NAME is valid (${FILE_SIZE} bytes)"
else
    echo "✗ $SCREENSHOT_NAME not found"
    exit 1
fi

echo ""
echo "Screenshot validation successful!"
