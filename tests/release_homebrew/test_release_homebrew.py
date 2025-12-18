# standard imports
import os
import subprocess
import sys
from typing import Optional
from unittest.mock import patch

# lib imports
import pytest

# local imports
from actions.release_homebrew import main


def get_current_branch(cwd: Optional[str] = None) -> str:
    if cwd:
        os.chdir(cwd)  # hack for unit testing on windows
    if not cwd:
        github_ref = os.getenv('GITHUB_REF')
        if github_ref:
            # Running in a GitHub Actions runner.
            # The branch name is the last part of GITHUB_REF.
            return github_ref.split('/')[-1]

    # Fallback method when not running in a GitHub Actions runner
    proc = subprocess.run(
        ['git', 'branch', '--show-current'],
        cwd=cwd,
        capture_output=True,
    )
    return proc.stdout.decode().strip()


def test_parse_args():
    args = main._parse_args(['--formula_file', 'foo'])
    assert args.formula_file == 'foo'


def test_run_subprocess(capsys, operating_system):
    result = main._run_subprocess(
        args_list=[sys.executable, '-c', 'print("foo")'],
    )

    assert result, "Process returned non zero exit code"

    captured = capsys.readouterr()
    assert 'foo' in captured.out
    assert captured.err == ''


def test_run_subprocess_fail(capsys, operating_system):
    result = main._run_subprocess(
        args_list=[sys.executable, '-c', 'raise SystemExit(1)'],
    )

    assert not result, "Process returned zero exit code"
    assert main.ERROR


@pytest.mark.parametrize('outputs', [
    ('test_1', 'foo'),
    ('test_2', 'bar'),
])
def test_set_github_action_output(github_output_file, outputs):
    main.set_github_action_output(output_name=outputs[0], output_value=outputs[1])

    with open(github_output_file, 'r') as f:
        output = f.read()

    assert output.endswith(f"{outputs[0]}<<EOF\n{outputs[1]}\nEOF\n")


def test_get_brew_repository(operating_system):
    assert main.get_brew_repository()


@pytest.mark.parametrize(
    'repo_fixture, branch_suffix, repo_type, custom_branch_env_var, output_name, upstream_repo, upstream_branch',
    [
        # Test homebrew-core fork with upstream syncing
        (
                'homebrew_core_fork_repo',
                'release_homebrew_action_tests',
                'Homebrew/homebrew-core fork',
                'INPUT_HOMEBREW_CORE_HEAD_BRANCH',
                'homebrew_core_branch',
                os.environ.get('INPUT_UPSTREAM_HOMEBREW_CORE_REPO', 'Homebrew/homebrew-core'),
                'main',
        ),
        # Test org homebrew repo without upstream syncing
        (
                'org_homebrew_repo',
                'test_formula',
                'org homebrew repo',
                'INPUT_ORG_HOMEBREW_REPO_HEAD_BRANCH',
                'org_homebrew_repo_branch',
                None,
                'master',
        ),
    ]
)
def test_prepare_repo_branch(
        repo_fixture,
        branch_suffix,
        repo_type,
        custom_branch_env_var,
        output_name,
        upstream_repo,
        upstream_branch,
        request,
        operating_system
):
    """Test prepare_repo_branch for different repository types."""
    # Get the actual path from the fixture
    repo_path = request.getfixturevalue(repo_fixture)

    # Call prepare_repo_branch with appropriate parameters
    branch = main.prepare_repo_branch(
        branch_suffix=branch_suffix,
        path=repo_path,
        repo_type=repo_type,
        custom_branch_env_var=custom_branch_env_var,
        output_name=output_name,
        upstream_repo=upstream_repo,
        upstream_branch=upstream_branch,
    )

    # assert that the branch name was returned
    assert branch.endswith(branch_suffix)

    # assert that the current branch is the branch we created
    current_branch = get_current_branch(cwd=repo_path)
    assert current_branch.endswith(branch_suffix)


