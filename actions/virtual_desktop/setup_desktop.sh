#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Constants
AYATANA="ayatana"
CINNAMON="cinnamon"
LEGACY="legacy"
OPENBOX="openbox"
PROCESS_START_TIMEOUT=15

# Default values
APPINDICATOR_VERSION="$AYATANA"
DISPLAY_NUM=99
DISPLAY_SIZE="1280x720"
ENVIRONMENT=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --appindicator-version=*)
      APPINDICATOR_VERSION="${1#*=}"
      shift
      ;;
    --display-size=*)
      DISPLAY_SIZE="${1#*=}"
      shift
      ;;
    --environment=*)
      ENVIRONMENT="${1#*=}"
      shift
      ;;
    *)
      echo -e "${RED}Error: Unknown parameter: $1${RESET}" >&2
      exit 1
      ;;
  esac
done

# Validate environment
VALID_ENVIRONMENTS=("budgie" "$CINNAMON" "fluxbox" "gnome" "lxde" "lxqt" "mate" "$OPENBOX" "plasma" "xfce")
VALID=false
for env in "${VALID_ENVIRONMENTS[@]}"; do
  if [[ "$ENVIRONMENT" == "$env" ]]; then
    VALID=true
    break
  fi
done

if [[ "$VALID" == "false" ]]; then
  echo -e "${RED}Error: Invalid environment '${ENVIRONMENT}'${RESET}" >&2
  echo -e "${YELLOW}Valid options: ${VALID_ENVIRONMENTS[*]}${RESET}" >&2
  exit 1
fi

# Validate appindicator-version
VALID_APPINDICATOR_VERSIONS=("${AYATANA}" "${LEGACY}")
VALID=false
for version in "${VALID_APPINDICATOR_VERSIONS[@]}"; do
  if [[ "$APPINDICATOR_VERSION" == "$version" ]]; then
    VALID=true
    break
  fi
done

if [[ "$VALID" == "false" ]]; then
  echo -e "${RED}Error: Invalid appindicator-version '${APPINDICATOR_VERSION}'${RESET}" >&2
  echo -e "${YELLOW}Valid options: ${VALID_APPINDICATOR_VERSIONS[*]}${RESET}" >&2
  exit 1
fi

# Parse display size
if [[ ! "$DISPLAY_SIZE" =~ ^[0-9]+x[0-9]+$ ]]; then
  echo -e "${RED}Error: Invalid display size format '${DISPLAY_SIZE}'${RESET}" >&2
  echo -e "${YELLOW}Expected format: WIDTHxHEIGHT (e.g., 1280x720)${RESET}" >&2
  exit 1
fi

WIDTH=$(echo "$DISPLAY_SIZE" | cut -d'x' -f1)
HEIGHT=$(echo "$DISPLAY_SIZE" | cut -d'x' -f2)

echo -e "${CYAN}Setting up virtual desktop environment...${RESET}"
echo -e "${CYAN}  Environment: ${ENVIRONMENT}${RESET}"
echo -e "${CYAN}  Display size: ${DISPLAY_SIZE}${RESET}"
echo -e "${CYAN}  Display: :${DISPLAY_NUM}${RESET}"

# Base dependencies for all environments
BASE_DEPS=(
  adwaita-icon-theme
  at-spi2-core
  dbus-x11
  gnome-icon-theme
  libnotify-bin
  libpulse0
  pulseaudio-utils
  x11-utils
  x11-xserver-utils
  xfonts-75dpi
  xfonts-100dpi
  xfonts-base
  xvfb
)

# Function to configure AppIndicator packages based on version
configure_appindicator() {
  local version="$1"

  if [[ "$version" == "${AYATANA}" ]]; then
    ENV_DEPS+=(
      ayatana-indicator-application
      gir1.2-ayatanaappindicator3-0.1
    )
    INDICATOR_SERVICE="/usr/libexec/ayatana-indicator-application/ayatana-indicator-application-service"
  elif [[ "$version" == "${LEGACY}" ]]; then
    ENV_DEPS+=(
      gir1.2-appindicator3-0.1
      indicator-application
    )
    INDICATOR_SERVICE="/usr/lib/x86_64-linux-gnu/indicator-application/indicator-application-service"
  fi

  return 0
}

