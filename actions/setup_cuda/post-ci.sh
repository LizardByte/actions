#!/bin/bash

set -euo pipefail

echo "Verifying CUDA installation..."

# Check if nvcc is available
if command -v nvcc &>/dev/null; then
    echo "✓ nvcc found in PATH"
    nvcc --version
else
    echo "✗ nvcc not found in PATH"
    exit 1
fi

# Check environment variables
echo ""
echo "Environment variables:"
echo "  CUDA_PATH=${CUDA_PATH:-not set}"
echo "  CUDA_HOME=${CUDA_HOME:-not set}"
echo "  CMAKE_CUDA_COMPILER=${CMAKE_CUDA_COMPILER:-not set}"

# Verify CUDA_PATH is set
if [[ -z "${CUDA_PATH:-}" ]]; then
    echo "✗ CUDA_PATH not set"
    exit 1
fi

# Check if CUDA directories exist
echo ""
echo "CUDA installation structure:"
if [[ -d "${CUDA_PATH}/bin" ]]; then
    echo "✓ ${CUDA_PATH}/bin exists"
else
    echo "✗ ${CUDA_PATH}/bin not found"
    exit 1
fi

if [[ -d "${CUDA_PATH}/include" ]]; then
    echo "✓ ${CUDA_PATH}/include exists"
else
    echo "✗ ${CUDA_PATH}/include not found"
    exit 1
fi

# Check for lib directory (Windows uses lib, Linux uses lib64)
if [[ -d "${CUDA_PATH}/lib64" ]]; then
    echo "✓ ${CUDA_PATH}/lib64 exists"
elif [[ -d "${CUDA_PATH}/lib" ]]; then
    echo "✓ ${CUDA_PATH}/lib exists"
else
    echo "✗ ${CUDA_PATH}/lib or lib64 not found"
    exit 1
fi

# Detect platform (prefer GitHub's RUNNER_OS when available)
RUNNER_OS_NORMALIZED="${RUNNER_OS:-}"
if [[ -z "${RUNNER_OS_NORMALIZED}" ]]; then
    case "$(uname -s 2>/dev/null || echo unknown)" in
        MINGW*|MSYS*|CYGWIN*) RUNNER_OS_NORMALIZED="Windows" ;;
        Darwin*) RUNNER_OS_NORMALIZED="macOS" ;;
        Linux*) RUNNER_OS_NORMALIZED="Linux" ;;
        *) RUNNER_OS_NORMALIZED="unknown" ;;
    esac
fi

# On Windows, nvcc needs the MSVC host compiler (cl.exe). GitHub runners sometimes
# don't have it on PATH inside bash. We'll try to enable it, and if we can't,
# we'll skip the compilation test (but still validate the CUDA install).
maybe_enable_msvc_windows() {
    [[ "${RUNNER_OS_NORMALIZED}" == "Windows" ]] || return 0

    if command -v cl.exe &>/dev/null; then
        return 0
    fi

    echo ""
    echo "MSVC host compiler (cl.exe) not found in PATH. Attempting to enable Visual Studio environment..."

    # Try to locate VS installation via vswhere.exe
    # Note: Windows env vars may include parentheses, so use printenv instead of ${ProgramFiles(x86)}
    local programfiles_x86
    programfiles_x86="$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)"
    local vswhere_winpath="${programfiles_x86}\\Microsoft Visual Studio\\Installer\\vswhere.exe"
    local vswhere=""

    # Convert to MSYS path if needed (Git-Bash provides cygpath)
    if command -v cygpath &>/dev/null; then
        vswhere="$(cygpath -u "$vswhere_winpath" 2>/dev/null || true)"
    fi

    # Fallback common path if cygpath isn't available
    if [[ -z "${vswhere}" ]]; then
        vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    fi

    if [[ ! -f "${vswhere}" ]]; then
        echo "⚠ vswhere.exe not found; cannot auto-enable MSVC environment."
        return 0
    fi

    local vs_install
    vs_install="$(${vswhere} -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null || true)"

    if [[ -z "${vs_install}" ]]; then
        echo "⚠ Visual Studio with C++ build tools not found via vswhere.exe."
        return 0
    fi

    # Prefer VsDevCmd.bat (sets a complete dev environment)
    local vsdevcmd
    vsdevcmd="${vs_install}\\Common7\\Tools\\VsDevCmd.bat"
    local vcvars64
    vcvars64="${vs_install}\\VC\\Auxiliary\\Build\\vcvars64.bat"

    local bat_to_call=""
    if [[ -f "${vsdevcmd}" ]]; then
        bat_to_call="${vsdevcmd}"
    elif [[ -f "${vcvars64}" ]]; then
        bat_to_call="${vcvars64}"
    else
        echo "⚠ Could not find VsDevCmd.bat or vcvars64.bat under: ${vs_install}"
        return 0
    fi

    # Export the environment from cmd.exe into this bash process.
    # We parse `set` output lines as KEY=VALUE.
    local env_dump
    env_dump="$(cmd.exe /c "call \"${bat_to_call}\" -arch=amd64 -host_arch=amd64 >nul 2>&1 && set" 2>nul | tr -d '\r' || true)"

    if [[ -z "${env_dump}" ]]; then
        echo "⚠ Failed to capture Visual Studio environment."
        return 0
    fi

    while IFS='=' read -r key val; do
        # Skip malformed lines
        [[ -z "${key}" ]] && continue
        export "${key}=${val}"
    done <<< "${env_dump}"

    if command -v cl.exe &>/dev/null; then
        echo "✓ MSVC environment enabled (cl.exe now found)"
    else
        echo "⚠ MSVC environment attempted but cl.exe still not found"
    fi
}