def test_prepare_repo_branch_custom_branch(capsys, org_homebrew_repo, monkeypatch, operating_system):
    """Test prepare_repo_branch with a custom head branch specified via environment variable."""
    # Set a custom branch name via environment variable
    custom_branch_name = 'my-custom-feature-branch'
    monkeypatch.setenv('INPUT_ORG_HOMEBREW_REPO_HEAD_BRANCH', custom_branch_name)

    # Call prepare_repo_branch
    branch = main.prepare_repo_branch(
        branch_suffix='test_formula',
        path=org_homebrew_repo,
        repo_type='org homebrew repo',
        custom_branch_env_var='INPUT_ORG_HOMEBREW_REPO_HEAD_BRANCH',
        output_name='org_homebrew_repo_branch',
        upstream_repo=None,
        upstream_branch='master',
    )

    # Assert that the custom branch name was used
    assert branch == custom_branch_name

    # Assert that the current branch is the custom branch
    current_branch = get_current_branch(cwd=org_homebrew_repo)
    assert current_branch == custom_branch_name

    # Verify the log message was printed
    captured = capsys.readouterr()
    assert f'Using custom head branch: {custom_branch_name}' in captured.out


def test_extract_version_from_formula_with_version(tmp_path):
    """Test extracting version from a formula with version field."""
    formula_file = tmp_path / "test_formula.rb"
    formula_file.write_text('''
class TestFormula < Formula
  desc "Test formula"
  version "1.2.3"
  url "https://example.com/test.tar.gz"
end
''')

    version = main.extract_version_from_formula(str(formula_file))
    assert version == "1.2.3"


def test_extract_version_from_formula_with_tag(tmp_path):
    """Test extracting version from a formula with tag field (fallback)."""
    formula_file = tmp_path / "test_formula.rb"
    formula_file.write_text('''
class TestFormula < Formula
  desc "Test formula"
  url "https://example.com/test.tar.gz"
    tag: "v2.0.0"
end
''')

    version = main.extract_version_from_formula(str(formula_file))
    assert version == "v2.0.0"


def test_extract_version_from_formula_version_priority(tmp_path):
    """Test that version field takes priority over tag field."""
    formula_file = tmp_path / "test_formula.rb"
    formula_file.write_text('''
class TestFormula < Formula
  desc "Test formula"
  url "https://example.com/test.tar.gz"
    tag: "v1.0.0"
  version "2.0.0"
end
''')

    version = main.extract_version_from_formula(str(formula_file))
    assert version == "2.0.0"


def test_extract_version_from_formula_first_tag_only(tmp_path):
    """Test that only the first tag is processed."""
    formula_file = tmp_path / "test_formula.rb"
    formula_file.write_text('''
class TestFormula < Formula
  desc "Test formula"
  url "https://example.com/test.tar.gz"
    tag: "v1.0.0"
    # tag: "v2.0.0" - this should not be picked up
  tag: "v3.0.0"
end
''')

    version = main.extract_version_from_formula(str(formula_file))
    assert version == "v1.0.0"


def test_extract_version_from_formula_no_version(tmp_path):
    """Test extracting version when no version or tag field exists."""
    formula_file = tmp_path / "test_formula.rb"
    formula_file.write_text('''
class TestFormula < Formula
  desc "Test formula"
  url "https://example.com/test.tar.gz"
end
''')

    version = main.extract_version_from_formula(str(formula_file))
    assert version is None


def test_extract_version_from_formula_file_error(tmp_path, capsys):
    """Test extracting version when file cannot be read."""
    formula_file = tmp_path / "nonexistent.rb"

    version = main.extract_version_from_formula(str(formula_file))
    assert version is None

    captured = capsys.readouterr()
    assert 'Could not extract version from formula' in captured.out


@pytest.mark.parametrize('formula, version, is_new, expected', [
    ('hello_world', '1.2.3', True, 'hello_world 1.2.3 (new formula)'),
    ('hello_world', None, True, 'hello_world (new formula)'),
    ('hello_world', 'v2.0.0', False, 'hello_world v2.0.0'),
    ('hello_world', None, False, 'hello_world'),
    ('my_app', '3.1.4', True, 'my_app 3.1.4 (new formula)'),
    ('my_app', '5.0.0', False, 'my_app 5.0.0'),
])
def test_generate_commit_message(formula, version, is_new, expected):
    """Test generating commit messages for various scenarios."""
    result = main.generate_commit_message(formula, version, is_new)
    assert result == expected