# Session managers start their window manager and panel asynchronously. Wait
# for each required process instead of treating a fixed startup delay as proof
# that it failed.
wait_for_process() {
  local process_name="$1"
  local timeout_seconds="$2"
  local elapsed

  if pgrep -x "$process_name" > /dev/null 2>&1; then
    return 0
  fi

  echo -e "${BLUE}Waiting for ${process_name} to start...${RESET}"
  for ((elapsed = 0; elapsed < timeout_seconds; elapsed++)); do
    sleep 1
    if pgrep -x "$process_name" > /dev/null 2>&1; then
      return 0
    fi
  done

  return 1
}

# Desktop environment specific packages
echo -e "${BLUE}Configuring ${ENVIRONMENT} desktop environment...${RESET}"

START_BUDGIE_COMPONENTS=false
VERIFY_NOTIFICATION_SERVICE=false

case "$ENVIRONMENT" in
  budgie)
    # Budgie - modern GTK desktop with an integrated panel and notifications
    ENV_DEPS=(
      budgie-desktop
      budgie-desktop-environment
      budgie-indicator-applet
    )
    # The stock session treats hardware-dependent services as required and
    # displays a fatal-error overlay when one of them fails on a headless
    # runner. Start Budgie's three core components directly instead.
    WM_COMMAND="budgie-wm"
    WM_PROCESS="budgie-wm"
    PANEL_COMMAND="budgie-panel"
    PANEL_PROCESS="budgie-panel"
    NOTIF_COMMAND=""  # notifications are provided by Budgie
    INDICATOR_SERVICE=""
    START_BUDGIE_COMPONENTS=true
    ;;

  "$CINNAMON")
    # Cinnamon - modern, full-featured desktop with an integrated panel
    ENV_DEPS=(
      cinnamon-core
    )
    WM_COMMAND="cinnamon-session-cinnamon"
    WM_PROCESS="$CINNAMON"
    PANEL_COMMAND=""  # cinnamon-session starts the panel automatically
    PANEL_PROCESS="$CINNAMON"
    NOTIF_COMMAND=""  # notifications are provided by Cinnamon
    INDICATOR_SERVICE=""
    ;;

  fluxbox)
    # Fluxbox - lightweight window manager with built-in toolbar
    ENV_DEPS=(
      dunst
      fluxbox
      stalonetray
    )
    WM_COMMAND="fluxbox"
    WM_PROCESS="fluxbox"
    PANEL_COMMAND="stalonetray"
    PANEL_PROCESS="stalonetray"
    NOTIF_COMMAND="dunst"
    INDICATOR_SERVICE=""
    ;;

  gnome)
    # GNOME - modern desktop with AppIndicator support provided by an extension
    ENV_DEPS=(
      gnome-session
      gnome-shell-extension-appindicator
      notification-daemon
    )
    WM_COMMAND="gnome-session --session=gnome"
    WM_PROCESS="gnome-shell"
    PANEL_COMMAND=""  # GNOME Shell provides the panel
    PANEL_PROCESS="gnome-shell"
    # GNOME Shell does not claim the notification service when its session is
    # launched outside a login manager, so provide a headless-safe fallback.
    NOTIF_COMMAND="/usr/lib/notification-daemon/notification-daemon"
    INDICATOR_SERVICE=""
    VERIFY_NOTIFICATION_SERVICE=true
    ;;

  lxde)
    # LXDE - very lightweight, basic tray support
    ENV_DEPS=(
      lxde
      lxsession
      notification-daemon
      policykit-1
      policykit-1-gnome
    )
    WM_COMMAND="startlxde"
    WM_PROCESS="lxsession"
    PANEL_COMMAND=""  # lxsession starts lxpanel automatically
    PANEL_PROCESS="lxpanel"
    NOTIF_COMMAND="/usr/lib/notification-daemon/notification-daemon"
    INDICATOR_SERVICE=""
    ;;

  lxqt)
    # LXQt - modern, lightweight Qt desktop
    ENV_DEPS=(
      lxqt-core
      "$OPENBOX"
    )
    WM_COMMAND="startlxqt"
    WM_PROCESS="$OPENBOX"
    PANEL_COMMAND="lxqt-panel"
    PANEL_PROCESS="lxqt-panel"
    NOTIF_COMMAND="lxqt-notificationd"
    INDICATOR_SERVICE=""
    ;;

  mate)
    # MATE - full-featured desktop, fork of GNOME 2, excellent tray support
    ENV_DEPS=(
      mate-applet-brisk-menu
      mate-applets
      mate-desktop-environment-core
      mate-icon-theme
      mate-indicator-applet
      mate-notification-daemon
      mate-panel
      mate-themes
    )

    # Add AppIndicator packages based on version
    configure_appindicator "$APPINDICATOR_VERSION"

    WM_COMMAND="mate-session"
    WM_PROCESS="mate-session"
    PANEL_COMMAND=""  # mate-session starts panel automatically
    PANEL_PROCESS="mate-panel"
    NOTIF_COMMAND="/usr/libexec/mate-notification-daemon/mate-notification-daemon"
    ;;

  "$OPENBOX")
    # Openbox - minimal window manager with tint2 panel for tray
    ENV_DEPS=(
      dunst
      "$OPENBOX"
      tint2
    )
    WM_COMMAND="$OPENBOX"
    WM_PROCESS="$OPENBOX"
    PANEL_COMMAND="tint2"
    PANEL_PROCESS="tint2"
    NOTIF_COMMAND="dunst"
    INDICATOR_SERVICE=""
    ;;

  plasma)
    # KDE Plasma - modern Qt desktop with an integrated panel and notifications
    ENV_DEPS=(
      kwin-x11
      plasma-desktop
      plasma-workspace
    )
    WM_COMMAND="startplasma-x11"
    WM_PROCESS="kwin_x11"
    PANEL_COMMAND=""  # Plasma starts plasmashell automatically
    PANEL_PROCESS="plasmashell"
    NOTIF_COMMAND=""  # notifications are provided by Plasma
    INDICATOR_SERVICE=""
    ;;

  xfce)
    # XFCE - lightweight, full-featured, excellent tray support
    ENV_DEPS=(
      xfce4
      xfce4-indicator-plugin
      xfce4-notifyd
    )

    # Add AppIndicator packages based on version
    configure_appindicator "$APPINDICATOR_VERSION"

    WM_COMMAND="xfce4-session"
    WM_PROCESS="xfce4-session"
    PANEL_COMMAND=""  # xfce4-session starts panel automatically
    PANEL_PROCESS="xfce4-panel"
    NOTIF_COMMAND="/usr/lib/x86_64-linux-gnu/xfce4/notifyd/xfce4-notifyd"
    ;;

  *)
    echo -e "${RED}Error: Unsupported environment '${ENVIRONMENT}'${RESET}" >&2
    exit 1
    ;;
