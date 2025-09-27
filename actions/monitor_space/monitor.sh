#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Default values
MODE=""
STORAGE_PATH=""

# Function to get available disk space in GB
get_disk_space_gb() {
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows - get free space in GB
    powershell -Command \
      "(Get-WmiObject -Class Win32_LogicalDisk | Where-Object {\$_.DeviceID -eq 'C:'}).FreeSpace / 1GB" | tr -d '\r'
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - get available space in GB (df reports in 512-byte blocks by default)
    df / | tail -1 | awk '{printf "%.2f", $4/2048/1024}'
  else
    # Linux - get available space in GB
    df --output=avail / | tail -1 | awk '{printf "%.2f", $1/1024/1024}'
  fi
}

# Function to get current timestamp
get_timestamp() {
  date +%s
}

# Function to start monitoring
start_monitoring() {
  local current_space start_time
  current_space=$(get_disk_space_gb)
  start_time=$(get_timestamp)

  echo -e "${BLUE}Starting disk space monitoring...${RESET}"
  echo -e "${CYAN}Current free space: ${current_space} GB${RESET}"

  # Create monitoring data file
  local monitor_file="${STORAGE_PATH}/monitor_space_data.txt"
  echo "${start_time},${current_space},${current_space}" > "$monitor_file"

  # Start background monitoring process
  (
    while true; do
      sleep 5  # Check every 5 seconds
      if [[ ! -f "$monitor_file" ]]; then
        break  # Stop if monitoring file is removed
      fi

      local space timestamp min_space
      space=$(get_disk_space_gb)
      timestamp=$(get_timestamp)

      # Read current minimum from file
      min_space=$(tail -1 "$monitor_file" | cut -d',' -f3)

      # Update minimum if current space is lower
      if (( $(awk "BEGIN {print ($space < $min_space)}") )); then
        min_space="$space"
      fi

      # Append to monitoring file
      echo "${timestamp},${space},${min_space}" >> "$monitor_file"
    done
  ) &

  # Store the background process PID
  local pid=$!
  echo "$pid" > "${STORAGE_PATH}/monitor_space_pid.txt"

  echo -e "${GREEN}Background monitoring started (PID: $pid)${RESET}"

  # Set GitHub Actions outputs
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "current-space=${current_space}"
      echo "minimum-space=${current_space}"
      echo "space-consumed=0.00"
      echo "monitoring-duration=0"
    } >> "${GITHUB_OUTPUT}"
  fi
}

# Function to stop monitoring and report results
stop_monitoring() {
  local monitor_file="${STORAGE_PATH}/monitor_space_data.txt"
  local pid_file="${STORAGE_PATH}/monitor_space_pid.txt"

  if [[ ! -f "$monitor_file" ]]; then
    echo -e "${RED}Error: No monitoring data found. Did you start monitoring first?${RESET}"
    exit 1
  fi

  # Stop background process if it's still running
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo -e "${YELLOW}Stopped background monitoring process (PID: $pid)${RESET}"
    fi
    rm -f "$pid_file"
  fi

  # Process monitoring data
  local start_time end_time duration current_space min_space max_consumed
  start_time=$(head -1 "$monitor_file" | cut -d',' -f1)
  end_time=$(tail -1 "$monitor_file" | cut -d',' -f1)
  duration=$((end_time - start_time))

  current_space=$(get_disk_space_gb)
  min_space=$(tail -1 "$monitor_file" | cut -d',' -f3)

  # Calculate maximum space consumed (start space - minimum space)
  local start_space
  start_space=$(head -1 "$monitor_file" | cut -d',' -f2)
  max_consumed=$(awk "BEGIN {printf \"%.2f\", $start_space - $min_space}")

  echo -e "${BLUE}Disk Space Monitoring Report${RESET}"
  echo -e "${CYAN}============================${RESET}"
  echo -e "Current free space: ${GREEN}${current_space} GB${RESET}"
  echo -e "Minimum free space: ${GREEN}${min_space} GB${RESET}"
  echo -e "Maximum space consumed: ${GREEN}${max_consumed} GB${RESET}"
  echo -e "Monitoring duration: ${GREEN}${duration} seconds${RESET}"

  # Set GitHub Actions outputs
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "current-space=${current_space}"
      echo "minimum-space=${min_space}"
      echo "space-consumed=${max_consumed}"
      echo "monitoring-duration=${duration}"
    } >> "${GITHUB_OUTPUT}"
  fi

  # Clean up monitoring files
  rm -f "$monitor_file"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    --storage-path=*)
      STORAGE_PATH="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Set default storage path if not provided
if [[ -z "$STORAGE_PATH" ]]; then
  if [[ -n "${GITHUB_WORKSPACE:-}" ]]; then
    STORAGE_PATH="${GITHUB_WORKSPACE}/.monitor_space"
  else
    STORAGE_PATH="/tmp/monitor_space"
  fi
fi

# Create storage directory if it doesn't exist
mkdir -p "$STORAGE_PATH"

# Execute based on mode
case "$MODE" in
  start)
    start_monitoring
    ;;
  stop)
    stop_monitoring
    ;;
  *)
    echo -e "${RED}Error: Invalid mode '$MODE'. Use 'start' or 'stop'.${RESET}"
    exit 1
    ;;
esac