@patch('subprocess.run')
def test_is_formula_tracked_true(mock_run):
    """Test is_formula_tracked when file is tracked."""
    mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0)

    result = main.is_formula_tracked('/path/to/formula.rb', '/path/to/repo')
    assert result is True

    mock_run.assert_called_once()
    call_args = mock_run.call_args
    assert 'git' in call_args[0][0]
    assert 'ls-files' in call_args[0][0]


@patch('subprocess.run')
def test_is_formula_tracked_false(mock_run):
    """Test is_formula_tracked when file is not tracked."""
    mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=1)

    result = main.is_formula_tracked('/path/to/formula.rb', '/path/to/repo')
    assert result is False


@patch('os.chmod')
@patch('os.path.exists')
@patch('shutil.copy2')
@patch('os.makedirs')
def test_copy_formula_to_directories(mock_makedirs, mock_copy, mock_exists, mock_chmod, capsys):
    """Test copying formula to multiple directories."""
    mock_exists.return_value = True

    main.copy_formula_to_directories(
        '/source/formula.rb',
        'formula.rb',
        ['/dest1', '/dest2']
    )

    # Verify makedirs called for each directory
    assert mock_makedirs.call_count == 2

    # Verify copy2 called for each directory
    assert mock_copy.call_count == 2

    # Verify chmod called for each directory
    assert mock_chmod.call_count == 2

    # Verify output messages
    captured = capsys.readouterr()
    assert 'Copying formula.rb to /dest1' in captured.out
    assert 'Copying formula.rb to /dest2' in captured.out
    assert 'Copied formula.rb to /dest1' in captured.out
    assert 'Copied formula.rb to /dest2' in captured.out


@patch('os.path.exists')
@patch('shutil.copy2')
@patch('os.makedirs')
def test_copy_formula_to_directories_copy_failure(mock_makedirs, mock_copy, mock_exists):
    """Test copy_formula_to_directories when copy verification fails."""
    mock_exists.return_value = False

    with pytest.raises(FileNotFoundError, match='was not copied'):
        main.copy_formula_to_directories(
            '/source/formula.rb',
            'formula.rb',
            ['/dest1']
        )


