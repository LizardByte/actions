# Python Version Test Files

This directory contains sample Python version files for testing the `setup_python` action's file parsing capabilities.

## Directory Structure

```
version_files/
├── python-version/          # .python-version files
│   ├── single-version/      # Single version specified
│   ├── multiple-versions/   # Multiple versions (one per line)
│   └── patch-version/       # Version with patch number
├── pyproject-toml/          # pyproject.toml files
│   ├── requires-python-gte/       # Using requires-python with >= operator
│   ├── requires-python-exact/     # Using requires-python with == operator
│   ├── requires-python-compatible/ # Using requires-python with ~= operator
│   ├── poetry-caret/              # Poetry format with ^ operator
│   └── requires-python-with-patch/ # requires-python with patch version
├── tool-versions/           # .tool-versions files
│   ├── single-version/      # Just Python specified
│   ├── with-other-tools/    # Python with other tools (nodejs, ruby)
│   └── patch-version/       # Version with patch number
└── pipfile/                 # Pipfile files
    ├── simple/              # Basic Pipfile
    ├── with-dependencies/   # Pipfile with various dependencies
    └── with-patch-version/  # Python version with patch number
```

## Test File Details

### .python-version Files

#### `python-version/single-version/.python-version`
- **Content**: `3.12.0`
- **Expected Output**: `3.12.0`
- **Use Case**: Standard single version specification

#### `python-version/multiple-versions/.python-version`
- **Content**: Multiple versions (3.11.0, 3.12.0, 3.13.0)
- **Expected Output**: `3.11.0 3.12.0 3.13.0`
- **Default Version**: `3.13.0` (last one)
- **Use Case**: Testing multiple Python versions installation

#### `python-version/patch-version/.python-version`
- **Content**: `3.10.5`
- **Expected Output**: `3.10.5`
- **Use Case**: Version with full patch number

### pyproject.toml Files

#### `pyproject-toml/requires-python-gte/pyproject.toml`
- **Content**: `requires-python = ">=3.8"`
- **Expected Output**: `3.8`
- **Use Case**: Greater-than-or-equal version constraint

#### `pyproject-toml/requires-python-exact/pyproject.toml`
- **Content**: `requires-python = "==3.11.5"`
- **Expected Output**: `3.11.5`
- **Use Case**: Exact version match

#### `pyproject-toml/requires-python-compatible/pyproject.toml`
- **Content**: `requires-python = "~=3.9.0"`
- **Expected Output**: `3.9.0`
- **Use Case**: Compatible release version

#### `pyproject-toml/poetry-caret/pyproject.toml`
- **Content**: Poetry format with `python = "^3.10"`
- **Expected Output**: `3.10`
- **Use Case**: Poetry dependency format with caret operator

#### `pyproject-toml/requires-python-with-patch/pyproject.toml`
- **Content**: `requires-python = ">=3.12.1"`
- **Expected Output**: `3.12.1`
- **Use Case**: Version constraint with patch number

### .tool-versions Files

#### `tool-versions/single-version/.tool-versions`
- **Content**: `python 3.12.0`
- **Expected Output**: `3.12.0`
- **Use Case**: Standard asdf format with just Python

#### `tool-versions/with-other-tools/.tool-versions`
- **Content**: Multiple tools including `python 3.11.4`
- **Expected Output**: `3.11.4`
- **Use Case**: .tool-versions with multiple language runtimes

#### `tool-versions/patch-version/.tool-versions`
- **Content**: `python 3.10.12`
- **Expected Output**: `3.10.12`
- **Use Case**: Python version with patch number

### Pipfile Files

#### `pipfile/simple/Pipfile`
- **Content**: `python_version = "3.12"`
- **Expected Output**: `3.12`
- **Use Case**: Basic Pipfile with minimal dependencies

#### `pipfile/with-dependencies/Pipfile`
- **Content**: `python_version = "3.11"`
- **Expected Output**: `3.11`
- **Use Case**: Pipfile with more realistic dependency list

#### `pipfile/with-patch-version/Pipfile`
- **Content**: `python_version = "3.10.5"`
- **Expected Output**: `3.10.5`
- **Use Case**: Python version specified with patch number

## Usage in Tests

These files can be used to test the action's ability to parse different file formats and version specifications. Example usage:

```yaml
- uses: LizardByte/actions/actions/setup_python@master
  with:
    python-version-file: 'tests/setup_python/version_files/python-version/single-version/.python-version'
```

## Testing Coverage

The test files cover:
- ✅ Single version specifications
- ✅ Multiple version specifications (for .python-version)
- ✅ Different version operators (>=, ==, ~=, ^)
- ✅ Major.minor versions (e.g., 3.12)
- ✅ Major.minor.patch versions (e.g., 3.12.0)
- ✅ Poetry-style pyproject.toml
- ✅ PEP 621 pyproject.toml
- ✅ Multi-tool .tool-versions files
- ✅ Realistic Pipfile examples
