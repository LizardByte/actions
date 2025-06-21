# setup_python

This action provides the following functionality for GitHub Actions users:

- Installing a version of Python or PyPy and (by default) adding it to the PATH, including Python 2.7.

The action was developed after GitHub decided to remove support for Python 2.7 from their `actions/setup-python` action.

## Basic usage

See [action.yml](action.yml)

**Python**
```yaml
steps:
- uses: actions/checkout@v4
- uses: LizardByte/actions/actions/setup_python@master
  with:
    python-version: '3.12'
- run: python my_script.py
```

**Python 2.7**
```yaml
steps:
- uses: actions/checkout@v4
- uses: LizardByte/actions/actions/setup_python@master
  with:
    python-version: '2.7'
- run: python my_script.py
```

**PyPy**
```yaml
steps:
- uses: actions/checkout@v4
- uses: LizardByte/actions/actions/setup_python@master
  with:
    python-version: 'pypy3.9'
- run: python my_script.py
```

The `python-version` input is required.

If the version of Python is not `2.7` the action will use `actions/setup-python` and pass the version to that
action. Otherwise, it will install Python 2.7 on your platform.
