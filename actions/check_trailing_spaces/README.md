# check_trailing_spaces

Check files for trailing spaces, empty lines at EOF, and missing newline at EOF.

## 🛠 Prep Work

This action requires access to the repository's file system. For PR-based checks it also uses the GitHub API
to get the list of changed files, so a valid GitHub Token is required.

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Check trailing spaces
    uses: LizardByte/actions/actions/check_trailing_spaces@master
```

## 📥 Inputs

| Name                         | Description                                                                                                         | Default                                   | Required |
|------------------------------|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------|----------|
| token                        | GitHub Token used to authenticate API requests. Defaults to the built-in `GITHUB_TOKEN`.                            | `${{ github.token }}`                     | `false`  |
| pr_number                    | The pull request number to check. Defaults to the current PR number.                                                | `${{ github.event.pull_request.number }}` | `false`  |
| changed_files                | Newline-separated list of files to check. When provided, skips the GitHub API call. Supports filenames with spaces. | `''`                                      | `false`  |
| check_all_files              | Set to `"true"` to check all files in the repository instead of only changed PR files.                              | `'false'`                                 | `false`  |
| check_empty_line_at_eof      | Check that the last line in a file is not empty.                                                                    | `'true'`                                  | `false`  |
| check_missing_newline_at_eof | Check that the last line in the file ends in a newline character.                                                   | `'true'`                                  | `false`  |
| source_directory             | Directory to check when `check_all_files` is `true`. Defaults to the current directory.                             | `'.'`                                     | `false`  |
| ignore_patterns              | Newline-separated list of glob patterns for files to ignore (e.g., `*.md\n*.json`).                                 | `''`                                      | `false`  |

## 📤 Outputs

This action does not produce outputs. It will fail the workflow if any checks fail, with detailed logs showing
which files and lines are affected.

## ✅ Checks Performed

### Trailing Spaces

Detects lines that end with one or more spaces or tab characters. The output will list the file path and line
number for each violation.

### Empty Line at EOF

Detects files where the last line is blank (i.e., the file ends with two or more consecutive newlines). This is
distinct from having a single trailing newline (which is correct and required).

### Missing Newline at EOF

Detects files where the very last character is not a newline (`\n`). Many editors and tools expect files to end
with a newline character.

## 📋 Example Workflows

### Check PR changed files (default behavior)

```yaml
name: Check Trailing Spaces

on:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Check trailing spaces
        uses: LizardByte/actions/actions/check_trailing_spaces@master
```

### Check all files in the repository

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Check all files for trailing spaces
    uses: LizardByte/actions/actions/check_trailing_spaces@master
    with:
      check_all_files: 'true'
      source_directory: '.'
```

### Skip certain file types

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Check trailing spaces (skip binary/generated files)
    uses: LizardByte/actions/actions/check_trailing_spaces@master
    with:
      check_all_files: 'true'
      ignore_patterns: |
        *.png
        *.jpg
        *.min.js
        *.min.css
```

### Use with pre-fetched changed files

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Get changed files
    id: changed_files
    uses: LizardByte/actions/actions/get_changed_files@master

  - name: Check trailing spaces
    uses: LizardByte/actions/actions/check_trailing_spaces@master
    with:
      changed_files: ${{ steps.changed_files.outputs.changed_files }}
```

### Disable specific checks

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Check only trailing spaces (skip EOF checks)
    uses: LizardByte/actions/actions/check_trailing_spaces@master
    with:
      check_empty_line_at_eof: 'false'
      check_missing_newline_at_eof: 'false'
```

## 📝 Notes

- Only text files are checked. Binary files are automatically skipped.
- The `.git` directory is always excluded when scanning all files.
- When running on a pull request without providing `changed_files`, this action will automatically
  use the GitHub API to get the list of changed files.
- If no PR number is available and `check_all_files` is `false`, the action falls back to checking all files.

## 🔗 See Also

- [get_changed_files](../get_changed_files) - Get a list of changed files in a repository.
