#!/bin/bash

set -euo pipefail

echo "Pre-CI: Setting up display for screenshot tests..."

# Only need to setup display on Linux
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo "Detected Linux - setting up virtual display..."

  # Install xvfb if not already present
  if ! command -v Xvfb &> /dev/null; then
    echo "Installing Xvfb..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq xvfb
    sudo apt-get clean
    sudo rm -rf /var/lib/apt/lists/*
  fi

  # Start Xvfb on display :99
  echo "Starting Xvfb virtual display on :99..."
  Xvfb :99 -screen 0 1024x768x24 &
  XVFB_PID=$!

  # Save PID for cleanup in post-ci
  echo "$XVFB_PID" > /tmp/xvfb_screenshot.pid

  # Set DISPLAY environment variable
  export DISPLAY=:99
  echo "DISPLAY=$DISPLAY" >> "$GITHUB_ENV"

  # Wait a moment for Xvfb to start
  sleep 2

  # Verify Xvfb is running
  if ps -p $XVFB_PID > /dev/null; then
    echo "✓ Xvfb is running (PID: $XVFB_PID)"
    echo "✓ DISPLAY set to :99"
  else
    echo "✗ Failed to start Xvfb"
    exit 1
  fi

  # Optional: Start a simple window manager for more realistic testing
  if command -v fluxbox &> /dev/null; then
    echo "Starting fluxbox window manager..."
    fluxbox &
    sleep 1
  fi

else
  echo "Not Linux - no display setup needed"
  echo "OS: $OSTYPE"
fi

echo ""
echo "Display setup complete!"
