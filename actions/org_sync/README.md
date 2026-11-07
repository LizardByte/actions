# org_sync

Synchronize shared files, repository custom-property schemas, organization settings, Actions variables,
supplied organization secrets, blocked users, webhooks, and security configurations across GitHub organizations.
File changes use one bot branch and PR per repo;
administrative changes use the GitHub API directly. File-only behavior remains the default.

Use one policy file for all synchronization and `organizations.json` as the shared organization registry.
The same policy path can be passed to `config`, `properties_file`, and `admin_config`; these inputs enable
different capabilities without requiring separate files. Legacy separate policies remain supported.

See [Organization administration](administration.md) for schemas, settings, credential policies, permissions,
and a combined synchronization job. No administration API is called unless `properties_file` or `admin_config`
is supplied. `sync_files: 'false'` runs administration without requiring a file policy or initialized target repos.

## 🛠️ Prep Work

Check out the trusted source repository, including its organization registry and synchronization policy:

- `organizations.json` lists the allowed organization names. The existing file in `LizardByte/.github` works unchanged.
- `.github/org-sync.json` can contain file rules, property definitions, and administration settings together.

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
  "KokoStreamTV",
  "LizardByte",
  "LizardByte-infrastructure",
  "SunshineStream",
  "Themerr"
]
```

File discovery and property schemas use this registry. Administration also uses it, excluding
`source_organization` by default. Adding an org requires one registry edit. Individual credentials retain
explicit destination scopes; registry membership does not grant access to secrets or variables.
Optional rule-level selectors or a legacy administration-level `organizations` override can narrow the registry.

## Combined policy (`.github/org-sync.json`)

```json
{
  "version": 1,
  "files": {
    "rules": [
      {"id": "general", "files": [{"source": "renovate.json"}]}
    ]
  },
  "properties": [
    {"property_name": "sync_mode", "value_type": "single_select", "required": true,
      "allowed_values": ["included", "excluded"], "default_value": "included"}
  ],
  "administration": {
    "source_organization": "LizardByte",
    "settings": {"from_source": ["web_commit_signoff_required"]}
  }
}
```

```yaml
      config: .github/org-sync.json
      properties_file: .github/org-sync.json
      admin_config: .github/org-sync.json
      organizations_file: organizations.json
```

`files` has the file-policy fields documented below, `properties` contains GitHub property definitions, and
`administration` has the settings/resources/credentials documented in [the administration guide](administration.md).
Omit `properties_file` and `admin_config` for a file-only run using the same combined policy. For administration
only, set `sync_files: 'false'`. Schema reconciliation still includes the source org. Unknown combined-policy
fields, conflicting versions, and malformed sections are rejected. The existing flat file-policy format remains valid.

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
      "repository_names": [".github"],
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
- `repository_names` matches exact repo names, case-insensitively, within the configured organizations. For
  example, `[".github"]` follows additions to `organizations.json` automatically and skips organizations that
  do not yet contain that repo. It can be combined with `organizations`, but not with exact `repositories`.
  Name selectors still respect repository eligibility and custom properties. Globs are not supported.
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
| `token`                      | Workflow token             | File API credential; use a cross-repo token for delivery.  |
| `organization`               | All configured orgs        | Narrow the run to one org.                                 |
| `repository`                 | All configured targets     | Narrow the run to one `owner/repo`.                        |
| `dry_run`                    | `false`                    | Read-only planning, with no Git object or PR writes.       |
| `branch`                     | `bot/org-sync-files`       | Dedicated bot branch; must differ from the default branch. |
| `pr_title`                   | `chore: sync shared files` | PR title and commit subject.                               |
| `concurrency`                | `3`                        | Repository workers, from 1 to 10.                          |
| `sync_mode_property`         | `sync_mode`                | Single-select property controlling repository inclusion.   |
| `workflow_profiles_property` | `workflow_profiles`        | Multi-select property matched by each rule's `profile`.    |
| `sync_files`                 | `true`                     | Enable file replication; disable for admin-only jobs.      |
| `properties_file`            | Empty                      | JSON property definitions to reconcile across orgs.        |
| `admin_config`               | Empty                      | Explicit settings, variables, and secret policy.           |
| `admin_token`                | `token`, then job token    | Credential for administrative API calls.                   |
| `source_token`               | Administrative credential  | Optional separate source-org read credential.              |
| `secret_values`              | Empty                      | Optional JSON secret map; prefer environment mappings.     |

## 📤 Outputs

Every invocation writes a run summary and uploads a JSON report artifact with a unique `file-sync-` name,
including dry-run/delivery mode, source revision, scope, counts, and per-target results. Reports are retained
for 14 days. Partial results and fatal sync failures are reported too; a report does not turn a failed sync
into success. Multiple invocations in the same job receive separate report files/artifacts.

Reports use the already redacted `results` output, so private target details remain omitted. No consumer-side
report script or upload step is needed. Creating reports/artifacts does not write to target repositories.

| Output                  | Purpose                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `results`               | JSON array of repository statuses, changes, warnings, errors, and PR URLs where applicable. |
| `changed_repositories`  | Count of updated/closed PRs or repositories with planned changes.                           |
| `failed_repositories`   | Count of failed targets.                                                                    |
| `report_file`           | Runner-local path to the complete JSON report.                                              |
| `artifact_name`         | Unique uploaded report artifact name.                                                       |
| `organization_results`  | JSON organization changes/results with secret/variable values omitted.                      |
| `changed_organizations` | Count of updated organizations or orgs with planned changes.                                |
| `failed_organizations`  | Count of failed administrative targets.                                                     |

Administrative reports include per-operation status and managed schema/settings before/after values. File
outputs keep their existing meanings. Missing configuration values and read failures fail closed. Files are
skipped when a preceding administrative phase fails; use separate jobs for separate credentials and phases.

Schedule full runs to catch property changes; property edits do not change source files. Before replacing an
existing replicator, migrate exclusions/profiles, compare dry-run results, and disable its writer.
