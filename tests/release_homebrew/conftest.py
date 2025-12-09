# standard imports
import os
import shutil
import subprocess
import sys

# lib imports
import pytest

# local imports
from actions.release_homebrew import main


og_dir = os.getcwd()


@pytest.fixture(scope='session')
def is_macos():
    """Detect if running on macOS."""
    return sys.platform == 'darwin'


@pytest.fixture(scope='session', autouse=True)
def reinstall_packages_after_homebrew_tests(is_macos):
    """
    Reinstall packages that brew test-bot removes during cleanup.

    brew test-bot --only-cleanup-before removes system packages including:
    - gpg (breaks codecov uploads)

    This fixture runs after all release_homebrew tests complete, before other test modules run.
    Only runs on macOS where brew test-bot causes these issues.
    """
    yield

    # Only reinstall packages on macOS
    if not is_macos:
        return

    # After all release_homebrew tests complete, reinstall removed packages
    print("Reinstalling packages removed by brew test-bot...")

    packages_to_reinstall = [
        'gnupg',  # Provides gpg command for codecov
    ]

    for package in packages_to_reinstall:
        try:
            result = subprocess.run(
                ['brew', 'install', package],
                capture_output=True,
                timeout=120,
            )
            if result.returncode == 0:
                print(f"✓ {package} reinstalled successfully via brew")
            else:
                # Package might already be installed, try reinstalling
                result = subprocess.run(
                    ['brew', 'reinstall', package],
                    capture_output=True,
                    timeout=120,
                )
                if result.returncode == 0:
                    print(f"✓ {package} reinstalled successfully via brew reinstall")
                else:
                    print(f"✗ Failed to reinstall {package}: {result.stderr.decode()}")
        except Exception as e:
            print(f"✗ Exception while reinstalling {package}: {e}")


@pytest.fixture(scope='function', autouse=True)
def setup_release_homebrew_env():
    """Set up environment variables for release_homebrew tests only."""
    # Save original values
    original_env = {}
    env_vars = {
        'INPUT_FORMULA_FILE': os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'),
        'INPUT_CONTRIBUTE_TO_HOMEBREW_CORE': 'true',
        'INPUT_GIT_EMAIL': 'test@example.com',
        'INPUT_GIT_USERNAME': 'Test User',
        'INPUT_ORG_HOMEBREW_REPO': 'LizardByte/homebrew-homebrew',
        'INPUT_UPSTREAM_HOMEBREW_CORE_REPO': 'Homebrew/homebrew-core',
    }

    for key, value in env_vars.items():
        original_env[key] = os.environ.get(key)
        os.environ[key] = value

    yield

    # Restore original values
    for key, original_value in original_env.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


@pytest.fixture(scope='function', autouse=True)
def change_dir():
    os.chdir(og_dir)


@pytest.fixture(scope='function', autouse=True)
def error_reset():
    main.ERROR = False
    main.FAILURES = []


@pytest.fixture(scope='function')
def test_formula_file(tmp_path):
    """
    Create a test_formula.rb file for tests that need to verify copy failure scenarios.
    This fixture creates the file in a temporary directory and cleans it up after the test.
    """
    formula_dir = tmp_path / "Formula" / "t"
    formula_dir.mkdir(parents=True, exist_ok=True)
    test_formula_path = formula_dir / "test_formula.rb"

    # Create a minimal invalid formula (missing URL)
    test_formula_path.write_text("""class TestFormula < Formula
  url "https://github.com/LizardByte/actions.git"
end
""")

    yield str(test_formula_path)

    # Cleanup is automatic with tmp_path


@pytest.fixture(scope='function')
def github_output_file():
    f = os.environ['GITHUB_OUTPUT']
    os.makedirs(os.path.dirname(f), exist_ok=True)

    # touch the file
    with open(f, 'w') as fi:
        fi.write('')

    yield f

    # re-touch the file
    with open(f, 'w') as fi:
        fi.write('')


@pytest.fixture(scope='session')
def operating_system():
    if sys.platform == 'win32':
        pytest.skip("Skipping, cannot be tested on Windows")