def test_process_input_formula(operating_system, org_homebrew_repo):
    with pytest.raises(FileNotFoundError):
        main.process_input_formula(formula_file='foo')

    with pytest.raises(FileNotFoundError):
        main.process_input_formula(formula_file=os.path.join(os.getcwd(), 'build'))

    with pytest.raises(ValueError):
        main.process_input_formula(formula_file=os.path.join(os.getcwd(), 'README.md'))

    formula = main.process_input_formula(
        formula_file=os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'))
    assert formula == 'hello_world'

    dirs = [
        os.path.join(os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action', 'org_homebrew_repo'),
        os.path.join(os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action', 'homebrew_core_fork_repo'),
    ]

    for d in dirs:
        assert os.path.isfile(os.path.join(d, 'Formula', 'h', 'hello_world.rb'))


def test_process_input_formula_lizardbyte_actions_special_case(operating_system, org_homebrew_repo, monkeypatch):
    """Test that LizardByte/actions is allowed as a special case for CI testing."""
    # Set the INPUT_ORG_HOMEBREW_REPO to LizardByte/actions
    monkeypatch.setenv('INPUT_ORG_HOMEBREW_REPO', 'LizardByte/actions')

    formula = main.process_input_formula(
        formula_file=os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'))

    assert formula == 'hello_world'
    # Verify that the tap_repo_name was set correctly
    assert main.tap_repo_name == 'lizardbyte/actions'


def test_get_tap_name_from_repo_invalid_direct(monkeypatch):
    """Test that _get_tap_name_from_repo raises ValueError for invalid repository name."""
    # Set the INPUT_ORG_HOMEBREW_REPO to an invalid name (not starting with 'homebrew-' and not the special case)
    invalid_repo = 'SomeOwner/invalid-repo'
    monkeypatch.setenv('INPUT_ORG_HOMEBREW_REPO', invalid_repo)

    # Should raise ValueError with a helpful error message
    with pytest.raises(ValueError, match='does not follow Homebrew tap naming convention'):
        main._get_tap_name_from_repo(invalid_repo)


@pytest.mark.parametrize('repo_input, expected_owner, expected_tap_name', [
    # Standard homebrew tap format
    ('LizardByte/homebrew-homebrew', 'LizardByte', 'homebrew'),
    ('owner/homebrew-tap', 'owner', 'tap'),
    ('MyOrg/homebrew-custom', 'MyOrg', 'custom'),
    ('user123/homebrew-myformulas', 'user123', 'myformulas'),
    # Edge case: longer tap name
    ('SomeOrg/homebrew-very-long-tap-name', 'SomeOrg', 'very-long-tap-name'),
    # Special case for CI testing
    ('LizardByte/actions', 'LizardByte', 'actions'),
])
def test_get_tap_name_from_repo_valid(capsys, repo_input, expected_owner, expected_tap_name, monkeypatch):
    """Test _get_tap_name_from_repo with valid repository inputs."""
    # Set the environment variable for the function to read
    monkeypatch.setenv('INPUT_ORG_HOMEBREW_REPO', repo_input)

    owner, tap_name = main._get_tap_name_from_repo(repo_input)

    assert owner == expected_owner
    assert tap_name == expected_tap_name

    # Verify output was printed
    captured = capsys.readouterr()
    assert f'org_homebrew_repo_input: {repo_input}' in captured.out


@pytest.mark.parametrize('invalid_repo_input, expected_error_fragment', [
    # Missing 'homebrew-' prefix and not the special case
    ('SomeOwner/invalid-repo', 'does not follow Homebrew tap naming convention'),
    ('owner/tap', 'does not follow Homebrew tap naming convention'),
    ('MyOrg/custom-tap', 'does not follow Homebrew tap naming convention'),
    # Various invalid formats
    ('BadOrg/random-name', 'does not follow Homebrew tap naming convention'),
])
def test_get_tap_name_from_repo_invalid(capsys, invalid_repo_input, expected_error_fragment, monkeypatch):
    """Test _get_tap_name_from_repo with invalid repository inputs."""
    # Set the environment variable for the function to read
    monkeypatch.setenv('INPUT_ORG_HOMEBREW_REPO', invalid_repo_input)

    with pytest.raises(ValueError, match=expected_error_fragment):
        main._get_tap_name_from_repo(invalid_repo_input)

    # Verify output was printed before the error
    captured = capsys.readouterr()
    assert f'org_homebrew_repo_input: {invalid_repo_input}' in captured.out


def test_get_tap_name_from_repo_special_case_message(capsys, monkeypatch):
    """Test that the special case for LizardByte/actions prints the expected message."""
    repo_input = 'LizardByte/actions'
    monkeypatch.setenv('INPUT_ORG_HOMEBREW_REPO', repo_input)

    owner, tap_name = main._get_tap_name_from_repo(repo_input)

    assert owner == 'LizardByte'
    assert tap_name == 'actions'

    # Verify special case message was printed
    captured = capsys.readouterr()
    assert 'Using LizardByte/actions for CI testing (special case)' in captured.out


def test_is_brew_installed(operating_system):
    assert main.is_brew_installed()


def test_brew_upgrade(operating_system):
    assert main.brew_upgrade()


@pytest.mark.parametrize('setup_scenario', [
    # Scenario 1: Formula temp dir exists in first location (HOMEBREW_TEMP)
    {'env': {'HOMEBREW_TEMP': '/tmp/custom'}, 'dirs': ['/tmp/custom'], 'files': ['formula-123']},
    # Scenario 2: Formula temp dir exists in macOS default location
    {'env': {}, 'dirs': ['/private/tmp'], 'files': ['formula-456']},
    # Scenario 3: Formula temp dir exists in Linux default location
    {'env': {}, 'dirs': ['/var/tmp'], 'files': ['formula-789']},
])
@patch('os.path.isdir')
@patch('os.listdir')
@patch('os.environ')
def test_find_tmp_dir(mock_environ, mock_listdir, mock_isdir, setup_scenario):
    # Setup environment variables
    mock_environ.get.side_effect = lambda key, default: setup_scenario['env'].get(key, default)

    # Configure which directories exist
    mock_isdir.side_effect = lambda path: any(d in path for d in setup_scenario['dirs'])

    # Configure directory listings
    mock_listdir.return_value = setup_scenario['files']

    # Reset global tracking of temp directories
    main.TEMP_DIRECTORIES = []

    # Run the function and check results
    result = main.find_tmp_dir('formula')

    # Verify the result contains the formula temp directory path
    assert any(f in result for f in setup_scenario['files'])

    # Verify the temp directory was added to tracking
    assert len(main.TEMP_DIRECTORIES) == 1


@patch('os.path.isdir')
def test_find_tmp_dir_no_root_tmp(mock_isdir):
    # Make all temp directories non-existent
    mock_isdir.return_value = False

    # Run the function and expect error
    with pytest.raises(FileNotFoundError, match="Could not find root temp directory"):
        main.find_tmp_dir('formula')


@patch('os.path.isdir')
@patch('os.listdir')
def test_find_tmp_dir_no_formula_tmp(mock_listdir, mock_isdir):
    # Make root temp directories exist
    mock_isdir.side_effect = lambda path: any(tmp_dir in path for tmp_dir in ['/private/tmp', '/var/tmp'])

    # But no formula temp directories
    mock_listdir.return_value = ['other-dir', 'not-matching']

    # Reset global tracking of temp directories
    main.TEMP_DIRECTORIES = []

    # Run the function and expect error
    with pytest.raises(FileNotFoundError, match="Could not find temp directory"):
        main.find_tmp_dir('formula')


@pytest.mark.parametrize('existing_dirs', [
    ['formula-123'],
    ['formula-123', 'formula-456'],
    ['formula-123', 'formula-456', 'formula-789'],
])
@patch('os.path.isdir')
@patch('os.listdir')
def test_find_tmp_dir_tracking(mock_listdir, mock_isdir, existing_dirs):
    # Configure mock_isdir to return True for root temp directories
    # but also retain the ability to check other paths
    def mock_isdir_side_effect(path):
        # Return True for any of the root temp directories
        if any(tmp_dir in path for tmp_dir in ['/private/tmp', '/var/tmp']):
            return True
        return False

    mock_isdir.side_effect = mock_isdir_side_effect

    # Set up multiple formula directories
    mock_listdir.return_value = existing_dirs

    # Reset global tracking of temp directories
    main.TEMP_DIRECTORIES = []

    # Each call should find the next directory (not already in TEMP_DIRECTORIES)
    for i, expected_dir in enumerate(existing_dirs):
        result = main.find_tmp_dir('formula')
        assert expected_dir in result
        assert len(main.TEMP_DIRECTORIES) == i + 1

    # If called again with no new directories, it should raise an error
    with pytest.raises(FileNotFoundError, match="Could not find temp directory"):
        main.find_tmp_dir('formula')


def test_audit_formula(operating_system, org_homebrew_repo):
    #  Call process_input_formula first to set up the tap
    main.process_input_formula(
        formula_file=os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'))
    assert main.audit_formula(formula='hello_world')


def test_brew_install_formula(operating_system, org_homebrew_repo):
    # Call process_input_formula first to set up the tap
    main.process_input_formula(
        formula_file=os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'))
    assert main.install_formula(formula='hello_world')


def test_test_formula(brew_untap, operating_system, org_homebrew_repo):
    # Call process_input_formula first to set up the tap
    main.process_input_formula(
        formula_file=os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'))
    # Install the formula first to set HOMEBREW_BUILDPATH (required by test_formula)
    assert main.install_formula(formula='hello_world')
    # Now test the formula
    assert main.test_formula(formula='hello_world')


def test_main(brew_untap, org_homebrew_repo, homebrew_core_fork_repo, input_validate, operating_system):
    main.args = main._parse_args(args_list=[])
    main.main()
    assert not main.ERROR
    assert not main.FAILURES


@pytest.mark.parametrize('scenario, mocks, expected_failures', [
    # Scenario 1: Homebrew not installed
    (
            'homebrew_not_installed',
            [('is_brew_installed', False)],
            [],
    ),
    # Scenario 2: Brew upgrade fails
    (
            'brew_upgrade_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', False),
            ],
            [],
    ),
    # Scenario 3: brew test-bot --only-cleanup-before fails
    (
            'brew_test_bot_only_cleanup_before_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', False),
            ],
            [],
    ),
    # Scenario 4: brew test-bot --only-setup fails
    (
            'brew_test_bot_only_setup_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', False),
            ],
            [],
    ),
    # Scenario 5: Audit fails
    (
            'audit_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', True),
                ('audit_formula', False),
                ('brew_test_bot_only_tap_syntax', True),
                ('install_formula', True),
                ('test_formula', True),
                ('brew_test_bot_only_formulae', True),
            ],
            ['audit'],
    ),
    # Scenario 6: brew test-bot --only-tap-syntax fails
    (
            'brew_test_bot_only_tap_syntax_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', True),
                ('audit_formula', True),
                ('brew_test_bot_only_tap_syntax', False),
                ('install_formula', True),
                ('test_formula', True),
                ('brew_test_bot_only_formulae', True),
            ],
            ['tap-syntax'],
    ),
    # Scenario 7: Install fails
    (
            'install_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', True),
                ('audit_formula', True),
                ('brew_test_bot_only_tap_syntax', True),
                ('install_formula', False),
                ('test_formula', True),
                ('brew_test_bot_only_formulae', True),
            ],
            ['install'],
    ),
    # Scenario 8: Test fails
    (
            'test_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', True),
                ('audit_formula', True),
                ('brew_test_bot_only_tap_syntax', True),
                ('install_formula', True),
                ('test_formula', False),
                ('brew_test_bot_only_formulae', True),
            ],
            ['test'],
    ),
    # Scenario 9: brew test-bot --only-formulae fails
    (
            'brew_test_bot_only_formulae_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', True),
                ('audit_formula', True),
                ('brew_test_bot_only_tap_syntax', True),
                ('install_formula', True),
                ('test_formula', True),
                ('brew_test_bot_only_formulae', False),
            ],
            ['formulae'],
    ),
    # Scenario 10: Multiple failures
    (
            'multiple_failures',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_test_bot_only_cleanup_before', True),
                ('brew_test_bot_only_setup', True),
                ('audit_formula', False),
                ('brew_test_bot_only_tap_syntax', False),
                ('install_formula', False),
                ('test_formula', False),
                ('brew_test_bot_only_formulae', False),
            ],
            ['audit', 'tap-syntax', 'install', 'test', 'formulae'],
    ),
])
def test_main_error_cases(
        monkeypatch,
        scenario,
        mocks,
        expected_failures,
        operating_system,
):
    # Set up environment for validation
    monkeypatch.setenv('INPUT_VALIDATE', 'true')

    # Reset global state
    main.ERROR = False
    main.FAILURES = []

    # Set up mock args
    main.args = main._parse_args([])

    # Apply all the mocks
    mock_dict = {name: (lambda val: lambda *args, **kwargs: val)(retval) for name, retval in mocks}

    # set main.ERROR to true when there are expected failures
    # not the best approach, but this causes the code to raise SystemExit
    if expected_failures:
        main.ERROR = True

    # We need to catch SystemExit exceptions
    with patch.multiple(main, **mock_dict):
        # We need to catch SystemExit exceptions
        with pytest.raises(SystemExit):
            main.main()

        # Check if FAILURES list are as expected
        assert main.FAILURES == expected_failures