esac

# Combine base and environment-specific dependencies
ALL_DEPS=("${BASE_DEPS[@]}" "${ENV_DEPS[@]}")

# Install all dependencies in one command
echo -e "${BLUE}Installing all dependencies (${#ALL_DEPS[@]} packages)...${RESET}"
echo "::group::Installing dependencies"
sudo apt-get update -qq
sudo apt-get install -y -qq "${ALL_DEPS[@]}"
echo "::endgroup::"

# Clean up apt cache
echo -e "${BLUE}Cleaning up apt cache...${RESET}"
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*

# Start Xvfb
echo -e "${BLUE}Starting Xvfb on :${DISPLAY_NUM}...${RESET}"
Xvfb ":${DISPLAY_NUM}" -screen 0 "${WIDTH}x${HEIGHT}x24" -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 2

# Verify Xvfb is running
if ! ps -p $XVFB_PID > /dev/null; then
  echo -e "${RED}Error: Failed to start Xvfb${RESET}" >&2
  exit 1
fi

echo -e "${GREEN}✓ Xvfb started (PID: ${XVFB_PID})${RESET}"

# Set DISPLAY environment variable
export DISPLAY=":${DISPLAY_NUM}"
echo "DISPLAY=:${DISPLAY_NUM}" >> "$GITHUB_ENV"
export XDG_SESSION_TYPE="x11"
echo "XDG_SESSION_TYPE=x11" >> "$GITHUB_ENV"

