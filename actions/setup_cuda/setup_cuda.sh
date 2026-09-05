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

print_colored_line() {
    printf '%b%s%b\n' "$1" "$2" "$3"
}

# Return the major.minor portion used by NVIDIA's Windows install directory and
# component names (for example, 13.1.0 -> 13.1).
get_cuda_short_version() {
    local version="$1"

    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}Error: CUDA version must use the X.Y.Z format: ${version}${RESET}" >&2
        exit 1
    fi

    echo "${version%.*}"
}

# Keep an explicit component list so the Windows network installer never falls
# back to installing the display driver, profilers, samples, or docs.
get_windows_installer_components() {
    local version="$1"
    local short_version
    local major_version
    short_version=$(get_cuda_short_version "$version")
    major_version="${short_version%%.*}"

    local components=(
        "nvcc_${short_version}"
        "cuobjdump_${short_version}"
        "nvprune_${short_version}"
        "cupti_${short_version}"
        "cublas_${short_version}"
        "cublas_dev_${short_version}"
        "cudart_${short_version}"
        "cufft_${short_version}"
        "cufft_dev_${short_version}"
        "curand_${short_version}"
        "curand_dev_${short_version}"
        "cusolver_${short_version}"
        "cusolver_dev_${short_version}"
        "cusparse_${short_version}"
        "cusparse_dev_${short_version}"
        "npp_${short_version}"
        "npp_dev_${short_version}"
        "nvrtc_${short_version}"
        "nvrtc_dev_${short_version}"
        "nvml_dev_${short_version}"
        "thrust_${short_version}"
        "visual_studio_integration_${short_version}"
    )

    if (( major_version >= 12 )); then
        components+=("nvjitlink_${short_version}")
    fi

    if (( major_version >= 13 )); then
        # CUDA 13 split compiler internals out of the nvcc component. These
        # packages are required for headers, device compilation, and linking.
        components+=(
            "crt_${short_version}"
            "nvvm_${short_version}"
            "nvfatbin_${short_version}"
            "nvptxcompiler_${short_version}"
        )
    fi

    printf '%s\n' "${components[@]}"
}

get_windows_cuda_path() {
    local version="$1"
    local short_version
    short_version=$(get_cuda_short_version "$version")

    echo "/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v${short_version}"
}

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
        echo -e "${YELLOW}Note: Installing development toolkit components only (no driver, profilers, samples, or docs)${RESET}"

        local -a installer_components=()
        mapfile -t installer_components < <(get_windows_installer_components "$version")

        # Run the network installer silently
        # -s: silent mode
        # -n: prevent an automatic reboot
        # Explicit components prevent the silent installer from installing all packages.
        if ! "$installer_path" -s "${installer_components[@]}" -n; then
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
        # Check the exact requested version instead of accepting another CUDA
        # installation that may already be present on the runner.
        nvcc_path="$(get_windows_cuda_path "$version")/bin/nvcc.exe"
    else
        nvcc_path="${install_path}/bin/nvcc"
    fi

    if [[ -f "$nvcc_path" ]]; then
        print_colored_line "${GREEN}CUDA compiler (nvcc) found at " "$nvcc_path" "$RESET"
        local nvcc_version_output
        nvcc_version_output=$("$nvcc_path" --version)
        printf '%s\n' "$nvcc_version_output"

        local expected_release
        expected_release=$(get_cuda_short_version "$version")
        if [[ "$nvcc_version_output" != *"release ${expected_release},"* ]]; then
            echo -e "${RED}Error: Installed nvcc does not match requested CUDA ${version}${RESET}" >&2
            exit 1
        fi
    else
        print_colored_line "${RED}Error: CUDA compiler not found at " "$nvcc_path" "$RESET" >&2
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
        # Use the exact directory for the requested release instead of the
        # newest CUDA installation already present on the runner.
        local cuda_version_dir
        cuda_version_dir=$(get_windows_cuda_path "$version")

        if [[ ! -d "$cuda_version_dir" ]]; then
            print_colored_line \
                "${RED}Error: CUDA installation directory not found: " "$cuda_version_dir" "$RESET" >&2
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

        # GitHub's runner adds this path for every subsequent shell. Use the
        # native form so PowerShell/cmd consumers work as well as Git Bash.
        printf '%s\\bin\n' "$win_cuda_path" >> "${GITHUB_PATH}"

        # Set environment variables for GitHub Actions (use Windows-style paths)
        if [[ -n "${GITHUB_ENV:-}" ]]; then
            local short_version
            short_version=$(get_cuda_short_version "$version")
            {
                printf 'CUDA_PATH=%s\n' "$win_cuda_path"
                printf 'CUDA_HOME=%s\n' "$win_cuda_path"
                printf 'CUDA_ROOT=%s\n' "$win_cuda_path"
                printf 'CUDA_PATH_V%s=%s\n' "${short_version//./_}" "$win_cuda_path"
                printf 'CMAKE_CUDA_COMPILER=%s\n' "$win_nvcc_path"
            } >> "${GITHUB_ENV}"
        fi

        # Set outputs for GitHub Actions (use Windows-style paths)
        if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
            {
                printf 'cuda-version=%s\n' "$version"
                printf 'cuda-path=%s\n' "$win_cuda_path"
                printf 'nvcc-path=%s\n' "$win_nvcc_path"
            } >> "${GITHUB_OUTPUT}"
        fi

        echo -e "${GREEN}Environment variables configured:${RESET}"
        printf '  %bCUDA_PATH=%s%b\n' "$CYAN" "$win_cuda_path" "$RESET"
        printf '  %bCUDA_HOME=%s%b\n' "$CYAN" "$win_cuda_path" "$RESET"
        printf '  %bCMAKE_CUDA_COMPILER=%s%b\n' "$CYAN" "$win_nvcc_path" "$RESET"
        printf '  %bPATH includes %s/bin%b\n' "$CYAN" "$cuda_version_dir" "$RESET"
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

