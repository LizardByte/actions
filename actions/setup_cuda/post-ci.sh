#!/bin/bash

set -euo pipefail

readonly OS_LINUX="Linux"
readonly OS_MACOS="macOS"
readonly OS_WINDOWS="Windows"

# Detect platform (prefer GitHub's RUNNER_OS when available).
RUNNER_OS_NORMALIZED="${RUNNER_OS:-}"
if [[ -z "$RUNNER_OS_NORMALIZED" ]]; then
    case "$(uname -s 2>/dev/null || echo unknown)" in
        MINGW*|MSYS*|CYGWIN*) RUNNER_OS_NORMALIZED="$OS_WINDOWS" ;;
        Darwin*) RUNNER_OS_NORMALIZED="$OS_MACOS" ;;
        Linux*) RUNNER_OS_NORMALIZED="$OS_LINUX" ;;
        *) RUNNER_OS_NORMALIZED="unknown" ;;
    esac
fi

to_unix_path() {
    local path="$1"

    if [[ "$RUNNER_OS_NORMALIZED" == "$OS_WINDOWS" ]] && command -v cygpath &>/dev/null; then
        cygpath -u "$path"
    else
        printf '%s\n' "$path"
    fi
}

echo "Verifying CUDA installation..."

# Check if nvcc is available.
if command -v nvcc &>/dev/null; then
    echo "✓ nvcc found in PATH"
    nvcc --version
else
    echo "✗ nvcc not found in PATH"
    exit 1
fi

# Check environment variables.
echo ""
echo "Environment variables:"
echo "  CUDA_PATH=${CUDA_PATH:-not set}"
echo "  CUDA_HOME=${CUDA_HOME:-not set}"
echo "  CMAKE_CUDA_COMPILER=${CMAKE_CUDA_COMPILER:-not set}"

if [[ -z "${CUDA_PATH:-}" ]]; then
    echo "✗ CUDA_PATH not set"
    exit 1
fi

CUDA_PATH_UNIX=$(to_unix_path "$CUDA_PATH")

# Check if CUDA directories exist.
echo ""
echo "CUDA installation structure:"
if [[ -d "${CUDA_PATH_UNIX}/bin" ]]; then
    echo "✓ ${CUDA_PATH}/bin exists"
else
    echo "✗ ${CUDA_PATH}/bin not found"
    exit 1
fi

if [[ -d "${CUDA_PATH_UNIX}/include" ]]; then
    echo "✓ ${CUDA_PATH}/include exists"
else
    echo "✗ ${CUDA_PATH}/include not found"
    exit 1
fi

# Windows uses lib while Linux uses lib64.
if [[ -d "${CUDA_PATH_UNIX}/lib64" ]]; then
    echo "✓ ${CUDA_PATH}/lib64 exists"
elif [[ -d "${CUDA_PATH_UNIX}/lib" ]]; then
    echo "✓ ${CUDA_PATH}/lib exists"
else
    echo "✗ ${CUDA_PATH}/lib or lib64 not found"
    exit 1
fi

