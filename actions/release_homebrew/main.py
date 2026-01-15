# standard imports
import argparse
import os
import select
import shutil
import stat
import subprocess
import sys
from typing import AnyStr, IO, Optional, Mapping

# lib imports
from dotenv import load_dotenv

# Load the environment variables from the Environment File
load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# args placeholder
args = None

# result placeholder
ERROR = False
FAILURES = []
TEMP_DIRECTORIES = []
HOMEBREW_BUILDPATH = ""

tap_repo_name = ""  # will be set based on INPUT_ORG_HOMEBREW_REPO

og_dir = os.getcwd()


def _parse_args(args_list: list) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Homebrew formula audit, install, and test')
    parser.add_argument(
        '--formula_file',
        default=os.environ['INPUT_FORMULA_FILE'],
        help='Homebrew formula file to audit, install, and test',
        type=str,
    )
    return parser.parse_args(args_list)


def _read_and_print_output(
        pipe: Optional[IO[AnyStr]],
        encoding: str = 'utf-8',
):
    """Read a line from a pipe and print it if not empty."""
    line = pipe.readline()
    if line:
        print(line.decode(encoding), end='')


def _handle_realtime_output(process: subprocess.Popen):
    """Handle real-time output from process using select."""
    while True:
        reads = [process.stdout.fileno(), process.stderr.fileno()]
        ret = select.select(reads, [], [])

        for fd in ret[0]:
            if fd == process.stdout.fileno():
                _read_and_print_output(pipe=process.stdout)
            elif fd == process.stderr.fileno():
                _read_and_print_output(pipe=process.stderr)

        if process.poll() is not None:
            break


def _drain_remaining_output(process: subprocess.Popen):
    """Read and print any remaining output after process completion."""
    # Drain stdout
    while True:
        stdout_line = process.stdout.readline()
        if not stdout_line:
            break
        print(stdout_line.decode('utf-8'), end='')

    # Drain stderr
    while True:
        stderr_line = process.stderr.readline()
        if not stderr_line:
            break
        print(stderr_line.decode('utf-8'), end='')


def _cleanup_process(process: subprocess.Popen) -> int:
    """Close file descriptors and get exit code."""
    process.stdout.close()
    process.stderr.close()
    return process.wait()


def _setup_process(args_list: list, cwd: Optional[str], env: Optional[Mapping]) -> subprocess.Popen:
    """Set up and start the subprocess with proper working directory handling."""
    if cwd:
        os.chdir(cwd)  # hack for unit testing on windows

    try:
        process = subprocess.Popen(
            args=args_list,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=cwd,
            env=env,
        )
    finally:
        if cwd:
            os.chdir(og_dir)

    return process


def _run_subprocess(
        args_list: list,
        cwd: Optional[str] = None,
        env: Optional[Mapping] = None,
        ignore_error: bool = False,
) -> bool:
    global ERROR
    process = _setup_process(args_list=args_list, cwd=cwd, env=env)
    _handle_realtime_output(process=process)
    _drain_remaining_output(process=process)
    exit_code = _cleanup_process(process=process)

    if exit_code == 0:
        return True

    print(f'::error:: Process [{args_list}] failed with exit code', exit_code)
    if not ignore_error:
        ERROR = True
        return False

    return True


def set_github_action_output(output_name: str, output_value: str):
    """
    Set the output value by writing to the outputs in the Environment File, mimicking the behavior defined <here
    https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-output-parameter>__.

    Parameters
    ----------
    output_name : str
        Name of the output.
    output_value : str
        Value of the output.
    """
    with open(os.path.abspath(os.environ["GITHUB_OUTPUT"]), "a") as f:
        f.write(f'{output_name}<<EOF\n')
        f.write(output_value)
        f.write('\nEOF\n')


def start_group(title: str):
    """
    Start a collapsible group in GitHub Actions logs.

    Parameters
    ----------
    title : str
        The title of the group.
    """
    if os.getenv('PYTEST_RUN'):
        print(f'>> {title}')
    else:
        print(f'::group::{title}')


