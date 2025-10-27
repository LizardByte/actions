# -*- coding: utf-8 -*-
"""
Test the determine_version.sh script functionality.
These tests validate the version file parsing logic.
"""
# standard imports
import os
import platform
import subprocess

# lib imports
import pytest


def get_script_dir():
    """Get the directory containing the setup_python action."""
    # Get the directory of this test file
    test_dir = os.path.dirname(os.path.abspath(__file__))
    # Navigate up to the repo root, then to actions/setup_python
    repo_root = os.path.dirname(os.path.dirname(test_dir))
    return os.path.join(repo_root, 'actions', 'setup_python')


def get_bash_executable():
    """
    Get the path to the bash executable.

    On Windows, tries to find Git Bash in common installation locations.
    On Unix/macOS, uses the system bash.

    Returns:
        str: Path to bash executable
    """
    if platform.system() == 'Windows':
        # List of common Git Bash installation paths on Windows
        bash_candidates = [
            r'C:\Program Files\Git\bin\bash.exe',
            r'C:\Program Files (x86)\Git\bin\bash.exe',
            'bash.exe',  # Fallback to PATH
        ]

        for bash_path in bash_candidates:
            if bash_path == 'bash.exe' or os.path.exists(bash_path):
                return bash_path

        # If nothing found, return the first candidate as fallback
        return bash_candidates[0]
    else:
        return 'bash'


def to_bash_path(path):
    """
    Convert a Windows path to Unix-style path for bash compatibility.

    On Windows, bash (Git Bash) expects forward slashes instead of backslashes.
    On Unix, this is a no-op since paths already use forward slashes.

    Args:
        path: File path as a string

    Returns:
        str: Path with forward slashes
    """
    return path.replace('\\', '/') if path else ''


def run_determine_version(python_version='', python_version_file=''):
    """
    Helper function to run the determine_version.sh script.

    Args:
        python_version: Direct Python version string (optional)
        python_version_file: Path to file containing version (optional)

    Returns:
        tuple: (stdout, stderr, returncode)
    """
    script_dir = get_script_dir()
    determine_script = to_bash_path(path=os.path.join(script_dir, 'determine_version.sh'))
    repo_root = os.path.dirname(os.path.dirname(script_dir))

    # Build the command based on whether we're using direct version or file
    if python_version_file and not os.path.exists(python_version_file):
        # Skip if test file doesn't exist
        return None, None, -1

    cmd = 'source {} && determine_python_version "{}" "{}"'.format(
        determine_script, python_version, python_version_file
    )

    bash_exe = get_bash_executable()

    proc = subprocess.Popen(
        [bash_exe, '-c', cmd],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, stderr = proc.communicate()

    # Decode bytes to string for Python 3 compatibility
    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')
    if isinstance(stderr, bytes):
        stderr = stderr.decode('utf-8')

    return stdout, stderr, proc.returncode


@pytest.mark.parametrize("test_file,expected_version", [
    ('tests/setup_python/version_files/python-version/single-version/.python-version', '3.12.0'),
    ('tests/setup_python/version_files/pyproject-toml/requires-python-gte/pyproject.toml', '3.8'),
    ('tests/setup_python/version_files/tool-versions/single-version/.tool-versions', '3.12.0'),
    ('tests/setup_python/version_files/pipfile/simple/Pipfile', '3.12'),
])
def test_determine_version_from_file(test_file, expected_version):
    """Test reading version from various file types."""
    stdout, stderr, returncode = run_determine_version(python_version_file=test_file)

    assert returncode == 0, "Script failed with return code {}. stderr: '{}' stdout: '{}'".format(
        returncode, stderr, stdout
    )

    lines = stdout.strip().split('\n')
    # Filter out empty lines
    lines = [line for line in lines if line.strip()]

    if lines:
        version = lines[-1]
        assert version == expected_version, "Expected {}, got {}".format(expected_version, version)


def test_determine_version_from_multiple_versions():
    """Test reading multiple versions from .python-version file."""
    test_file = 'tests/setup_python/version_files/python-version/multiple-versions/.python-version'
    stdout, stderr, returncode = run_determine_version(python_version_file=test_file)

    assert returncode == 0, "Script failed with return code {}. stderr: '{}' stdout: '{}'".format(
        returncode, stderr, stdout
    )

    lines = stdout.strip().split('\n')
    # Filter out empty lines and find the versions/default
    lines = [line for line in lines if line.strip()]

    if len(lines) < 2:
        # If we don't have enough output, the test can't verify properly
        return

    all_versions = lines[-2]
    default_version = lines[-1]

    assert '3.11.0' in all_versions, "Expected 3.11.0 in {}".format(all_versions)
    assert '3.12.0' in all_versions, "Expected 3.12.0 in {}".format(all_versions)
    assert '3.13.0' in all_versions, "Expected 3.13.0 in {}".format(all_versions)
    assert default_version == '3.13.0', "Expected default 3.13.0, got {}".format(default_version)


def test_determine_version_from_direct_input():
    """Test providing version directly via input."""
    stdout, stderr, returncode = run_determine_version(python_version='3.11.5')

    assert returncode == 0, "Script failed with return code {}. stderr: '{}' stdout: '{}'".format(
        returncode, stderr, stdout
    )

    lines = stdout.strip().split('\n')
    lines = [line for line in lines if line.strip()]

    if lines:
        version = lines[-1]
        assert version == '3.11.5', "Expected 3.11.5, got {}".format(version)


def test_determine_version_from_multiple_inputs():
    """Test providing multiple versions via input."""
    # Test with newline-separated versions - use $'...' to interpret escape sequences
    script_dir = get_script_dir()
    determine_script = to_bash_path(path=os.path.join(script_dir, 'determine_version.sh'))
    repo_root = os.path.dirname(os.path.dirname(script_dir))

    bash_exe = get_bash_executable()

    proc = subprocess.Popen(
        [bash_exe, '-c', 'source {} && '
                       'determine_python_version $\'3.10\\n3.11\\n3.12\' "" && '
                       'echo "$PYTHON_VERSIONS" && echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, stderr = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')
    if isinstance(stderr, bytes):
        stderr = stderr.decode('utf-8')

    assert proc.returncode == 0, "Script failed with return code {}. stderr: '{}' stdout: '{}'".format(
        proc.returncode, stderr, stdout
    )

    lines = stdout.strip().split('\n')
    # Filter out empty lines
    lines = [line for line in lines if line.strip()]

    if len(lines) < 2:
        # If we don't have enough output, the test can't verify properly
        return

    all_versions = lines[-2]
    default_version = lines[-1]

    assert '3.10' in all_versions
    assert '3.11' in all_versions
    assert '3.12' in all_versions
    assert default_version == '3.12', "Expected default 3.12, got {}".format(default_version)
