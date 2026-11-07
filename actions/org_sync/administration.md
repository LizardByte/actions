# Organization administration

Administration is opt-in through `properties_file` and/or `admin_config`. The action uses the same plain
organization-name array as file synchronization. Administrative writes are direct API operations, while file
changes still use target PRs. The action does not enable this capability in any consuming workflow by itself.

## Running one synchronization job

```yaml
jobs:
  synchronize:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: LizardByte/actions/actions/org_sync@master
        env:
          SHARED_BOT_TOKEN: ${{ secrets.GH_BOT_TOKEN }}
        with:
          config: .github/org-sync.json
          properties_file: .github/org-sync.json
          admin_config: .github/org-sync.json
          organizations_file: organizations.json
          admin_token: ${{ secrets.ORG_SYNC_ADMIN_TOKEN }}
          dry_run: ${{ github.event_name == 'pull_request' }}
```

All three policy inputs can point to one combined JSON file with `version: 1`, `files`, `properties`, and
`administration` sections. They select capabilities, not separate files. `organizations.json` is the only shared
org registry; default administration destinations are its entries excluding `source_organization`.
Separate legacy file, schema, and administration documents remain supported.

Use trusted source code with the administrative credential. A workflow must restrict which PRs can access
credentials. Read-only previews can use a read-only credential; run delivery from reviewed source revisions.
Administration runs before file delivery in the same action invocation and job. A preview does not
pretend that planned property definitions have already been applied.

Omit `admin_config` to manage schemas without other settings. Set `sync_files: 'false'` for administration only.
Leave `sync_files` enabled to combine administration and file delivery. Failure in administration prevents file delivery
in that invocation. `organization` narrows all administrative operations to an allowed org. `repository` is
rejected with administration because an org-level write cannot be narrowed to one repository.

`admin_token` falls back to `token`, then the workflow's token. `source_token` optionally supplies a different
credential for source-organization reads, for example when using per-org GitHub App installation tokens.
A repository-scoped workflow token normally cannot administer an organization. Scope tokens to the APIs
actually selected by the policy:

| Capability                    | Organization permissions                              |
| ----------------------------- | ----------------------------------------------------- |
| Custom-property schema reads  | Custom properties: read                               |
| Custom-property schema writes | Custom properties: admin                              |
| Organization/Actions settings | Administration: read/write as appropriate             |
| Actions variables             | Variables: read/write as appropriate                  |
| Actions secrets               | Secrets: read/write as appropriate                    |
| Dependabot secrets            | Dependabot secrets: read/write as appropriate         |
| Codespaces secrets            | Organization codespaces secrets: read/write           |
| Selected repository discovery | Repository metadata access to every named target      |
| Blocked users                 | Blocking users: read/write                            |
| Organization webhooks         | Webhooks: read/write                                  |
| Code-security configurations  | Organization code security configurations: read/write |

Classic token scopes and membership requirements are documented in the corresponding GitHub API references.
Missing permission is an error, rather than a reason to skip a managed value or broaden repository access.

## Property definitions

In a combined policy, put the definitions in the top-level `properties` array. A separate legacy schema file
uses GitHub's schema payload format:

```json
{
  "properties": [
    {
      "property_name": "sync_mode",
      "value_type": "single_select",
      "required": true,
      "default_value": "included",
      "description": "Shared file synchronization",
      "allowed_values": ["included", "excluded"],
      "values_editable_by": "org_actors",
      "require_explicit_values": false
    }
  ]
}
```

The action supports `string`, `single_select`, `multi_select`, `true_false`, and `url` definitions. It reconciles
only named definitions in every selected org, including the source org. Unknown fields are rejected. Omitted
optional fields intentionally use documented defaults: optional, null default/description/allowed values,
`org_actors` editability, and no explicit-value requirement. Full definitions are sent so API defaults cannot
silently replace an intended optional field.

Unrelated definitions and repository assignments are retained. Existing property types cannot be changed by
this action; use an explicit migration. Enterprise-owned definitions can match an unchanged policy, but cannot
be edited here. Removed choices are permitted only when the full repository-value inventory shows that no
existing value would become invalid. The inventory is checked again before writing. Changing a default can
change the effective value on repositories inheriting it; the report includes old/new definitions for review.

