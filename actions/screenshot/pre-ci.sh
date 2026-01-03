#!/bin/bash

set -euo pipefail

echo "Pre-CI: Setting up display for screenshot tests..."

# Only need to setup display on Linux
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo "Detected Linux - setting up virtual desktop..."

  # Call the setup_virtual_desktop action's setup script
  chmod +x ./actions/setup_virtual_desktop/setup_desktop.sh
  ./actions/setup_virtual_desktop/setup_desktop.sh \
    --environment=xfce \
    --display-size=1280x720

else
  echo "Not Linux - no display setup needed"
  echo "OS: $OSTYPE"
fi

echo ""
echo "Pre-CI setup complete!"
