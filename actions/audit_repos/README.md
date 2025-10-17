# audit_repos

A reusable action to audit repositories in an organization or user account.

This action fetches repositories from an organization or user and runs various validation checks on them, including:
- Repository descriptions (existence, format, length)
- Repository settings (issues enabled, etc.)
- Merge types (merge commits, squash, rebase)
- Discussions configuration (org-wide vs. repo-specific)
- Community health files (README, LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, sponsors)

## 🛠️ Prep Work

### Token Requirements

This action works with the default `GITHUB_TOKEN` **only for public repositories in the current organization**.
For full functionality, especially when auditing:
- Private repositories
- Repositories in a different organization
- Community health files and detailed settings

You will need a **Personal Access Token (PAT)** with the following scopes:
- `repo` (for private repositories)
- `read:org` (for organization repositories)

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Audit Repositories
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
```

## 📥 Inputs

| Name                  | Description                                                                     | Default    | Required |
|-----------------------|---------------------------------------------------------------------------------|------------|----------|
| allowEmptyDescription | Allow repositories to have empty descriptions when checkDescription is enabled. | `false`    | `false`  |
| allowMergeCommit      | Allow merge commits. Options: `disabled`, `enabled`, `any`.                     | `disabled` | `false`  |
| allowRebaseMerge      | Allow rebase merge. Options: `disabled`, `enabled`, `any`.                      | `any`      | `false`  |
| allowSquashMerge      | Allow squash merge. Options: `disabled`, `enabled`, `any`.                      | `enabled`  | `false`  |
| checkCodeOfConduct    | Check if CODE_OF_CONDUCT exists.                                                | `true`     | `false`  |
| checkCommunityFiles   | Run the community health files validation check.                                | `true`     | `false`  |
| checkContributing     | Check if CONTRIBUTING exists.                                                   | `true`     | `false`  |
| checkDescription      | Run the repository description validation check.                                | `true`     | `false`  |
| checkDiscussions      | Run discussions validation. Options: `disabled`, `org`, `repo`.                 | `disabled` | `false`  |
| checkLicense          | Check if LICENSE exists.                                                        | `true`     | `false`  |
| checkMergeTypes       | Run the merge types validation check.                                           | `true`     | `false`  |
| checkReadme           | Check if README exists.                                                         | `true`     | `false`  |
| checkSecurity         | Check if SECURITY policy exists.                                                | `true`     | `false`  |
| checkSettings         | Run the repository settings validation check.                                   | `true`     | `false`  |
| checkSponsors         | Check if sponsors are activated (FUNDING.yml exists).                           | `true`     | `false`  |
| excludedRepos         | Comma-separated list of repository names to exclude from the audit.             |            | `false`  |
| githubOrg             | GitHub organization or user to audit. Defaults to current repo owner.           |            | `false`  |
| includeArchived       | Include archived repositories in the audit.                                     | `false`    | `false`  |
| includeForked         | Include forked repositories in the audit.                                       | `true`     | `false`  |
| includePrivate        | Include private repositories in the audit.                                      | `false`    | `false`  |
| orgDiscussionsRepo    | Repository name allowed to have discussions when using org-wide discussions.    | `.github`  | `false`  |
| token                 | GitHub Token with permissions to read organization repositories.                |            | `true`   |

## 📤 Outputs

This action does not produce outputs. It will fail the workflow if any audits fail,
with detailed logs showing which repositories and checks failed.

## Audit Checks

### Repository Descriptions

When `checkDescription` is enabled, the following validations are performed:
- Checks if description exists (unless `allowEmptyDescription` is set to `true`)
- Ensures description does not have leading or trailing whitespace
- Ensures description ends with a period
- Ensures description is at least 10 characters long

Set `allowEmptyDescription: true` to skip the missing description check while still validating format rules for
repositories that do have descriptions.

### Repository Settings

- Ensures issues are enabled

### Merge Types

Validates merge type settings according to your preferences:
- **disabled**: The merge type should be disabled
- **enabled**: The merge type should be enabled
- **any**: No validation (allows any setting)

Default configuration:
- Merge commits: `disabled`
- Squash merge: `enabled`
- Rebase merge: `any`

### Discussions

Validates discussions configuration:
- **disabled**: Skip discussions check
- **org**: Ensures repo discussions are disabled (assuming org-wide discussions)
- **repo**: Ensures every repo has discussions enabled

> [!NOTE]
> When using org-wide discussions, the repository specified in `orgDiscussionsRepo` will be allowed to have
> discussions even if org-wide discussions are enforced.

### Community Health Files

Checks for the presence of community health files:
- README file
- LICENSE file
- CODE_OF_CONDUCT file
- CONTRIBUTING guidelines
- SECURITY policy
- Sponsors activation (FUNDING.yml in `.github/` or root)

Each file check can be individually enabled/disabled.

> [!NOTE]
> Community health metrics are not available for forked repositories via the GitHub API, so forks will skip these
> checks and default to passing.

> [!NOTE]
> FUNDING.yml is checked at both the repository level and organization level. If your organization has a `.github`
> repository with `FUNDING.yml`, all repositories will inherit this and pass the sponsors check unless explicitly
> overridden at the repository level.

## 🖥 Example Workflows

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
```

### Custom Merge Type Configuration

```yaml
steps:
  - name: Audit Merge Settings
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      checkMergeTypes: true
      allowMergeCommit: disabled
      allowSquashMerge: enabled
      allowRebaseMerge: disabled
```

### Organization-Wide Discussions

```yaml
steps:
  - name: Audit Discussions
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      checkDiscussions: org  # Ensures repo discussions are disabled
```

### Selective Community Files Checks

```yaml
steps:
  - name: Audit Essential Files Only
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      checkCommunityFiles: true
      checkReadme: true
      checkLicense: true
      checkCodeOfConduct: false
      checkContributing: false
      checkSecurity: true
      checkSponsors: false
```

### Selective Checks Only

```yaml
steps:
  - name: Check Descriptions and Community Files Only
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      checkDescription: true
      checkSettings: false
      checkMergeTypes: false
      checkDiscussions: disabled
      checkCommunityFiles: true
```

### Allow Empty Descriptions

```yaml
steps:
  - name: Audit with Optional Descriptions
    uses: LizardByte/actions/actions/audit_repos@master
    with:
      token: ${{ secrets.GH_TOKEN }}
      checkDescription: true
      allowEmptyDescription: true  # Allows repos without descriptions, but validates format if present
```

## 📝 Notes

- **Token**: Use a PAT with appropriate permissions for full functionality. `GITHUB_TOKEN` has limited access.
- **Filters**: By default, archived repositories are excluded, but forked repositories are included
- **Continuity**: The action will continue running all enabled audits even if some fail, providing a complete report
- **Empty Results**: If no repositories match the filters, the action will exit successfully with a warning
- **Compatibility**: The action works with both GitHub organizations and user accounts
- **Rate Limiting**: The action fetches detailed information for each repository,
  which may be rate-limited for large organizations
