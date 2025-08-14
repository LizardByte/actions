#!/bin/bash

set -euo pipefail

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

# Function to display disk space info
get_disk_space() {
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows
    powershell -Command "Get-WmiObject -Class Win32_LogicalDisk | Select-Object Size,FreeSpace"
  else
    # Linux/macOS
    df -h /
  fi
}

# Function to measure space saved by a specific operation (for input categories)
measure_space_saved() {
  local operation_name="$1"
  shift
  local before_space after_space space_freed
  before_space=$(get_disk_space_gb)
  echo -e "${CYAN}Running: $operation_name...${RESET}"
  "$@"
  after_space=$(get_disk_space_gb)
  space_freed=$(awk "BEGIN {printf \"%.2f\", $after_space - $before_space}")
  echo -e "${GREEN}$operation_name: Total space freed: ${space_freed} GB${RESET}"

  # Store analysis data if analyze-space-savings is enabled
  if [[ "$ANALYZE_SPACE_SAVINGS" == "true" ]]; then
    SPACE_ANALYSIS_DATA+=("$operation_name:$space_freed")
  fi

  # Set individual output for this operation
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    local output_name
    output_name=$(echo "$operation_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
    echo "${output_name}-space-saved=${space_freed}" >> "${GITHUB_OUTPUT}"
  fi
}

# Function to measure space saved by individual commands within functions
with_space_saved() {
  local command_name="$1"
  shift
  local before_space after_space space_freed
  before_space=$(get_disk_space_gb)

  # Extract directory path if it's a safe_remove command
  local dir_info=""
  if [[ "$1" == "safe_remove" && -n "$2" ]]; then
    dir_info=" (${2})"
  fi

  echo -e "  ${CYAN}→ $command_name${dir_info}${RESET}"
  "$@"
  after_space=$(get_disk_space_gb)
  space_freed=$(awk "BEGIN {printf \"%.2f\", $after_space - $before_space}")
  if (( $(awk "BEGIN {print ($space_freed > 0.01)}") )); then
    echo -e "  ${GREEN}  Space freed: ${space_freed} GB${RESET}"
  else
    echo -e "  ${YELLOW}  Space freed: ${space_freed} GB${RESET}"
  fi
}

# Helper function to convert Windows paths to Unix style
convert_to_unix_path() {
  local path="$1"
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    if command -v cygpath &>/dev/null; then
      cygpath -u "$path"
    else
      echo "$path"
    fi
  else
    echo "$path"
  fi
}

# Helper: check if a file/dir contains a safe package
is_safe_package() {
  local path="$1"
  [[ -z "$SAFE_PACKAGES" ]] && return 1

  # Convert to Unix style path for consistent comparison
  local unix_path
  unix_path=$(convert_to_unix_path "$path")

  # Convert to lowercase for case-insensitive comparison on Windows
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    unix_path=$(echo "$unix_path" | tr '[:upper:]' '[:lower:]')
  fi

  IFS=',' read -ra PKGS <<< "$SAFE_PACKAGES"
  for pkg in "${PKGS[@]}"; do
    pkg=$(echo "$pkg" | xargs) # trim whitespace
    [[ -z "$pkg" ]] && continue

    # Try to find the package executable
    local pkg_path=""
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
      # Windows: try multiple methods to find the executable
      if command -v where &>/dev/null; then
        pkg_path=$(where "$pkg" 2>/dev/null | head -1 || where "${pkg}.exe" 2>/dev/null | head -1 || true)
      fi
      # Fallback to which if where doesn't work
      if [[ -z "$pkg_path" ]] && command -v which &>/dev/null; then
        pkg_path=$(which "$pkg" 2>/dev/null || which "${pkg}.exe" 2>/dev/null || true)
      fi
      # Convert to Unix style path if found
      if [[ -n "$pkg_path" ]]; then
        pkg_path=$(convert_to_unix_path "$pkg_path")
        # Convert to lowercase for case-insensitive comparison
        pkg_path=$(echo "$pkg_path" | tr '[:upper:]' '[:lower:]')
      fi
    else
      # Unix: use which
      pkg_path=$(which "$pkg" 2>/dev/null || true)
    fi

    # Check if the package path starts with the directory path
    if [[ -n "$pkg_path" && "$pkg_path" == $unix_path* ]]; then
      echo "Found safe package '$pkg' at $pkg_path (protecting $path)"
      return 0
    fi
  done
  return 1
}

# Function to safely remove directory
safe_remove() {
  local dir="$1"

  # Convert to Unix style path for consistent handling
  local unix_dir
  unix_dir=$(convert_to_unix_path "$dir")

  if [[ -d "$dir" ]]; then
    if [[ -n "$SAFE_PACKAGES" ]]; then
      local safe_pkg
      if safe_pkg=$(is_safe_package "$dir"); then
        echo -e "${YELLOW}Skipping $dir ($safe_pkg)${RESET}"
        return
      fi
    fi

    ${SUDO_CMD} rm -rf "$unix_dir"
  else
    echo -e "    ${RED}Directory does not exist: $dir${RESET}"
  fi
}

# Function to remove Android SDK
remove_android() {
  echo -e "${BOLD}${YELLOW}==> Removing Android SDK${RESET}"

  # Check if ANDROID_HOME is defined
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    # TODO: The space freed calculation on Windows reports 0.00 GB
    with_space_saved "Remove ANDROID_HOME" safe_remove "${ANDROID_HOME}"
  fi
}

# Function to remove Chocolatey (Windows only)
remove_chocolatey() {
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    echo -e "${BOLD}${YELLOW}==> Removing Chocolatey${RESET}"
    with_space_saved "Remove Chocolatey" safe_remove "/c/ProgramData/Chocolatey"
  fi
}

# Function to remove CodeQL
remove_codeql() {
  echo -e "${BOLD}${YELLOW}==> Removing CodeQL${RESET}"

  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    with_space_saved "Remove CodeQL" safe_remove "${HOSTEDTOOLCACHE}/windows/CodeQL"
  else
    with_space_saved "Remove CodeQL" safe_remove "${HOSTEDTOOLCACHE}/CodeQL"
  fi
}

# Function to remove Docker images
remove_docker_images() {
  echo -e "${BOLD}${YELLOW}==> Removing Docker images${RESET}"

  if command -v docker &> /dev/null; then
    with_space_saved "Remove docker images" bash -c "${SUDO_CMD} docker image prune --all --force"
    with_space_saved "Docker system prune" bash -c "${SUDO_CMD} docker system prune -af --volumes"

    # Restart Docker to ensure clean state
    if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" ]]; then
      with_space_saved "Restart Docker service" bash -c "${SUDO_CMD} systemctl restart docker"
    fi
  else
    echo -e "${YELLOW}Docker not found${RESET}"
  fi
}

# Function to remove docs (Linux only)
remove_docs_linux() {
  if [[ "$OSTYPE" == "linux-gnu" ]]; then
    echo -e "${BOLD}${YELLOW}==> Removing documentation${RESET}"
    with_space_saved "Remove documentation" safe_remove "/usr/share/doc"
    with_space_saved "Remove Ruby documentation" safe_remove "/usr/share/ri"
  fi
}

# Function to remove .NET
remove_dotnet() {
  echo -e "${BOLD}${YELLOW}==> Removing .NET${RESET}"

  if [[ "$OSTYPE" == "linux-gnu" ]]; then
    with_space_saved "Remove .NET" safe_remove "/usr/share/dotnet"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    with_space_saved "Remove .NET" safe_remove "/System/Volumes/Data/Users/runner/.dotnet"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    with_space_saved "Remove .NET Program Files" safe_remove "/c/Program Files/dotnet"
    with_space_saved "Remove .NET Program Files (x86)" safe_remove "/c/Program Files (x86)/dotnet"
  fi
}

# Function to remove Haskell
remove_haskell() {
  echo -e "${BOLD}${YELLOW}==> Removing Haskell${RESET}"
  if [[ "$OSTYPE" == "linux-gnu" ]]; then
    with_space_saved "Remove haskell-ghcup" safe_remove "/usr/local/.ghcup"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    with_space_saved "Remove haskell-ghcup" safe_remove "${XDG_DATA_HOME:=$HOME/.local/share}/ghcup"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # https://github.com/actions/runner-images/blob/c1745fed15dc0cb917a0fefff5f5ceab01799927/images/windows/scripts/build/Install-Haskell.ps1#L21
    with_space_saved "Remove haskell-ghcup" safe_remove "/c/ghcup"
  fi
}

# Function to remove Homebrew (Linux/macOS only)
remove_homebrew() {
  if [[ "$OSTYPE" == "darwin"* || "$OSTYPE" == "linux-gnu" ]]; then
    echo -e "${BOLD}${YELLOW}==> Removing Homebrew${RESET}"

    brew_found=true
    if [[ "$OSTYPE" == "linux-gnu" && -d "/home/linuxbrew/.linuxbrew" ]]; then
      eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    else
      brew_found=false
    fi

    if [[ ${brew_found} == true ]]; then
      if [[ -d "${HOMEBREW_PREFIX:=$(brew --prefix)}/homebrew" ]]; then
        with_space_saved "Remove Homebrew" safe_remove "${HOMEBREW_PREFIX:=$(brew --prefix)}/homebrew"
      else
        with_space_saved "Remove Homebrew" safe_remove "${HOMEBREW_PREFIX:=$(brew --prefix)}"
      fi
    fi
  fi
}

# Function to remove JVM
remove_jvm() {
  echo -e "${BOLD}${YELLOW}==> Removing JVM${RESET}"

  # Remove Java installations from environment variables (all JAVA_HOME_* variables)
  echo "Checking for JAVA_HOME environment variables..."
  for var in $(env | grep '^JAVA_HOME' | cut -d= -f1); do
    java_path="${!var}"
    if [[ -n "$java_path" && -d "$java_path" ]]; then
      with_space_saved "Remove Java from $var" safe_remove "$java_path"
    fi
  done
}

# Function to remove Swift
remove_swift() {
  echo -e "${BOLD}${YELLOW}==> Removing Swift${RESET}"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    with_space_saved "Remove Swift from Xcode" safe_remove "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift"
  elif [[ "$OSTYPE" == "linux-gnu" ]]; then
    with_space_saved "Remove Swift" safe_remove "/usr/share/swift"
  fi
}

# Function to remove tool cache
remove_tool_cache() {
  echo -e "${BOLD}${YELLOW}==> Removing tool cache${RESET}"
  with_space_saved "Remove hostedtoolcache" safe_remove "${HOSTEDTOOLCACHE}"
}

# Function to remove tools (Windows only)
remove_tools_windows() {
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    echo -e "${BOLD}${YELLOW}==> Removing Windows tools${RESET}"
    with_space_saved "Remove tools directory" safe_remove "/c/tools"
  fi
}

# Function to remove Xcode (macOS only)
remove_xcode() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${BOLD}${YELLOW}==> Removing Xcode${RESET}"

    # Remove all Xcode versions and their symlinks
    xcode_dirs=$(find /Applications -maxdepth 1 -name 'Xcode*.app' -type d)
    for dir in $xcode_dirs; do
      if [[ -d "$dir" ]]; then
        with_space_saved "Remove Xcode application: $dir" safe_remove "$dir"
      fi
    done

    # Also remove any remaining Xcode-related directories
    with_space_saved "Remove Xcode CommandLineTools" safe_remove "/Library/Developer/CommandLineTools"
  fi
}

