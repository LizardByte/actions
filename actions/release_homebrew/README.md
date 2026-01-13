# release_homebrew

A reusable action to audit, install, test, and publish homebrew formulas to a tap.

This action is designed to work with formulas supplied by the upstream repository, instead of the tap repository.
This works better for projects where the build process often changes, and formulas are more challenging to update.

As part of an automated release workflow, this action can be used to audit, install, test, and publish the supplied
formulas to the tap repository.

Additionally, this action can be used to contribute the formula to an upstream homebrew-core repository by
creating a pull request to the upstream repository. This feature is disabled by default. To use it, you must
fork [Homebrew/homebrew-core](https://github.com/Homebrew/homebrew-core) and provide the `homebrew_core_fork_repo`.
You must also enable the `contribute_to_homebrew_core` input. Finally, you can modify the `upstream_homebrew_core_repo`
to point to a different repository if you are not using the official Homebrew/homebrew-core repository.

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Validate and Publish Homebrew Formula
    id: homebrew
    uses: LizardByte/actions/actions/release_homebrew@master
    with:
      formula_file: "${{ github.workspace }}/hello_world.rb"
      git_email: ${{ secrets.GIT_EMAIL }}
      git_username: ${{ secrets.GIT_USERNAME }}
      org_homebrew_repo: repo_owner/repo_name
```

## 📥 Inputs

| Name                          | Description                                                                               | Default                        | Required |
|-------------------------------|-------------------------------------------------------------------------------------------|--------------------------------|----------|
| brew-gh-api-token             | Token to be used for GitHub API operations within brew. Useful for avoiding rate limits. | `${{ github.token }}`          | `false`  |
| contribute_to_homebrew_core   | Whether to contribute to homebrew-core.                                                   | `false`                        | `false`  |
| formula_file                  | The full path to the formula file.                                                        |                                | `true`   |
| git_email                     | The email to use for the commit.                                                          |                                | `true`   |
| git_username                  | The username to use for the commit.                                                       |                                | `true`   |
| homebrew_core_fork_repo       | The forked homebrew-core repository to publish to.                                        | `LizardByte/homebrew-core`     | `false`  |
| homebrew_core_base_branch     | The base branch of the homebrew-core fork to create PR against.                           | `main`                         | `false`  |
| homebrew_core_head_branch     | The head branch of the homebrew-core fork to create for the PR. If empty, auto-generated. |                                | `false`  |
| org_homebrew_repo             | The target repository to publish to.                                                      | `LizardByte/homebrew-homebrew` | `false`  |
| org_homebrew_repo_base_branch | The base branch of the target repository to create PR against.                            |                                | `false`  |
| org_homebrew_repo_head_branch | The head branch of the target repository to create for the PR. If empty, auto-generated.  |                                | `false`  |
| publish                       | Whether to publish the release.                                                           | `false`                        | `false`  |
| remove_labels                 | A comma-separated list of labels to remove from the PR in the org homebrew repo.          | `bottle-published,pr-pull`,    | `false`  |
| skip_stable_version_audit     | Whether to skip stable version audit for brew test-bot (useful for PR testing).           | `true`                         | `false`  |
| token                         | GitHub Token. This is required when `publish` is enabled.                                 |                                | `false`  |
| upstream_homebrew_core_repo   | The upstream homebrew-core repository that the fork is based on. Must be a GitHub repo.   | `Homebrew/homebrew-core`       | `false`  |
| validate                      | Whether to validate the formula.                                                          | `true`                         | `false`  |

> [!NOTE]
> `org_homebrew_repo` repo name should conform to the documentation.
> See: https://docs.brew.sh/Taps#repository-naming-conventions-and-assumptions

## 📤 Outputs

| Name      | Description                                       |
|-----------|---------------------------------------------------|
| buildpath | The path to Homebrew's temporary build directory. |
| testpath  | The path to Homebrew's temporary test directory.  |

## 🧰 Advanced Usage

It's possible to overwrite the defaults by providing additional inputs:

```yaml
steps:
  - name: Validate and Publish Homebrew Formula
    uses: LizardByte/actions/actions/release_homebrew@master
    with:
      contribute_to_homebrew_core: true
      formula_file: "${{ github.workspace }}/hello_world.rb"
      git_email: ${{ secrets.GIT_EMAIL }}
      git_username: ${{ secrets.GIT_USERNAME }}
      homebrew_core_fork_repo: repo_owner/homebrew-core
      homebrew_core_base_branch: main
      homebrew_core_head_branch: my-custom-branch  # optional, will be auto-generated if not specified
      org_homebrew_repo: repo_owner/repo_name
      org_homebrew_repo_base_branch: master
      org_homebrew_repo_head_branch: my-custom-branch  # optional, will be auto-generated if not specified
      publish: true  # you probably want to use some conditional logic here
      token: ${{ secrets.PAT }}  # required to publish
      upstream_homebrew_core_repo: Homebrew/homebrew-core
      validate: false  # skip the audit and install steps
```

## 📝 Notes

> [!Warning]
> This action is only compatible with Linux and macOS runners, and will intentionally fail on Windows runners.

> [!Note]
> If you have a formula that is sensitive to the runner's OS version, you may wish to use a matrix strategy to run the
> action. In this case you probably only want to run the publish on one of them. Below is an example.

```yaml
jobs:
  publish:
    strategy:
      fail-fast: false  # false to test all, true to cancel the remaining jobs if any fail
      matrix:
        include:
          - os: macos-14
          - os: macos-15
          - os: macos-26
          - os: ubuntu-latest
            publish: true
    name: Homebrew (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Generate Formula
        shell: bash
        run: |
          # whatever you need to do to generate the formula

      - name: Validate and Publish Homebrew Formula
        uses: LizardByte/actions/actions/release_homebrew@master
        with:
          formula_file: "${{ github.workspace }}/build/hello_world.rb"
          git_email: ${{ secrets.GIT_EMAIL }}
          git_username: ${{ secrets.GIT_USERNAME }}
          org_homebrew_repo: repo_owner/repo_name
          org_homebrew_repo_base_branch: main
          publish: ${{ matrix.publish }}
          token: ${{ secrets.PAT }}
```