# CUDA Toolkit is not available for current macOS runners, so leave dependent
# workflows free to include macOS in a shared matrix.
if [[ "$OS_TYPE" == "$OS_MACOS" ]]; then
    echo -e "${YELLOW}macOS detected - CUDA Toolkit installation is not supported${RESET}"
    echo -e "${GREEN}Skipping CUDA setup successfully${RESET}"
    exit 0
fi

# Validate before constructing download URLs or installer component names.
get_cuda_short_version "$CUDA_VERSION" >/dev/null

# Validate driver-version is provided for Linux (not needed for Windows network installer)
if [[ "$OS_TYPE" == "$OS_LINUX" ]] && [[ -z "$DRIVER_VERSION" ]]; then
    echo -e "${RED}Error: --driver-version is required for Linux${RESET}" >&2
    echo -e "${YELLOW}Example: --driver-version=550.54.15${RESET}" >&2
    echo -e "${YELLOW}Find the correct driver version at: https://developer.nvidia.com/cuda-downloads${RESET}" >&2
    exit 1
fi

# Set the effective installation path.
if [[ "$OS_TYPE" == "$OS_WINDOWS" ]]; then
    if [[ -n "$INSTALL_PATH" ]]; then
        echo -e "${YELLOW}Note: --install-path is ignored on Windows; NVIDIA's versioned default is used${RESET}"
    fi
    INSTALL_PATH=$(get_windows_cuda_path "$CUDA_VERSION")
elif [[ -z "$INSTALL_PATH" ]]; then
    INSTALL_PATH="/usr/local/cuda"
fi

# Main execution
echo -e "${BLUE}=== CUDA Toolkit Setup ===${RESET}"
echo -e "${CYAN}Operating System: ${OS_TYPE}${RESET}"
echo -e "${CYAN}CUDA Version: ${CUDA_VERSION}${RESET}"
if [[ "$OS_TYPE" == "$OS_LINUX" ]]; then
    echo -e "${CYAN}Driver Version: ${DRIVER_VERSION}${RESET}"
fi
print_colored_line "${CYAN}Install Path: " "$INSTALL_PATH" "$RESET"
echo ""

# Install CUDA
install_cuda "$CUDA_VERSION" "$DRIVER_VERSION" "$INSTALL_PATH" "$OS_TYPE"

# Setup environment
setup_environment "$INSTALL_PATH" "$CUDA_VERSION" "$OS_TYPE"

echo ""
echo -e "${GREEN}=== CUDA Toolkit Setup Complete ===${RESET}"
