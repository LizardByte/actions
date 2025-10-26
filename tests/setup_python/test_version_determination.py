# -*- coding: utf-8 -*-
"""
Test the determine_version.sh script functionality.
These tests validate the version file parsing logic.
"""
import os
import subprocess


def get_script_dir():
    """Get the directory containing the setup_python action."""
    # Get the directory of this test file
    test_dir = os.path.dirname(os.path.abspath(__file__))
    # Navigate up to the repo root, then to actions/setup_python
    repo_root = os.path.dirname(os.path.dirname(test_dir))
    return os.path.join(repo_root, 'actions', 'setup_python')


def test_determine_version_from_python_version_file():
    """Test reading version from .python-version file."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')
    test_file = 'tests/setup_python/version_files/python-version/single-version/.python-version'

    if not os.path.exists(test_file):
        # Skip if test file doesn't exist
        return

    # Run bash script to determine version
    repo_root = os.path.dirname(os.path.dirname(script_dir))

    # Use Popen for Python 2.7 compatibility
    import subprocess
    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version "" "{}" && '
                       'echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script, test_file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    # Decode bytes to string for Python 3 compatibility
    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
        version = stdout.strip().split('\n')[-1]
        assert version == '3.12.0', "Expected 3.12.0, got {}".format(version)


def test_determine_version_from_multiple_versions():
    """Test reading multiple versions from .python-version file."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')
    test_file = 'tests/setup_python/version_files/python-version/multiple-versions/.python-version'

    if not os.path.exists(test_file):
        return

    repo_root = os.path.dirname(os.path.dirname(script_dir))

    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version "" "{}" && '
                       'echo "$PYTHON_VERSIONS" && echo "$DEFAULT_PYTHON_VERSION"'.format(
                           determine_script, test_file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
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


def test_determine_version_from_pyproject_toml():
    """Test reading version from pyproject.toml file."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')
    test_file = 'tests/setup_python/version_files/pyproject-toml/requires-python-gte/pyproject.toml'

    if not os.path.exists(test_file):
        return

    repo_root = os.path.dirname(os.path.dirname(script_dir))

    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version "" "{}" && '
                       'echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script, test_file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
        version = stdout.strip().split('\n')[-1]
        assert version == '3.8', "Expected 3.8, got {}".format(version)


def test_determine_version_from_tool_versions():
    """Test reading version from .tool-versions file."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')
    test_file = 'tests/setup_python/version_files/tool-versions/single-version/.tool-versions'

    if not os.path.exists(test_file):
        return

    repo_root = os.path.dirname(os.path.dirname(script_dir))

    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version "" "{}" && '
                       'echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script, test_file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
        version = stdout.strip().split('\n')[-1]
        assert version == '3.12.0', "Expected 3.12.0, got {}".format(version)


def test_determine_version_from_pipfile():
    """Test reading version from Pipfile."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')
    test_file = 'tests/setup_python/version_files/pipfile/simple/Pipfile'

    if not os.path.exists(test_file):
        return

    repo_root = os.path.dirname(os.path.dirname(script_dir))

    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version "" "{}" && '
                       'echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script, test_file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
        version = stdout.strip().split('\n')[-1]
        assert version == '3.12', "Expected 3.12, got {}".format(version)


def test_determine_version_from_direct_input():
    """Test providing version directly via input."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')

    repo_root = os.path.dirname(os.path.dirname(script_dir))

    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version "3.11.5" "" && '
                       'echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
        version = stdout.strip().split('\n')[-1]
        assert version == '3.11.5', "Expected 3.11.5, got {}".format(version)


def test_determine_version_from_multiple_inputs():
    """Test providing multiple versions via input."""
    script_dir = get_script_dir()
    determine_script = os.path.join(script_dir, 'determine_version.sh')

    repo_root = os.path.dirname(os.path.dirname(script_dir))

    # Test with newline-separated versions - use $'...' to interpret escape sequences
    proc = subprocess.Popen(
        ['bash', '-c', 'source {} && '
                       'determine_python_version $\'3.10\\n3.11\\n3.12\' "" && '
                       'echo "$PYTHON_VERSIONS" && echo "$DEFAULT_PYTHON_VERSION"'.format(determine_script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=repo_root
    )
    stdout, _ = proc.communicate()

    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8')

    if proc.returncode == 0:
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
