"""Exercise desktop package selection and panel startup without installing a desktop."""

# standard imports
from pathlib import Path
import os
import shutil
import subprocess

# lib imports
import pytest


SCRIPT = (Path(__file__).resolve().parents[2] / 'actions/virtual_desktop/setup_desktop.sh').read_text(encoding='utf-8')
BASH = (shutil.which('bash', path=f"{os.environ.get('ProgramFiles', '')}/Git/bin")
        if os.name == 'nt' else shutil.which('bash'))
pytestmark = pytest.mark.skipif(BASH is None, reason='Bash is required to test the desktop setup script')


def run_bash(source, *arguments):
    return subprocess.run(
        [BASH, '--noprofile', '--norc', '-s', '--', *arguments],
        input=source,
        capture_output=True,
        text=True,
        encoding='utf-8',
        timeout=10,
        check=False,
    )


@pytest.mark.parametrize('environment', ['budgie', 'gnome'])
def test_removed_environments_are_rejected_before_installing(environment):
    mocks = 'sudo() { echo UNEXPECTED_INSTALL; return 99; }\n'
    source = mocks + SCRIPT.split('# Clean up apt cache', 1)[0]
    result = run_bash(source, f'--environment={environment}')

    assert result.returncode == 1
    assert f"Invalid environment '{environment}'" in result.stderr
    assert 'Valid options: cinnamon fluxbox lxde lxqt mate openbox plasma xfce' in result.stderr
    assert 'UNEXPECTED_INSTALL' not in result.stdout


@pytest.mark.parametrize('environment,separate_x11_package,expected,excluded', [
    ('plasma', True, 'plasma-session-x11', 'policykit-1'),
    ('plasma', False, 'plasma-workspace', 'plasma-session-x11'),
    ('lxde', False, 'polkitd', 'policykit-1'),
    ('xfce', True, 'xfce4', 'plasma-session-x11'),
])
def test_desktop_dependencies(environment, separate_x11_package, expected, excluded):
    # Only execute through dependency installation; sudo records requests and
    # apt-cache models releases with and without Plasma's separate X11 package.
    mocks = f'''
sudo() {{
  if [[ "$1 $2" == "apt-get install" ]]; then
    printf 'INSTALL_DEP:%s\\n' "${{@:3}}"
  fi
}}
apt-cache() {{
  [[ "$*" == "show plasma-session-x11" ]] && return {0 if separate_x11_package else 100}
  return 1
}}
'''
    source = mocks + SCRIPT.split('# Clean up apt cache', 1)[0]
    result = run_bash(source, f'--environment={environment}')

    assert result.returncode == 0, result.stderr
    dependencies = [line.removeprefix('INSTALL_DEP:') for line in result.stdout.splitlines()
                    if line.startswith('INSTALL_DEP:')]
    assert expected in dependencies
    assert excluded not in dependencies


@pytest.mark.parametrize('initial_socket,keyring_socket', [
    (None, None),
    ('', None),
    ('/tmp/existing-agent.sock', None),
    (None, '/tmp/keyring/ssh'),
])
def test_lxde_exports_ssh_socket_only_when_available(tmp_path, monkeypatch, initial_socket, keyring_socket):
    output = tmp_path / 'github_env'
    output.touch()
    monkeypatch.setenv('GITHUB_ENV', output.as_posix())
    monkeypatch.delenv('SSH_AUTH_SOCK', raising=False)
    if initial_socket is not None:
        monkeypatch.setenv('SSH_AUTH_SOCK', initial_socket)
    keyring_output = f'SSH_AUTH_SOCK={keyring_socket}; export SSH_AUTH_SOCK;' if keyring_socket else ''
    monkeypatch.setenv('TEST_KEYRING_OUTPUT', keyring_output)

    preamble = SCRIPT.split('# Desktop environment specific packages', 1)[0]
    block = SCRIPT.split('# Start gnome-keyring for credential management', 1)[1].split('# Composited desktops', 1)[0]
    mocks = 'gnome-keyring-daemon() { printf "%s\\n" "$TEST_KEYRING_OUTPUT"; }\n'
    result = run_bash(preamble + mocks + block, '--environment=lxde')

    assert result.returncode == 0, result.stderr
    socket = keyring_socket or initial_socket
    assert output.read_text(encoding='utf-8') == (f'SSH_AUTH_SOCK={socket}\n' if socket else '')


def run_xfce_configuration(ready_after, restart_status=0):
    # Execute the configuration block with a panel whose process exists before
    # its D-Bus service is ready, as happens during slow session startup.
    preamble = SCRIPT.split('# Desktop environment specific packages', 1)[0]
    block = SCRIPT.split('# Configure XFCE panel for indicator support', 1)[1].split('# Start panel/tray', 1)[0]
    mocks = f'''
INDICATOR_SERVICE=indicator-service
PANEL_PROCESS=xfce4-panel
PANEL_WAIT_COUNT=0
pgrep() {{ return 0; }}
dbus-send() {{
  [[ "$*" == *"string:org.xfce.Panel"* ]] || return 1
  if [[ "$PANEL_WAIT_COUNT" -ge {ready_after} ]]; then
    echo 'boolean true'
  else
    echo 'boolean false'
  fi
}}
sleep() {{ ((PANEL_WAIT_COUNT += 1)); }}
xfconf-query() {{ printf 'CONFIGURED:%s\\n' "$PANEL_WAIT_COUNT"; }}
xfce4-panel() {{ echo UNBOUNDED_RESTART; }}
timeout() {{
  printf 'BOUNDED_RESTART:%s\\n' "$*"
  return {restart_status}
}}
'''
    return run_bash(preamble + mocks + block, '--environment=xfce')


def test_xfce_waits_for_panel_before_configuring():
    result = run_xfce_configuration(ready_after=3)

    assert result.returncode == 0, result.stderr
    assert 'CONFIGURED:3' in result.stdout
    assert 'BOUNDED_RESTART:--kill-after=5s 15s xfce4-panel -r' in result.stdout
    assert 'UNBOUNDED_RESTART' not in result.stdout


def test_xfce_missing_panel_fails_before_configuring():
    result = run_xfce_configuration(ready_after=100)

    assert result.returncode == 1
    assert 'XFCE panel did not start' in result.stderr
    assert 'CONFIGURED:' not in result.stdout
    assert 'RESTART:' not in result.stdout


@pytest.mark.parametrize('restart_status', [1, 124, 137])
def test_xfce_restart_failure_is_reported(restart_status):
    result = run_xfce_configuration(ready_after=1, restart_status=restart_status)

    assert result.returncode == 1
    assert 'Failed to restart XFCE panel' in result.stderr
    assert 'XFCE panel configured' not in result.stdout