def test_main_skip_validate(monkeypatch):
    # Set up environment to skip validation
    monkeypatch.setenv('INPUT_VALIDATE', 'false')

    # Reset global state
    main.ERROR = False
    main.FAILURES = []

    # Set up mock args
    main.args = main._parse_args([])

    # Mock only the necessary functions to pass through the first part
    with patch.object(main, 'is_brew_installed', return_value=True), \
            patch.object(main, 'process_input_formula', return_value='hello_world'):
        # Should not raise SystemExit
        main.main()

        # No errors or failures should be recorded
        assert not main.ERROR
        assert not main.FAILURES


@patch('actions.release_homebrew.main._run_subprocess')
def test_prepare_repo_branch_failure(mock_run, homebrew_core_fork_repo, operating_system):
    # Mock _run_subprocess to return False for the first call (branch creation)
    # and False for the second call (branch checkout)
    mock_run.return_value = False

    # Test that the function raises SystemExit when both branch operations fail
    with pytest.raises(SystemExit):
        main.prepare_repo_branch(
            branch_suffix='release_homebrew_action_tests',
            path=homebrew_core_fork_repo,
            repo_type='Homebrew/homebrew-core fork',
            custom_branch_env_var='INPUT_HOMEBREW_CORE_HEAD_BRANCH',
            output_name='homebrew_core_branch',
            upstream_repo=os.environ['INPUT_UPSTREAM_HOMEBREW_CORE_REPO'],
            upstream_branch='main',
        )

    # Verify the function attempted to run git commands
    assert mock_run.called
    assert mock_run.call_count >= 1


