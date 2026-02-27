# get_changed_files

Get the list of changed files in a pull request.

## 🛠 Prep Work

This action requires access to the GitHub API. The default `GITHUB_TOKEN` is sufficient for public repositories.
For private repositories, a token with `repo` scope may be required.

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Get changed files
    id: changed_files
    uses: LizardByte/actions/actions/get_changed_files@master

  - name: Use changed files
    run: echo "${{ steps.changed_files.outputs.changed_files }}"
```

## 📥 Inputs

| Name      | Description                                                                              | Default                                   | Required |
|-----------|------------------------------------------------------------------------------------------|-------------------------------------------|----------|
| token     | GitHub Token used to authenticate API requests. Defaults to the built-in `GITHUB_TOKEN`. | `${{ github.token }}`                     | `false`  |
| pr_number | The pull request number to get changed files for. Defaults to the current PR number.     | `${{ github.event.pull_request.number }}` | `false`  |

## 📤 Outputs

| Name          | Description                                                  |
|---------------|--------------------------------------------------------------|
| changed_files | Newline-separated list of changed files in the pull request. |

## 📝 Notes

- The action uses pagination to retrieve all changed files, so it works correctly for PRs with many files.
- Changed files are returned as a newline-separated string in the `changed_files` output, which safely handles
  filenames containing spaces.
- If no `pr_number` is provided and the action is not running in a `pull_request` event context, the action will fail.
