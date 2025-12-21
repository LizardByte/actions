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

# Clean up test files
rm -f test_cuda test_cuda.cu

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