@patch('actions.release_homebrew.main.prepare_repo_branch')
@patch('actions.release_homebrew.main._run_subprocess')
@patch('os.chmod')
@patch('os.path.exists')
@patch('os.makedirs')
@patch('shutil.copy2')
def test_process_input_formula_copy_failure(
    mock_copy,
    mock_makedirs,
    mock_exists,
    mock_chmod,
    mock_run_subprocess,
    mock_prepare_repo_branch,
    test_formula_file,
    tmp_path,
    operating_system
):
    # Make the initial file checks pass
    # First call (checking if formula exists): True
    # Second call (checking if it's a file): True
    # All subsequent calls (checking if copies exist): False to simulate copy failure
    mock_exists.side_effect = [True, True] + [False] * 10

    # Mock makedirs to do nothing (simulate successful directory creation)
    mock_makedirs.return_value = None

    # Mock copy2 to do nothing (simulate copy without actually copying)
    mock_copy.return_value = None

    # Mock chmod to do nothing (simulate successful permission change)
    mock_chmod.return_value = None

    # Mock prepare_repo_branch to return a branch name without doing actual git operations
    mock_prepare_repo_branch.return_value = 'release_homebrew_action/test_formula'

    # Mock _run_subprocess to simulate successful brew tap
    mock_run_subprocess.return_value = True

    # Test that the function raises FileNotFoundError when copy verification fails
    with pytest.raises(FileNotFoundError, match="was not copied"):
        main.process_input_formula(formula_file=str(test_formula_file))


