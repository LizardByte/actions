#!/bin/bash

set -euo pipefail

echo "Starting disk space monitoring for CI test..."

# Start the monitoring using the action directly
chmod +x ./actions/monitor_space/monitor.sh
"./actions/monitor_space/monitor.sh" --mode=start --storage-path=".monitor_space_ci"

echo "Monitoring started. Current directory contents:"
ls -la

# Simulate some disk space usage by creating temporary files
echo "Creating temporary files to consume disk space..."
mkdir -p temp_test_files

# Create several files of different sizes to simulate real usage
for i in {1..5}; do
    # Create files ranging from 10MB to 50MB
    size=$((10 + i * 8))
    echo "Creating temp file ${i} of ${size}MB..."

    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        # Windows - use fsutil or PowerShell as fallback
        if command -v fsutil &>/dev/null; then
            fsutil file createnew "temp_test_files/test_file_${i}.tmp" $((size * 1024 * 1024))
        else
            # PowerShell fallback for Windows
            powershell -Command "\$bytes = New-Object byte[] ($size * 1024 * 1024); [System.IO.File]::WriteAllBytes('temp_test_files/test_file_${i}.tmp', \$bytes)"
        fi
    else
        # Linux/macOS - use dd with /dev/zero
        dd if=/dev/zero of="temp_test_files/test_file_${i}.tmp" bs=1M count=${size} 2>/dev/null
    fi
done

echo "Temporary files created:"
ls -lh temp_test_files/

# Wait a bit to let the monitor capture the space usage
sleep 10

echo "Pre-CI setup complete. Monitor should be tracking space usage."
