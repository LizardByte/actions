# setup_cuda

A reusable action to install NVIDIA CUDA Toolkit on Linux and Windows runners using official installers.

This action provides a consistent way to install CUDA Toolkit across different runners, including Linux (x86_64, ARM64)
and Windows (x86_64). The installation uses NVIDIA's official installers and sets up all necessary environment
variables for C/C++ compilation.

## 🛠️ Prep Work

This action supports the following runners:

- **Linux**: Ubuntu-based runners (x86_64 or ARM64/aarch64) - requires `sudo` access
- **Windows**: Windows Server runners (x86_64) with a CUDA-compatible MSVC toolchain
- **macOS**: Skipped successfully because CUDA is not supported

Requirements:

- Sufficient disk space for the selected toolkit components (typically several GB)
- On Windows, a Visual Studio C++ toolchain supported by the requested CUDA version

> [!NOTE]
> This action does not install GPU drivers. On Windows it explicitly installs the development toolkit and
> Visual Studio build integration, while omitting the display driver, profilers, samples, and documentation.

> [!TIP]
> To find the correct CUDA version and driver version combination:
> - **For Linux**: Visit [NVIDIA CUDA Toolkit Downloads](https://developer.nvidia.com/cuda-downloads), select Linux, and note the driver version in the runfile name
> - **For Windows**: Only the CUDA version is needed

## 🚀 Basic Usage

See [action.yml](action.yml)

### Linux - CUDA 13.1.0
```yaml
steps:
  - name: Setup CUDA 13.1.0
    uses: LizardByte/actions/actions/setup_cuda@master
    with:
      cuda-version: '13.1.0'
      driver-version: '590.44.01'  # Required for Linux
  - name: Verify CUDA Version
    run: nvcc --version
```

### Custom Installation Path

```yaml
steps:
  - name: Setup CUDA
    uses: LizardByte/actions/actions/setup_cuda@master
    with:
      cuda-version: '13.1.0'
      driver-version: '590.44.01'
      install-path: '/opt/cuda'
```

### Windows - CUDA 13.1.0

CUDA 13.1 supports Visual Studio 2022, so use the matching runner image rather than `windows-latest`:

```yaml
jobs:
  build:
    runs-on: windows-2022
    steps:
      - name: Setup CUDA 13.1.0
        uses: LizardByte/actions/actions/setup_cuda@master
        with:
          cuda-version: '13.1.0'
      - name: Verify CUDA Version
        run: nvcc --version
```

## 📥 Inputs

| Name           | Description                                                            | Default           | Required |
|----------------|------------------------------------------------------------------------|-------------------|----------|
| cuda-version   | The version of CUDA Toolkit to install (e.g., '13.1.0', '12.4.1')      |                   | `true`   |
| driver-version | The driver version in the runfile name (Linux only, e.g., '590.44.01') |                   | `false`* |
| install-path   | Installation path for CUDA Toolkit (Linux only)                        | OS default        | `false`  |

\* `driver-version` is required for Linux and unused on Windows.

> [!NOTE]
> **Linux**: The `driver-version` is required and must match the driver version in NVIDIA's runfile name.
> - Example: `cuda_13.1.0_590.44.01_linux.run` → driver-version: `590.44.01`
>
> **Windows**: The `driver-version` is not used. Windows uses the network installer which doesn't require specifying a driver version.
> - Network installer: `cuda_13.1.0_windows_network.exe`
>
> **macOS**: CUDA is not supported, so the action exits successfully without installing anything.

> [!TIP]
> Find driver versions on the [NVIDIA CUDA Downloads](https://developer.nvidia.com/cuda-downloads) page by selecting Linux and viewing the runfile name.

## 📤 Outputs

| Name         | Description                            |
|--------------|----------------------------------------|
| cuda-version | The version of CUDA that was installed |
| cuda-path    | The installation path of CUDA Toolkit  |
| nvcc-path    | The path to the nvcc compiler          |

## 📝 Notes

### Supported Platforms & Installers

The requested CUDA Toolkit release must be available from NVIDIA's installer archive. Ensure the selected runner's
host compiler is supported by that CUDA release.

| Platform       | Installer Type    | Driver Version |
|----------------|-------------------|----------------|
| Linux x86_64   | Local runfile     | ✅ Required     |
| Linux ARM64    | Local runfile     | ✅ Required     |
| Windows x86_64 | Network installer | ❌ Not needed   |
| macOS          | N/A (skipped)     | ❌ Not needed   |

> [!TIP]
> **For Linux**: Find the driver version by visiting [NVIDIA CUDA Toolkit Archive](https://developer.nvidia.com/cuda-toolkit-archive):
> 1. Select your desired CUDA version
> 2. Choose "Linux" → "x86_64" (or "sbsa" for ARM) → "Ubuntu" → "runfile (local)"
> 3. The download link shows the full runfile name with driver version
>
> Example: `cuda_13.1.0_590.44.01_linux.run` means driver version is `590.44.01`

> [!TIP]
> **For Windows**: Only specify the `cuda-version`. The action selects development components explicitly and does
> not install the GPU driver. The install path is NVIDIA's versioned default and cannot be customized.

> [!NOTE]
> The action automatically detects your platform and downloads the appropriate installer:
> - **Linux x86_64**: `cuda_X.Y.Z_DDD.DD.DD_linux.run`
> - **Linux aarch64**: `cuda_X.Y.Z_DDD.DD.DD_linux_sbsa.run` (Server Base System Architecture)
> - **Windows**: `cuda_X.Y.Z_windows_network.exe` (network installer)
> - **macOS**: Skipped successfully

### Environment Variables

This action automatically sets up the following environment variables for subsequent steps:

- `CUDA_PATH` - Path to CUDA installation (e.g., `/usr/local/cuda`)
- `CUDA_HOME` - Same as CUDA_PATH (for compatibility)
- `CUDA_ROOT` - Same as CUDA_PATH (for compatibility)
- `CMAKE_CUDA_COMPILER` - Path to nvcc compiler
- `PATH` - Updated to include `${CUDA_PATH}/bin`
- `LD_LIBRARY_PATH` - Updated to include `${CUDA_PATH}/lib64` (Linux only)
- `LIBRARY_PATH` - Updated to include `${CUDA_PATH}/lib64` (Linux only)
- `CPATH` - Updated to include `${CUDA_PATH}/include` (Linux only)

These variables make it easy to compile CUDA code with various build systems (Make, CMake, etc.).

### Installation Details

**Linux:**
- **Installation Method**: Official NVIDIA runfile installer (local)
- **Components Installed**: CUDA Toolkit only (compiler, libraries, headers)
- **Components NOT Installed**: GPU drivers, OpenGL libraries
- **Installation Size**: ~3-4 GB depending on version
- **Installation Time**: ~2-5 minutes depending on runner speed

**Windows:**
- **Installation Method**: Official NVIDIA network installer
- **Components Installed**: Development toolkit (compiler, libraries, headers) and Visual Studio build integration
- **Components NOT Installed**: GPU driver, profilers, samples, documentation
- **Download Size**: The bootstrap installer is small; selected components are downloaded during installation
- **Installation Time**: ~5-10 minutes (downloads components as needed)

**macOS:**
- Skipped successfully because CUDA is not supported

### CMake Integration

The action sets `CMAKE_CUDA_COMPILER` automatically, so CMake will find the correct nvcc compiler.

## 🔗 See Also

- [more_space](../more_space) - Free up disk space if needed before CUDA installation
- [monitor_space](../monitor_space) - Monitor disk space usage during CUDA installation

## ⚠️ Limitations

- **No GPU Execution**: GitHub Actions runners don't have GPUs, so you can compile CUDA code but not run it
- **No Driver Installation**: GPU drivers are not installed (not needed for compilation)
- **Platform Support**:
  - ✅ Linux x86_64 and ARM64/aarch64 (full support)
  - ✅ Windows x86_64 (full support via network installer)
  - ⚠️ macOS (successful no-op because CUDA is not supported)
- **Linux Requirements**: Requires `sudo` access for installation
- **Windows**: Install path not customizable (uses NVIDIA default location)
