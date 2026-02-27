# screenshot

A reusable action to install and setup a cross-platform screenshot CLI tool for GitHub Actions runners.

This action installs the necessary screenshot tools and provides a path to a CLI command that can be called repeatedly
in your tests, scripts, or workflow steps. This is ideal for unit tests that need to capture screenshots at specific
points in time or for debugging purposes.

## 🛠️ Prep Work

### Windows & macOS
No preparation needed! These platforms have built-in screenshot capabilities.

### Linux
Linux requires a display server (X11 or Wayland) to be running. Use the virtual desktop setup action before this one:

```yaml
- name: Setup virtual display
  uses: LizardByte/actions/actions/virtual_desktop@master
  with:
    environment: xfce
```

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Setup screenshot tool
    id: screenshot-tool
    uses: LizardByte/actions/actions/screenshot@master

  - name: Take a screenshot
    run: ${{ steps.screenshot-tool.outputs.tool-path }} --output-path=screenshot.png --delay=1000
```

## 📥 Inputs

This action has no inputs.

## 📤 Outputs

| Name      | Description                                                                 |
|-----------|-----------------------------------------------------------------------------|
| tool-path | Command to execute the screenshot tool (includes the full command/path)     |

## 📟 CLI Tool Usage

The screenshot tool supports the following arguments:

### Arguments

| Argument       | Description                                    | Required | Default |
|----------------|------------------------------------------------|----------|---------|
| --output-path  | Path where the screenshot will be saved        | Yes      | N/A     |
| --delay        | Delay in milliseconds before taking screenshot | No       | 0       |

### Examples

```bash
# Basic screenshot
$TOOL_PATH --output-path=screenshot.png

# Screenshot with 2 second delay
$TOOL_PATH --output-path=screenshot.png --delay=2000

# Screenshot to specific directory
$TOOL_PATH --output-path=./screenshots/test-$(date +%s).png
```

## Platform-Specific Details

### Windows
- Uses PowerShell with `System.Windows.Forms` and `System.Drawing`
- **DPI-aware**: Automatically handles high-DPI displays correctly
- Captures all screens in multi-monitor setups
- Saves as PNG format

### macOS
- Uses built-in `screencapture` command
- No additional dependencies required
- Captures the entire desktop
- Saves as PNG format

### Linux
- Uses ImageMagick `import` command
- Automatically installed during setup if not present
- Requires X11 or Wayland display server
- Saves as PNG format

> [!NOTE]
> On Linux, this action requires a running display server.
> GitHub's default Linux runners don't have a display by default,
> so you'll need to set one up using a tool like `xvfb` or a headless GUI action.

## 🖥 Example Workflows

### Basic Usage

```yaml
name: Screenshot Test
on: [push]

jobs:
  screenshot:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [windows-latest, macos-latest]
    steps:
      - name: Setup screenshot tool
        id: screenshot
        uses: LizardByte/actions/actions/screenshot@master

      - name: Take screenshot
        run: ${{ steps.screenshot.outputs.tool-path }} --output-path=desktop.png

      - name: Upload screenshot
        uses: actions/upload-artifact@v6
        with:
          name: screenshot-${{ matrix.os }}
          path: desktop.png
```

### Multiple Screenshots in Tests

```yaml
steps:
  - name: Setup screenshot tool
    id: screenshot
    uses: LizardByte/actions/actions/screenshot@master

  - name: Run tests with screenshots
    env:
      SCREENSHOT_TOOL: ${{ steps.screenshot.outputs.tool-path }}
    run: |
      # Take screenshot before test
      $SCREENSHOT_TOOL --output-path=before-test.png

      # Run your application or test
      npm test

      # Take screenshot after test
      $SCREENSHOT_TOOL --output-path=after-test.png --delay=500

      # Take screenshot on specific event
      if [ $? -ne 0 ]; then
        $SCREENSHOT_TOOL --output-path=error-screenshot.png
      fi
```

### Python Unit Tests

```yaml
steps:
  - name: Setup screenshot tool
    id: screenshot
    uses: LizardByte/actions/actions/screenshot@master

  - name: Run tests
    env:
      SCREENSHOT_CMD: ${{ steps.screenshot.outputs.tool-path }}
    run: pytest tests/
```

```python
# In your test file
import os
import subprocess

def take_screenshot(name):
    """Helper to take screenshots during tests"""
    screenshot_cmd = os.environ.get('SCREENSHOT_CMD')
    if screenshot_cmd:
        subprocess.run(f'{screenshot_cmd} --output-path=screenshots/{name}.png', shell=True)

def test_ui_element():
    take_screenshot('before-click')
    # ... perform test actions ...
    take_screenshot('after-click')
```

### Linux with Virtual Display

```yaml
name: Linux Screenshot
on: [push]

jobs:
  screenshot:
    runs-on: ubuntu-latest
    steps:
      - name: Setup virtual desktop
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          environment: xfce

      - name: Setup screenshot tool
        id: screenshot
        uses: LizardByte/actions/actions/screenshot@master

      - name: Take screenshots
        run: |
          # Launch something visual
          xeyes &
          sleep 2

          # Take multiple screenshots
          ${{ steps.screenshot.outputs.tool-path }} --output-path=screenshot1.png
          sleep 1
          ${{ steps.screenshot.outputs.tool-path }} --output-path=screenshot2.png --delay=500

      - name: Upload screenshots
        uses: actions/upload-artifact@v6
        with:
          name: screenshots-linux
          path: "*.png"
```

### Cross-Platform Usage

```yaml
steps:
  - name: Setup screenshot tool
    id: screenshot
    uses: LizardByte/actions/actions/screenshot@master

  - name: Take screenshot (works on all platforms)
    run: ${{ steps.screenshot.outputs.tool-path }} --output-path=screenshot.png --delay=1000
```

### Debugging Failed Tests

```yaml
steps:
  - name: Setup screenshot tool
    id: screenshot
    uses: LizardByte/actions/actions/screenshot@master

  - name: Run tests
    id: tests
    continue-on-error: true
    run: npm test

  - name: Capture failure screenshot
    if: steps.tests.outcome == 'failure'
    run: ${{ steps.screenshot.outputs.tool-path }} --output-path=failure-screenshot.png

  - name: Upload failure screenshot
    if: steps.tests.outcome == 'failure'
    uses: actions/upload-artifact@v6
    with:
      name: failure-screenshot
      path: failure-screenshot.png
```

## 📝 Notes

- The tool outputs a **command** that can be called repeatedly in your tests
- Screenshots are saved in PNG format on all platforms
- The output directory is created automatically if it doesn't exist
- On Windows, the tool is DPI-aware and will capture high-resolution screenshots on high-DPI displays
- The delay parameter is useful when you need to wait for UI elements to load or animations to complete
