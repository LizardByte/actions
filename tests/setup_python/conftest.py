# -*- coding: utf-8 -*-
# standard imports
import os

# lib imports
import pytest


@pytest.fixture(scope='session')
def input_python_version():
    # split by `-` to remove architecture suffix from pyenv versions
    return os.environ.get('INPUT_PYTHON_VERSION').split('-')[0]
