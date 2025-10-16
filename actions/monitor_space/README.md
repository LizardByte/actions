# monitor_space

A reusable action to monitor disk space usage during workflow execution.

This action can track disk space consumption by starting a background monitoring process at the beginning of your
workflow and stopping it later to generate a comprehensive report of space usage.

## 🚀 Basic Usage

See [action.yml](action.yml)

### Start Monitoring
```yaml
steps:
  - name: Start Space Monitoring
    uses: LizardByte/actions/actions/monitor_space@master
    with:
      mode: start
```

### Stop Monitoring and Get Results
```yaml
steps:
  - name: Stop Space Monitoring
    uses: LizardByte/actions/actions/monitor_space@master
    with:
      mode: stop
```

## 📥 Inputs

| Name          | Description                                                            | Default                              | Required |
|---------------|------------------------------------------------------------------------|--------------------------------------|----------|
| mode          | Operation mode: 'start' to begin monitoring, 'stop' to end and report  |                                      | `true`   |
| storage-path  | Path to store monitoring data (default: GitHub workspace temp dir)     | `${GITHUB_WORKSPACE}/.monitor_space` | `false`  |

## 📤 Outputs

| Name                 | Description                                             |
|----------------------|---------------------------------------------------------|
| current-space        | Current free disk space (GB)                            |
| minimum-space        | Minimum free disk space recorded during monitoring (GB) |
| space-consumed       | Maximum space consumed during monitoring (GB)           |
| monitoring-duration  | Duration of monitoring session (seconds)                |

## 🧰 Advanced Usage

```yaml
steps:
  # First, free up space using more_space action
  - name: Free Disk Space
    uses: LizardByte/actions/actions/more_space@master
    with:
      clean-all: true

  # Start monitoring after cleanup
  - name: Start Space Monitoring
    uses: LizardByte/actions/actions/monitor_space@master
    with:
      mode: start

  # Your workflow steps that consume disk space
  - name: Build Application
    run: |
      # Your build commands here
      echo "Building application..."

  - name: Run Tests
    run: |
      # Your test commands here
      echo "Running tests..."

  # Stop monitoring and get final report
  - name: Stop Space Monitoring
    id: space-monitor
    uses: LizardByte/actions/actions/monitor_space@master
    with:
      mode: stop

  # Use the monitoring results
  - name: Display Space Usage
    run: |
      echo "Current free space: ${{ steps.space-monitor.outputs.current-space }} GB"
      echo "Minimum free space: ${{ steps.space-monitor.outputs.minimum-space }} GB"
      echo "Maximum space consumed: ${{ steps.space-monitor.outputs.space-consumed }} GB"
      echo "Monitoring duration: ${{ steps.space-monitor.outputs.monitoring-duration }} seconds"
```

## 📝 Notes

### Features

- **Cross-platform**: Works on Linux, Windows, and macOS
- **Background monitoring**: Continuously tracks disk space every 5 seconds
- **Minimum tracking**: Records the lowest free space encountered
- **Safe cleanup**: Automatically stops background processes
- **Detailed reporting**: Provides comprehensive space usage statistics

### How It Works

1. **Start Mode**:
   - Records initial free disk space
   - Starts a background process that checks disk space every 5 seconds
   - Tracks the minimum free space encountered
   - Stores monitoring data in a temporary file

2. **Stop Mode**:
   - Stops the background monitoring process
   - Calculates final statistics including minimum space and duration
   - Outputs comprehensive report
   - Cleans up temporary monitoring files

### Platform Support

- **Linux**: Uses `df` command to get disk space information
- **macOS**: Uses `df` command with macOS-specific formatting
- **Windows**: Uses PowerShell `Get-WmiObject` to query disk space

### Error Handling

- Validates that monitoring was started before attempting to stop
- Gracefully handles background process cleanup
- Provides clear error messages for invalid usage
- Automatically creates the necessary directories for data storage

## 🔗 See Also

This action can be used in conjunction with [more_space](../more_space).
