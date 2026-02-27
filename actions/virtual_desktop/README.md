# virtual_desktop

A reusable action to set up a virtual desktop environment on Linux GitHub Actions runners for GUI applications,
system tray icons, and notifications.

This action configures a headless X11 server (Xvfb) with a full desktop environment, enabling you to run and test GUI
applications that require a display, system tray support, or notification capabilities.

## 🛠️ Prep Work

**Linux Only** - This action only works on Linux runners and will fail if run on Windows or macOS.

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Setup virtual desktop
    uses: LizardByte/actions/actions/virtual_desktop@master
    with:
      appindicator-version: ayatana
      display-size: 1280x720
      environment: xfce
```

## 📥 Inputs

| Name                  | Description                                                           | Default    | Required |
|-----------------------|-----------------------------------------------------------------------|------------|----------|
| appindicator-version  | AppIndicator version (ayatana, legacy). Only applies to mate and xfce | `ayatana`  | `false`  |
| display-size          | Display resolution in WIDTHxHEIGHT format (e.g., 1920x1080)           | `1280x720` | `false`  |
| environment           | Desktop environment (fluxbox, lxde, mate, openbox, xfce)              | `xfce`     | `false`  |

## 📤 Outputs

| Name      | Description                           |
|-----------|---------------------------------------|
| display   | DISPLAY environment variable value    |
| xvfb-pid  | Process ID of the Xvfb server         |

## 🖥️ Desktop Environments

### Fluxbox

![Fluxbox Desktop](docs/images/screenshot-fluxbox.png)

**Best for:** Lightweight standalone window manager

- **Tray Support:** ✅ Good (stalonetray)
- **Notifications:** ✅ Full support (dunst)
- **Footprint:** Very small (~50MB)
- **Features:** Built-in toolbar, minimal dependencies

```yaml
with:
  environment: fluxbox
```

### LXDE

![LXDE Desktop](docs/images/screenshot-lxde.png)

**Best for:** Lightweight option with basic desktop features

- **Tray Support:** ✅ Good (lxpanel)
- **Notifications:** ✅ Full support (notification-daemon)
- **Footprint:** Small (~80MB)
- **Features:** Minimal resource usage, fast startup

```yaml
with:
  environment: lxde
```

### MATE

![MATE Desktop](docs/images/screenshot-mate.png)

**Best for:** Traditional desktop experience with excellent compatibility

- **Tray Support:** ✅ Excellent (mate-indicator-applet)
- **AppIndicator:** ✅ Full support (ayatana or legacy)
- **Notifications:** ✅ Full support (mate-notification-daemon)
- **Footprint:** Medium (~160MB)
- **Features:** Fork of GNOME 2, traditional desktop layout, high application compatibility

```yaml
with:
  appindicator-version: ayatana  # or 'legacy'
  environment: mate
```

### Openbox

![Openbox Desktop](docs/images/screenshot-openbox.png)

**Best for:** Minimal window manager with tray via tint2

- **Tray Support:** ✅ Good (tint2 panel)
- **Notifications:** ✅ Full support (dunst)
- **Footprint:** Very small (~50MB)
- **Features:** Standalone window manager, highly customizable

```yaml
with:
  environment: openbox
```

### XFCE

![XFCE Desktop](docs/images/screenshot-xfce.png)

**Best for:** Full-featured desktop with excellent tray support

- **Tray Support:** ✅ Excellent (xfce4-indicator-plugin)
- **AppIndicator:** ✅ Full support (ayatana or legacy)
- **Notifications:** ✅ Full support (xfce4-notifyd)
- **Footprint:** Medium (~150MB)
- **Features:** Complete desktop environment with panels, system tray, window decorations

```yaml
with:
  appindicator-version: ayatana  # or 'legacy'
  environment: xfce
```

## 🖥 Example Workflows

### Basic - Run GUI Application

```yaml
name: Test GUI App
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup virtual desktop
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          environment: xfce

      - name: Run GUI application
        run: |
          # DISPLAY is already set by the action
          python my_gui_app.py &
          sleep 5
