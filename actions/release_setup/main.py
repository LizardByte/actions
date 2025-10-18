# standard imports
import datetime
import io
import json
import os
import re

# lib imports
from dotenv import load_dotenv
import requests

# global variables
AVATAR_SIZE = 40

# Load the environment variables from the Environment File
load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# root directory of this action
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Get the repository name from the environment variables
REPOSITORY_NAME = os.environ["GITHUB_REPOSITORY"]

# Get the GitHub API token from the environment variables
GITHUB_API_TOKEN = os.environ["INPUT_GITHUB_TOKEN"]

# Define the headers for the GitHub API
GITHUB_HEADERS = {'Authorization': f'token {GITHUB_API_TOKEN}'}


class TimestampUTC:
    """
    Timestamp class to handle the timestamp conversion.

    Attributes
    ----------
    timestamp : datetime.datetime
        The timestamp in datetime format.
    year : int
        The year of the timestamp.
    month : str
        The month of the timestamp, zero-padded.
    day : str
        The day of the timestamp, zero-padded.
    hour : str
        The hour of the timestamp, zero-padded.
    minute : str
        The minute of the timestamp, zero-padded.
    second : str
        The second of the timestamp, zero-padded.
    """
    def __init__(self, iso_timestamp: str):
        # use datetime.datetime and convert created at to yyyy.m.d-hhmmss
        # GitHub can provide timestamps in different formats, ensure we handle them all using `fromisoformat`
        # timestamp: "2023-01-25T10:43:35Z"
        # timestamp "2024-07-14T13:17:25-04:00"
        self.timestamp = datetime.datetime.fromisoformat(iso_timestamp).astimezone(datetime.timezone.utc)
        self.year = self.timestamp.year
        self.month = str(self.timestamp.month).zfill(2)
        self.day = str(self.timestamp.day).zfill(2)
        self.hour = str(self.timestamp.hour).zfill(2)
        self.minute = str(self.timestamp.minute).zfill(2)
        self.second = str(self.timestamp.second).zfill(2)

    def __repr__(self):
        class_name = type(self).__name__
        return f"{class_name}(y{self.year}.m{self.month}.d{self.day}.h{self.hour}.m{self.minute}.s{self.second})"

    def __str__(self):
        return f"{self.year=}, {self.month=}, {self.day=}, {self.hour=}, {self.minute=}, {self.second=}"


def append_github_step_summary(message: str):
    """
    Append a message to the GitHub Status Summary.

    Parameters
    ----------
    message : str
        The message to append to the GitHub Status Summary. This support markdown.
    """
    with open(os.path.abspath(os.environ["GITHUB_STEP_SUMMARY"]), "a") as f:
        f.write(f'{message}\n')


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


def check_release(version: str) -> bool:
    """
    Check if the release exists in the GitHub API.

    This function will check if the release exists in the GitHub API.

    Parameters
    ----------
    version : str
        Version number of the release.

    Returns
    -------
    bool
        True if the release exists, False otherwise.
    """
    # Get the release from the GitHub API
    version_prefix = os.getenv('INPUT_TAG_PREFIX', 'v')
    github_api_url = f'https://api.github.com/repos/{REPOSITORY_NAME}/releases/tags/{version_prefix}{version}'
    response = requests.get(github_api_url, headers=GITHUB_HEADERS)

    # Check if the release exists
    if response.status_code == 200:
        return True
    else:
        return False


def get_github_event() -> dict:
    """
    Get the GitHub event from the environment variables.

    Returns
    -------
    dict
        Dictionary containing the GitHub event.
    """
    github_event_path = os.environ['GITHUB_EVENT_PATH']
    with open(github_event_path, 'r') as f:
        github_event = json.load(f)
    return github_event


def get_repo_default_branch() -> str:
    """
    Get the default branch of the repository from the GitHub event context.

    Returns
    -------
    str
        Default branch of the repository.
    """
    # get default branch from event context
    github_event = get_github_event()
    return github_event['repository']['default_branch']