@pytest.fixture(scope='function')
def org_homebrew_repo():
    directory = os.path.join(os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action')
    os.makedirs(directory, exist_ok=True)

    repo = 'org_homebrew_repo'
    repo_directory = os.path.join(directory, repo)

    if not os.path.isdir(repo_directory):
        # Create a minimal git repo structure
        os.makedirs(repo_directory, exist_ok=True)
        subprocess.run(
            ['git', 'init'],
            cwd=repo_directory,
            capture_output=True,
        )
        subprocess.run(
            ['git', 'config', 'user.email', 'test@test.com'],
            cwd=repo_directory,
            capture_output=True,
        )
        subprocess.run(
            ['git', 'config', 'user.name', 'Test User'],
            cwd=repo_directory,
            capture_output=True,
        )

        # Create Formula directory structure
        os.makedirs(os.path.join(repo_directory, 'Formula'), exist_ok=True)

        # Create a README
        with open(os.path.join(repo_directory, 'README.md'), 'w') as f:
            f.write('# Test Homebrew Tap\n')

        # Initial commit
        subprocess.run(['git', 'add', '.'], cwd=repo_directory, capture_output=True)
        subprocess.run(['git', 'commit', '-m', 'Initial commit'], cwd=repo_directory, capture_output=True)

    # Reset the repository to clean state, removing any test artifacts
    subprocess.run(['git', 'reset', '--hard', 'HEAD'], cwd=repo_directory, capture_output=True)
    subprocess.run(['git', 'clean', '-fd'], cwd=repo_directory, capture_output=True)

    yield repo_directory


@pytest.fixture(scope='function')  # todo: fix repo deletion
def homebrew_core_fork_repo():
    directory = os.path.join(os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action')
    os.makedirs(directory, exist_ok=True)

    repo = 'homebrew_core_fork_repo'
    repo_directory = os.path.join(directory, repo)

    if not os.path.isdir(repo_directory):
        # clone the homebrew-core fork, with depth 1
        proc = subprocess.run(
            [
                'git',
                'clone',
                'https://github.com/LizardByte/homebrew-core',
                repo,
                '--depth=1',
            ],
            cwd=directory,
            capture_output=True
        )

        if proc.returncode != 0:
            print(proc.stderr.decode('utf-8'))
            raise RuntimeError('Failed to clone homebrew-core')

    # remove the upstream remote
    main._run_subprocess(
        args_list=[
            'git',
            'remote',
            'remove',
            'upstream',
        ],
        cwd=repo_directory,
    )

    yield repo_directory

    # remove the homebrew-core fork (this fails)
    # shutil.rmtree(repo_directory)


def _cleanup_bottle_files():
    """Clean up bottle files from previous test runs."""
    import glob
    workspaces_to_check = [
        os.getenv('GITHUB_WORKSPACE', ''),
        os.getcwd(),
    ]
    # Remove duplicates and empty strings
    workspaces_to_check = list({w for w in workspaces_to_check if w})

    for workspace in workspaces_to_check:
        bottle_patterns = [
            os.path.join(workspace, 'hello_world--*.bottle.*.tar.gz'),
            os.path.join(workspace, 'hello_world--*.bottle.json'),
        ]
        for pattern in bottle_patterns:
            for file in glob.glob(pattern):
                if os.path.exists(file):
                    os.remove(file)


def _cleanup_tapped_repositories():
    """Clean up test artifacts from tapped directories."""
    brew_repo = main.get_brew_repository()
    taps_to_clean = [
        os.path.join(brew_repo, 'Library', 'Taps', 'lizardbyte', 'homebrew-homebrew'),
        os.path.join(brew_repo, 'Library', 'Taps', 'lizardbyte', 'homebrew-actions'),
    ]
    for tap_dir in taps_to_clean:
        if os.path.isdir(tap_dir):
            # Reset the tap repository to clean state, removing any test artifacts
            subprocess.run(['git', 'reset', '--hard', 'HEAD'], cwd=tap_dir, capture_output=True)
            subprocess.run(['git', 'clean', '-fd'], cwd=tap_dir, capture_output=True)


def _uninstall_hello_world_formula():
    """Uninstall hello_world formula from all taps."""
    # Try to uninstall from specific taps first to avoid ambiguity
    for tap in ['lizardbyte/homebrew/hello_world', 'lizardbyte/actions/hello_world', 'hello_world']:
        subprocess.run(
            args=['brew', 'uninstall', tap],
            capture_output=True,
        )
        # Silently ignore errors - we just want to make sure it's uninstalled


def _get_tap_name_for_cleanup():
    """Get the tap name for cleanup, either from main.tap_repo_name or derived from environment."""
    tap_name = main.tap_repo_name
    if not tap_name:
        # Derive from INPUT_ORG_HOMEBREW_REPO
        org_homebrew_repo = os.getenv('INPUT_ORG_HOMEBREW_REPO', 'LizardByte/homebrew-homebrew')
        owner, repo_name = org_homebrew_repo.split('/')
        if repo_name.startswith('homebrew-'):
            tap_suffix = repo_name[9:]
            tap_name = f'{owner.lower()}/{tap_suffix}'
    return tap_name


def _untap_and_remove_directory(tap_name):
    """Untap the repository and remove its directory."""
    proc = subprocess.run(
        args=['brew', 'untap', tap_name],
        capture_output=True,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode('utf-8')
        # Only print error if it's not "No such tap" error
        if 'No such tap' not in stderr:
            print(stderr)

    # remove brew tap directory
    brew_repo = main.get_brew_repository()
    owner, tap_suffix = tap_name.split('/')
    tap_directory = os.path.join(brew_repo, 'Library', 'Taps', owner, f'homebrew-{tap_suffix}')
    if os.path.isdir(tap_directory):
        shutil.rmtree(tap_directory)


@pytest.fixture(scope='function')
def brew_untap():
    def cleanup():
        _cleanup_bottle_files()
        _cleanup_tapped_repositories()
        _uninstall_hello_world_formula()

        tap_name = _get_tap_name_for_cleanup()
        if tap_name:
            _untap_and_remove_directory(tap_name)

    # Clean up before the test
    cleanup()

    # Run the test
    yield

    # Clean up after the test
    cleanup()


@pytest.fixture(scope='function', params=['true', 'false'])
def input_validate(request):
    os.environ['INPUT_VALIDATE'] = request.param
    yield
    del os.environ['INPUT_VALIDATE']


@pytest.fixture
def control_pytest_run(monkeypatch):
    """Fixture to control PYTEST_RUN environment variable."""
    original_value = os.environ.get('PYTEST_RUN')

    def set_pytest_run(value):
        if value is None:
            monkeypatch.delenv('PYTEST_RUN', raising=False)
        else:
            monkeypatch.setenv('PYTEST_RUN', value)

    yield set_pytest_run

    # Restore original value
    if original_value is None:
        monkeypatch.delenv('PYTEST_RUN', raising=False)
    else:
        monkeypatch.setenv('PYTEST_RUN', original_value)