Schema writes are preceded by a fresh comparison and followed by a readback. This catches concurrent edits
and backend normalization instead of reporting false success. Removing a definition from the file does not
delete it from GitHub, and this action never copies or patches repository custom-property assignments.

## Administrative policy

An example `administration` section (also accepted as a separate legacy administration file):

```json
{
  "version": 1,
  "source_organization": "LizardByte",
  "settings": {
    "from_source": ["web_commit_signoff_required"],
    "values": {"default_repository_permission": "read"}
  },
  "actions": {
    "from_source": ["workflow"],
    "permissions": {"enabled_repositories": "all", "sha_pinning_required": true},
    "retention": {"days": 30}
  },
  "variables": [
    {
      "name": "SHARED_USERNAME",
      "from_source": "GH_BOT_NAME",
      "organizations": ["SunshineStream"],
      "visibility": "selected",
      "repository_names": [".github"]
    }
  ],
  "secrets": [
    {
      "name": "GH_BOT_TOKEN",
      "kind": "actions",
      "value_env": "SHARED_BOT_TOKEN",
      "organizations": ["SunshineStream"],
      "visibility": "selected",
      "repository_names": [".github"]
    }
  ]
}
```

Every org reference must be present in `organizations.json`. Settings, blocked users, webhooks, and security
configurations follow that registry, excluding the source org by default. Property schemas cover the full
selected registry, including the source. A legacy policy-level `organizations` override remains supported.
Credential entries require explicit destinations at the entry or legacy override level; adding a registry
entry provisions shared settings and schemas without silently extending secret or variable access. Resource
entries can still narrow their own organization scope.

Version 1 is the default if omitted. All sections are optional, but unknown keys, invalid types, conflicting
value sources, duplicate credential names, and scopes outside the registry fail validation before delivery.

### Variables and secrets

Variables use exactly one literal string `value` or a `from_source` variable name. Source variables are read
once during preparation; target values are compared without including their plaintext in outputs/artifacts.
Variables are only written when their value or access policy differs. `source_organization` is required when
copying source values or settings.

GitHub cannot export existing secret plaintext. Use exactly one `value_env` (preferred) or `value_key` for each
secret. `value_env` names an environment variable explicitly populated from a workflow secret, as above.
`value_key` selects from the optional `secret_values` JSON input, supplied through a dedicated workflow secret
such as `secret_values: ${{ secrets.ORG_SYNC_SECRET_VALUES }}`. Never commit secret values to a policy file.
Values are masked before use and encrypted with the destination's public key using a libsodium sealed box.
Administrative delivery installs the locked encryption dependency with lifecycle scripts disabled. File-only
runs and all dry runs skip this installation. Missing/empty environment values cannot erase an existing secret.

`kind` defaults to `actions`; `dependabot` and `codespaces` are also supported. Secret values cannot be compared
or read back. In `sync` mode each apply intentionally sets the supplied value again, allowing rotation. API
acceptance and the resulting access policy are verified; the report does not claim plaintext comparison.
Dry runs can plan secrets without their values, with a warning that delivery requires them.

Both variables and secrets require explicit `visibility`: `all`, `private`, or `selected`. `selected` resolves
`repository_names` to IDs inside each destination org. Missing/inaccessible named repositories fail the org
before writes; an explicit empty name list grants access to no repositories. IDs are rechecked before writes.
Selected access lists are replaced by the configured list, never copied as source-org repository IDs.

Same-name credential entries may specify different values or repository names for disjoint destination
organizations. Overlapping destinations for the same kind/name are rejected. Repeated reads of one source
variable are shared across entries.

Missing/inaccessible named recipients fail by default. Set `missing_repositories: defer` on a `selected` entry
when preparing repositories that will be created or transferred later. Only existing named recipients receive
access, with warnings for the others. If none exist, that entire credential entry is deferred without writing
or requiring its supplied secret. Existing credentials remain untouched until a recipient becomes available.
An explicit empty list still manages an empty allowlist. Subsequent runs add named recipients as they appear;
an identity change between planning and writing fails rather than granting access from an obsolete plan.

The optional `mode` is `sync` by default. `create_if_missing` preserves the entire existing variable/secret,
including its value and access policy. No secret/variable is deleted when omitted from configuration. Values,
ciphertext, and recipient keys are excluded from results and artifacts; API errors are sanitized. Access diffs
report visibility/counts rather than exposing discovered private repository IDs or names.

### Organization and Actions settings