def get_repo_squash_and_merge_required() -> bool:
    """
    Check if squash and merge is required for the repository.

    Returns
    -------
    bool
        True if squash and merge is required, False otherwise.

    Raises
    ------
    KeyError
        If the required keys are not found in the GitHub API response.
        Ensure the token has the `"Metadata" repository permissions (read)` scope.
    """
    github_api_url = f'https://api.github.com/repos/{REPOSITORY_NAME}'
    response = requests.get(url=github_api_url, headers=GITHUB_HEADERS)
    repo_info = response.json()

    try:
        allow_squash_merge = repo_info['allow_squash_merge']
        allow_merge_commit = repo_info['allow_merge_commit']
        allow_rebase_merge = repo_info['allow_rebase_merge']
    except KeyError:
        msg = ('::error:: Could not find the required keys in the GitHub API response. '
               'Ensure the token has the `"Metadata" repository permissions (read)` scope. '
               'If using the built-in GITHUB_TOKEN, ensure the `permissions/contents` is set to `write`.')
        print(msg)
        raise KeyError(msg)

    if allow_squash_merge and not allow_merge_commit and not allow_rebase_merge:
        return True
    else:
        print('::error:: The repository must have ONLY squash and merge enabled.')
        print('::warning:: DO NOT re-run this job after changing the repository settings.'
              'Wait until a new commit is made.')
        return False


def get_push_event_details() -> dict:
    """
    Get the details of the GitHub push event from the API.

    This function will get the details of the GitHub push event from the API.

    Returns
    -------
    dict
        Dictionary containing the details of the push event.
    """
    # default
    push_event_details = {
        'publish_release': False,
        'release_commit': '',
        'release_version': '',
    }

    github_event = get_github_event()

    is_pull_request = True if github_event.get("pull_request") else False

    push_event_details['release_commit'] = os.environ["GITHUB_SHA"]

    if is_pull_request:
        push_event_details['release_version'] = f'0.0.{github_event["number"]}'
        return push_event_details

    # get the commit timestamp
    commit_timestamp = github_event["commits"][0]['timestamp']
    current_timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # this is a push event
    # check if squash and merge is required
    if not get_repo_squash_and_merge_required():
        msg = (":exclamation: WARNING: Squash and merge is not enabled for this repository. "
               "It is recommended to require squash and merge in order to get repeatable version numbers. "
               "Falling back to using the system timestamp.")
        append_github_step_summary(message=msg)
        print(f'::warning:: {msg}')
        commit_timestamp = current_timestamp

    # ensure there is only 1 commit in the github context
    if len(github_event["commits"]) != 1:
        msg = (":exclamation: WARNING: This action only supports a single commit push event. "
               "It is recommended to require squash and merge in order to get repeatable version numbers. "
               "Falling back to using the system timestamp.")
        append_github_step_summary(message=msg)
        print(f'::warning:: {msg}')
        commit_timestamp = current_timestamp

    ts = TimestampUTC(iso_timestamp=commit_timestamp)

    # not a pull request, so publish
    push_event_details['publish_release'] = True

    if os.getenv('INPUT_DOTNET', 'false').lower() == 'true':
        # dotnet versioning
        build = f"{ts.hour}{ts.minute}"
        revision = ts.second
        release_version = f"{ts.year}.{int(ts.month)}{ts.day}.{int(build)}.{int(revision)}"
    else:
        # default versioning
        build = f"{ts.hour}{ts.minute}{ts.second}"
        release_version = f"{ts.year}.{int(ts.month)}{ts.day}.{int(build)}"

    push_event_details['release_version'] = release_version
    return push_event_details