# Session managers use ICE sockets for client lifecycle management.
sudo mkdir -p /tmp/.ICE-unix
sudo chmod 1777 /tmp/.ICE-unix

# Modern desktop sessions expect a private runtime directory. GitHub-hosted
# runners normally provide one, but self-hosted runners and containers may not.
if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  export XDG_RUNTIME_DIR="${RUNNER_TEMP:-/tmp}/virtual-desktop-runtime-${UID}"
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  echo "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" >> "$GITHUB_ENV"
fi

# Start D-Bus session (required for notifications and accessibility)
echo -e "${BLUE}Starting D-Bus session...${RESET}"

# Always start a new D-Bus session for this workflow
# Don't try to reuse existing dbus-daemon as it may not have the correct session address
eval "$(dbus-launch --sh-syntax)"

if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo -e "${GREEN}✓ D-Bus session started${RESET}"
  echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" >> "$GITHUB_ENV"
else
  echo -e "${RED}Error: Failed to start D-Bus session${RESET}" >&2
  exit 1
fi

# Start AT-SPI bus to fix accessibility warnings
echo -e "${BLUE}Starting accessibility bus...${RESET}"
if [[ -x "/usr/libexec/at-spi-bus-launcher" ]]; then
  /usr/libexec/at-spi-bus-launcher --launch-immediately &
  sleep 1
elif [[ -x "/usr/lib/at-spi2-core/at-spi-bus-launcher" ]]; then
  /usr/lib/at-spi2-core/at-spi-bus-launcher --launch-immediately &
  sleep 1
else
  echo -e "${YELLOW}⚠ AT-SPI bus launcher not found, accessibility may be limited${RESET}"
fi

# Start PulseAudio with dummy sink to fix audio warnings
echo -e "${BLUE}Starting PulseAudio with dummy sink...${RESET}"
pulseaudio --start --exit-idle-time=-1 > /dev/null 2>&1 || true
pactl load-module module-null-sink sink_name=dummy > /dev/null 2>&1 || true

# Start gnome-keyring for credential management
if [[ "$ENVIRONMENT" == "lxde" ]]; then
  echo -e "${BLUE}Starting gnome-keyring daemon...${RESET}"
  eval "$(gnome-keyring-daemon --start --components=pkcs11,secrets,ssh 2>/dev/null)"
  export SSH_AUTH_SOCK
  echo "SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$GITHUB_ENV"
fi

# GNOME's AppIndicator extension is installed system-wide but is not enabled in
# a plain GNOME session by default.
if [[ "$ENVIRONMENT" == "gnome" ]]; then
  echo -e "${BLUE}Enabling GNOME AppIndicator extension...${RESET}"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "['ubuntu-appindicators@ubuntu.com']"
fi

# Composited desktops need Mesa software rendering when running under Xvfb.
if [[ "$ENVIRONMENT" == "budgie" ]] || [[ "$ENVIRONMENT" == "$CINNAMON" ]] || \
   [[ "$ENVIRONMENT" == "gnome" ]] || [[ "$ENVIRONMENT" == "plasma" ]]; then
  export LIBGL_ALWAYS_SOFTWARE=1
fi

# Start window manager in background
echo -e "${BLUE}Starting ${ENVIRONMENT} window manager...${RESET}"

if [[ "$START_BUDGIE_COMPONENTS" == "true" ]]; then
  export XDG_CURRENT_DESKTOP="Budgie:GNOME"
  echo "XDG_CURRENT_DESKTOP=$XDG_CURRENT_DESKTOP" >> "$GITHUB_ENV"
fi

$WM_COMMAND &
WM_PID=$!

# Budgie's background service provides Raven notifications and the
# StatusNotifier host without pulling in hardware-dependent session services.
if [[ "$START_BUDGIE_COMPONENTS" == "true" ]]; then
  budgie-daemon &
fi

# lxqt-session delegates these components to XDG autostart. That is not
# consistently available on headless runners without a user systemd session,
# so start the missing core components explicitly.
if [[ "$ENVIRONMENT" == "lxqt" ]]; then
  if ! pgrep -x "$OPENBOX" > /dev/null 2>&1; then
    "$OPENBOX" &
  fi
  if ! pgrep -x "pcmanfm-qt" > /dev/null 2>&1; then
    pcmanfm-qt --desktop --profile=lxqt &
  fi
