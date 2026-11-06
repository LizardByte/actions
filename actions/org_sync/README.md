# org_sync

Replicate shared files across GitHub organizations using repository custom properties. Changes are delivered
through one bot branch and pull request per repository. This first version synchronizes files; secrets and
organization settings are separate capabilities.

## 🛠️ Prep Work

Check out the trusted source repository, including its organization list and separate file policy:

- `organizations.json` lists the allowed organization names. The existing file in `LizardByte/.github` works unchanged.
- `.github/file-sync.json` defines which files to replicate, their destinations, and any workflow-profile requirements.

Provision these repository custom properties in target orgs by default. Set `sync_mode_property` and
`workflow_profiles_property` to use your own property names:

| Property            | Type          | Behavior                                                                                                  |
| ------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `sync_mode`         | Single select | `included` enables sync; `excluded` skips the entire repository. Missing/invalid values fail that target. |
| `workflow_profiles` | Multi-select  | Selects additional groups. Missing or null means no additional profiles; general rules still apply.       |

Use a token authorized for every selected org, or invoke the action once per org with its GitHub App installation
token and the `organization` input. Org-wide discovery needs Metadata and organization Custom properties read
permissions. Exact-repo discovery uses the repository metadata/property APIs. Delivery requires Contents and Pull
requests write permissions; changing workflow files also requires Workflows write permission. Default branches
must already be initialized. A repository-scoped `GITHUB_TOKEN` cannot write to other repositories.

## 🚀 Basic Usage

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: LizardByte/actions/actions/org_sync@master
    with:
      config: .github/file-sync.json
      organizations_file: organizations.json
      dry_run: 'true'
      token: ${{ secrets.ORG_SYNC_TOKEN }}
```

Review the `results` output, then set `dry_run: 'false'` to deliver pull requests. Run only trusted source code
with the sync credential. Configure workflow concurrency so two controllers do not write the same bot branch.

Organizations with different property names can optionally add overrides to the action step. For example:

```yaml
      sync_mode_property: repository_sync
      workflow_profiles_property: repository_profiles
```

Property overrides apply to discovery and the pre-write property check. Both names must be distinct and
nonempty, without whitespace; values retain the types and meanings above. Profile values such as `docs` are
defined by your file policy and matching multi-select choices, with no fixed set built into the action.
Using the default names requires neither override input.

## Organization list (`organizations.json`)

The organization list is a plain JSON array of names, matching the existing `LizardByte/.github` file:

```json
[
  "LizardByte",
  "LizardByte-infrastructure",
  "SunshineStream",
  "Themerr",
  "KokoStreamTV"
]
```

Keep replication rules in the separate file policy below. Its optional rule-level `organizations` list narrows
a rule to some of these names; it does not replace or change the format of `organizations.json`.

## File policy (`.github/file-sync.json`)

```json
{
  "version": 1,
  "rules": [
    {
      "id": "general",
      "files": [
        {"source": ".github/workflows/_common-lint.yml"},
        {"source": "renovate.json", "mode": "create_if_missing"}
      ]
    },
    {
      "id": "docs",
      "profile": "docs",
      "files": [
        {"source": ".github/workflows/_update-docs.yml"}
      ]
    },
    {
      "id": "organization-pr-template",
      "repositories": ["SunshineStream/.github", "Themerr/.github", "KokoStreamTV/.github"],
      "files": [
        {"source": ".github/pull_request_template.md"}
      ]
    },
    {
      "id": "obsolete-file",
      "files": [
        {"destination": ".github/workflows/old.yml", "mode": "remove"}
      ]
    }
  ]
}
```

- `version` must be `1`. An optional `id` identifies the controller and defaults to `org-sync`.
- Each rule has a unique `id`, an optional `profile`, and a nonempty `files` array.
- A rule applies to all listed orgs by default. Narrow it with either `organizations` or exact `repositories`.
  These selectors must stay inside `organizations.json`.
- The `repository` action input narrows the policy to one exact repo without listing org repositories.
- `profile` matches membership in the property selected by `workflow_profiles_property` (default
  `workflow_profiles`). Discovery considers inactive profile rules too, so deselection is reconciled on the next run.
- `source` and `destination` are exact repository-relative file paths; `destination` defaults to `source`.
  Globs, absolute paths, traversal, symlink sources, and conflicting destination definitions are rejected.
- `permissions` can override the source executable bit with `100644` or `100755`.
- Org-wide rules include forks, skip private/archived repositories, and skip the workflow's source repository
  by default. Policy booleans `include_forks`, `include_private`, `include_archived`, and `include_source` override
  these filters. Private targets are redacted from action results and diagnostics.

## File lifecycle and deselection

| Mode                | Selected/general rule                                                                              | Profile deselected                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sync` (default)    | Create or update the configured path to match the source.                                          | Remove the configured managed path, including legacy replicated files on the first run.                                      |
| `create_if_missing` | Create only when absent. Preserve existing files, including empty files and pending starter files. | Remove only an unchanged file previously created by this controller. Preserve pre-existing or subsequently customized files. |
| `remove`            | Remove the explicit destination if present. Omit `source`.                                         | Inactive removal rules do not remove unrelated files.                                                                        |

