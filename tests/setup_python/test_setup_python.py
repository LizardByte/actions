# -*- coding: utf-8 -*-
# standard imports
import platform
import sys


def test_python_platform_version(input_python_version):
    assert platform.python_version().startswith(input_python_version)


def test_python_system_version(input_python_version):
    assert sys.version.startswith(input_python_version)