@patch('actions.release_homebrew.main._run_subprocess')
def test_brew_upgrade_update_failure(mock_run):
    # Set up the mock to fail on brew update
    def side_effect(args_list, *args, **kwargs):
        # Check if 'update' is in the args_list (which is a list)
        if args_list and 'update' in args_list:
            main.ERROR = True
            return False
        # Should not reach here for upgrade since update failed
        return True

    mock_run.side_effect = side_effect

    # Call the function and check result
    result = main.brew_upgrade()

    # Assert that brew_upgrade returns False when update fails
    assert not result

    # Verify that only one call was made (the update call)
    assert mock_run.call_count == 1

    # Verify that the call was for brew update
    call_args = mock_run.call_args_list[0][1]['args_list']
    assert 'update' in call_args
    assert 'upgrade' not in call_args


@patch('actions.release_homebrew.main._run_subprocess')
def test_commit_formula_changes(mock_run, tmp_path, monkeypatch, operating_system):
    """Test that commit_formula_changes commits the formula to git."""
    # Set up environment variables
    monkeypatch.setenv('INPUT_GIT_EMAIL', 'test@example.com')
    monkeypatch.setenv('INPUT_GIT_USERNAME', 'Test User')

    # Create a temporary git repo
    repo_path = tmp_path / "test_repo"
    repo_path.mkdir()

    # Mock _run_subprocess to return True (success)
    mock_run.return_value = True

    # Call the function
    main.commit_formula_changes(
        path=str(repo_path),
        formula_filename='test_formula.rb',
        message='Test commit message'
    )

    # Verify git config was called
    # call.kwargs contains the keyword arguments passed to _run_subprocess
    assert any(
        'git' in call.kwargs.get('args_list', []) and
        'config' in call.kwargs.get('args_list', []) and
        'user.email' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )
    assert any(
        'git' in call.kwargs.get('args_list', [])
        and 'config' in call.kwargs.get('args_list', [])
        and 'user.name' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )

    # Verify git add was called
    assert any(
        'git' in call.kwargs.get('args_list', []) and
        'add' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )

    # Verify git commit was called
    assert any(
        'git' in call.kwargs.get('args_list', []) and
        'commit' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )


