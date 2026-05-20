# standard imports
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def read_repo_file(path):
    return (REPO_ROOT / path).read_text(encoding='utf-8')


def test_windows_bash_detection_supports_cygwin_ostype():
    """GitHub Windows bash may report OSTYPE=cygwin instead of msys."""
    script_paths = [
        'actions/more_space/cleanup.sh',
        'actions/screenshot/action.yml',
        'actions/screenshot/screenshot.sh',
    ]

    for script_path in script_paths:
        assert 'cygwin' in read_repo_file(script_path), f'{script_path} should treat cygwin as Windows bash'


def test_screenshot_powershell_logging_uses_script_analyzer_safe_command():
    """Write-Host violates PSScriptAnalyzer and Write-Information has no foreground color."""
    screenshot_script = read_repo_file('actions/screenshot/screenshot.ps1')

    assert 'Write-Host' not in screenshot_script
    assert 'Write-Information' in screenshot_script
    assert '-ForegroundColor' not in screenshot_script


def test_screenshot_powershell_logging_keeps_color_codes():
    """The PowerShell script should preserve the original yellow, cyan, and green status colors."""
    screenshot_script = read_repo_file('actions/screenshot/screenshot.ps1')

    assert "-ColorCode '33'" in screenshot_script
    assert "-ColorCode '36'" in screenshot_script
    assert "-ColorCode '32'" in screenshot_script
