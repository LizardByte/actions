param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath,

    [Parameter(Mandatory=$false)]
    [int]$Delay = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Set DPI awareness
Add-Type @'
  using System;
  using System.Runtime.InteropServices;
  public class DPI {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
  }
'@
[DPI]::SetProcessDPIAware() | Out-Null

# Apply delay if specified
if ($Delay -gt 0) {
    Write-Information "Waiting $Delay ms before taking screenshot..." -ForegroundColor Yellow
    Start-Sleep -Milliseconds $Delay
}

# Get the bounds of all screens combined
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen

Write-Information "Screenshot dimensions: $($bounds.Width)x$($bounds.Height)" -ForegroundColor Cyan

# Create output directory if needed
$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and !(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Create bitmap
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# Capture the screen
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

# Save the screenshot
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Cleanup
$graphics.Dispose()
$bitmap.Dispose()

Write-Information "Screenshot saved to: $OutputPath" -ForegroundColor Green