# Function to perform Linux package cleanup
linux_package_cleanup() {
  if [[ "$OSTYPE" == "linux-gnu" ]]; then
    echo -e "${BOLD}${YELLOW}==> Linux package cleanup${RESET}"
    with_space_saved "Remove unused packages" bash -c "${SUDO_CMD} apt-get autoremove -y 2>/dev/null || true"
    with_space_saved "Clean apt cache" bash -c "${SUDO_CMD} apt-get clean"
  fi
}


# Color codes
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
RESET="\033[0m"
BOLD="\033[1m"

# Default values
ANALYZE_SPACE_SAVINGS="false"
CLEAN_ALL="false"
REMOVE_ANDROID="false"
REMOVE_CHOCOLATEY="false"
REMOVE_CODEQL="false"
REMOVE_DOCKER_IMAGES="false"
REMOVE_DOCS_LINUX="false"
REMOVE_DOTNET="false"
REMOVE_HASKELL="false"
REMOVE_HOMEBREW="false"
REMOVE_JVM="false"
REMOVE_SWIFT="false"
REMOVE_TOOL_CACHE="false"
REMOVE_TOOLS_WINDOWS="false"
REMOVE_XCODE="false"
SAFE_PACKAGES=""

# Set OS specific variables
SUDO_CMD=$([[ "$EUID" -ne 0 ]] && command -v sudo &>/dev/null && echo "sudo" || echo "")
HOSTEDTOOLCACHE=$(convert_to_unix_path "${AGENT_TOOLSDIRECTORY}")
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  SUDO_CMD=""  # sudo not needed on Windows, and it's disabled on arm
fi