def end_group():
    """
    End a collapsible group in GitHub Actions logs.
    """
    if os.getenv('PYTEST_RUN'):
        print('<< END')
    else:
        print('::endgroup::')


def get_brew_repository() -> str:
    proc = subprocess.run(
        args=['brew', '--repository'],
        capture_output=True,
    )
    return proc.stdout.decode('utf-8').strip()


def commit_formula_changes(
        path: str,
        formula_filename: str,
        message: str,
) -> None:
    """
    Commit formula changes to a git repository.

    Parameters
    ----------
    path : str
        Path to the git repository.
    formula_filename : str
        Name of the formula file being committed.
    message : str
        Commit message.
    """
    start_group(f'Committing formula changes in {path}')

    # Configure git user if not already configured
    git_email = os.getenv('INPUT_GIT_EMAIL')
    git_username = os.getenv('INPUT_GIT_USERNAME')

    if git_email:
        print(f'Configuring git user.email: {git_email}')
        _run_subprocess(
            args_list=['git', 'config', 'user.email', git_email],
            cwd=path,
        )

    if git_username:
        print(f'Configuring git user.name: {git_username}')
        _run_subprocess(
            args_list=['git', 'config', 'user.name', git_username],
            cwd=path,
        )

    # Add the formula file
    print(f'Adding {formula_filename} to git')
    _run_subprocess(
        args_list=['git', 'add', '-A'],
        cwd=path,
    )

    # Commit the changes
    print(f'Committing changes: {message}')
    _run_subprocess(
        args_list=['git', 'commit', '-m', message],
        cwd=path,
        ignore_error=True,  # ignore error if nothing to commit
    )

    end_group()


def prepare_repo_branch(
        branch_suffix: str,
        path: str,
        repo_type: str,
        custom_branch_env_var: str,
        output_name: str,
        upstream_repo: Optional[str] = None,
        upstream_branch: str = 'main',
) -> str:
    """
    Prepare a repository by creating or checking out a branch for the PR.

    Parameters
    ----------
    branch_suffix : str
        Suffix to use for the branch name (typically the formula name).
    path : str
        Path to the git repository.
    repo_type : str
        Type of repository for logging (e.g., 'org homebrew repo', 'Homebrew/homebrew-core fork').
    custom_branch_env_var : str
        Environment variable name to check for custom branch name.
    output_name : str
        Name of the GitHub Action output to set with the branch name.
    upstream_repo : Optional[str]
        If provided, add this as upstream remote and sync with it.
    upstream_branch : str
        Branch name in the upstream repo to sync with (default: 'main').

    Returns
    -------
    str
        The branch name that was created or checked out.
    """
    global ERROR

    og_error = ERROR

    start_group(f'Preparing {repo_type} branch')

    # Check if a custom head branch was specified
    custom_branch = os.getenv(custom_branch_env_var, '').strip()

    if custom_branch:
        branch_name = custom_branch
        print(f'Using custom head branch: {branch_name}')
    else:
        branch_name = f'release_homebrew_action/{branch_suffix}'
        print(f'Auto-generating head branch: {branch_name}')

    # Check if we're already on the target branch
    process = subprocess.run(
        ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
        cwd=path,
        capture_output=True,
        text=True
    )
    current_branch = process.stdout.strip() if process.returncode == 0 else ''

    if current_branch == branch_name:
        print(f'Already on branch {branch_name}')
        result = True
        ERROR = og_error
    else:
        print(f'Attempt to create new branch {branch_name}')
        result = _run_subprocess(
            args_list=['git', 'checkout', '-b', branch_name],
            cwd=path,
        )
        if not result:  # checkout the existing branch
            print(f'Attempting to checkout existing branch {branch_name}')
            result = _run_subprocess(
                args_list=['git', 'checkout', branch_name],
                cwd=path,
            )

        if result:
            ERROR = og_error
        else:
            end_group()
            raise SystemExit(1, f'::error:: Failed to create or checkout branch {branch_name}')

    # If upstream repo is provided, sync with it
    if upstream_repo:
        # add the upstream remote
        print('Adding upstream remote')
        _run_subprocess(
            args_list=[
                'git',
                'remote',
                'add',
                'upstream',
                f'https://github.com/{upstream_repo}'
            ],
            cwd=path,
        )

        # fetch the upstream remote
        print('Fetching upstream remote')
        _run_subprocess(
            args_list=['git', 'fetch', 'upstream', '--depth=1'],
            cwd=path,
        )

        # hard reset
        print(f'Hard resetting to upstream/{upstream_branch}')
        _run_subprocess(
            args_list=['git', 'reset', '--hard', f'upstream/{upstream_branch}'],
            cwd=path,
        )

    set_github_action_output(
        output_name=output_name,
        output_value=branch_name
    )

    end_group()

    return branch_name


