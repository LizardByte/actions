#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

# OS type constants
readonly OS_LINUX="linux"
readonly OS_WINDOWS="windows"
readonly OS_MACOS="macos"

# Default values
CUDA_VERSION=""
DRIVER_VERSION=""
INSTALL_PATH=""
OS_TYPE=""

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)
            echo "$OS_LINUX"
            ;;
        Darwin*)
            echo "$OS_MACOS"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "$OS_WINDOWS"
            ;;
        *)
            echo -e "${RED}Error: Unsupported OS: $(uname -s)${RESET}" >&2
            exit 1
            ;;
    esac

    return 0
}

# Function to detect architecture
detect_architecture() {
    local arch
    arch=$(uname -m)

    case "$arch" in
        x86_64)
            echo "x86_64"
            ;;
        aarch64|arm64)
            echo "aarch64"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${RESET}" >&2
            exit 1
            ;;
    esac

    return 0
}

# Function to get the installer name for a specific version and architecture
get_installer_name() {
    local version="$1"
    local driver_version="$2"
    local arch="$3"
    local os_type="$4"

    # NVIDIA naming convention for installers
    # Linux x86_64: cuda_<version>_<driver_version>_linux.run
    # Linux aarch64: cuda_<version>_<driver_version>_linux_sbsa.run
    # Windows: cuda_<version>_windows_network.exe (network installer, no driver version)

    if [[ "$os_type" == "$OS_WINDOWS" ]]; then
        echo "cuda_${version}_windows_network.exe"
    elif [[ "$arch" == "x86_64" ]]; then
        echo "cuda_${version}_${driver_version}_linux.run"
    elif [[ "$arch" == "aarch64" ]]; then
        echo "cuda_${version}_${driver_version}_linux_sbsa.run"
    else
        echo -e "${RED}Error: Unsupported architecture for CUDA: $arch${RESET}" >&2
        exit 1
    fi

    return 0
}

# Function to get download URL
get_download_url() {
    local version="$1"
    local installer="$2"
    local os_type="$3"

    # NVIDIA's URL pattern differs for Windows network installer
    if [[ "$os_type" == "$OS_WINDOWS" ]]; then
        echo "https://developer.download.nvidia.com/compute/cuda/${version}/network_installers/${installer}"
    else
        echo "https://developer.download.nvidia.com/compute/cuda/${version}/local_installers/${installer}"
    fi

    return 0
}

# Function to download and install CUDA
install_cuda() {
    local version="$1"
    local driver_version="$2"
    local install_path="$3"
    local os_type="$4"
    local arch
    local installer
    local download_url

    arch=$(detect_architecture)
    echo -e "${BLUE}Detected architecture: ${CYAN}${arch}${RESET}"
    echo -e "${BLUE}Operating system: ${CYAN}${os_type}${RESET}"

    installer=$(get_installer_name "$version" "$driver_version" "$arch" "$os_type")
    download_url=$(get_download_url "$version" "$installer" "$os_type")

    echo -e "${BLUE}Installing CUDA Toolkit ${CYAN}${version}${BLUE} for ${CYAN}${os_type}/${arch}${RESET}"
    if [[ "$os_type" != "$OS_WINDOWS" ]]; then
        echo -e "${CYAN}Driver version: ${driver_version}${RESET}"
    fi
    echo -e "${CYAN}Download URL: ${download_url}${RESET}"

    # Download the installer
    echo -e "${BLUE}Downloading CUDA installer...${RESET}"
    local tmp_dir
    tmp_dir=$(mktemp -d)
    local installer_path="${tmp_dir}/${installer}"

    if ! curl -fsSL -o "$installer_path" "$download_url"; then
        echo -e "${RED}Error: Failed to download CUDA installer${RESET}" >&2
        echo -e "${YELLOW}URL: ${download_url}${RESET}" >&2
        rm -rf "$tmp_dir"
        exit 1
    fi

    echo -e "${GREEN}Download complete${RESET}"

    if [[ "$os_type" == "$OS_WINDOWS" ]]; then
        # Windows installation using network installer
        echo -e "${BLUE}Installing CUDA Toolkit (network installer)${RESET}"
        echo -e "${YELLOW}Note: Installing toolkit only (no driver, no visual studio integration)${RESET}"

        # Run the network installer silently
        # -s: silent mode
        if ! "$installer_path" -s; then
            echo -e "${RED}Error: CUDA installation failed${RESET}" >&2
            rm -rf "$tmp_dir"
            exit 1
        fi
    else
        # Linux installation
        # Make the runfile executable
        chmod +x "$installer_path"

        echo -e "${BLUE}Installing CUDA Toolkit to ${CYAN}${install_path}${RESET}"
        echo -e "${YELLOW}Note: Installing toolkit only (no driver)${RESET}"

        # Run the installer silently
        # --silent: silent installation
        # --toolkit: install toolkit only
        # --toolkitpath: specify installation path
        # --no-opengl-libs: don't install OpenGL libraries (not needed for compilation)
        if ! sudo "$installer_path" --silent --toolkit --toolkitpath="$install_path" --no-opengl-libs; then
            echo -e "${RED}Error: CUDA installation failed${RESET}" >&2
            rm -rf "$tmp_dir"
            exit 1
        fi
    fi

    echo -e "${GREEN}CUDA Toolkit installation complete${RESET}"

    # Clean up
    rm -rf "$tmp_dir"

    # Verify installation
    local nvcc_path
    if [[ "$os_type" == "$OS_WINDOWS" ]]; then
        # Windows: CUDA installs to C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v<version>
        # Find the nvcc.exe
        nvcc_path=$(find "/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA" -name "nvcc.exe" 2>/dev/null | head -1 || true)
        if [[ -z "$nvcc_path" ]]; then
            # Try Program Files (x86)
            nvcc_path=$(find "/c/Program Files (x86)/NVIDIA GPU Computing Toolkit/CUDA" -name "nvcc.exe" 2>/dev/null | head -1 || true)
        fi
    else
        nvcc_path="${install_path}/bin/nvcc"
    fi

    if [[ -f "$nvcc_path" ]]; then
        echo -e "${GREEN}CUDA compiler (nvcc) found at ${nvcc_path}${RESET}"
        "$nvcc_path" --version || true
    else
        echo -e "${RED}Error: CUDA compiler not found after installation${RESET}" >&2
        exit 1
    fi

    return 0
}