fi

# Give session managers more time to start all components
if [[ "$ENVIRONMENT" == "budgie" ]] || [[ "$ENVIRONMENT" == "$CINNAMON" ]] || \
   [[ "$ENVIRONMENT" == "gnome" ]] || [[ "$ENVIRONMENT" == "lxde" ]] || \
   [[ "$ENVIRONMENT" == "lxqt" ]] || [[ "$ENVIRONMENT" == "mate" ]] || \
   [[ "$ENVIRONMENT" == "plasma" ]] || [[ "$ENVIRONMENT" == "xfce" ]]; then
  sleep 5  # Session managers need more time to start panels, notification daemons, etc.
else
  sleep 2
fi

# Verify window manager is running
if ps -p $WM_PID > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Window manager started (PID: ${WM_PID})${RESET}"
else
  echo -e "${YELLOW}⚠ Window manager may have daemonized or exited${RESET}"
fi

# Configure XFCE panel for indicator support
if [[ "$ENVIRONMENT" == "xfce" ]] && [[ -n "${INDICATOR_SERVICE:-}" ]]; then
  echo -e "${BLUE}Configuring XFCE panel for AppIndicator support...${RESET}"

  # Wait for panel to be fully initialized
  sleep 2

  # Add the indicator plugin to XFCE panel
  # The plugin ID is usually "indicator" and we add it to panel-1 (default panel)
  xfconf-query -c xfce4-panel -p /panels/panel-1/plugin-ids -t int -s 1 -t int -s 2 -t int -s 3 -t int -s 4 -t int -s 5 -t int -s 99 --create 2>/dev/null || true
  xfconf-query -c xfce4-panel -p /plugins/plugin-99 -t string -s indicator --create 2>/dev/null || true

  # Restart xfce4-panel to apply changes
  xfce4-panel -r 2>/dev/null || true
  sleep 2

  echo -e "${GREEN}✓ XFCE panel configured for indicators${RESET}"
fi

# Start panel/tray (if different from WM)
if [[ "$PANEL_COMMAND" != "$WM_COMMAND" ]] && [[ -n "$PANEL_COMMAND" ]]; then
  PANEL_COMMAND_PROCESS="${PANEL_COMMAND%% *}"
  if pgrep -x "$PANEL_COMMAND_PROCESS" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Panel already running${RESET}"
  else
    echo -e "${BLUE}Starting panel/tray...${RESET}"
    $PANEL_COMMAND &
    PANEL_PID=$!
    sleep 1

    if ps -p $PANEL_PID > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Panel started (PID: ${PANEL_PID})${RESET}"
    else
      echo -e "${YELLOW}⚠ Panel may have daemonized or exited${RESET}"
    fi
  fi
fi

# A session launcher can remain alive even when its shell or panel failed. Check
# the user-visible components before reporting success to downstream steps.
if ! wait_for_process "$WM_PROCESS" "$PROCESS_START_TIMEOUT"; then
  echo -e "${RED}Error: ${ENVIRONMENT} window manager did not start (${WM_PROCESS})${RESET}" >&2
  exit 1
fi

if ! wait_for_process "$PANEL_PROCESS" "$PROCESS_START_TIMEOUT"; then
  echo -e "${RED}Error: ${ENVIRONMENT} panel did not start (${PANEL_PROCESS})${RESET}" >&2
  exit 1
fi

if [[ "$START_BUDGIE_COMPONENTS" == "true" ]] && \
   ! wait_for_process "budgie-daemon" "$PROCESS_START_TIMEOUT"; then
  echo -e "${RED}Error: Budgie background service did not start (budgie-daemon)${RESET}" >&2
  exit 1
fi