maybe_enable_msvc_windows

# Try to compile a simple CUDA program
echo ""
echo "Testing CUDA compilation..."

cat > test_cuda.cu << 'EOF'
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

# On Windows, nvcc requires MSVC's cl.exe. If it's not available, skip this test.
if [[ "${RUNNER_OS_NORMALIZED}" == "Windows" ]] && ! command -v cl.exe &>/dev/null; then
    echo "⚠ Skipping CUDA compilation test on Windows because cl.exe was not found in PATH."
    echo "  (CUDA toolkit is installed, but MSVC Build Tools are required to compile with nvcc.)"
    rm -f test_cuda.cu
else
    # Compile only: GitHub runners typically don't have a GPU, so execution is unreliable.
    if [[ "${RUNNER_OS_NORMALIZED}" == "Windows" ]]; then
        # Object-only compile to validate nvcc + host compiler integration
        if nvcc -c test_cuda.cu -o test_cuda.obj; then
            echo "✓ CUDA compilation successful"
        else
            echo "✗ CUDA compilation failed"
            rm -f test_cuda.cu test_cuda.obj
            exit 1
        fi
        rm -f test_cuda.cu test_cuda.obj
    else
        if nvcc -o test_cuda test_cuda.cu; then
            echo "✓ CUDA compilation successful"
            if ./test_cuda; then
                echo "✓ CUDA program execution successful"
            else
                echo "✗ CUDA program execution failed"
                rm -f test_cuda test_cuda.cu
                exit 1
            fi
        else
            echo "✗ CUDA compilation failed"
            rm -f test_cuda.cu
            exit 1
        fi
        rm -f test_cuda test_cuda.cu
    fi
fi

# Test CMake integration
echo ""
echo "Testing CMake CUDA support..."

if command -v cmake &>/dev/null; then
    cat > test_cuda_cmake.cu << 'EOF'
#include <stdio.h>

int main() {
    printf("CMake CUDA test\n");
    return 0;
}
EOF

    cat > CMakeLists.txt << 'EOF'
cmake_minimum_required(VERSION 3.18)
project(CUDATest CUDA)

add_executable(test_cmake test_cuda_cmake.cu)
EOF

    mkdir -p build_test
    if cmake -B build_test -S . &>/dev/null && cmake --build build_test &>/dev/null; then
        echo "✓ CMake CUDA configuration successful"
        if ./build_test/test_cmake; then
            echo "✓ CMake CUDA build successful"
        fi
    else
        echo "✗ CMake CUDA configuration failed (this may be expected if CMake is not available)"
    fi

    # Clean up CMake test files
    rm -rf build_test test_cuda_cmake.cu CMakeLists.txt
else
    echo "⚠ CMake not available, skipping CMake test"
fi

echo ""
echo "Post-CI verification complete!"
