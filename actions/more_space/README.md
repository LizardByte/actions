# more_space

A reusable action to free up GitHub hosted runner space by removing unnecessary files and components.

## Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Free Disk Space
    uses: LizardByte/actions/actions/more_space@master
```

## Advanced Usage

```yaml
steps:
  - name: Free Disk Space with Analysis
    uses: LizardByte/actions/actions/more_space@master
    with:
      analyze-space-savings: true
      clean-all: true
      safe-packages: "jq,git"
```

## Inputs

| Name                  | Description                                                                                  | Default | Required |
|-----------------------|----------------------------------------------------------------------------------------------|---------|----------|
| analyze-space-savings | Generate detailed analysis of space savings by each input option                             | `false` | `false`  |
| clean-all             | When true, all inputs except 'safe-packages' are ignored and all cleanup options are enabled | `false` | `false`  |
| safe-packages         | A list of packages to keep. If found the cleanup step where found will be sipped             |         | `false`  |
| remove-android        | Remove Android SDK                                                                           | `false` | `false`  |
| remove-chocolatey     | Remove Chocolatey (Windows only)                                                             | `false` | `false`  |
| remove-codeql         | Remove CodeQL databases                                                                      | `false` | `false`  |
| remove-docker-images  | Remove Docker images                                                                         | `false` | `false`  |
| remove-docs-linux     | Remove /usr/share/doc (Linux only)                                                           | `false` | `false`  |
| remove-dotnet         | Remove .NET runtime and tools                                                                | `false` | `false`  |
| remove-haskell        | Remove Haskell                                                                               | `false` | `false`  |
| remove-homebrew       | Remove Homebrew (Linux/macOS only)                                                           | `false` | `false`  |
| remove-jvm            | Remove JVMs                                                                                  | `false` | `false`  |
| remove-swift          | Remove Swift  (Linux/macOS only)                                                             | `false` | `false`  |
| remove-tool-cache     | Remove runner tool cache                                                                     | `false` | `false`  |
| remove-tools-windows  | Remove /c/tools (Windows only)                                                               | `false` | `false`  |
| remove-xcode          | Remove Xcode (macOS only)                                                                    | `false` | `false`  |

## Outputs

| Name           | Description                                                                      |
|----------------|----------------------------------------------------------------------------------|
| space-after    | Free disk space after cleanup (GB)                                               |
| space-analysis | JSON formatted analysis of space savings by input option (sorted by space saved) |
| space-before   | Free disk space before cleanup (GB)                                              |
| space-saved    | Amount of disk space saved (GB)                                                  |

## Expected Space Savings

The following table shows the expected space savings for each cleanup option across different runner types. Values are in GB.

| Input Option           | ubuntu-22.04 | ubuntu-22.04-arm | ubuntu-24.04 | ubuntu-24.04-arm | windows-2022 | windows-2025 | windows-11-arm | macos-13 | macos-14 | macos-15 | macos-26 |
|------------------------|--------------|------------------|--------------|------------------|--------------|--------------|----------------|----------|----------|----------|----------|
| `remove-android`       | 8.49         | -                | 9.32         | -                | FIX          | FIX          | FIX            | 13.15    | 13.06    | 12.20    | 9.38     |
| `remove-codeql`        | 1.54         | -                | 1.54         | -                | 1.11         | 1.11         | 1.08           | 3.46     | 3.45     | 3.43     | 3.47     |
| `remove-dotnet`        | 1.10         | -                | FIX          | -                | 10.04        | 4.18         | 12.88          | 3.82     | 4.02     | 4.01     | 4.01     |
| `remove-docker-images` | 3.44         | 3.41             | 0.00         | 0.00             | 10.40        | 0.00         | -              | -        | -        | -        | -        |
| `remove-chocolatey`    | -            | -                | -            | -                | 2.56         | 2.52         | 2.38           | -        | -        | -        | -        |
| `remove-docs-linux`    | 0.13         | 0.14             | 0.12         | 0.12             | -            | -            | -              | -        | -        | -        | -        |
| `remove-haskell`       | 6.24         | -                | 6.24         | -                | 10.02        | 3.65         | -              | TODO     | TODO     | TODO     | TODO     |
| `remove-homebrew`      | 0.18         | -                | 0.18         | -                | -            | -            | -              | 1.65     | 7.36     | 7.84     | TODO     |
| `remove-jvm`           | 1.14         | 1.14             | 1.13         | 1.14             | 1.10         | 1.10         | 0.58           | 1.08     | 0.91     | 0.92     | 0.92     |
| `remove-swift`         | 2.70         | 2.68             | 2.71         | 2.68             | -            | -            | -              | 0.44     | 0.44     | 0.49     | 0.51     |
| `remove-tool-cache`    | 3.84         | -                | 3.47         | -                | 3.53         | 2.42         | 1.68           | 2.62     | 1.45     | 1.43     | 1.43     |
| `remove-tools-windows` | -            | -                | -            | -                | 0.22         | 0.22         | 0.21           | -        | -        | -        | -        |
| `remove-xcode`         | -            | -                | -            | -                | -            | -            | -              | 49.88    | 35.14    | 28.99    | 10.25    |
| Linux package cleanup  | 0.08         | 0.18             | 0.03         | 0.13             | -            | -            | -              | -        | -        | -        | -        |
| Total saved            | 28.88        | 7.55             | 24.74        | 4.07             | 38.98        | 15.20        | 18.81          | 76.10    | 65.83    | 59.31    | 29.97    |

## Examples

### Clean Everything

```yaml
- name: Free Maximum Disk Space
  uses: LizardByte/actions/actions/more_space@master
  with:
    clean-all: true
```

### Target Specific Components

```yaml
- name: Free Disk Space for Container Build
  uses: LizardByte/actions/actions/more_space@master
  with:
    remove-docker-images: true
    remove-dotnet: true
    remove-android: true
```

### Analyze Space Usage

```yaml
- name: Analyze Disk Space Usage
  uses: LizardByte/actions/actions/more_space@master
  with:
    analyze-space-savings: true
    clean-all: true

- name: Display Analysis
  run: echo '${{ steps.cleanup.outputs.space-analysis }}'
```

## Safe Package Protection

When using `safe-packages`, the action will:

1. Locate the specified packages using system commands (`which`, `where`)
2. Check if any cleanup target contains these packages
3. Skip removal of directories containing protected packages
4. Continue with other cleanup operations

This ensures critical tools remain available after cleanup.
