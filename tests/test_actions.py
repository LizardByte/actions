# standard imports
import os

# lib imports
import pytest

ACTIONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'actions')
MAX_ACTION_NAME_LENGTH = 17


def get_action_names():
    """Return a list of directory names inside the actions directory."""
    return [
        name for name in os.listdir(ACTIONS_DIR)
        if os.path.isdir(os.path.join(ACTIONS_DIR, name)) and not name.startswith('_') and not name.startswith('.')
    ]


@pytest.mark.parametrize('action_name', get_action_names())
def test_action_name_length(action_name):
    """Action directory names must not exceed 17 characters."""
    assert len(action_name) <= MAX_ACTION_NAME_LENGTH, (
        f"Action name '{action_name}' is {len(action_name)} characters long, "
        f"but must be no more than {MAX_ACTION_NAME_LENGTH} characters."
    )
