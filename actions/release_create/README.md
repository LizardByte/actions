# release_create

A reusable action to create a GitHub release. This action is tailored to the
@LizardByte organization, but can be used by anyone if they follow the same conventions.

This is basically a wrapper around [ncipollo/release-action](https://github.com/ncipollo/release-action),
with some different defaults to make it easier to use within the @LizardByte organization.
Additionally, all except the 2 (configurable) latest pre-releases and tags are deleted.

## Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Create Release
    uses: LizardByte/actions/actions/release_create@master
    with:
      name: v0.1.0
      tag: v0.1.0
      token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Name                    | Description                                                                                          | Default         | Required |
|-------------------------|------------------------------------------------------------------------------------------------------|-----------------|----------|
| allowUpdates            | An optional flag which indicates if we should update a release if it already exists.                 | `true`          | `false`  |
| artifactErrorsFailBuild | An optional flag which indicates if we should fail the build if there are errors with the artifacts. | `false`         | `false`  |
| artifacts               | The artifacts to upload.                                                                             | `*artifacts/*`  | `false`  |
| body                    | The body of the release.                                                                             |                 | `false`  |
| deleteOtherPreReleases  | Whether to delete other pre-releases.                                                                | `true`          | `false`  |
| deletePreReleaseTags    | Whether to delete other pre-release tags.                                                            | `true`          | `false`  |
| draft                   | Whether the release is a draft.                                                                      | `false`         | `false`  |
| generateReleaseNotes    | Indicates if release notes should be automatically generated.                                        | `true`          | `false`  |
| keepPreReleaseCount     | The number of pre-releases to keep.                                                                  | `2`             | `false`  |
| name                    | The version to create.                                                                               |                 | `true`   |
| prerelease              | Whether the release is a prerelease.                                                                 | `true`          | `false`  |
| sleepDuration           | The duration to sleep in seconds before deleting tags.                                               | `15`            | `false`  |
| tag                     | The tag to create.                                                                                   |                 | `true`   |
| token                   | GitHub Token.                                                                                        |                 | `true`   |
| virustotal_api_key      | The VirusTotal API key to use for scanning artifacts.                                                |                 | `false`  |

## See Also

This action is meant to be used in conjunction with [release_setup](../release_setup).