# Array to store space analysis data
declare -a SPACE_ANALYSIS_DATA

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --analyze-space-savings=*)
      ANALYZE_SPACE_SAVINGS="${1#*=}"
      shift
      ;;
    --clean-all=*)
      CLEAN_ALL="${1#*=}"
      shift
      ;;
    --remove-android=*)
      REMOVE_ANDROID="${1#*=}"
      shift
      ;;
    --remove-chocolatey=*)
      REMOVE_CHOCOLATEY="${1#*=}"
      shift
      ;;
    --remove-codeql=*)
      REMOVE_CODEQL="${1#*=}"
      shift
      ;;
    --remove-docker-images=*)
      REMOVE_DOCKER_IMAGES="${1#*=}"
      shift
      ;;
    --remove-docs-linux=*)
      REMOVE_DOCS_LINUX="${1#*=}"
      shift
      ;;
    --remove-dotnet=*)
      REMOVE_DOTNET="${1#*=}"
      shift
      ;;
    --remove-haskell=*)
      REMOVE_HASKELL="${1#*=}"
      shift
      ;;
    --remove-homebrew=*)
      REMOVE_HOMEBREW="${1#*=}"
      shift
      ;;
    --remove-swift=*)
      REMOVE_SWIFT="${1#*=}"
      shift
      ;;
    --remove-jvm=*)
      REMOVE_JVM="${1#*=}"
      shift
      ;;
    --remove-tool-cache=*)
      REMOVE_TOOL_CACHE="${1#*=}"
      shift
      ;;
    --remove-tools-windows=*)
      REMOVE_TOOLS_WINDOWS="${1#*=}"
      shift
      ;;
    --remove-xcode=*)
      REMOVE_XCODE="${1#*=}"
      shift
      ;;
    --safe-packages=*)
      SAFE_PACKAGES="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# If CLEAN_ALL is true, set all remove options to true (except safe packages)