def extract_version_from_formula(formula_file: str) -> Optional[str]:
    """
    Extract version from a Homebrew formula file.

    Looks for 'version "x.y.z"' first, then falls back to 'tag: "vx.y.z"'.

    Parameters
    ----------
    formula_file : str
        Path to the formula file.

    Returns
    -------
    Optional[str]
        The version string if found, None otherwise.
    """
    version = None
    tag_found = False
    try:
        with open(formula_file, 'r') as f:
            for line in f:
                stripped = line.strip()
                # Look for version line in formula (e.g., version "1.2.3")
                # Must start with 'version' (not just contain it) to avoid matching variables like GCC_VERSION
                # Also, ensure it's at class level (2 spaces) and not inside deeper blocks (4+ spaces)
                if (
                        line.startswith('  ') and
                        not line.startswith('    ') and
                        stripped.startswith('version') and
                        '"' in line
                ):
                    # Extract version string between quotes
                    start = line.find('"')
                    end = line.find('"', start + 1)
                    if start != -1 and end != -1:
                        version = line[start + 1:end]
                        break
                # Fallback to tag if version not found (only process first occurrence)
                elif not tag_found and version is None and stripped.startswith('tag:') and '"' in line:
                    # Extract tag string between quotes (e.g., tag: "v1.2.3")
                    start = line.find('"')
                    end = line.find('"', start + 1)
                    if start != -1 and end != -1:
                        version = line[start + 1:end]
                        tag_found = True
                        # Don't break here, keep looking for version in case it comes later
    except Exception as e:
        print(f'Could not extract version from formula: {e}')

    return version


def generate_commit_message(formula: str, version: Optional[str], is_new: bool) -> str:
    """
    Generate a commit message for a formula update or addition.

    Parameters
    ----------
    formula : str
        The formula name.
    version : Optional[str]
        The version string, if available.
    is_new : bool
        True if this is a new formula, False if it's an update.

    Returns
    -------
    str
        The generated commit message.
    """
    if is_new:
        # New formula format: "foobar 7.3 (new formula)"
        if version:
            return f'{formula} {version} (new formula)'
        else:
            return f'{formula} (new formula)'
    else:
        # Update format: "foobar 7.3"
        if version:
            return f'{formula} {version}'
        else:
            return f'{formula}'


def is_formula_tracked(formula_path: str, repo_path: str) -> bool:
    """
    Check if a formula file is tracked in a git repository.

    Parameters
    ----------
    formula_path : str
        Path to the formula file.
    repo_path : str
        Path to the git repository root.

    Returns
    -------
    bool
        True if the file is tracked, False otherwise.
    """
    check_tracked = subprocess.run(
        ['git', 'ls-files', '--error-unmatch', formula_path],
        cwd=repo_path,
        capture_output=True,
    )
    return check_tracked.returncode == 0


