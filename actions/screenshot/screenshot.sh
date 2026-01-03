#!/bin/bash

set -euo pipefail

# Parse command line arguments
OUTPUT_PATH=""
DELAY=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --output-path=*)
      OUTPUT_PATH="${1#*=}"
      shift
      ;;
    --delay=*)
      DELAY="${1#*=}"
      shift
      ;;
    *)
      echo "Error: Unknown parameter: $1" >&2
      exit 1
      ;;
  esac
done

# Validate required arguments
if [[ -z "$OUTPUT_PATH" ]]; then
  echo "Error: --output-path is required" >&2
  echo "Usage: $0 --output-path=screenshot.png [--delay=1000]" >&2
  exit 1
fi

# Create output directory if needed
OUTPUT_DIR=$(dirname "$OUTPUT_PATH")
mkdir -p "$OUTPUT_DIR"

# Apply delay if specified
if [[ $DELAY -gt 0 ]]; then
  DELAY_SECONDS=$(echo "scale=3; $DELAY / 1000" | bc)
  echo "Waiting ${DELAY_SECONDS}s before taking screenshot..."
  sleep "$DELAY_SECONDS"
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Take screenshot based on OS
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  # Windows - call PowerShell script with DPI awareness
  powershell -File "$SCRIPT_DIR/screenshot.ps1" -OutputPath "$OUTPUT_PATH" -Delay "$DELAY"

elif [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS - use built-in screencapture
  # -x: no sound
  screencapture -x "$OUTPUT_PATH"
  echo "Screenshot saved to: $OUTPUT_PATH"

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux - use ImageMagick import

  # Check for display
  if [[ -z "${DISPLAY:-}" ]]; then
    echo "Error: DISPLAY environment variable is not set" >&2
    echo "Note: A display server must be running to take screenshots." >&2
    exit 1
  fi

  # Use ImageMagick import to capture screenshot
  if command -v import &> /dev/null; then
    import -window root "$OUTPUT_PATH"
    echo "Screenshot saved to: $OUTPUT_PATH"
  else
    echo "Error: ImageMagick 'import' command not found" >&2
    echo "Note: The setup action should have installed ImageMagick automatically." >&2
    exit 1
  fi

else
  echo "Error: Unsupported OS type: $OSTYPE" >&2
  exit 1
fi