def process_release_body(release_body: str) -> str:
    """
    Process the provided release body.

    Replace contributor mentions and PR numbers with GitHub URLs.

    Parameters
    ----------
    release_body : str
       The release body.

    Returns
    -------
    str
       Processed release body.
    """
    # replace contributor mentions with GitHub profile
    processed_body = ''
    contributors = {}
    re_username = re.compile(r'@([a-zA-Z\d\-]{0,38})')
    re_pr_url = re.compile(r'(https://github\.com/([a-zA-Z\d\-]{0,38})/([a-zA-Z\d-]+)/pull/(\d+))')
    for line in io.StringIO(release_body).readlines():
        split_line = line.rsplit(' by ', 1)

        # find the username
        username_search = re_username.search(split_line[1] if len(split_line) > 1 else line)
        if not username_search:
            processed_body += line
            continue

        username = username_search.group(1)

        update_pr_url = False
        username_url = f'https://github.com/{username}'
        username_url_md = f'[@{username}]({username_url})'

        if username in contributors:
            contributors[username]['contributions'] += 1
        else:
            contributors[username] = {
                'contributions': 1,
                'url': username_url,
            }

        if ' by @' in line:
            # replace the mention with a GitHub profile URL
            line = line.replace(f' by @{username}', f' by {username_url_md}')
            update_pr_url = True
        if '* @' in line:
            # replace the mention with a GitHub profile URL
            line = line.replace(f'* @{username}', f'* {username_url_md}')
            update_pr_url = True
        if update_pr_url:
            pr_search = re_pr_url.search(line)
            if not pr_search:
                processed_body += line
                continue

            pr_url = pr_search.group(1)
            pr_number = pr_search.group(4)

            # replace the pr url with a Markdown link
            line = line.replace(pr_url, f'[#{pr_number}]({pr_url})')

        processed_body += line

    # add contributors to the release notes
    if contributors:
        # sort contributors by contributions count
        contributors = dict(sorted(contributors.items(), key=lambda item: (-item[1]['contributions'], item[0])))

        processed_body += '\n\n---\n'
        processed_body += '## Contributors\n'
        for contributor, details in contributors.items():
            # add the contributor's avatar
            # use <img> tag to ensure the image is the correct size as unchanged avatars cannot use the size query
            processed_body += (
                f'<a href="{details["url"]}" '
                'target="_blank" '
                'rel="external noopener noreferrer" '
                f'aria-label="GitHub profile of contributor, {contributor}" '
                '>'
                f'<img src="{details["url"]}.png?size={AVATAR_SIZE}" '
                f'width="{AVATAR_SIZE}" '
                f'height="{AVATAR_SIZE}" '
                f'alt="{contributor}" '
                f'title="{contributor}: {details["contributions"]} '
                f'{"merges" if details["contributions"] > 1 else "merge"}" '
                '></a>')
    processed_body += '\n'

    return processed_body


def generate_release_body(tag_name: str, target_commitish: str) -> str:
    """
    Generate the release body, by comparing this SHA to the previous latest release.

    Parameters
    ----------
    tag_name : str
        Tag name of the release.
    target_commitish : str
        The commitish value that determines where the Git tag is created from.

    Returns
    -------
    str
        Release body.
    """
    # Get the latest release from the GitHub API
    github_api_url = f'https://api.github.com/repos/{REPOSITORY_NAME}/releases/latest'
    response = requests.get(github_api_url, headers=GITHUB_HEADERS)

    # Check if the release exists
    if not response.status_code == 200:
        return ''

    latest_release = response.json()

    # generate release notes
    github_api_url = f'https://api.github.com/repos/{REPOSITORY_NAME}/releases/generate-notes'
    data = {
        'tag_name': tag_name,
        'target_commitish': target_commitish,
        'previous_tag_name': latest_release['tag_name'],
    }
    response = requests.post(github_api_url, headers=GITHUB_HEADERS, json=data)

    release_notes = response.json()
    return process_release_body(release_body=release_notes['body'])


def main() -> dict:
    """
    Main function for the action.

    Returns
    -------
    dict
        Job outputs.
    """
    job_outputs = {}

    # Get the push event details
    push_event_details = get_push_event_details()

    release_version = push_event_details["release_version"]
    release_tag = f"{release_version}"

    # generate release notes
    if push_event_details['publish_release']:
        release_body = generate_release_body(
            tag_name=f"{os.getenv('INPUT_TAG_PREFIX', 'v')}{release_tag}",
            target_commitish=push_event_details["release_commit"],
        )
    else:
        release_body = ''
    release_generate_release_notes = True if not release_body else False

    version_prefix = ''
    if os.getenv('INPUT_INCLUDE_TAG_PREFIX_IN_OUTPUT', 'true').lower() == 'true':
        version_prefix = os.getenv('INPUT_TAG_PREFIX', 'v')

    job_outputs['publish_release'] = str(push_event_details['publish_release']).lower()
    job_outputs['release_body'] = release_body
    job_outputs['release_commit'] = push_event_details['release_commit']
    job_outputs['release_generate_release_notes'] = str(release_generate_release_notes).lower()
    job_outputs['release_version'] = release_version
    job_outputs['release_tag'] = f'{version_prefix if release_tag else ""}{release_tag}'

    # Set the outputs
    for output_name, output_value in job_outputs.items():
        # debug print
        print(f'::debug::Setting output {output_name} to {output_value}')
        set_github_action_output(output_name=output_name, output_value=output_value)

    return job_outputs


if __name__ == "__main__":
    main()  # pragma: no cover
