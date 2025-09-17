# release_setup

A reusable action to set up release inputs for GitHub Actions. This action is tailored to the
@LizardByte organization, but can be used by anyone if they follow the same conventions.

The action does the following:

- Get the latest push event to the default branch
- Provide some outputs to use for the release step

## Simple Usage
```yaml
- name: Setup Release
  id: setup_release
  uses: LizardByte/actions/actions/release_setup@master
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs
| Name                         | Description                                                                                | Default | Required |
|------------------------------|--------------------------------------------------------------------------------------------|---------|----------|
| dotnet                       | Whether to create a dotnet version (4 components, e.g. yyyy.mmdd.hhmm.ss).                 | `false` | `false`  |
| github_token                 | GitHub token to use for API requests.                                                      |         | `true`   |
| include_tag_prefix_in_output | Whether to include the tag prefix in the output.                                           | `true`  | `false`  |
| tag_prefix                   | The tag prefix. This will be used when searching for existing releases in GitHub API.      | `v`     | `false`  |

## Outputs
| Name                           | Description                                                                |
|--------------------------------|----------------------------------------------------------------------------|
| publish_release                | Whether or not to publish a release                                        |
| release_body                   | The body for the release                                                   |
| release_commit                 | The commit hash for the release. (i.e. `${GITHUB_SHA}`                     |
| release_generate_release_notes | Whether or not to generate release notes. True if `release_body` is blank. |
| release_tag                    | The tag for the release (i.e. `release_version` with prefix)               |
| release_version                | The version for the release (i.e. `yyyy.mmdd.hhmmss`)                      |
