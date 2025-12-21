# setup_cuda

A reusable action to install NVIDIA CUDA Toolkit on Linux runners using the runfile installer.

This action provides a consistent way to install CUDA Toolkit across different Linux runners, including both standard
Ubuntu and ARM-based Ubuntu runners. The installation uses NVIDIA's official runfile installers and sets up all
necessary environment variables for C/C++ compilation.

## 🛠️ Prep Work

This action is designed for Linux runners only and requires:
- Ubuntu-based runner (standard x86_64 or ARM64/aarch64)
- Sufficient disk space (CUDA Toolkit requires ~3-4 GB)
- `sudo` access (required for installation)

> [!NOTE]
> This action installs the CUDA Toolkit only (compiler, libraries, headers) and does not install GPU drivers,
> as they are not needed for compilation and are not available in standard GitHub Actions runners.

> [!TIP]
> To find the correct CUDA version and driver version combination, visit the
> [NVIDIA CUDA Toolkit Downloads](https://developer.nvidia.com/cuda-downloads) page and select your desired version.
> The driver version is part of the runfile name.

## 🚀 Basic Usage

See [action.yml](action.yml)

### CUDA 12.4.1
```yaml
steps:
  - name: Setup CUDA 12.4.1
    uses: LizardByte/actions/actions/setup_cuda@master
    with:
      cuda-version: '12.4.1'
      driver-version: '550.54.15'
  - name: Verify CUDA Version
    run: nvcc --version
```

### Custom Installation Path
```yaml
steps:
  - name: Setup CUDA
    uses: LizardByte/actions/actions/setup_cuda@master
    with:
      cuda-version: '12.6.2'
      driver-version: '560.35.03'
      install-path: '/opt/cuda'
```

## 📥 Inputs

| Name           | Description                                                             | Default           | Required |
|----------------|-------------------------------------------------------------------------|-------------------|----------|
| cuda-version   | The version of CUDA Toolkit to install (e.g., '12.6.2', '11.8.0')       |                   | `true`   |
| driver-version | The driver version in the runfile name (e.g., '560.35.03', '520.61.05') |                   | `true`   |
| install-path   | Installation path for CUDA Toolkit                                      | `/usr/local/cuda` | `false`  |

> [!NOTE]
> The `driver-version` is the version number included in NVIDIA's runfile name. For example, for the file
> `cuda_12.4.1_550.54.15_linux.run`, the cuda-version is `12.4.1` and the driver-version is `550.54.15`.
> You can find these on the [NVIDIA CUDA Downloads](https://developer.nvidia.com/cuda-downloads) page.

## 📤 Outputs

| Name         | Description                            |
|--------------|----------------------------------------|
| cuda-version | The version of CUDA that was installed |
| cuda-path    | The installation path of CUDA Toolkit  |
| nvcc-path    | The path to the nvcc compiler          |

## 📝 Notes

### Supported CUDA Versions

This action can install **any** CUDA Toolkit version available from NVIDIA, as long as you provide the correct
`cuda-version` and `driver-version` combination. There is no hardcoded list of supported versions.

> [!TIP]
> To find the driver version for any CUDA version:
> 1. Visit [NVIDIA CUDA Toolkit Archive](https://developer.nvidia.com/cuda-toolkit-archive)
> 2. Select your desired CUDA version
> 3. Choose "Linux" → "x86_64" (or "sbsa" for ARM) → "Ubuntu" → "runfile (local)"
> 4. The download link will show the full runfile name, which includes the driver version
>
> For example: `cuda_12.4.1_550.54.15_linux.run` means driver version is `550.54.15`

> [!NOTE]
> The action automatically detects your architecture and downloads the appropriate installer:
> - **x86_64**: Downloads `cuda_X.Y.Z_DDD.DD.DD_linux.run`
> - **aarch64**: Downloads `cuda_X.Y.Z_DDD.DD.DD_linux_sbsa.run` (Server Base System Architecture)

### Environment Variables

This action automatically sets up the following environment variables for subsequent steps:

- `CUDA_PATH` - Path to CUDA installation (e.g., `/usr/local/cuda`)
- `CUDA_HOME` - Same as CUDA_PATH (for compatibility)
- `CUDA_ROOT` - Same as CUDA_PATH (for compatibility)
- `CMAKE_CUDA_COMPILER` - Path to nvcc compiler
- `PATH` - Updated to include `${CUDA_PATH}/bin`
- `LD_LIBRARY_PATH` - Updated to include `${CUDA_PATH}/lib64`
- `LIBRARY_PATH` - Updated to include `${CUDA_PATH}/lib64`
- `CPATH` - Updated to include `${CUDA_PATH}/include`

These variables make it easy to compile CUDA code with various build systems (Make, CMake, etc.).

### Installation Details

- **Installation Method**: Official NVIDIA runfile installer
- **Components Installed**: CUDA Toolkit only (compiler, libraries, headers)
- **Components NOT Installed**: GPU drivers, OpenGL libraries (not needed for compilation)
- **Installation Size**: ~3-4 GB depending on version
- **Installation Time**: ~2-5 minutes depending on runner speed

### CMake Integration

The action sets `CMAKE_CUDA_COMPILER` automatically, so CMake will find the correct nvcc compiler.

## 🔗 See Also

- [more_space](../more_space) - Free up disk space if needed before CUDA installation
- [monitor_space](../monitor_space) - Monitor disk space usage during CUDA installation

## ⚠️ Limitations

- **Linux Only**: This action only supports Linux runners (Ubuntu-based)
- **No GPU Execution**: GitHub Actions runners don't have GPUs, so you can compile CUDA code but not run it
- **No Driver Installation**: GPU drivers are not installed (not needed for compilation)
- **Architecture Support**: Only x86_64 and ARM64/aarch64 architectures are supported