```

### Testing System Tray Application

```yaml
name: Test Tray Icon
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup virtual desktop
        id: desktop
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          appindicator-version: ayatana
          display-size: 1920x1080
          environment: xfce

      - name: Install app dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y python3-gi gir1.2-ayatanaappindicator3-0.1

      - name: Run tray application
        run: |
          echo "Display: ${{ steps.desktop.outputs.display }}"
          python3 tray_app.py &
          APP_PID=$!
          sleep 5

          # Verify app is running
          if ps -p $APP_PID > /dev/null; then
            echo "Tray app is running"
          fi
```

### Testing Notifications

```yaml
name: Test Notifications
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Setup virtual desktop
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          environment: xfce

      - name: Send test notification
        run: |
          notify-send "Test Title" "Test message body"

      - name: Test Python notifications
        run: |
          sudo apt-get update
          sudo apt-get install -y python3-gi gir1.2-notify-0.7
          python3 -c "
          from gi.repository import Notify
          Notify.init('Test')
          n = Notify.Notification.new('Python Notification', 'From Python!')
          n.show()
          "
```

### With Screenshots

```yaml
name: Test with Screenshots
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Setup virtual desktop
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          environment: openbox
          display-size: 1024x768

      - name: Setup screenshot tool
        id: screenshot
        uses: LizardByte/actions/actions/screenshot@master

      - name: Run GUI and capture
        run: |
          xterm &
          sleep 2
          ${{ steps.screenshot.outputs.tool-path }} --output-path=desktop.png

      - name: Upload screenshot
        uses: actions/upload-artifact@v4
        with:
          name: desktop-screenshot
          path: desktop.png
```

### High Resolution Testing

```yaml
name: High-DPI Testing
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Setup 4K virtual desktop
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          environment: lxde
          display-size: 3840x2160

      - name: Run high-DPI tests
        run: pytest tests/test_hidpi.py
```

### Matrix Testing Multiple Environments

```yaml
name: Test All Environments
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        desktop: [xfce, lxde, openbox, fluxbox]
    steps:
      - name: Setup ${{ matrix.desktop }}
        uses: LizardByte/actions/actions/virtual_desktop@master
        with:
          environment: ${{ matrix.desktop }}

      - name: Run tests
        run: pytest tests/
```

## 📝 Notes

- **Linux Only:** This action will fail with an error if run on Windows or macOS runners
- **Display Variable:** The `DISPLAY` environment variable is automatically set for subsequent steps
- **Process Management:** Xvfb and the desktop environment run in the background for the duration of the job
- **Resource Usage:** Desktop environments vary in size:
  - Minimal (openbox, fluxbox): ~50MB
  - Lightweight (lxde): ~80MB
  - Full-featured (xfce): ~150MB
- **Tray Icons:** All environments support system tray icons through their respective panel implementations
- **AppIndicator Support:**
  - Only available on MATE and XFCE environments
  - **Ayatana** (recommended): Modern fork with active development
  - **Legacy**: Original Ubuntu implementation (deprecated but still available)
  - Python apps need `gir1.2-ayatanaappindicator3-0.1` or `gir1.2-appindicator3-0.1`
- **Notifications:** All environments include notification daemon support (`notify-send` command available)
- **Common Resolutions:**
  - HD: 1280x720
  - Full HD: 1920x1080
  - 4K: 3840x2160
  - Custom: Any WIDTHxHEIGHT format

## 🔧 Troubleshooting

### GUI Application Won't Start
```yaml
- name: Debug display
  run: |
    echo "DISPLAY=$DISPLAY"
    xdpyinfo | grep dimensions
```

### Tray Icon Not Appearing
Different environments have different tray implementations. Try XFCE for the most reliable tray support.

### Out of Memory
Use a lighter environment (openbox, fluxbox, or lxde) if you encounter memory issues.

## 🔗 See Also

This action works well with:
- [screenshot](../screenshot) - Capture screenshots of the virtual desktop
- [setup_python](../setup_python) - Set up Python for GUI testing

## 💡 Common Use Cases

- Testing GUI applications in CI/CD
- Running applications that require system tray support
- Testing notification functionality
- Automated screenshot capture of applications
- Integration testing for desktop applications
- AppIndicator testing (Ubuntu/GNOME style tray icons)
- Qt/GTK application testing
