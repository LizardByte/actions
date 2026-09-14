Describe "screenshot.ps1" {
    It "captures the virtual screen as a PNG in a new output directory" {
        $scriptPath = Join-Path $PSScriptRoot "..\..\actions\screenshot\screenshot.ps1"
        $outputPath = Join-Path $TestDrive "screenshots\desktop.png"

        & $scriptPath -OutputPath $outputPath -Delay 1

        Test-Path -LiteralPath $outputPath | Should -BeTrue
        (Get-Item -LiteralPath $outputPath).Length | Should -BeGreaterThan 8
        $signature = [System.IO.File]::ReadAllBytes($outputPath)[0..7]
        [BitConverter]::ToString($signature).Replace("-", "") |
            Should -Be "89504E470D0A1A0A"
    }
}