if [[ "$CLEAN_ALL" == "true" ]]; then
  REMOVE_ANDROID="true"
  REMOVE_CHOCOLATEY="true"
  REMOVE_CODEQL="true"
  REMOVE_DOCKER_IMAGES="true"
  REMOVE_DOCS_LINUX="true"
  REMOVE_DOTNET="true"
  REMOVE_HASKELL="true"
  REMOVE_HOMEBREW="true"
  REMOVE_JVM="true"
  REMOVE_SWIFT="true"
  REMOVE_TOOL_CACHE="true"
  REMOVE_TOOLS_WINDOWS="true"
  REMOVE_XCODE="true"
fi

echo -e "${BOLD}${YELLOW}==> Initial disk space${RESET}"
get_disk_space
INITIAL_SPACE=$(get_disk_space_gb)
echo -e "${YELLOW}Initial free space: ${INITIAL_SPACE} GB${RESET}"

# Execute cleanup functions based on inputs
if [[ "$REMOVE_ANDROID" == "true" ]]; then
  measure_space_saved "Remove Android SDK" remove_android
fi

if [[ "$REMOVE_CHOCOLATEY" == "true" && ("$OSTYPE" == "msys" || "$OSTYPE" == "win32") ]]; then
  measure_space_saved "Remove Chocolatey" remove_chocolatey
fi

if [[ "$REMOVE_DOCKER_IMAGES" == "true" ]]; then
  measure_space_saved "Remove Docker images" remove_docker_images
fi

if [[ "$REMOVE_CODEQL" == "true" ]]; then
  measure_space_saved "Remove CodeQL" remove_codeql
fi

if [[ "$REMOVE_DOCS_LINUX" == "true" && "$OSTYPE" == "linux-gnu" ]]; then
  measure_space_saved "Remove documentation" remove_docs_linux
