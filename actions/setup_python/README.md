# setup_python

A reusable action to set up Python using pyenv on GitHub Actions runners.

This action provides a consistent way to install any Python version available in pyenv across all platforms,
including older versions like Python 2.7 that are no longer available in the standard actions/setup-python action.

## 🚀 Basic Usage

See [action.yml](action.yml)

**Python**
```yaml
steps:
  - uses: LizardByte/actions/actions/setup_python@master
    with:
      python-version: '3.12'
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

| Name           | Description                      | Default | Required |
|----------------|----------------------------------|---------|----------|
| python-version | The version of Python to set up. |         | `true`   |

## 📤 Outputs

This action does not produce outputs.

## 📝 Notes

> [!NOTE]
> The python version must be an available option from pyenv. The versions available depend on the operating system and
> architecture. The available versions will be listed in the output of the action.
