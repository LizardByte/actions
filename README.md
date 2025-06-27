# LizardByte re-usable actions

[![GitHub Workflow Status (CI)](https://img.shields.io/github/actions/workflow/status/lizardbyte/actions/ci.yml.svg?branch=master&label=CI%20build&logo=github&style=for-the-badge)](https://github.com/LizardByte/actions/actions/workflows/ci.yml?query=branch%3Amaster)
[![Codecov](https://img.shields.io/codecov/c/gh/LizardByte/actions.svg?token=GQm8qlXRaw&style=for-the-badge&logo=codecov&label=codecov)](https://app.codecov.io/gh/LizardByte/actions)

This is a monorepo containing a collection of GitHub Actions maintained by LizardByte.

## actions

| Action                                                | Description                                 | Type      | Language         |
|-------------------------------------------------------|---------------------------------------------|-----------|------------------|
| [facebook_post](actions/facebook_post#readme)         | Post to Facebook page/group using Graph API | docker    | python           |
| [release_changelog](actions/release_changelog#readme) | Generate a changelog for the latest release | composite | javascript       |
| [release_create](actions/release_create#readme)       | Create a new release                        | composite | bash, javascript |
| [release_homebrew](actions/release_homebrew#readme)   | Validate and update Homebrew formula        | composite | bash, python     |
| [release_setup](actions/release_setup#readme)         | Prepare a release                           | docker    | python           |
| [setup_python](actions/setup_python#readme)           | Set up Python environment                   | composite | bash             |

## Contributions

Contributions are welcome!
See our [Contributor's Guide](https://docs.lizardbyte.dev/latest/developers/code_of_conduct.html).
