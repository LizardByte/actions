# release_changelog

A reusable action to update a changelog, based on the contents of the GitHub releases.

## Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Update Changelog
    uses: LizardByte/actions/actions/release_changelog@master
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Name                   | Description                            | Default         | Required |
|------------------------|----------------------------------------|-----------------|----------|
| changelogBranch        | The branch to store the changelog in.  | `changelog`     | `false`  |
| changelogFile          | The file to store the changelog in.    | `CHANGELOG.md`  | `false`  |
| token                  | GitHub Token.                          |                 | `true`   |

## Outputs

| Name      | Description                              |
|-----------|------------------------------------------|
| changelog | The contents of the generated changelog. |

## See Also

This action is meant to be used in conjunction with [release_setup](../release_setup).
