# cloudsmith_upload

A reusable action that publishes DEB and RPM packages to distro-specific Cloudsmith repositories. It uses the
[official Cloudsmith CLI Setup Action](https://github.com/cloudsmith-io/cloudsmith-cli-action), infers each target from
the package filename, and checks Cloudsmith's current distribution catalog before uploading.

## 🚀 Basic Usage

```yaml
permissions:
  contents: read

steps:
  - name: Upload packages
    uses: LizardByte/actions/actions/cloudsmith_upload@master
    with:
      api_key: ${{ secrets.CLOUDSMITH_API_KEY }}
      owner: your-workspace
      package_path: artifacts
      repository: your-repository
      republish: true
```

`package_path` accepts newline-separated files or directories. Directories are scanned recursively for `.deb` and
`.rpm` files.

## 🔐 OIDC Authentication

Cloudsmith recommends OIDC for CI/CD because it uses short-lived credentials instead of a stored API key. Follow
[Cloudsmith's GitHub Actions OIDC setup guide](https://docs.cloudsmith.com/authentication/setup-cloudsmith-to-authenticate-with-oidc-in-github-actions)
before enabling it in a workflow. Cloudsmith's [current plan matrix](https://cloudsmith.com/pricing) lists OIDC for
Ultra and Enterprise; use the `api_key` input with a
[service account API key](https://docs.cloudsmith.com/accounts-and-teams/service-accounts) when the workspace plan does
not include OIDC.

To configure OIDC:

1. Create a Cloudsmith service account and grant it permission to upload to the target repositories.
2. As a Cloudsmith Manager or Owner using the classic interface, open
   `https://cloudsmith.io/orgs/{workspace}/settings/openid-connect/` and create an OIDC provider. Use
   `https://token.actions.githubusercontent.com` as the provider URL and restrict access with claims such as
   `repository_owner`.
3. Associate the OIDC provider with the service account.
4. Grant the GitHub Actions job `id-token: write`, then pass the Cloudsmith workspace and service account slugs to
   this action.

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - name: Upload packages
    uses: LizardByte/actions/actions/cloudsmith_upload@master
    with:
      oidc_namespace: your-workspace
      oidc_service_slug: your-service-account-slug
      owner: your-workspace
      package_path: artifacts
      repository: your-repository
```

The official Cloudsmith setup action configures the CLI to exchange GitHub's identity token on its first authenticated
command. This action also enables `verify-auth`, so an invalid OIDC configuration fails before any upload is attempted.

For an action shared by repositories in one GitHub organization, a claim such as
`{"repository_owner": "your-github-organization"}` allows those repositories to authenticate while excluding other
GitHub organizations. Repository access assigned to the Cloudsmith service account still controls where it can upload.

## 🔎 Filename Detection

The action recognizes these naming conventions:

| Package | Example                                     | Cloudsmith target     |
|---------|---------------------------------------------|-----------------------|
| DEB     | `helloworld_1.2.3-1+debiantrixie_amd64.deb` | `debian/trixie`       |
| DEB     | `helloworld_1.2.3-1+ubuntu22.04_arm64.deb`  | `ubuntu/jammy`        |
| DEB     | `helloworld-ubuntu-24.04-amd64.deb`         | `ubuntu/noble`        |
| RPM     | `HelloWorld-1.2.3-1.fc44.x86_64.rpm`        | `fedora/44`           |
| RPM     | `HelloWorld-1.2.3-1.suse.lp156.aarch64.rpm` | `opensuse/15.6`       |
| RPM     | `HelloWorld-1.2.3-1.suse.tw.x86_64.rpm`     | `opensuse/tumbleweed` |

Numeric Ubuntu versions are matched to Cloudsmith's codename slug using its live API. Fedora and openSUSE releases are
also checked against that catalog. By default, a correctly recognized package for a release Cloudsmith does not yet
support is skipped with a warning. It will begin uploading automatically once the release appears in Cloudsmith.

An unrecognized DEB or RPM filename fails the action by default so a newly introduced naming convention cannot silently
go unpublished.

## 📥 Inputs

| Name                  | Description                                                                  | Default                         | Required |
|-----------------------|------------------------------------------------------------------------------|---------------------------------|----------|
| api_key               | Cloudsmith API key; prefer OIDC for CI/CD.                                   |                                 | `false`  |
| api_host              | Cloudsmith API host.                                                         | `https://api.cloudsmith.io`     | `false`  |
| cli_version           | Cloudsmith CLI version to install.                                           | `latest`                        | `false`  |
| component             | Optional Debian component.                                                   |                                 | `false`  |
| dry_run               | Resolve and report uploads without authenticating or publishing.             | `false`                         | `false`  |
| fail_on_no_packages   | Fail when no supported package remains.                                      | `true`                          | `false`  |
| fail_on_unmatched     | Fail when a package filename does not identify its distribution.             | `true`                          | `false`  |
| oidc_namespace        | Cloudsmith namespace for OIDC authentication.                                |                                 | `false`  |
| oidc_service_slug     | Cloudsmith service account slug for OIDC authentication.                     |                                 | `false`  |
| owner                 | Cloudsmith organization or namespace.                                        |                                 | `true`   |
| package_path          | Newline-separated package files or directories.                              |                                 | `true`   |
| republish             | Replace existing packages with the same attributes.                          | `false`                         | `false`  |
| repository            | Cloudsmith repository slug.                                                  |                                 | `true`   |
| skip_unsupported      | Skip distro releases absent from Cloudsmith's current catalog.               | `true`                          | `false`  |
| tags                  | Optional comma-separated package tags.                                       |                                 | `false`  |
| wait_for_sync         | Wait for each package to finish synchronizing.                               | `true`                          | `false`  |

Exactly one authentication method is required outside dry-run mode: `api_key`, or both `oidc_namespace` and
`oidc_service_slug`.

## 📤 Outputs

| Name            | Description                                                                    |
|-----------------|--------------------------------------------------------------------------------|
| package_plan    | JSON upload plan with filenames and resolved distro/release targets.           |
| planned_count   | Number of packages resolved for upload.                                        |
| published_count | Number of packages submitted to Cloudsmith; zero for a dry run.                |
| skipped_count   | Number of package files skipped because they were unmatched or unsupported.    |

## 🧪 Dry Run

Dry-run mode still queries Cloudsmith's public distribution catalog, but it skips authentication and CLI installation:

```yaml
- name: Validate package routing
  uses: LizardByte/actions/actions/cloudsmith_upload@master
  with:
    dry_run: true
    owner: your-workspace
    package_path: artifacts
    repository: your-repository
```

## 🔗 See Also

- [Cloudsmith GitHub Actions integration](https://docs.cloudsmith.com/integrations/integrating-with-github-actions)
- [Cloudsmith Debian repository documentation](https://docs.cloudsmith.com/formats/debian-repository)
- [Cloudsmith RPM repository documentation](https://docs.cloudsmith.com/formats/redhat-repository)
