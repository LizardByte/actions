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
CUDA_VERSION=""
DRIVER_VERSION=""
INSTALL_PATH="/usr/local/cuda"

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

# Function to get the runfile name for a specific version and architecture
get_runfile_name() {
    local version="$1"
    local driver_version="$2"
    local arch="$3"

    # NVIDIA naming convention for runfiles
    # For x86_64: cuda_<version>_<driver_version>_linux.run
    # For aarch64: cuda_<version>_<driver_version>_linux_sbsa.run

    if [[ "$arch" == "x86_64" ]]; then
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
    local runfile="$2"

    # NVIDIA's standard URL pattern
    echo "https://developer.download.nvidia.com/compute/cuda/${version}/local_installers/${runfile}"

    return 0
}

# Function to download and install CUDA
install_cuda() {
    local version="$1"
    local driver_version="$2"
    local install_path="$3"
    local arch
    local runfile
    local download_url

    arch=$(detect_architecture)
    echo -e "${BLUE}Detected architecture: ${CYAN}${arch}${RESET}"

    runfile=$(get_runfile_name "$version" "$driver_version" "$arch")
    download_url=$(get_download_url "$version" "$runfile")

    echo -e "${BLUE}Installing CUDA Toolkit ${CYAN}${version}${BLUE} for ${CYAN}${arch}${RESET}"
    echo -e "${CYAN}Driver version: ${driver_version}${RESET}"
    echo -e "${CYAN}Download URL: ${download_url}${RESET}"

    # Download the runfile
    echo -e "${BLUE}Downloading CUDA installer...${RESET}"
    local tmp_dir
    tmp_dir=$(mktemp -d)
    local runfile_path="${tmp_dir}/${runfile}"

    if ! curl -fsSL -o "$runfile_path" "$download_url"; then
        echo -e "${RED}Error: Failed to download CUDA installer${RESET}" >&2
        echo -e "${YELLOW}URL: ${download_url}${RESET}" >&2
        rm -rf "$tmp_dir"
        exit 1
    fi

    echo -e "${GREEN}Download complete${RESET}"

    # Make the runfile executable
    chmod +x "$runfile_path"

    # Install CUDA toolkit (without driver, since we don't have GPU in CI)
    echo -e "${BLUE}Installing CUDA Toolkit to ${CYAN}${install_path}${RESET}"
    echo -e "${YELLOW}Note: Installing toolkit only (no driver)${RESET}"

    # Run the installer silently
    # --silent: silent installation
    # --toolkit: install toolkit only
    # --toolkitpath: specify installation path
    # --no-opengl-libs: don't install OpenGL libraries (not needed for compilation)
    if ! sudo "$runfile_path" --silent --toolkit --toolkitpath="$install_path" --no-opengl-libs; then
        echo -e "${RED}Error: CUDA installation failed${RESET}" >&2
        rm -rf "$tmp_dir"
        exit 1
    fi

    echo -e "${GREEN}CUDA Toolkit installation complete${RESET}"

    # Clean up
    rm -rf "$tmp_dir"

    # Verify installation
    if [[ -f "${install_path}/bin/nvcc" ]]; then
        echo -e "${GREEN}CUDA compiler (nvcc) found at ${install_path}/bin/nvcc${RESET}"
        "${install_path}/bin/nvcc" --version
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

    echo -e "${BLUE}Setting up environment variables...${RESET}"

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

if [[ -z "$DRIVER_VERSION" ]]; then
    echo -e "${RED}Error: --driver-version is required${RESET}" >&2
    echo -e "${YELLOW}Example: --driver-version=550.54.15${RESET}" >&2
    echo -e "${YELLOW}Find the correct driver version at: https://developer.nvidia.com/cuda-downloads${RESET}" >&2
    exit 1
fi

# Main execution
echo -e "${BLUE}=== CUDA Toolkit Setup ===${RESET}"
echo -e "${CYAN}CUDA Version: ${CUDA_VERSION}${RESET}"
echo -e "${CYAN}Driver Version: ${DRIVER_VERSION}${RESET}"
echo -e "${CYAN}Install Path: ${INSTALL_PATH}${RESET}"
echo ""

# Check if running on Linux
if [[ "$(uname -s)" != "Linux" ]]; then
    echo -e "${RED}Error: This action only supports Linux runners${RESET}" >&2
    exit 1
fi

# Install CUDA
install_cuda "$CUDA_VERSION" "$DRIVER_VERSION" "$INSTALL_PATH"

# Setup environment
setup_environment "$INSTALL_PATH" "$CUDA_VERSION"

echo ""
echo -e "${GREEN}=== CUDA Toolkit Setup Complete ===${RESET}"