`settings.from_source` names fields to copy from the source org; `settings.values` supplies explicit overrides.
Only specified fields are managed. Supported organization fields are:

- `default_repository_permission`, `web_commit_signoff_required`, `deploy_keys_enabled_for_repositories`;
- `has_organization_projects`, `has_repository_projects`;
- `members_can_create_repositories`, `members_can_create_internal_repositories`,
  `members_can_create_private_repositories`, `members_can_create_public_repositories`;
- `members_can_create_pages`, `members_can_create_public_pages`, `members_can_create_private_pages`,
  `members_can_fork_private_repositories`;
- Public profile fields: `company`, `blog`, `location`, `name`, `description`, `twitter_username`.

The `actions` section supports:

| Group              | Managed fields                                                                   |
| ------------------ | -------------------------------------------------------------------------------- |
| `permissions`      | `enabled_repositories`, `allowed_actions`, `sha_pinning_required`                |
| `workflow`         | `default_workflow_permissions`, `can_approve_pull_request_reviews`               |
| `selected_actions` | `github_owned_allowed`, `verified_allowed`, `patterns_allowed`                   |
| `retention`        | `days` for artifact/log/check/workflow-run retention                             |

Use `actions.from_source` to copy one or more groups; explicit group fields override source values. Unspecified
destination fields are retained. `permissions.enabled_repositories: selected` requires explicit
`actions.repository_names`. Switching `allowed_actions` to `selected` requires all three `selected_actions`
fields, because GitHub does not expose the inactive allowlist. The allowlist is initialized after selected
mode is enabled. Named repositories must exist before selected-repository policies can be applied.

### Blocked users

```json
{"blocked_users": {"from_source": true, "users": ["additional-user"], "remove_extra": false}}
```

This unions explicitly named users with the source org's blocked users. Destination-only blocks are preserved
by default. Set `remove_extra: true` explicitly to unblock destination users absent from the desired list.
The source org is not changed unless it is also an explicitly selected destination.

### Organization webhooks

```json
{
  "webhooks": [
    {
      "id": "shared-events",
      "source_url": "https://hooks.example.com/github",
      "url": "https://hooks.example.com/github-project",
      "events": ["push", "pull_request"],
      "secret_env": "WEBHOOK_SIGNING_SECRET"
    }
  ]
}
```

An exact `source_url` optionally copies events, activity, content type, and SSL verification settings. Explicit
fields override source values. `url` selects the destination hook; without it, `source_url` is reused. A new
hook without a source defaults to active JSON/push delivery with SSL verification enabled. Duplicate URLs
and ambiguous existing hooks are rejected. Removing a policy does not delete hooks. Use `mode: create_if_missing`
to preserve an existing hook. Delivery never sends test events or manually triggers a webhook.

Supply exactly one `secret_env` or `secret_value_key` (from `secret_values`), or explicitly select `unsigned: true`.
Source signing secrets cannot be exported. Signed delivery resends the supplied secret; unsigned delivery clears
it. Both are reapplied because GitHub cannot reliably expose signing-secret state for comparison. Missing
values prevent delivery; dry runs report a warning. Hook URLs, signing secrets, and IDs are omitted from reports.
All destinations must be explicitly listed at policy or entry level.

Use `source_url_prefix` instead of exact URLs to select a group without committing receiver credentials:

```json
{"webhooks": [{"id": "notifications", "source_url_prefix": "https://hooks.example.com/receivers/", "unsigned": true}]}
```

The prefix must be an HTTP(S) directory URL ending in `/`, without user information, query, or fragment.
It selects only `web` hooks under that origin/path and preserves each matching hook's URL, events, and activity.
It cannot be combined with `source_url` or a destination `url`. Overlapping selections are rejected. An empty
source group fails before delivery, because an OAuth-filtered response is not proof that no hooks exist.
Use a credential that can read the original hooks; GitHub's OAuth webhook restrictions can hide hooks created
outside that OAuth app even when `admin:org_hook` is granted. URLs and signing secrets remain absent from reports.

### Code-security configurations

```json
{
  "security_configurations": [
    {
      "source_name": "Shared baseline",
      "name": "Project baseline",
      "values": {"dependabot_alerts": "enabled", "secret_scanning": "enabled"},
      "copy_default": true
    }
  ]
}
```

