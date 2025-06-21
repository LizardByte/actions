# -*- coding: utf-8 -*-
# standard imports
import os

# lib imports
import pytest


@pytest.fixture(scope='session')
def input_python_version():
    return os.environ.get('INPUT_PYTHON_VERSION')
