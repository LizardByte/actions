#!/bin/bash

# Create a dummy binary file to simulate with virustotal scan

# Create output directory if it doesn't exist
mkdir -p dist

# Create a simple dummy executable
cat > dist/dummy-binary << 'EOF'
#!/bin/bash
echo "This is a dummy binary for VirusTotal testing"
exit 0
EOF

# Make it executable
chmod +x dist/dummy-binary

# Validate the binary file was created successfully
if [[ -f "dist/dummy-binary" && -x "dist/dummy-binary" ]]; then
    echo "Valid dummy binary created at dist/dummy-binary"
    echo "File size: $(stat -c%s dist/dummy-binary) bytes"
    echo "File type: $(file dist/dummy-binary)"
else
    echo "Error: Failed to create valid dummy binary"
    exit 1
fi