def copy_formula_to_directories(
        formula_file: str,
        formula_filename: str,
        tap_dirs: list,
) -> None:
    """
    Copy a formula file to multiple tap directories and set permissions.

    Parameters
    ----------
    formula_file : str
        Path to the source formula file.
    formula_filename : str
        Name of the formula file.
    tap_dirs : list
        List of destination directories.
    """
    for d in tap_dirs:
        print(f'Copying {formula_filename} to {d}')
        os.makedirs(d, exist_ok=True)
        dest_file = os.path.join(d, formula_filename)
        shutil.copy2(formula_file, dest_file)

        if not os.path.exists(dest_file):
            raise FileNotFoundError(f'::error:: Formula file {formula_filename} was not copied to {d}')

        # Set permissions required by Homebrew (rw-r--r--)
        # Owner: read + write, Group: read, Others: read
        # Homebrew requires formula files to be world-readable (brew audit enforces this)
        # Only owner has write permission, complying with security best practices
        # Formula files are Ruby scripts that should not be executable
        os.chmod(dest_file, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
        print(f'Copied {formula_filename} to {d}')


def _get_tap_name_from_repo(org_homebrew_repo_input: str) -> tuple[str, str]:
    """
    Extract tap name and owner from repository input.

    Parameters
    ----------
    org_homebrew_repo_input : str
        Repository input in format owner/homebrew-tap_name or owner/actions

    Returns
    -------
    tuple[str, str]
        Tuple of (owner, tap_name)
    """
    print(f'org_homebrew_repo_input: {org_homebrew_repo_input}')
    print(f'INPUT_ORG_HOMEBREW_REPO env var: {os.getenv("INPUT_ORG_HOMEBREW_REPO")}')

    owner, repo_name = org_homebrew_repo_input.split('/')
    if repo_name.startswith('homebrew-'):
        tap_name = repo_name[9:]  # Remove "homebrew-" prefix
    elif org_homebrew_repo_input == 'LizardByte/actions':
        # Special case for CI testing
        print('Using LizardByte/actions for CI testing (special case)')
        tap_name = 'actions'
    else:
        raise ValueError(
            f'::error:: Repository name "{repo_name}" does not follow Homebrew tap naming convention. '
            f'The repository name must start with "homebrew-" (e.g., "owner/homebrew-tap"). '
            f'Please ensure the org_homebrew_repo input is set correctly. '
            f'Current value: {org_homebrew_repo_input}'
        )

    return owner, tap_name


def process_input_formula(formula_file: str) -> str:
    global tap_repo_name

    # check if the formula file exists
    if not os.path.exists(formula_file):
        raise FileNotFoundError(f'::error:: Formula file {formula_file} does not exist')

    # check if the formula file is a file
    if not os.path.isfile(formula_file):
        raise FileNotFoundError(f'::error:: Formula file {formula_file} is not a file')

    # check if the formula file is a .rb file
    if not formula_file.endswith('.rb'):
        raise ValueError(f'::error:: Formula file {formula_file} is not a .rb file')

    # get filename
    formula_filename = os.path.basename(formula_file)
    print(f'formula_filename: {formula_filename}')

    formula = formula_filename.split('.')[0]

    # get the first letter of formula name
    first_letter = formula_filename[0].lower()
    print(f'first_letter: {first_letter}')

    # enable developer mode
    print('Enabling brew developer mode')
    _run_subprocess(
        args_list=[
            'brew',
            'developer',
            'on'
        ],
    )

    # Parse the org_homebrew_repo to get the tap name
    org_homebrew_repo_input = os.getenv('INPUT_ORG_HOMEBREW_REPO', 'LizardByte/homebrew-homebrew')
    owner, tap_name = _get_tap_name_from_repo(org_homebrew_repo_input)

    tap_repo_name = f'{owner.lower()}/{tap_name}'
    print(f'tap_repo_name: {tap_repo_name}')

    org_homebrew_repo = os.path.join(
        os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action', 'org_homebrew_repo')
    homebrew_core_fork_repo = os.path.join(
        os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action', 'homebrew_core_fork_repo')
    print(f'org_homebrew_repo: {org_homebrew_repo}')
    print(f'homebrew_core_fork_repo: {homebrew_core_fork_repo}')

    # Tap the existing repo
    start_group(f'Tapping repository {tap_repo_name}')
    print(f'Running `brew tap {tap_repo_name} {org_homebrew_repo}`')
    _run_subprocess(
        args_list=[
            'brew',
            'tap',
            tap_repo_name,
            org_homebrew_repo,
        ],
    )

    end_group()

    # Prepare branches for both repositories
    # Get base branches from inputs, with defaults
    org_base_branch = os.getenv('INPUT_ORG_HOMEBREW_REPO_BASE_BRANCH', 'master')
    homebrew_core_base_branch = os.getenv('INPUT_HOMEBREW_CORE_BASE_BRANCH', 'main')

    prepare_repo_branch(
        branch_suffix=formula,
        path=org_homebrew_repo,
        repo_type='org homebrew repo',
        custom_branch_env_var='INPUT_ORG_HOMEBREW_REPO_HEAD_BRANCH',
        output_name='org_homebrew_repo_branch',
        upstream_repo=None,  # No upstream syncing for org repo
        upstream_branch=org_base_branch,  # Not used, but for consistency
    )

    if os.getenv('INPUT_CONTRIBUTE_TO_HOMEBREW_CORE').lower() == 'true':
        prepare_repo_branch(
            branch_suffix=formula,
            path=homebrew_core_fork_repo,
            repo_type='Homebrew/homebrew-core fork',
            custom_branch_env_var='INPUT_HOMEBREW_CORE_HEAD_BRANCH',
            output_name='homebrew_core_branch',
            upstream_repo=os.getenv('INPUT_UPSTREAM_HOMEBREW_CORE_REPO'),
            upstream_branch=homebrew_core_base_branch,
        )

    # copy the formula file to the directories
    start_group(f'Copying formula {formula} to tap directories')

    # Map directories to their repository root paths for committing
    tap_dir_to_repo = {}

    org_homebrew_repo_formula_dir = os.path.join(org_homebrew_repo, 'Formula', first_letter)
    homebrew_core_fork_repo_formula_dir = os.path.join(homebrew_core_fork_repo, 'Formula', first_letter)

    tap_dir_to_repo[org_homebrew_repo_formula_dir] = org_homebrew_repo
    tap_dir_to_repo[homebrew_core_fork_repo_formula_dir] = homebrew_core_fork_repo

    tap_dirs = [
        org_homebrew_repo_formula_dir,  # we will commit back to this
        homebrew_core_fork_repo_formula_dir,  # we will commit back to this
    ]

    if is_brew_installed():
        # Get the tapped location
        brew_tap_root = os.path.join(
            get_brew_repository(),
            'Library',
            'Taps',
            owner.lower(),
            f'homebrew-{tap_name}',
        )
        brew_tap_path = os.path.join(brew_tap_root, 'Formula', first_letter)
        tap_dirs.append(brew_tap_path)
        tap_dir_to_repo[brew_tap_path] = brew_tap_root

    copy_formula_to_directories(formula_file, formula_filename, tap_dirs)

    end_group()

    # Extract version from the formula file
    version = extract_version_from_formula(formula_file)

    # Commit changes to the tap directories
    commit_messages = {}

    for formula_dir, repo_path in tap_dir_to_repo.items():
        if os.path.isdir(os.path.join(repo_path, '.git')):
            formula_path = os.path.join(formula_dir, formula_filename)
            is_new = not is_formula_tracked(formula_path, repo_path)
            commit_message = generate_commit_message(formula, version, is_new)
            commit_messages[repo_path] = commit_message

            commit_formula_changes(
                path=repo_path,
                formula_filename=formula_filename,
                message=commit_message,
            )
        else:
            print(f'Skipping commit for {repo_path} (not a git repository)')

    # Set commit messages as outputs
    # Use the org_homebrew_repo commit message as the primary output
    if org_homebrew_repo in commit_messages:
        set_github_action_output(
            output_name='commit_message',
            output_value=commit_messages[org_homebrew_repo]
        )

    return formula


def is_brew_installed() -> bool:
    print('Checking if Homebrew is installed')
    return _run_subprocess(
        args_list=[
            'brew',
            '--version'
        ]
    )


def audit_formula(formula: str) -> bool:
    start_group(f'Auditing formula {formula}')
    result = _run_subprocess(
        args_list=[
            'brew',
            'audit',
            '--os=all',
            '--arch=all',
            '--strict',
            '--online',
            f'{tap_repo_name}/{formula}'
        ],
    )
    end_group()
    return result


def brew_upgrade() -> bool:
    start_group('Updating and Upgrading Homebrew')

    print('Updating Homebrew')
    env = {
        'HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK': '1',
    }

    # combine with os environment
    env.update(os.environ)

    result = _run_subprocess(
        args_list=[
            'brew',
            'update'
        ],
        env=env,
    )
    if not result:
        end_group()
        return False

    print('Upgrading Homebrew')
    result = _run_subprocess(
        args_list=[
            'brew',
            'upgrade'
        ],
        env=env,
    )

    end_group()
    return result


def brew_test_bot_only_cleanup_before() -> bool:
    start_group('Running brew test-bot --only-cleanup-before')
    result = _run_subprocess(
        args_list=[
            'brew',
            'test-bot',
            f'--tap={tap_repo_name}',
            '--only-cleanup-before',
        ],
    )
    end_group()
    return result


def brew_test_bot_only_setup() -> bool:
    start_group('Running brew test-bot --only-setup')
    result = _run_subprocess(
        args_list=[
            'brew',
            'test-bot',
            f'--tap={tap_repo_name}',
            '--only-setup',
        ],
    )
    end_group()
    return result


def brew_test_bot_only_tap_syntax() -> bool:
    start_group('Running brew test-bot --only-tap-syntax')
    result = _run_subprocess(
        args_list=[
            'brew',
            'test-bot',
            f'--tap={tap_repo_name}',
            '--only-tap-syntax',
        ],
    )
    end_group()
    return result


def brew_test_bot_only_formulae(formula: str) -> bool:
    start_group(f'Running brew test-bot --only-formulae for {formula}')

    org_repo = os.environ['INPUT_ORG_HOMEBREW_REPO']
    root_url = f'https://ghcr.io/v2/{org_repo.rsplit("-", 1)[0].lower()}'

    # Check if we should skip stable version audit (default: true, meaning skip it)
    skip_stable_version_audit = os.getenv('INPUT_SKIP_STABLE_VERSION_AUDIT', 'true').lower() == 'true'
    stable_version_audit_arg = '--skip-stable-version-audit' if skip_stable_version_audit else ''

    # Check if running from a fork PR to skip livecheck
    is_fork_pr = os.getenv('INPUT_IS_FORK_PR', 'false').lower() == 'true'

    # Build args list, filtering out empty strings
    args_list = [
        'brew',
        'test-bot',
        '--only-formulae',
        f'--tap={tap_repo_name}',
        f'--testing-formulae={tap_repo_name}/{formula}',
        f'--root-url={root_url}',
    ]

    if stable_version_audit_arg:
        args_list.append(stable_version_audit_arg)

    if is_fork_pr:
        args_list.append('--skip-livecheck')
        print('Skipping livecheck (running from fork PR)')

    # setting this will allow us to skip advanced tests when building bottles
    env = {
        'HOMEBREW_BOTTLE_BUILD': 'true',
    }

    # combine with os environment
    env.update(os.environ)

    result = _run_subprocess(
        args_list=args_list,
        env=env,
    )

    end_group()
    return result


def find_tmp_dir(formula: str) -> str:
    print('Trying to find temp directory')
    root_tmp_dirs = [
        os.getenv('HOMEBREW_TEMP', ""),  # if manually set
        '/private/tmp',  # macOS default
        '/var/tmp',  # Linux default
    ]

    # first tmp dir that exists
    root_tmp_dir = next((d for d in root_tmp_dirs if os.path.isdir(d)), None)

    if not root_tmp_dir:
        raise FileNotFoundError('::error:: Could not find root temp directory')

    print(f'Using temp directory {root_tmp_dir}')

    # find formula temp directories not already in the list
    for d in os.listdir(root_tmp_dir):
        print(f'Checking temp directory {d}')
        tmp_dir = os.path.join(root_tmp_dir, d)
        if d.startswith(f'{formula}-') and tmp_dir not in TEMP_DIRECTORIES:
            print(f'Found temp directory {tmp_dir}')
            TEMP_DIRECTORIES.append(tmp_dir)
            break
    else:
        tmp_dir = ""

    if not tmp_dir:
        raise FileNotFoundError(f'::error:: Could not find temp directory {tmp_dir}')

    return tmp_dir


def install_formula(formula: str) -> bool:
    start_group(f'Installing formula {formula}')

    env = {
        'HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK': '1',
    }

    # combine with os environment
    env.update(os.environ)

    result = _run_subprocess(
        args_list=[
            'brew',
            'install',
            '--build-from-source',
            '--include-test',
            '--keep-tmp',
            '--verbose',
            f'{tap_repo_name}/{formula}',
        ],
        env=env,
    )

    global HOMEBREW_BUILDPATH
    HOMEBREW_BUILDPATH = find_tmp_dir(formula)

    set_github_action_output(
        output_name='buildpath',
        output_value=HOMEBREW_BUILDPATH
    )

    end_group()
    return result


def test_formula(formula: str) -> bool:
    start_group(f'Testing formula {formula}')

    env = {
        'HOMEBREW_BUILDPATH': HOMEBREW_BUILDPATH,
    }

    # combine with os environment
    env.update(os.environ)

    result = _run_subprocess(
        args_list=[
            'brew',
            'test',
            '--keep-tmp',
            '--verbose',
            f'{tap_repo_name}/{formula}',
        ],
        env=env,
    )

    set_github_action_output(
        output_name='testpath',
        output_value=find_tmp_dir(formula)
    )

    end_group()
    return result


def main():
    if not is_brew_installed():
        raise SystemExit(1, 'Homebrew is not installed')

    # Always process the formula to set up branches and copy files, even if validation is skipped
    formula = process_input_formula(args.formula_file)

    if os.environ['INPUT_VALIDATE'].lower() != 'true':
        print('Skipping audit, install, and test')
        return

    upgrade_status = brew_upgrade()
    if not upgrade_status:
        print('::error:: Homebrew update or upgrade failed')
        raise SystemExit(1)

    if not brew_test_bot_only_cleanup_before():
        print('::error:: brew test-bot --only-cleanup-before failed')
        raise SystemExit(1)

    if not brew_test_bot_only_setup():
        print('::error:: brew test-bot --only-setup failed')
        raise SystemExit(1)

    if not audit_formula(formula):
        print(f'::error:: Formula {formula} failed audit')
        FAILURES.append('audit')

    if not brew_test_bot_only_tap_syntax():
        print('::error:: brew test-bot --only-tap-syntax failed')
        FAILURES.append('tap-syntax')

    if not install_formula(formula):
        print(f'::error:: Formula {formula} failed install')
        FAILURES.append('install')

    if not test_formula(formula):
        print(f'::error:: Formula {formula} failed test')
        FAILURES.append('test')

    if not brew_test_bot_only_formulae(formula):
        print('::error:: brew test-bot --only-formulae failed')
        FAILURES.append('formulae')

    if ERROR:
        raise SystemExit(
            1,
            f'::error:: Formula did not pass checks: {FAILURES}. Please check the logs for more information.'
        )

    print(f'Formula {formula} passed all checks!')


if __name__ == '__main__':  # pragma: no cover
    args = _parse_args(args_list=sys.argv[1:])
    main()
