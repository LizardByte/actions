# standard imports
import os
from unittest.mock import patch, Mock

# lib imports
from dotenv import load_dotenv
import pytest
import requests

# local imports
from actions.release_setup import main

# set action directory
ACTION_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'actions', 'release_setup')

# set environment variables
load_dotenv(os.path.join(ACTION_DIR, '.env'))

try:
    GITHUB_TOKEN = os.environ['INPUT_GITHUB_TOKEN']
except KeyError:
    os.environ['INPUT_GITHUB_TOKEN'] = ''
    GITHUB_TOKEN = os.environ['INPUT_GITHUB_TOKEN']

GITHUB_HEADERS = {'Authorization': f'token {GITHUB_TOKEN}'}

# globals
COMMIT = None
DATA_DIRECTORY = os.path.join(os.path.dirname(__file__), 'data')


def pytest_runtest_setup(item):
    if 'github_token' in item.fixturenames and not GITHUB_TOKEN:
        pytest.skip('INPUT_GITHUB_TOKEN environment variable not set')


@pytest.fixture(scope='session')
def github_token():
    yield


@pytest.fixture(scope='function')
def github_output_file():
    f = os.environ['GITHUB_OUTPUT']

    # ensure directory exists
    os.makedirs(os.path.dirname(f), exist_ok=True)

    # touch the file
    with open(f, 'w') as fi:
        fi.write('')

    yield f

    # re-touch the file
    with open(f, 'w') as fi:
        fi.write('')


@pytest.fixture(scope='function')
def github_step_summary_file():
    f = os.environ['GITHUB_STEP_SUMMARY']

    # ensure directory exists
    os.makedirs(os.path.dirname(f), exist_ok=True)

    # touch the file
    with open(f, 'w') as fi:
        fi.write('')

    yield f

    # re-touch the file
    with open(f, 'w') as fi:
        fi.write('')


@pytest.fixture(scope='function')
def latest_commit(github_token):
    global COMMIT
    original_sha = os.environ.get('GITHUB_SHA', '')

    if not COMMIT:
        # get commits on the default branch
        github_api_url = f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/commits"
        response = requests.get(
            url=github_api_url,
            headers=GITHUB_HEADERS,
            params={'sha': 'master'},
        )
        data = response.json()
        COMMIT = data[0]['sha']

    os.environ['GITHUB_SHA'] = COMMIT
    yield COMMIT

    os.environ['GITHUB_SHA'] = original_sha


@pytest.fixture(scope='function')
def dummy_github_push_event_path():
    original_value = os.getenv('GITHUB_EVENT_PATH', os.path.join(DATA_DIRECTORY, 'dummy_github_event.json'))
    os.environ['GITHUB_EVENT_PATH'] = os.path.join(DATA_DIRECTORY, 'dummy_github_push_event.json')
    yield
    os.environ['GITHUB_EVENT_PATH'] = original_value


@pytest.fixture(scope='function')
def dummy_github_push_event_path_invalid_commits():
    original_value = os.getenv('GITHUB_EVENT_PATH', os.path.join(DATA_DIRECTORY, 'dummy_github_event.json'))
    os.environ['GITHUB_EVENT_PATH'] = os.path.join(DATA_DIRECTORY, 'dummy_github_push_event_invalid_commits.json')
    yield
    os.environ['GITHUB_EVENT_PATH'] = original_value


@pytest.fixture(scope='function', params=['pr', 'push', 'push_alt_timestamp'])
def github_event_path(request):
    original_value = os.getenv('GITHUB_EVENT_PATH', os.path.join(DATA_DIRECTORY, 'dummy_github_event.json'))
    os.environ['GITHUB_EVENT_PATH'] = os.path.join(DATA_DIRECTORY, f'dummy_github_{request.param}_event.json')
    yield
    os.environ['GITHUB_EVENT_PATH'] = original_value


@pytest.fixture(params=[True, False], scope='function')
def input_dotnet(request):
    os.environ['INPUT_DOTNET'] = str(request.param).lower()
    yield

    del os.environ['INPUT_DOTNET']


@pytest.fixture(scope='function')
def requests_get_error():
    original_get = requests.get

    mock_response = Mock()
    mock_response.status_code = 500
    requests.get = Mock(return_value=mock_response)

    yield

    requests.get = original_get


@pytest.fixture(scope='function', params=[True, False])
def mock_get_push_event_details(request):
    if request.param:
        # If the parameter is True, return a mock
        with patch('actions.release_setup.main.get_push_event_details') as mock:
            mock.return_value = {
                'publish_release': True,
                'release_commit': 'master',
                'release_version': 'test',
            }
            yield
    else:
        # If the parameter is False, don't patch anything
        yield


@pytest.fixture(scope='function', params=[True, False])
def mock_get_repo_squash_and_merge_required(request):
    original_get = requests.get

    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        'allow_squash_merge': True,
        'allow_merge_commit': not request.param,
        'allow_rebase_merge': not request.param,
    }

    requests.get = Mock(return_value=mock_response)

    yield request.param

    requests.get = original_get


@pytest.fixture(scope='function')
def mock_get_repo_squash_and_merge_required_key_error():
    original_get = requests.get

    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.json.return_value = {}

    requests.get = Mock(return_value=mock_response)

    yield

    requests.get = original_get


@pytest.fixture(scope='function')
def mock_get_squash_and_merge_return_value():
    original_function = main.get_repo_squash_and_merge_required
    main.get_repo_squash_and_merge_required = Mock(return_value=False)
    yield
    main.get_repo_squash_and_merge_required = original_function


@pytest.fixture(scope='function')
def mock_generate_release_body_success():
    original_get = requests.get
    original_post = requests.post

    # Mock the GET request for latest release
    mock_get_response = Mock()
    mock_get_response.status_code = 200
    mock_get_response.json.return_value = {'tag_name': 'v1.0.0'}

    # Mock the POST request for generating release notes
    mock_post_response = Mock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        'body': '## What\'s Changed\n* Test PR by @testuser in https://github.com/test/repo/pull/1',
    }

    requests.get = Mock(return_value=mock_get_response)
    requests.post = Mock(return_value=mock_post_response)

    yield

    requests.get = original_get
    requests.post = original_post


@pytest.fixture(scope='function')
def mock_check_release_exists():
    original_get = requests.get

    mock_response = Mock()
    mock_response.status_code = 200

    requests.get = Mock(return_value=mock_response)

    yield

    requests.get = original_get


@pytest.fixture(scope='module', params=[0, 1])
def release_notes_sample(request):
    sample_set = ()
    with open(os.path.join(DATA_DIRECTORY, f'provided_release_notes_sample_{request.param}.md'), 'r') as f:
        sample_set += (f.read(),)
    with open(os.path.join(DATA_DIRECTORY, f'expected_release_notes_sample_{request.param}.md'), 'r') as f:
        sample_set += (f.read(),)

    return sample_set