# Start notification daemon
if [[ -n "$NOTIF_COMMAND" ]]; then
  NOTIF_PROCESS=$(basename "${NOTIF_COMMAND%% *}")
  if pgrep -f "(^|/)${NOTIF_PROCESS}([[:space:]]|$)" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Notification daemon already running${RESET}"
  else
    echo -e "${BLUE}Starting notification daemon...${RESET}"

    # Check if the command exists first
    if command -v "$NOTIF_COMMAND" &> /dev/null || [[ -x "$NOTIF_COMMAND" ]]; then
      $NOTIF_COMMAND &
      NOTIF_PID=$!
      sleep 2

      if ps -p $NOTIF_PID > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Notification daemon started (PID: ${NOTIF_PID})${RESET}"
      else
        echo -e "${YELLOW}⚠ Notification daemon may have daemonized or exited${RESET}"
      fi
    else
      echo -e "${YELLOW}⚠ Notification daemon not found: ${NOTIF_COMMAND}${RESET}"
    fi
  fi
fi

# GNOME's fallback must own the notification service before downstream steps
# run because notify-send fails immediately when no implementation is present.
if [[ "$VERIFY_NOTIFICATION_SERVICE" == "true" ]] && \
   ! dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply \
     /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner \
     string:org.freedesktop.Notifications | grep -q "boolean true"; then
  echo -e "${RED}Error: GNOME notification service did not start${RESET}" >&2
  exit 1
fi

# Start indicator application service (for AppIndicator support)
# In CI environments, D-Bus activation doesn't always work reliably, so we start the service manually
# after giving the panel time to initialize its indicator applet
# Note: For MATE with legacy indicators, we skip this as they use the notification area instead
if [[ -n "${INDICATOR_SERVICE:-}" ]]; then
  # Skip for MATE + legacy combination (uses notification area instead)
  if [[ "$ENVIRONMENT" == "mate" ]] && [[ "$APPINDICATOR_VERSION" == "${LEGACY}" ]]; then
    echo -e "${BLUE}Legacy indicators for MATE will use the notification area (system tray)${RESET}"
    echo -e "${CYAN}  No indicator service needed${RESET}"
  else
    echo -e "${BLUE}Starting indicator application service...${RESET}"

    if [[ -x "$INDICATOR_SERVICE" ]]; then
      # Wait for the panel's indicator applet to be ready
      sleep 3

      # Start the service
      $INDICATOR_SERVICE &
      INDICATOR_PID=$!
      sleep 3

      if ps -p $INDICATOR_PID > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Indicator service started (PID: ${INDICATOR_PID})${RESET}"
      else
        # Service may have daemonized, check if it's running by name
        if pgrep -f "$(basename "$INDICATOR_SERVICE")" > /dev/null 2>&1; then
          echo -e "${GREEN}✓ Indicator service is running (daemonized)${RESET}"
        else
          echo -e "${YELLOW}⚠ Indicator service may have exited${RESET}"
          exit 1
        fi
      fi
    else
      echo -e "${RED}✗ Indicator service not found or not executable: ${INDICATOR_SERVICE}${RESET}" >&2
      echo -e "${YELLOW}  Checking if file exists...${RESET}"
      ls -la "$(dirname "$INDICATOR_SERVICE")" 2>&1 || true
      exit 1
    fi
  fi
fi

# Verify X server is responding
echo -e "${BLUE}Verifying X server...${RESET}"
if xdpyinfo -display ":${DISPLAY_NUM}" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ X server is responding${RESET}"
else
  echo -e "${RED}Error: X server is not responding${RESET}" >&2
  exit 1
fi


# Output information
echo ""
echo -e "${GREEN}Virtual desktop setup complete!${RESET}"
echo -e "${CYAN}Configuration:${RESET}"
echo -e "${CYAN}  Display: :${DISPLAY_NUM}${RESET}"
echo -e "${CYAN}  Resolution: ${WIDTH}x${HEIGHT}x24${RESET}"
echo -e "${CYAN}  Environment: ${ENVIRONMENT}${RESET}"
echo -e "${CYAN}  Xvfb PID: ${XVFB_PID}${RESET}"

# Output to GitHub Actions
echo "display=:${DISPLAY_NUM}" >> "${GITHUB_OUTPUT}"
echo "xvfb-pid=${XVFB_PID}" >> "${GITHUB_OUTPUT}"

echo ""
echo -e "${CYAN}You can now run GUI applications with DISPLAY=:${DISPLAY_NUM}${RESET}"
