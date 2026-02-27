#!/usr/bin/env python3
"""Test script for AppIndicator/Ayatana support in virtual desktop environments."""
import signal
import sys


def main():
    """Create a test AppIndicator with a built-in icon."""
    # AppIndicator is only available on Linux
    if sys.platform != 'linux':
        print(f"Skipping AppIndicator test on {sys.platform} (only supported on Linux)")
        return

    # Get appindicator version from command line argument (default: ayatana)
    appindicator_version = sys.argv[1] if len(sys.argv) > 1 else 'ayatana'

    # Import gi modules only on Linux to avoid import errors on other platforms
    import gi

    if appindicator_version == 'ayatana':
        gi.require_version('AyatanaAppIndicator3', '0.1')
        from gi.repository import AyatanaAppIndicator3 as AppIndicator
        print("Using Ayatana AppIndicator")
    elif appindicator_version == 'legacy':
        gi.require_version('AppIndicator3', '0.1')
        from gi.repository import AppIndicator3 as AppIndicator
        print("Using Legacy AppIndicator")
    else:
        print(f"Error: Invalid appindicator version '{appindicator_version}'")
        sys.exit(1)

    from gi.repository import GLib
    from gi.repository import Gtk

    indicator = AppIndicator.Indicator.new(
        "test-indicator",
        "mail-message-new",
        AppIndicator.IndicatorCategory.APPLICATION_STATUS
    )
    indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
    indicator.set_title("Test AppIndicator")

    # Create a simple menu
    menu = Gtk.Menu()
    item = Gtk.MenuItem(label="Test Item")
    menu.append(item)
    item.show()
    indicator.set_menu(menu)

    # Exit after 3 seconds
    GLib.timeout_add_seconds(3, Gtk.main_quit)

    Gtk.main()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    main()
