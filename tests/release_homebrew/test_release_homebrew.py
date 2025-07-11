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


def test_prepare_homebrew_core_fork(homebrew_core_fork_repo, operating_system):
    main.prepare_homebrew_core_fork(
        branch_suffix='release_homebrew_action_tests',
        path=homebrew_core_fork_repo
    )

    # assert that the current branch is the branch we created
    branch = get_current_branch(cwd=homebrew_core_fork_repo)
    assert branch.endswith('release_homebrew_action_tests')


def test_process_input_formula(operating_system):
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


def test_is_brew_installed(operating_system):
    assert main.is_brew_installed()


def test_brew_upgrade(operating_system):
    assert main.brew_upgrade()


def test_brew_debug(operating_system):
    assert main.brew_debug()


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


def test_audit_formula(operating_system):
    assert main.audit_formula(formula='hello_world')


def test_brew_install_formula(operating_system):
    assert main.install_formula(formula='hello_world')


def test_test_formula(operating_system):
    assert main.test_formula(formula='hello_world')


def test_main(brew_untap, homebrew_core_fork_repo, input_validate, operating_system):
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
                ('brew_upgrade', False)
            ],
            [],
    ),
    # Scenario 3: Brew debug fails
    (
            'brew_debug_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_debug', False)
            ],
            [],
    ),
    # Scenario 4: Audit fails
    (
            'audit_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_debug', True),
                ('audit_formula', False)
            ],
            ['audit'],
    ),
    # Scenario 5: Install fails
    (
            'install_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_debug', True),
                ('audit_formula', True),
                ('install_formula', False)
            ],
            ['install'],
    ),
    # Scenario 6: Test fails
    (
            'test_fails',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_debug', True),
                ('audit_formula', True),
                ('install_formula', True),
                ('test_formula', False)
            ],
            ['test'],
    ),
    # Scenario 7: Multiple failures
    (
            'multiple_failures',
            [
                ('is_brew_installed', True),
                ('process_input_formula', 'hello_world'),
                ('brew_upgrade', True),
                ('brew_debug', True),
                ('audit_formula', False),
                ('install_formula', False),
                ('test_formula', False)
            ],
            ['audit', 'install', 'test'],
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
def test_prepare_homebrew_core_fork_failure(mock_run, homebrew_core_fork_repo, operating_system):
    # Mock _run_subprocess to return False for the first call (branch creation)
    # and False for the second call (branch checkout)
    mock_run.return_value = False

    # Test that the function raises SystemExit when both branch operations fail
    with pytest.raises(SystemExit):
        main.prepare_homebrew_core_fork(
            branch_suffix='release_homebrew_action_tests',
            path=homebrew_core_fork_repo
        )

    # Verify the function attempted to run git commands
    assert mock_run.called
    assert mock_run.call_count >= 1


@patch('os.path.exists')
def test_process_input_formula_copy_failure(mock_exists, tmp_path, operating_system):
    # Create a test formula file
    test_formula = tmp_path / "test_formula.rb"
    test_formula.write_text("class TestFormula < Formula\nend")

    # Make the initial file check pass, but the copy verification fail
    # First call (checking if formula exists): True
    # Second call (checking if it's a file): True
    # All subsequent calls (checking if copies exist): False
    mock_exists.side_effect = [True, True] + [False] * 10

    # Test that the function raises FileNotFoundError when copy verification fails
    with pytest.raises(FileNotFoundError, match="was not copied"):
        main.process_input_formula(formula_file=str(test_formula))


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
