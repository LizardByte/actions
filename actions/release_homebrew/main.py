# standard imports
import argparse
import os
import select
import shutil
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

temp_repo = os.path.join('release_homebrew_action', 'homebrew-test')

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

    process = subprocess.Popen(
        args=args_list,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=env,
    )

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


def get_brew_repository() -> str:
    proc = subprocess.run(
        args=['brew', '--repository'],
        capture_output=True,
    )
    return proc.stdout.decode('utf-8').strip()


def prepare_homebrew_core_fork(
        branch_suffix: str,
        path: str,
) -> None:
    global ERROR

    og_error = ERROR

    print('Preparing Homebrew/homebrew-core fork')

    # checkout a new branch
    branch_name = f'release_homebrew_action/{branch_suffix}'

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
        raise SystemExit(1, f'::error:: Failed to create or checkout branch {branch_name}')

    # add the upstream remote
    print('Adding upstream remote')
    _run_subprocess(
        args_list=[
            'git',
            'remote',
            'add',
            'upstream',
            f'https://github.com/{os.environ["INPUT_UPSTREAM_HOMEBREW_CORE_REPO"]}'
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
    print('Hard resetting to upstream/master')
    _run_subprocess(
        args_list=['git', 'reset', '--hard', 'upstream/master'],
        cwd=path,
    )

    set_github_action_output(
        output_name='homebrew_core_branch',
        output_value=branch_name
    )


def process_input_formula(formula_file: str) -> str:
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

    # run brew tap
    print(f'Running `brew tap-new {temp_repo} --no-git`')
    _run_subprocess(
        args_list=[
            'brew',
            'tap-new',
            temp_repo,
            '--no-git'
        ],
    )

    org_homebrew_repo = os.path.join(
        os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action', 'org_homebrew_repo')
    homebrew_core_fork_repo = os.path.join(
        os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action', 'homebrew_core_fork_repo')
    print(f'org_homebrew_repo: {org_homebrew_repo}')
    print(f'homebrew_core_fork_repo: {homebrew_core_fork_repo}')

    if os.getenv('INPUT_CONTRIBUTE_TO_HOMEBREW_CORE').lower() == 'true':
        prepare_homebrew_core_fork(branch_suffix=formula, path=homebrew_core_fork_repo)

    # copy the formula file to the two directories
    tap_dirs = [
        os.path.join(org_homebrew_repo, 'Formula', first_letter),  # we will commit back to this
        os.path.join(homebrew_core_fork_repo, 'Formula', first_letter),  # we will commit back to this
    ]
    if is_brew_installed():
        tap_dirs.append(os.path.join(get_brew_repository(), 'Library', 'Taps', temp_repo, 'Formula', first_letter))
    for d in tap_dirs:
        print(f'Copying {formula_filename} to {d}')
        os.makedirs(d, exist_ok=True)
        shutil.copy2(formula_file, d)

        if not os.path.exists(os.path.join(d, formula_filename)):
            raise FileNotFoundError(f'::error:: Formula file {formula_filename} was not copied to {d}')
        print(f'Copied {formula_filename} to {d}')

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
    print(f'Auditing formula {formula}')
    return _run_subprocess(
        args_list=[
            'brew',
            'audit',
            '--os=all',
            '--arch=all',
            '--strict',
            '--online',
            os.path.join(temp_repo, formula)
        ],
    )


def brew_upgrade() -> bool:
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
        return False

    print('Upgrading Homebrew')
    return _run_subprocess(
        args_list=[
            'brew',
            'upgrade'
        ],
        env=env,
    )


def brew_debug() -> bool:
    # run brew config
    print('Running `brew config`')
    result = _run_subprocess(
        args_list=[
            'brew',
            'config',
        ],
    )

    # run brew doctor
    print('Running `brew doctor`')
    _run_subprocess(
        args_list=[
            'brew',
            'doctor',
        ],
        ignore_error=True,
    )

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
    print(f'Installing formula {formula}')
    env = {
        'HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK': '1',
    }

    # combine with os environment
    env.update(os.environ)

    result = _run_subprocess(
        args_list=[
            'brew',
            'install',
            '--include-test',
            '--keep-tmp',
            '--verbose',
            os.path.join(temp_repo, formula),
        ],
        env=env,
    )

    global HOMEBREW_BUILDPATH
    HOMEBREW_BUILDPATH = find_tmp_dir(formula)

    set_github_action_output(
        output_name='buildpath',
        output_value=HOMEBREW_BUILDPATH
    )

    return result


def test_formula(formula: str) -> bool:
    print(f'Testing formula {formula}')
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
            os.path.join(temp_repo, formula),
        ],
        env=env,
    )

    set_github_action_output(
        output_name='testpath',
        output_value=find_tmp_dir(formula)
    )

    return result


def main():
    if not is_brew_installed():
        raise SystemExit(1, 'Homebrew is not installed')

    formula = process_input_formula(args.formula_file)

    if os.environ['INPUT_VALIDATE'].lower() != 'true':
        print('Skipping audit, install, and test')
        return

    upgrade_status = brew_upgrade()
    if not upgrade_status:
        print('::error:: Homebrew update or upgrade failed')
        raise SystemExit(1)

    if not brew_debug():
        print('::error:: Homebrew debug failed')
        raise SystemExit(1)

    if not audit_formula(formula):
        print(f'::error:: Formula {formula} failed audit')
        FAILURES.append('audit')

    if not install_formula(formula):
        print(f'::error:: Formula {formula} failed install')
        FAILURES.append('install')

    if not test_formula(formula):
        print(f'::error:: Formula {formula} failed test')
        FAILURES.append('test')

    if ERROR:
        raise SystemExit(
            1,
            f'::error:: Formula did not pass checks: {FAILURES}. Please check the logs for more information.'
        )

    print(f'Formula {formula} audit, install, and test successful')


if __name__ == '__main__':  # pragma: no cover
    args = _parse_args(args_list=sys.argv[1:])
    main()