# On Windows, nvcc needs the MSVC host compiler. Import the developer-command
# environment because GitHub's bash shell does not put cl.exe on PATH by default.
enable_msvc_windows() {
    [[ "$RUNNER_OS_NORMALIZED" == "$OS_WINDOWS" ]] || return 0

    if command -v cl.exe &>/dev/null; then
        return 0
    fi

    echo ""
    echo "MSVC host compiler (cl.exe) not found in PATH. Enabling the Visual Studio environment..."

    local vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"

    if [[ ! -f "$vswhere" ]]; then
        echo "✗ vswhere.exe not found; cannot enable the MSVC environment."
        return 1
    fi

    local vs_install
    if ! vs_install=$("$vswhere" -latest -products '*' \
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
            -property installationPath 2>/dev/null | tr -d '\r'); then
        echo "✗ vswhere.exe failed while locating Visual Studio."
        return 1
    fi

    if [[ -z "$vs_install" ]]; then
        echo "✗ Visual Studio with C++ build tools not found via vswhere.exe."
        return 1
    fi

    local vsdevcmd_win="${vs_install}\\Common7\\Tools\\VsDevCmd.bat"
    local vcvars64_win="${vs_install}\\VC\\Auxiliary\\Build\\vcvars64.bat"
    local vsdevcmd
    local vcvars64
    vsdevcmd=$(to_unix_path "$vsdevcmd_win")
    vcvars64=$(to_unix_path "$vcvars64_win")

    local bat_to_call
    local bat_arguments
    if [[ -f "$vsdevcmd" ]]; then
        bat_to_call=$(cygpath -d "$vsdevcmd")
        bat_arguments="-arch=amd64 -host_arch=amd64"
    elif [[ -f "$vcvars64" ]]; then
        bat_to_call=$(cygpath -d "$vcvars64")
        bat_arguments=""
    else
        echo "✗ Could not find VsDevCmd.bat or vcvars64.bat under: ${vs_install}"
        return 1
    fi

    local env_dump
    if ! env_dump=$(cmd.exe //d //s //c \
            "call ${bat_to_call} ${bat_arguments} >nul 2>&1 && set" 2>/dev/null | tr -d '\r'); then
        echo "✗ Visual Studio developer-command script failed."
        return 1
    fi

    if [[ -z "$env_dump" ]]; then
        echo "✗ Failed to capture the Visual Studio environment."
        return 1
    fi

    while IFS='=' read -r key val; do
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

        if [[ "${key^^}" == "PATH" ]]; then
            PATH=$(cygpath -p -u "$val")
            export PATH
        else
            export "${key}=${val}"
        fi
    done <<< "$env_dump"

    if ! command -v cl.exe &>/dev/null; then
        echo "✗ Visual Studio environment loaded, but cl.exe is still not available."
        return 1
    fi

    echo "✓ MSVC environment enabled (cl.exe found)"
}

enable_msvc_windows

test_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
test_root=$(to_unix_path "$test_root")
test_dir=$(mktemp -d "${test_root%/}/setup-cuda.XXXXXX")
readonly test_dir
trap 'rm -rf "$test_dir"' EXIT

# Compile a simple CUDA program. Windows performs an object-only build; Linux
# also links and runs host-only code, which does not require a GPU.
echo ""
echo "Testing CUDA compilation..."

test_cuda_source="${test_dir}/test_cuda.cu"
cat > "$test_cuda_source" << 'EOF'
#include <stdio.h>

__global__ void hello_cuda() {
    printf("Hello from CUDA!\n");
}

int main() {
    printf("CUDA compilation test\n");
    printf("This program was compiled successfully with nvcc\n");
    return 0;
}
EOF

if [[ "$RUNNER_OS_NORMALIZED" == "$OS_WINDOWS" ]]; then
    nvcc -c "$test_cuda_source" -o "${test_dir}/test_cuda.obj"
    echo "✓ CUDA compilation successful"
else
    nvcc -o "${test_dir}/test_cuda" "$test_cuda_source"
    echo "✓ CUDA compilation successful"
    "${test_dir}/test_cuda"
    echo "✓ CUDA program execution successful"
fi

# Test both CMake CUDA configuration and the build. A missing CMake executable
# or any configuration/build failure must fail CI rather than produce a warning.
echo ""
echo "Testing CMake CUDA support..."

if ! command -v cmake &>/dev/null; then
    echo "✗ CMake not available"
    exit 1
fi

cmake_source_dir="${test_dir}/cmake-source"
cmake_build_dir="${test_dir}/cmake-build"
mkdir -p "$cmake_source_dir"

cat > "${cmake_source_dir}/test_cuda_cmake.cu" << 'EOF'
#include <stdio.h>

int main() {
    printf("CMake CUDA test\n");
    return 0;
}
EOF

cat > "${cmake_source_dir}/CMakeLists.txt" << 'EOF'
cmake_minimum_required(VERSION 3.18)
project(CUDATest CUDA)

add_executable(test_cmake test_cuda_cmake.cu)
EOF

cmake -B "$cmake_build_dir" -S "$cmake_source_dir"
echo "✓ CMake CUDA configuration successful"
cmake --build "$cmake_build_dir" --config Release --parallel
echo "✓ CMake CUDA build successful"

echo ""
echo "Post-CI verification complete!"