# Function to setup environment variables
setup_environment() {
    local install_path="$1"
    local version="$2"
    local os_type="$3"

    echo -e "${BLUE}Setting up environment variables...${RESET}"

    if [[ "$os_type" == "$OS_WINDOWS" ]]; then
        # Windows: Find CUDA installation
        local cuda_base="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA"
        if [[ ! -d "$cuda_base" ]]; then
            cuda_base="/c/Program Files (x86)/NVIDIA GPU Computing Toolkit/CUDA"
        fi

        # Find the version directory
        local cuda_version_dir
        cuda_version_dir=$(find "$cuda_base" -maxdepth 1 -type d -name "v*" | sort -V | tail -1)

        if [[ -z "$cuda_version_dir" ]]; then
            echo -e "${RED}Error: Could not find CUDA installation directory${RESET}" >&2
            exit 1
        fi

        local nvcc_path="${cuda_version_dir}/bin/nvcc.exe"

        # Convert paths to Windows format for outputs
        local win_cuda_path
        local win_nvcc_path
        if command -v cygpath &>/dev/null; then
            win_cuda_path=$(cygpath -w "$cuda_version_dir")
            win_nvcc_path=$(cygpath -w "$nvcc_path")
        else
            # Fallback: convert /c/path to C:\path
            win_cuda_path=$(echo "$cuda_version_dir" | sed 's|^/\([a-z]\)/|\U\1:/|' | sed 's|/|\\|g')
            win_nvcc_path=$(echo "$nvcc_path" | sed 's|^/\([a-z]\)/|\U\1:/|' | sed 's|/|\\|g')
        fi

        # Add CUDA to PATH (use Unix-style for bash)
        echo "${cuda_version_dir}/bin" >> "${GITHUB_PATH}"

        # Set environment variables for GitHub Actions (use Windows-style paths)
        if [[ -n "${GITHUB_ENV:-}" ]]; then
            {
                echo "CUDA_PATH=${win_cuda_path}"
                echo "CUDA_HOME=${win_cuda_path}"
                echo "CUDA_ROOT=${win_cuda_path}"
                echo "CUDA_PATH_V${version//./_}=${win_cuda_path}"
                echo "CMAKE_CUDA_COMPILER=${win_nvcc_path}"
            } >> "${GITHUB_ENV}"
        fi

        # Set outputs for GitHub Actions (use Windows-style paths)
        if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
            {
                echo "cuda-version=${version}"
                echo "cuda-path=${win_cuda_path}"
                echo "nvcc-path=${win_nvcc_path}"
            } >> "${GITHUB_OUTPUT}"
        fi

        echo -e "${GREEN}Environment variables configured:${RESET}"
        echo -e "  ${CYAN}CUDA_PATH=${win_cuda_path}${RESET}"
        echo -e "  ${CYAN}CUDA_HOME=${win_cuda_path}${RESET}"
        echo -e "  ${CYAN}CMAKE_CUDA_COMPILER=${win_nvcc_path}${RESET}"
        echo -e "  ${CYAN}PATH includes ${cuda_version_dir}/bin${RESET}"
    else
        # Linux: Use provided install path
        # Add CUDA to PATH
        echo "${install_path}/bin" >> "${GITHUB_PATH}"

        # Set environment variables for GitHub Actions
        if [[ -n "${GITHUB_ENV:-}" ]]; then
            {
                echo "CUDA_PATH=${install_path}"
                echo "CUDA_HOME=${install_path}"
                echo "CUDA_ROOT=${install_path}"
                echo "LD_LIBRARY_PATH=${install_path}/lib64:\${LD_LIBRARY_PATH:-}"
                echo "LIBRARY_PATH=${install_path}/lib64:\${LIBRARY_PATH:-}"
                echo "CPATH=${install_path}/include:\${CPATH:-}"
                echo "CMAKE_CUDA_COMPILER=${install_path}/bin/nvcc"
            } >> "${GITHUB_ENV}"
        fi

        # Set outputs for GitHub Actions
        if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
            {
                echo "cuda-version=${version}"
                echo "cuda-path=${install_path}"
                echo "nvcc-path=${install_path}/bin/nvcc"
            } >> "${GITHUB_OUTPUT}"
        fi

        echo -e "${GREEN}Environment variables configured:${RESET}"
        echo -e "  ${CYAN}CUDA_PATH=${install_path}${RESET}"
        echo -e "  ${CYAN}CUDA_HOME=${install_path}${RESET}"
        echo -e "  ${CYAN}CUDA_ROOT=${install_path}${RESET}"
        echo -e "  ${CYAN}CMAKE_CUDA_COMPILER=${install_path}/bin/nvcc${RESET}"
        echo -e "  ${CYAN}PATH includes ${install_path}/bin${RESET}"
        echo -e "  ${CYAN}LD_LIBRARY_PATH includes ${install_path}/lib64${RESET}"
        echo -e "  ${CYAN}LIBRARY_PATH includes ${install_path}/lib64${RESET}"
        echo -e "  ${CYAN}CPATH includes ${install_path}/include${RESET}"
    fi

    return 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --cuda-version=*)
            CUDA_VERSION="${1#*=}"
            shift
            ;;
        --driver-version=*)
            DRIVER_VERSION="${1#*=}"
            shift
            ;;
        --install-path=*)
            INSTALL_PATH="${1#*=}"
            shift
            ;;
        *)
            echo -e "${RED}Error: Unknown option '$1'${RESET}" >&2
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$CUDA_VERSION" ]]; then
    echo -e "${RED}Error: --cuda-version is required${RESET}" >&2
    echo -e "${YELLOW}Example: --cuda-version=12.4.1${RESET}" >&2
    exit 1
