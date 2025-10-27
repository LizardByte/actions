# -*- coding: utf-8 -*-
# standard imports
import os
import platform
import subprocess
import sys

# lib imports
import pytest


def test_python_platform_version(default_python_version):
    """Test that the installed Python version matches the expected version."""
    actual_version = platform.python_version()
    # Split by '-' to handle architecture suffixes like 3.12.10-win32
    expected_version = default_python_version.split('-')[0]

    # Check that actual version starts with expected version
    assert actual_version.startswith(expected_version), \
        "Expected Python {}, but got {}".format(expected_version, actual_version)


def test_python_system_version(default_python_version):
    """Test that sys.version matches the expected version."""
    actual_version = sys.version
    # Split by '-' to handle architecture suffixes like 3.12.10-win32
    expected_version = default_python_version.split('-')[0]

    assert actual_version.startswith(expected_version), \
        "Expected Python {}, but got {}".format(expected_version, actual_version)


def test_pyenv_versions_installed():
    """Test that pyenv has installed the expected versions."""
    # Get PYTHON_VERSIONS from environment if available
    python_versions = os.environ.get('PYTHON_VERSIONS', '')

    assert python_versions, "PYTHON_VERSIONS environment variable not set"

    # Get list of installed pyenv versions
    try:
        # Use check_output for Python 2.7 compatibility
        output = subprocess.check_output(['pyenv', 'versions', '--bare'])
        # Decode bytes to string for Python 3 compatibility
        if isinstance(output, bytes):
            output = output.decode('utf-8')
        installed_versions = output.strip().split('\n')
    except (subprocess.CalledProcessError, OSError):
        # pyenv might not be in PATH in some environments
        pytest.skip("pyenv not found")
        return

    # Split the expected versions
    expected_versions = python_versions.split()

    # Check that each expected version is installed
    for expected_version in expected_versions:
        # Remove architecture suffix for comparison
        expected_base = expected_version.split('-')[0]
        # Check if any installed version starts with the expected version
        assert any(
            installed.startswith(expected_version) or installed.startswith(expected_base)
            for installed in installed_versions
        ), "Expected version {} not found in installed versions: {}".format(
            expected_version, installed_versions
        )


def test_default_python_version(default_python_version):
    """Test that the default Python version is correct."""
    # Split by '-' to handle architecture suffixes
    expected_base = default_python_version.split('-')[0]

    # Get current Python version
    actual_version = platform.python_version()

    assert actual_version.startswith(expected_base), \
        "Default version should be {}, but got {}".format(expected_base, actual_version)
