import os
import re
from setuptools import setup


def get_dev_extras():
    """Read the dev extras from pyproject.toml without any TOML library dependency."""
    pyproject_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")

    with open(pyproject_path, "r") as f:
        content = f.read()

    # Extract the [project.optional-dependencies] dev block
    match = re.search(
        r'\[project\.optional-dependencies]\s*dev\s*=\s*\[(.*?)]',
        content,
        re.DOTALL,
    )
    if not match:
        return []

    block = match.group(1)
    # Extract each quoted string
    return re.findall(r'"([^"]+)"', block)


setup(
    extras_require={
        "dev": get_dev_extras(),
    },
)