If two rules map the same file, it remains while any matching rule is selected. Overlapping mappings must agree
on source, mode, and permissions. Source files must exist: an accidentally deleted source never implicitly deletes
its destination.

The action maintains `.github/org-sync-state.json` in the target PR to track file ownership. The path is reserved.
Keep that file when merging synchronization PRs. Files removed from the policy are cleaned up when unchanged;
locally modified former files are preserved with a warning. Targets removed entirely from the discovery scope
are not visited for cleanup.
If a customized file exists only in an unmerged sync PR, cleanup fails that repository; merge or revert the
customization first. The action preserves the pending branch for review.

## Pull requests and efficiency

Source bytes are read once, repositories/properties are discovered once per org, and Git trees/blobs are compared
before writing. Binary files and executable modes are supported. Each repository gets one tree and commit for its
combined changes, with reused blobs and one open PR. An unchanged run creates no commits and updates no PRs.

Existing bot branches must contain this controller's state and no unrelated edits. Updates use fast-forward ref
writes, preserving base-branch changes through merge parents. Concurrent branch/property changes cause a failure
and can be retried; no default branch is pushed and no PR is merged automatically. If deselection makes an open
PR unnecessary, the action closes it. Its bot branch is retained for reuse.

Repository failures are reported while other targets continue; any failure marks the action failed. Missing org
access is also reported without blocking other orgs. API retries are handled by `actions/github-script`.

## 📥 Inputs

| Input                        | Default                    | Purpose                                                    |
| ---------------------------- | -------------------------- | ---------------------------------------------------------- |
| `config`                     | `.github/file-sync.json`   | File policy, relative to the source directory.             |
| `organizations_file`         | `organizations.json`       | Allowed org-name list, relative to the source directory.   |
| `source_directory`           | Workflow workspace         | Trusted source checkout.                                   |
| `token`                      | Required                   | GitHub API credential.                                     |
| `organization`               | All configured orgs        | Narrow the run to one org.                                 |
| `repository`                 | All configured targets     | Narrow the run to one `owner/repo`.                        |
| `dry_run`                    | `false`                    | Read-only planning, with no Git object or PR writes.       |
| `branch`                     | `bot/org-sync-files`       | Dedicated bot branch; must differ from the default branch. |
| `pr_title`                   | `chore: sync shared files` | PR title and commit subject.                               |
| `concurrency`                | `3`                        | Repository workers, from 1 to 10.                          |
| `sync_mode_property`         | `sync_mode`                | Single-select property controlling repository inclusion.   |
| `workflow_profiles_property` | `workflow_profiles`        | Multi-select property matched by each rule's `profile`.    |

## 📤 Outputs

| Output                 | Purpose                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `results`              | JSON array of repository statuses, changes, warnings, errors, and PR URLs where applicable. |
| `changed_repositories` | Count of updated/closed PRs or repositories with planned changes.                           |
| `failed_repositories`  | Count of failed targets.                                                                    |

Schedule full runs to catch property changes; property edits do not change source files. Before replacing an
existing replicator, migrate exclusions/profiles, compare dry-run results, and disable its writer.
