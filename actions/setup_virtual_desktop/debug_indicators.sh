#!/bin/bash
# Debug script to check AppIndicator environment

echo "=== AppIndicator Debug Information ==="
echo ""

echo "1. Checking if indicator service is running:"
pgrep -fa "(ayatana-indicator|indicator-application)" || echo "  No indicator service found"
echo ""

echo "2. Checking D-Bus session:"
echo "  DBUS_SESSION_BUS_ADDRESS: ${DBUS_SESSION_BUS_ADDRESS:-NOT SET}"
echo ""

echo "3. Checking if indicator service is on D-Bus:"
dbus-send --session --dest=org.freedesktop.DBus --print-reply /org/freedesktop/DBus \
  org.freedesktop.DBus.ListNames 2>/dev/null | grep -i indicator || echo "  No indicator service registered on D-Bus"
echo ""

echo "4. Checking GObject Introspection typelibs:"
ls -lh /usr/lib/x86_64-linux-gnu/girepository-1.0/*AppIndicator* 2>/dev/null || echo "  No AppIndicator typelibs found"
echo ""

echo "5. Checking panel processes:"
pgrep -fa "(mate-panel|xfce4-panel)" || echo "  No panel found"
echo ""

echo "6. Checking DISPLAY:"
echo "  DISPLAY: ${DISPLAY:-NOT SET}"
echo ""

echo "7. Installed AppIndicator packages:"
dpkg -l | grep -E "(ayatana-indicator|libayatana-appindicator|gir1.2-ayatanaappindicator|gir1.2-appindicator|indicator-application)" || echo "  No AppIndicator packages installed"
echo ""

echo "8. Testing simple indicator registration:"
python3 -c "
import gi
try:
    gi.require_version('AyatanaAppIndicator3', '0.1')
    from gi.repository import AyatanaAppIndicator3 as AppIndicator
    print('  ✓ Python can import AyatanaAppIndicator3 (Ayatana)')
    indicator = AppIndicator.Indicator.new('test', 'mail-message-new', AppIndicator.IndicatorCategory.APPLICATION_STATUS)
    print('  ✓ Created Ayatana indicator object')
    indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
    print('  ✓ Set Ayatana indicator status to ACTIVE')
except Exception as e:
    print(f'  ✗ Ayatana AppIndicator failed: {e}')

try:
    gi.require_version('AppIndicator3', '0.1')
    from gi.repository import AppIndicator3 as AppIndicator
    print('  ✓ Python can import AppIndicator3 (Legacy)')
    indicator = AppIndicator.Indicator.new('test', 'mail-message-new', AppIndicator.IndicatorCategory.APPLICATION_STATUS)
    print('  ✓ Created Legacy indicator object')
    indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
    print('  ✓ Set Legacy indicator status to ACTIVE')
except Exception as e:
    print(f'  ✗ Legacy AppIndicator failed: {e}')
" 2>&1

echo ""
echo "=== End Debug Information ==="
