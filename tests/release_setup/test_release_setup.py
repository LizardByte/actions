# standard imports
import os
from typing import Dict, Tuple, Union

# lib imports
import pytest

# local imports
from actions.release_setup import main


@pytest.mark.parametrize('iso_timestamp', [
    ('1970-01-01T00:00:00Z', {
        'year': 1970,
        'month': '01',
        'day': '01',
        'hour': '00',
        'minute': '00',
        'second': '00',
    }),
    ('2023-11-27T23:58:28Z', {
        'year': 2023,
        'month': '11',
        'day': '27',
        'hour': '23',
        'minute': '58',
        'second': '28',
    }),
    ('2023-01-25T10:43:35Z', {
        'year': 2023,
        'month': '01',
        'day': '25',
        'hour': '10',
        'minute': '43',
        'second': '35',
    }),
    ('2024-07-14T17:17:25Z', {
        'year': 2024,
        'month': '07',
        'day': '14',
        'hour': '17',
        'minute': '17',
        'second': '25',
    }),
    ('2024-07-14T13:17:25-04:00', {
        'year': 2024,
        'month': '07',
        'day': '14',
        'hour': '17',  # include timezone offset
        'minute': '17',
        'second': '25',
    }),
    ('2024-07-14T13:17:25+04:00', {
        'year': 2024,
        'month': '07',
        'day': '14',
        'hour': '09',  # include timezone offset
        'minute': '17',
        'second': '25',
    }),
    ('2024-07-22T22:17:25-04:00', {
        'year': 2024,
        'month': '07',
        'day': '23',
        'hour': '02',  # include timezone offset
        'minute': '17',
        'second': '25',
    }),
])
def test_timestamp_class(iso_timestamp: Tuple[str, Dict[str, Union[int, str]]]):
    timestamp = main.TimestampUTC(iso_timestamp=iso_timestamp[0])

    assert timestamp.year == iso_timestamp[1]['year']
    assert timestamp.month == iso_timestamp[1]['month']
    assert timestamp.day == iso_timestamp[1]['day']
    assert timestamp.hour == iso_timestamp[1]['hour']
    assert timestamp.minute == iso_timestamp[1]['minute']
    assert timestamp.second == iso_timestamp[1]['second']

    assert repr(timestamp) == ("TimestampUTC("
                               f"y{iso_timestamp[1]['year']}."
                               f"m{iso_timestamp[1]['month']}."
                               f"d{iso_timestamp[1]['day']}."
                               f"h{iso_timestamp[1]['hour']}."
                               f"m{iso_timestamp[1]['minute']}."
                               f"s{iso_timestamp[1]['second']})")

    assert str(timestamp) == (f"self.year={iso_timestamp[1]['year']}, "
                              f"self.month='{iso_timestamp[1]['month']}', "
                              f"self.day='{iso_timestamp[1]['day']}', "
                              f"self.hour='{iso_timestamp[1]['hour']}', "
                              f"self.minute='{iso_timestamp[1]['minute']}', "
                              f"self.second='{iso_timestamp[1]['second']}'")


@pytest.mark.parametrize('message', [
    'foo',
    'bar',
])
def test_append_github_step_summary(github_step_summary_file, message):
    main.append_github_step_summary(message=message)

    with open(github_step_summary_file, 'r') as f:
        output = f.read()

    assert output.endswith(f"{message}\n")


@pytest.mark.parametrize('outputs', [
    ('test_1', 'foo'),
    ('test_2', 'bar'),
])
def test_set_github_action_output(github_output_file, outputs):
    main.set_github_action_output(output_name=outputs[0], output_value=outputs[1])

    with open(github_output_file, 'r') as f:
        output = f.read()

    assert output.endswith(f"{outputs[0]}<<EOF\n{outputs[1]}\nEOF\n")


@pytest.mark.parametrize('version', [
    ('1970.1.1', False),
    ('2025.627.5037', True),
])
def test_check_release(version):
    assert main.check_release(version=version[0]) == version[1]


def test_check_release_exists(mock_check_release_exists):
    # Test the case where a release exists (status_code == 200)
    assert main.check_release(version='2025.627.5037') is True


def test_get_repo_default_branch(github_token, github_event_path):
    assert main.get_repo_default_branch() == 'master'


def test_get_repo_squash_and_merge_required(mock_get_repo_squash_and_merge_required):
    assert main.get_repo_squash_and_merge_required() is mock_get_repo_squash_and_merge_required


def test_get_repo_squash_and_merge_required_key_error(mock_get_repo_squash_and_merge_required_key_error):
    with pytest.raises(KeyError):
        main.get_repo_squash_and_merge_required()


def test_get_push_event_details(github_event_path, input_dotnet, latest_commit):
    result = main.get_push_event_details()
    assert result
    assert 'publish_release' in result
    assert 'release_commit' in result
    assert 'release_version' in result


def test_get_push_event_details_no_squash(
    dummy_github_push_event_path,
    mock_get_squash_and_merge_return_value,
    github_step_summary_file,
    input_dotnet,
):
    # Should no longer raise SystemExit, just warn and continue
    result = main.get_push_event_details()
    assert result
    assert result['publish_release'] is True

    # Check that warning was added to step summary
    with open(github_step_summary_file, 'r') as f:
        summary = f.read()
    assert 'WARNING: Squash and merge is not enabled' in summary


def test_get_push_event_details_invalid_commits(
    dummy_github_push_event_path_invalid_commits,
    github_step_summary_file,
    input_dotnet,
    mock_get_squash_and_merge_return_value,
):
    # Should no longer raise SystemExit, just warn and continue
    result = main.get_push_event_details()
    assert result
    assert result['publish_release'] is True

    # Check that warning was added to step summary
    with open(github_step_summary_file, 'r') as f:
        summary = f.read()
    assert 'WARNING: This action only supports a single commit push event' in summary


def test_process_release_body(release_notes_sample):
    result = main.process_release_body(release_body=release_notes_sample[0])
    assert result == release_notes_sample[1]


def test_generate_release_body_success(mock_generate_release_body_success):
    result = main.generate_release_body(tag_name='v2.0.0', target_commitish='abc123')
    assert result
    assert '@testuser' in result
    assert 'Contributors' in result


def test_generate_release_body(github_token):
    assert main.generate_release_body(tag_name='test', target_commitish=os.environ['GITHUB_SHA'])


def test_generate_release_body_non_200_status_code(github_token, requests_get_error):
    assert main.generate_release_body(tag_name='test', target_commitish='abc') == ''


def test_main_function(
        github_event_path,
        github_output_file,
        github_step_summary_file,
        github_token,
        input_dotnet,
        mock_get_push_event_details,
):
    job_outputs = main.main()

    with open(github_output_file, 'r') as f:
        output = f.read()

    for output_name, output_value in job_outputs.items():
        assert f'{output_name}<<EOF\n{output_value}\nEOF\n' in output