fi

if [[ "$REMOVE_DOTNET" == "true" ]]; then
  measure_space_saved "Remove .NET" remove_dotnet
fi

if [[ "$REMOVE_HASKELL" == "true" ]]; then
  measure_space_saved "Remove Haskell" remove_haskell
fi

if [[ "$REMOVE_HOMEBREW" == "true" && ("$OSTYPE" == "darwin"* || "$OSTYPE" == "linux-gnu") ]]; then
  measure_space_saved "Remove Homebrew" remove_homebrew
fi

if [[ "$REMOVE_JVM" == "true" ]]; then
  measure_space_saved "Remove JVM" remove_jvm
fi

if [[ "$REMOVE_SWIFT" == "true" && ("$OSTYPE" == "darwin"* || "$OSTYPE" == "linux-gnu") ]]; then
  measure_space_saved "Remove Swift" remove_swift
fi

if [[ "$REMOVE_TOOL_CACHE" == "true" ]]; then
  measure_space_saved "Remove tool cache" remove_tool_cache
fi

if [[ "$REMOVE_TOOLS_WINDOWS" == "true" && ("$OSTYPE" == "msys" || "$OSTYPE" == "win32") ]]; then
  measure_space_saved "Remove Windows tools" remove_tools_windows
fi

if [[ "$REMOVE_XCODE" == "true" && "$OSTYPE" == "darwin"* ]]; then
  measure_space_saved "Remove Xcode" remove_xcode
fi

# Always perform Linux package cleanup if on Linux
if [[ "$OSTYPE" == "linux-gnu" ]]; then
  measure_space_saved "Linux package cleanup" linux_package_cleanup
fi

echo -e "${BOLD}${YELLOW}==> Final disk space${RESET}"
get_disk_space
FINAL_SPACE=$(get_disk_space_gb)
echo -e "${YELLOW}Final free space: ${FINAL_SPACE} GB${RESET}"

# Calculate total space saved
SPACE_SAVED=$(awk "BEGIN {printf \"%.2f\", $FINAL_SPACE - $INITIAL_SPACE}")
echo -e "${GREEN}Total space saved: ${SPACE_SAVED} GB${RESET}"

# Generate space analysis JSON if requested
if [[ "$ANALYZE_SPACE_SAVINGS" == "true" && ${#SPACE_ANALYSIS_DATA[@]} -gt 0 ]]; then
  echo -e "${BOLD}${YELLOW}==> Generating space analysis${RESET}"

  # Create temporary file for sorting
  temp_file=$(mktemp)

  # Sort data by space saved (descending order)
  for entry in "${SPACE_ANALYSIS_DATA[@]}"; do
    operation_name="${entry%:*}"
    space_saved="${entry#*:}"
    # Use printf to ensure consistent decimal formatting for sorting
    printf "%.2f:%s\n" "$space_saved" "$operation_name" >> "$temp_file"
  done

  # Sort by space saved (numeric, descending) and generate compact JSON
  space_analysis_json="["
  first_entry=true

  while IFS=':' read -r space_saved operation_name; do
    if [[ "$first_entry" == "true" ]]; then
      first_entry=false
    else
      space_analysis_json+=","
    fi

    # Escape any quotes in operation name for JSON
    escaped_operation="${operation_name//\"/\\\"}"
    space_analysis_json+="{\"operation\":\"$escaped_operation\",\"space_saved_gb\":$space_saved}"
  done < <(sort -nr "$temp_file")

  space_analysis_json+="]"

  # Clean up temp file
  rm -f "$temp_file"

  echo -e "${GREEN}Space analysis generated${RESET}"

  # Output the JSON analysis
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "space-analysis=${space_analysis_json}" >> "${GITHUB_OUTPUT}"
  fi
else
  # Set empty analysis if not requested or no data
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "space-analysis=[]" >> "${GITHUB_OUTPUT}"
  fi
fi

# Set GitHub Actions outputs
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "space-before=${INITIAL_SPACE}"
    echo "space-after=${FINAL_SPACE}"
    echo "space-saved=${SPACE_SAVED}"
  } >> "${GITHUB_OUTPUT}"
fi

echo -e "${BOLD}${GREEN}==> Cleanup completed${RESET}"
