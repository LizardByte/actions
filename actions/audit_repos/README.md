# audit_repos

A reusable action to audit repositories in an organization or user account.

This action fetches repositories from an organization or user and runs various validation checks on them, including:
- Repository descriptions (existence, format, length)
- Repository settings (issues enabled, etc.)

## Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Audit Repositories
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Name             | Description                                                             | Default | Required |
|------------------|-------------------------------------------------------------------------|---------|----------|
| token            | GitHub Token with permissions to read organization repositories.        |         | `true`   |
| githubOrg        | GitHub organization or user to audit. Defaults to current repo owner.   | `""`    | `false`  |
| includeArchived  | Include archived repositories in the audit.                             | `false` | `false`  |
| includeForked    | Include forked repositories in the audit.                               | `true`  | `false`  |
| excludedRepos    | Comma-separated list of repository names to exclude from the audit.     | `""`    | `false`  |
| checkDescription | Run the repository description validation check.                        | `true`  | `false`  |
| checkSettings    | Run the repository settings validation check.                           | `true`  | `false`  |

## Outputs

This action does not produce outputs. It will fail the workflow if any audits fail, with detailed logs showing which repositories and checks failed.

## Audit Checks

### Repository Descriptions
- Checks if description exists
- Ensures description does not have leading or trailing whitespace
- Ensures description ends with a period
- Ensures description is at least 10 characters long

### Repository Settings
- Ensures issues are enabled

## Example Workflows

### Basic - Audit Current Organization

```yaml
name: Audit Repos
permissions: {}

on:
  schedule:
    - cron: '00 00 * * *'
  workflow_dispatch:

jobs:
  audit:
    name: Audit Repos
    runs-on: ubuntu-latest
    steps:
      - name: Run repository audits
        uses: LizardByte/actions/actions/audit_repos@master
        with:
          token: ${{ secrets.GH_TOKEN }}
```

### Advanced - Custom Organization with Filters

```yaml
steps:
  - name: Audit Repositories
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      githubOrg: 'MyOrgName'
      includeArchived: false
      includeForked: false
      excludedRepos: 'test-repo,legacy-repo,archive-me'
      checkDescription: true
      checkSettings: true
```

### Selective Checks Only

```yaml
steps:
  - name: Check Descriptions Only
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      checkDescription: true
      checkSettings: false
```

## Notes

- The action requires a GitHub token with permissions to read organization repositories
- By default, archived repositories are excluded but forked repositories are included
- The action will continue running all enabled audits even if some fail, providing a complete report at the end
- If no repositories match the filters, the action will exit successfully with a warning
- The action works with both GitHub organizations and user accounts