fi

# Detect OS
OS_TYPE=$(detect_os)

# Skip on macOS
if [[ "$OS_TYPE" == "$OS_MACOS" ]]; then
    echo -e "${YELLOW}macOS detected - CUDA Toolkit installation not supported on macOS${RESET}"
    echo -e "${YELLOW}Skipping CUDA installation...${RESET}"
    echo ""
    echo -e "${GREEN}=== CUDA Toolkit Setup Skipped (macOS) ===${RESET}"
    exit 0
fi

# Validate driver-version is provided for Linux (not needed for Windows network installer)
if [[ "$OS_TYPE" == "$OS_LINUX" ]] && [[ -z "$DRIVER_VERSION" ]]; then
    echo -e "${RED}Error: --driver-version is required for Linux${RESET}" >&2
    echo -e "${YELLOW}Example: --driver-version=550.54.15${RESET}" >&2
    echo -e "${YELLOW}Find the correct driver version at: https://developer.nvidia.com/cuda-downloads${RESET}" >&2
    exit 1
fi

# Set default install path if not provided
if [[ -z "$INSTALL_PATH" ]]; then
    if [[ "$OS_TYPE" == "$OS_WINDOWS" ]]; then
        # Windows default is handled by the installer itself
        INSTALL_PATH="C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v${CUDA_VERSION}"
    else
        # Linux default
        INSTALL_PATH="/usr/local/cuda"
    fi
fi

# Main execution
echo -e "${BLUE}=== CUDA Toolkit Setup ===${RESET}"
echo -e "${CYAN}Operating System: ${OS_TYPE}${RESET}"
echo -e "${CYAN}CUDA Version: ${CUDA_VERSION}${RESET}"
if [[ "$OS_TYPE" == "$OS_LINUX" ]]; then
    echo -e "${CYAN}Driver Version: ${DRIVER_VERSION}${RESET}"
fi
echo -e "${CYAN}Install Path: ${INSTALL_PATH}${RESET}"
echo ""

# Install CUDA
install_cuda "$CUDA_VERSION" "$DRIVER_VERSION" "$INSTALL_PATH" "$OS_TYPE"

# Setup environment
setup_environment "$INSTALL_PATH" "$CUDA_VERSION" "$OS_TYPE"

echo ""
echo -e "${GREEN}=== CUDA Toolkit Setup Complete ===${RESET}"
