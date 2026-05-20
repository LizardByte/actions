param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath,

    [Parameter(Mandatory=$false)]
    [int]$Delay = 0
)

$InformationPreference = 'Continue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Write-ColoredInformation {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Message,

        [Parameter(Mandatory=$true)]
        [string]$ColorCode
    )

    $escape = [char]27
    Write-Information "${escape}[${ColorCode}m${Message}${escape}[0m"
}

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
    Write-ColoredInformation -Message "Waiting $Delay ms before taking screenshot..." -ColorCode '33'
    Start-Sleep -Milliseconds $Delay
}

# Get the bounds of all screens combined
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen

Write-ColoredInformation -Message "Screenshot dimensions: $($bounds.Width)x$($bounds.Height)" -ColorCode '36'

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

Write-ColoredInformation -Message "Screenshot saved to: $OutputPath" -ColorCode '32'