Configurations are matched by name, copied using supported writable feature fields, and created or updated
using destination configuration IDs. `values` overrides source fields, or defines a configuration without a
source. Omitted destination configurations/settings are preserved. Enterprise/global configurations cannot
be edited; an unchanged match is allowed. API permissions, enterprise policies, and product entitlements still
apply. Features can have licensing implications; only explicitly configured policies are delivered.

Use `copy_default: true` to copy the source configuration's new-repository default scope, or explicitly set
`default_for_new_repos` to `all`, `public`, `private_and_internal`, or `none`. Overlapping managed default scopes
are rejected. Setting a scope replaces the previous default for that scope. These operations configure defaults
for new repositories; they do not attach configurations to existing repositories or launch scans on them.
An existing repository rollout requires a separate explicit attachment policy.

Source-org team/role IDs cannot be reused automatically. Nonempty delegated-bypass reviewer options require an
explicit `values.secret_scanning_delegated_bypass_options` override for a single destination organization.
Reviewer IDs are excluded from reports. Fresh comparisons and readbacks protect configurations and defaults
against concurrent changes. Removing a policy does not delete a configuration.

### Settings that require manual setup

The GitHub settings UI exposes more controls than the supported public write APIs. For standalone organizations:

| Setting                                      | Supported synchronization                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Social accounts / URLs                       | Website (`blog`) and legacy `twitter_username`; extra social links are manual  |
| Location                                     | `settings.from_source` or `settings.values.location`                           |
| Member privileges                            | The supported fields listed above; other UI-only privileges are manual         |
| Blocked users                                | `blocked_users` policy                                                         |
| Default repository settings / default labels | Supported permissions/creation settings; org default labels/branch name manual |
| General Actions settings                     | Permissions, workflow defaults, allowlists, and retention as listed above      |
| Webhooks                                     | `webhooks` policy; signing secrets must be supplied                            |
| Packages                                     | Organization creation/visibility/inheritance policies are manual               |
| Two-factor authentication                    | Standalone-org enforcement is manual; enterprise enforcement uses other APIs   |
| Advanced security                            | `security_configurations` and defaults for new repositories                    |
| Personal access token policies               | Organization allow/approval/lifetime policies are manual                       |

Repository labels have a separate per-repository API, but this action does not emulate the organization-wide
default-label setting. Package list/delete/restore and individual PAT approval/revocation APIs do not provide
the corresponding organization policy controls. Billing/owners, teams, app installations, runners, rulesets,
and environments also need separate identity mappings and API-specific policies. Unknown settings are rejected.

## Failure handling and review

All local policies and source reads are validated before any destination writes. Each org's operations are
planned completely before delivery. Errors in one org do not block safe operations in other orgs, but fail
the action. Reads/planning are bounded; writes within an org are ordered. Use workflow concurrency to prevent
two controllers from changing the same org simultaneously.

Org API operations are not transactional. If a later write or verification fails, earlier writes can already
have succeeded. The report retains completed and pending operation records plus schema/settings before/after
snapshots; a pending entry can include an attempted write. No automatic rollback overwrites newer org state.
Review the failed operation and rerun after correcting the cause. Secrets and variable plaintext never appear
in these snapshots. Reports include source SHA, scope, dry-run mode, separate org/repo counts, and errors.

API references: [property schemas](https://docs.github.com/en/rest/orgs/custom-properties),
[organization settings](https://docs.github.com/en/rest/orgs/orgs#update-an-organization),
[Actions permissions](https://docs.github.com/en/rest/actions/permissions),
[variables](https://docs.github.com/en/rest/actions/variables),
[Actions secrets](https://docs.github.com/en/rest/actions/secrets),
[Dependabot secrets](https://docs.github.com/en/rest/dependabot/secrets), and
[Codespaces secrets](https://docs.github.com/en/rest/codespaces/organization-secrets).

Additional API references: [blocked users](https://docs.github.com/en/rest/orgs/blocking),
[webhooks](https://docs.github.com/en/rest/orgs/webhooks), and
[code-security configurations](https://docs.github.com/en/rest/code-security/configurations).
Manual policy references: [default labels](https://docs.github.com/en/organizations/managing-organization-settings/managing-default-labels-for-repositories-in-your-organization),
[package policies](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility),
[2FA enforcement](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-two-factor-authentication-for-your-organization/requiring-two-factor-authentication-in-your-organization),
and [PAT policies](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization).
