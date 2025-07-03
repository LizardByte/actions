# standard imports
import os
import shutil
import subprocess
import sys

# lib imports
import pytest

# local imports
from actions.release_homebrew import main

os.environ['INPUT_FORMULA_FILE'] = os.path.join(os.getcwd(), 'tests', 'release_homebrew', 'Formula', 'hello_world.rb')
os.environ['INPUT_CONTRIBUTE_TO_HOMEBREW_CORE'] = 'true'
os.environ['INPUT_UPSTREAM_HOMEBREW_CORE_REPO'] = 'Homebrew/homebrew-core'


og_dir = os.getcwd()


@pytest.fixture(scope='function', autouse=True)
def change_dir():
    os.chdir(og_dir)


@pytest.fixture(scope='function', autouse=True)
def error_reset():
    main.ERROR = False


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


@pytest.fixture(scope='function')  # todo: fix repo deletion
def homebrew_core_fork_repo():
    directory = os.path.join(os.environ['GITHUB_WORKSPACE'], 'release_homebrew_action')
    os.makedirs(directory, exist_ok=True)

    repo = 'homebrew_core_fork_repo'
    repo_directory = os.path.join(directory, repo)

    if not os.path.isdir(repo_directory):
        # clone the homebrew-core fork, with depth 1
        os.chdir(directory)
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
        os.chdir(og_dir)

        if proc.returncode != 0:
            print(proc.stderr.decode('utf-8'))
            raise Exception('Failed to clone homebrew-core')

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


@pytest.fixture(scope='function')
def brew_untap():
    # uninstall hello_world formula
    proc = subprocess.run(
        args=['brew', 'uninstall', 'hello_world'],
        capture_output=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.decode('utf-8'))
        raise Exception('Failed to uninstall hello_world formula')

    # untap the temporary repo
    proc = subprocess.run(
        args=['brew', 'untap', main.temp_repo],
        capture_output=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.decode('utf-8'))
        raise Exception('Failed to untap the temporary repo')

    # remove brew tap directory
    brew_repo = main.get_brew_repository()
    tap_directory = os.path.join(brew_repo, 'Library', 'Taps', main.temp_repo)
    if os.path.isdir(tap_directory):
        shutil.rmtree(tap_directory)


@pytest.fixture(scope='function', params=['true', 'false'])
def input_validate(request):
    os.environ['INPUT_VALIDATE'] = request.param
    yield
    del os.environ['INPUT_VALIDATE']