@patch('actions.release_homebrew.main._run_subprocess')
def test_commit_formula_changes_no_git_credentials(mock_run, tmp_path, monkeypatch, operating_system):
    """Test that commit_formula_changes works without git credentials."""
    # Ensure git credentials are not set
    monkeypatch.delenv('INPUT_GIT_EMAIL', raising=False)
    monkeypatch.delenv('INPUT_GIT_USERNAME', raising=False)

    # Create a temporary git repo
    repo_path = tmp_path / "test_repo"
    repo_path.mkdir()

    # Mock _run_subprocess to return True (success)
    mock_run.return_value = True

    # Call the function
    main.commit_formula_changes(
        path=str(repo_path),
        formula_filename='test_formula.rb',
        message='Test commit message'
    )

    # Verify git config was NOT called since no credentials
    assert not any(
        'git' in call.kwargs.get('args_list', []) and
        'config' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )

    # Verify git add was called
    assert any(
        'git' in call.kwargs.get('args_list', []) and
        'add' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )

    # Verify git commit was called
    assert any(
        'git' in call.kwargs.get('args_list', []) and
        'commit' in call.kwargs.get('args_list', [])
        for call in mock_run.call_args_list
    )


def test_start_group_pytest_mode(capsys, control_pytest_run):
    """Test start_group outputs pytest format when PYTEST_RUN is set."""
    control_pytest_run('true')

    main.start_group('Test Group')

    captured = capsys.readouterr()
    assert captured.out == '>> Test Group\n'
    assert captured.err == ''


def test_start_group_github_actions_mode(capsys, control_pytest_run):
    """Test start_group outputs GitHub Actions format when PYTEST_RUN is not set."""
    control_pytest_run(None)

    main.start_group('Test Group')

    captured = capsys.readouterr()
    assert captured.out == '::group::Test Group\n'
    assert captured.err == ''


def test_end_group_pytest_mode(capsys, control_pytest_run):
    """Test end_group outputs pytest format when PYTEST_RUN is set."""
    control_pytest_run('true')

    main.end_group()

    captured = capsys.readouterr()
    assert captured.out == '<< END\n'
    assert captured.err == ''


def test_end_group_github_actions_mode(capsys, control_pytest_run):
    """Test end_group outputs GitHub Actions format when PYTEST_RUN is not set."""
    control_pytest_run(None)

    main.end_group()

    captured = capsys.readouterr()
    assert captured.out == '::endgroup::\n'
    assert captured.err == ''


def test_process_input_formula_skips_commit_for_non_git_repo(capsys, operating_system, org_homebrew_repo, tmp_path):
    """Test that process_input_formula skips commit when repo is not a git repository."""
    # Remove the .git directory from org_homebrew_repo to simulate a non-git repo
    git_dir = os.path.join(org_homebrew_repo, '.git')
    if os.path.isdir(git_dir):
        import shutil
        shutil.rmtree(git_dir)

    # Process the formula - it should skip the commit
    formula = main.process_input_formula(
        formula_file=os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb'))

    assert formula == 'hello_world'

    # Check that the "Skipping commit" message was printed
    captured = capsys.readouterr()
    assert 'Skipping commit for' in captured.out
    assert '(not a git repository)' in captured.out
