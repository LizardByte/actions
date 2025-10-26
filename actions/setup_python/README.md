# setup_python

A reusable action to set up Python using pyenv on GitHub Actions runners.

This action provides a consistent way to install any Python version available in pyenv across all platforms,
including older versions like Python 2.7 that are no longer available in the standard actions/setup-python action.

## 🚀 Basic Usage

See [action.yml](action.yml)

**Single Python Version**
```yaml
steps:
  - uses: LizardByte/actions/actions/setup_python@master
    with:
      python-version: '3.12'
  - run: python my_script.py
```

**Multiple Python Versions**
```yaml
steps:
  - uses: LizardByte/actions/actions/setup_python@master
    with:
      python-version: |
        3.11
        3.12
        3.13
  - run: python my_script.py
```

**Python Version from File**
```yaml
steps:
  - uses: LizardByte/actions/actions/setup_python@master
    with:
      python-version-file: '.python-version'
  - run: python my_script.py
```

**Python 2.7**
```yaml
steps:
  - uses: LizardByte/actions/actions/setup_python@master
    with:
      python-version: '2.7'
  - run: python my_script.py
```

**PyPy**
```yaml
steps:
  - uses: LizardByte/actions/actions/setup_python@master
    with:
      python-version: 'pypy3.9'
  - run: python my_script.py
```

## 📥 Inputs

| Name                | Description                                                                                                              | Default | Required |
|---------------------|--------------------------------------------------------------------------------------------------------------------------|---------|----------|
| python-version      | The version(s) of Python to set up. Can be a single version or multiple versions separated by newlines or spaces.        |         | `false`  |
| python-version-file | File containing the Python version to set up. Supports `.python-version`, `pyproject.toml`, `.tool-versions`, `Pipfile`. |         | `false`  |

> [!NOTE]
> Either `python-version` or `python-version-file` must be specified.

## 📤 Outputs

This action does not produce outputs.

## 📝 Notes

> [!NOTE]
> The python version must be an available option from pyenv. The versions available depend on the operating system and
> architecture. The available versions will be listed in the output of the action.

> [!TIP]
> When installing multiple Python versions:
> - All specified versions will be installed via pyenv
> - Only the last version in the list will be set as the global/default Python version
> - Other installed versions can still be accessed using `pyenv shell <version>` or `pyenv local <version>`

## 📂 Supported File Formats

When using `python-version-file`, the following file formats are supported:

### `.python-version`
```
3.12.0
```

Or for multiple versions:
```
3.11.0
3.12.0
3.13.0
```

### `pyproject.toml`
```toml
[project]
requires-python = ">=3.8"
```

Or:
```toml
[tool.poetry.dependencies]
python = "^3.8"
```

### `.tool-versions`
```
python 3.12.0
```

### `Pipfile`
```toml
[requires]
python_version = "3.12"
```
