# pinact

A reusable action to run [pinact](https://github.com/suzuki-shunsuke/pinact) against repositories in an organization and create PRs for updates.

Pinact is a tool that updates GitHub Actions to use commit hashes instead of tags, improving security by preventing tag hijacking attacks.

## 🛠️ Prep Work

### Prerequisites

- GitHub token with permissions to:
  - Read repositories
  - Create branches
  - Create pull requests

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Run Pinact
    uses: LizardByte/actions/actions/pinact@master
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
```

## 📥 Inputs

| Name           | Description                                                                                                                | Default                                                 | Required |
|----------------|----------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|----------|
| dryRun         | Dry run mode. If true, will not push changes or create pull requests.                                                      | `false`                                                 | `false`  |
| gitAuthorEmail | Git commit author email.                                                                                                   | `41898282+github-actions[bot]@users.noreply.github.com` | `false`  |
| gitAuthorName  | Git commit author name.                                                                                                    | `github-actions[bot]`                                   | `false`  |
| githubOrg      | GitHub organization or user to process repositories from. Defaults to current repo owner. Ignored if repo is specified.    | Current repository owner                                | `false`  |
| includeForks   | Include forked repositories when processing an organization. Has no effect when repo is specified.                         | `false`                                                 | `false`  |
| pinactConfig   | Pinact configuration file content (YAML).                                                                                  | Empty (no config file)                                  | `false`  |
| pinactRepo     | Repository to use for pinact. Allows using a fork. Format: owner/repo.                                                     | `suzuki-shunsuke/pinact`                                | `false`  |
| pinactVersion  | Version of pinact to use. Use `latest` for the newest release, or specify a tag (e.g., `v3.9.0`) or branch (e.g., `main`). | `latest`                                                | `false`  |
| prBranchName   | Name of the branch to create for the pull request.                                                                         | `pinact-updates`                                        | `false`  |
| repo           | Specific repository to run pinact on (format: owner/repo). If specified, runs only on this repo instead of all org repos.  | Empty (runs on all org repos)                           | `false`  |
| token          | GitHub Token with permissions to read repositories and create pull requests.                                               | N/A                                                     | `true`   |

## 📤 Outputs

This action does not produce any outputs. It creates pull requests directly in the target repositories.

## 🔒 Security Benefits

Using pinact to update GitHub Actions provides several security benefits:

- **Prevents tag hijacking**: Tags can be moved to point to different commits, but commit hashes are immutable
- **Improves supply chain security**: Ensures the exact version of an action is used
- **Audit trail**: Makes it clear exactly which version of an action is being used

## 🖥 Example Workflows

### Dry run mode (preview changes without creating PRs)

```yaml
name: Preview Pinact Changes

on:
  workflow_dispatch:

jobs:
  pinact-dry-run:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact in dry run mode
        uses: LizardByte/actions/actions/pinact@master
        with:
          dryRun: true
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Run on all repositories in an organization

```yaml
name: Update Actions with Pinact

on:
  workflow_dispatch:

jobs:
  pinact:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact on all repos
        uses: LizardByte/actions/actions/pinact@master
        with:
          token: ${{ secrets.ORG_ADMIN_TOKEN }}
```

### Run on a specific repository

```yaml
name: Update Actions with Pinact

on:
  workflow_dispatch:
    inputs:
      repo:
        description: 'Repository to update (format: owner/repo)'
        required: true

jobs:
  pinact:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact on specific repo
        uses: LizardByte/actions/actions/pinact@master
        with:
          repo: ${{ github.event.inputs.repo }}
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Using a custom pinact fork

```yaml
name: Update Actions with Pinact

on:
  workflow_dispatch:

jobs:
  pinact:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact with custom fork
        uses: LizardByte/actions/actions/pinact@master
        with:
          pinactRepo: myorg/pinact
          pinactVersion: v1.2.3
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Custom branch name and git author

```yaml
name: Update Actions with Pinact

on:
  workflow_dispatch:

jobs:
  pinact:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact with custom settings
        uses: LizardByte/actions/actions/pinact@master
        with:
          prBranchName: actions-security-update
          gitAuthorName: Security Bot
          gitAuthorEmail: security-bot@example.com
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Using custom pinact configuration

```yaml
name: Update Actions with Pinact

on:
  workflow_dispatch:

jobs:
  pinact:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact with custom config
        uses: LizardByte/actions/actions/pinact@master
        with:
          pinactConfig: |
            ---
            # config content here
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Include forked repositories

```yaml
name: Update Actions with Pinact (Including Forks)

on:
  workflow_dispatch:

jobs:
  pinact:
    runs-on: ubuntu-latest
    steps:
      - name: Run Pinact including forks
        uses: LizardByte/actions/actions/pinact@master
        with:
          includeForks: true
          token: ${{ secrets.ORG_ADMIN_TOKEN }}
```

## 📝 Notes

- **Dry run mode**: Use `dryRun: true` to preview changes without pushing branches or creating PRs
- The action automatically filters out archived repositories when running on an organization
- By default, forked repositories are excluded. Use `includeForks: true` to include them
- If a pull request already exists for the specified branch, it will be updated instead of creating a duplicate
- The action detects the default branch automatically and will error if it cannot be determined
- API rate limiting is handled with automatic retry and exponential backoff
- Temporary clones are created and cleaned up automatically
- The diff output is displayed for each repository where changes are made

## 🔗 See Also

- [pinact](https://github.com/suzuki-shunsuke/pinact) - The upstream pinact tool
- [audit_repos](../audit_repos) - Audit repositories in an organization
