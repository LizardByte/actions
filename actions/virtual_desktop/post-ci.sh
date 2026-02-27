#!/bin/bash

set -euo pipefail

echo "Verifying virtual desktop setup..."

# Check if DISPLAY is set
if [[ -z "${DISPLAY:-}" ]]; then
  echo "✗ DISPLAY environment variable not set"
  exit 1
fi

echo "✓ DISPLAY is set to: $DISPLAY"

# Check D-Bus session address is set
echo ""
echo "Checking D-Bus session..."
if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo "✗ DBUS_SESSION_BUS_ADDRESS is not set"
  exit 1
fi

echo "✓ DBUS_SESSION_BUS_ADDRESS is set to: $DBUS_SESSION_BUS_ADDRESS"

# Verify D-Bus is working
if dbus-send --session --dest=org.freedesktop.DBus --print-reply /org/freedesktop/DBus \
   org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
  echo "✓ D-Bus session is responding"
else
  echo "✗ D-Bus session is not responding"
  exit 1
fi

# Check if X server is responding
if xdpyinfo > /dev/null 2>&1; then
  echo "✓ X server is responding"
else
  echo "✗ X server is not responding"
  exit 1
fi

# Get display information
echo ""
echo "Display information:"
xdpyinfo | grep -E "dimensions|resolution" || true

# Check if notify-send is available
if command -v notify-send &> /dev/null; then
  echo "✓ notify-send is available"

  # Try sending a test notification
  if notify-send "Test Notification" "Virtual desktop is working!" 2>/dev/null; then
    echo "✓ Notification sent successfully"
  else
    echo "✗ Notification command ran but may not be visible"
    exit 1
  fi
else
  echo "✗ notify-send not found"
  exit 1
fi

# Check for running window manager
echo ""
echo "Checking for window manager..."
WM_FOUND=false

for wm in fluxbox lxsession mate-session openbox xfce4-session; do
  if pgrep -x "$wm" > /dev/null 2>&1; then
    echo "✓ Found window manager: $wm"
    WM_FOUND=true
    break
  fi
done

if [[ "$WM_FOUND" = false ]]; then
  echo "✗ No window manager found running (may have daemonized)"
  exit 1
fi

# Check for panel/tray
echo ""
echo "Checking for panel/tray..."
PANEL_FOUND=false

for panel in lxpanel mate-panel stalonetray tint2 xfce4-panel; do
  if pgrep -x "$panel" > /dev/null 2>&1; then
    echo "✓ Found panel: $panel"
    PANEL_FOUND=true
    break
  fi
done

if [[ "$PANEL_FOUND" = false ]]; then
  echo "✗ No panel found running (may have daemonized or integrated)"
  exit 1
fi

# Check for AppIndicator service (MATE/XFCE only, except MATE with legacy)
echo ""
echo "Checking for AppIndicator service..."

# Check what environment and version we're using
IS_MATE=false
IS_XFCE=false
if pgrep -x "mate-session" > /dev/null 2>&1; then
  IS_MATE=true
elif pgrep -x "xfce4-session" > /dev/null 2>&1; then
  IS_XFCE=true
fi

if pgrep -f "ayatana-indicator-application-service" > /dev/null 2>&1; then
  echo "✓ Ayatana AppIndicator service is running"

  # Verify it's registered on D-Bus (ayatana uses org.ayatana.indicator.application)
  if dbus-send --session --dest=org.freedesktop.DBus --print-reply /org/freedesktop/DBus \
     org.freedesktop.DBus.ListNames 2>/dev/null | grep -q "org.ayatana.indicator.application"; then
    echo "✓ Ayatana AppIndicator service is registered on D-Bus"
  else
    echo "✗ Ayatana AppIndicator service running but not registered on D-Bus"
    exit 1
  fi
elif pgrep -f "indicator-application-service" > /dev/null 2>&1; then
  echo "✓ Legacy AppIndicator service is running"

  # Verify it's registered on D-Bus (legacy uses com.canonical.indicator.application)
  if dbus-send --session --dest=org.freedesktop.DBus --print-reply /org/freedesktop/DBus \
     org.freedesktop.DBus.ListNames 2>/dev/null | grep -q "com.canonical.indicator.application"; then
    echo "✓ Legacy AppIndicator service is registered on D-Bus"
  else
    echo "✗ Legacy AppIndicator service running but not registered on D-Bus"
    exit 1
  fi
elif [[ "$IS_MATE" == "true" ]] || [[ "$IS_XFCE" == "true" ]]; then
  # For MATE with legacy indicators, the notification area is used instead of indicator service
  if [[ "$IS_MATE" == "true" ]]; then
    # Check if mate-indicator-applet is running (only for Ayatana)
    if pgrep -f "mate-indicator-applet" > /dev/null 2>&1; then
      echo "⚠ MATE with Ayatana indicators detected but service not running"
      echo "  This is expected if using the 'legacy' appindicator-version input"
    else
      echo "ℹ MATE session detected - using notification area for indicators"
      echo "  (Legacy indicators use the system tray, not the indicator service)"
    fi
  else
    echo "✗ XFCE session detected but AppIndicator service not running"
    exit 1
  fi
else
  echo "ℹ AppIndicator service not expected (not MATE/XFCE environment)"
fi

echo ""
echo "Virtual desktop validation successful!"
