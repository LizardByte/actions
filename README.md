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

### Patterns

#### Workflows

This repo has two workflows to test the actions:

- ci.yml
  - A matrix is generated for each action based on the `ci-matrix.json` file in the action's directory. To add or remove
    a matrix, edit the `ci-matrix.json` file.
  - Each action should have at least one matrix defined.
  - If anything needs run before the action is run, create a `pre-ci.sh` file in the action's directory.
  - If anything needs run after the action is run, create a `post-ci.sh` file in the action's directory.
- pytest.yml
  - This workflow runs unit tests for the repo.
  - Python code should be 100% covered by tests.

#### Action Types

This repo has two types of actions:

- **Docker**: These actions are run in a Docker container. They should have a `Dockerfile` in the action's directory.
- **Composite**: These actions are run as a series of steps in the workflow.

Additional action types can be used if necessary.

#### Action Languages

This repo has three languages used for actions:
- **Bash**: Used in portions of composite actions.
- **JavaScript**: Used in portions of composite actions.
- **Python**: Used in Docker actions and composite actions.

Additional languages can be used if necessary.

## License

This repository is licensed under the [MIT License](LICENSE). Individual actions may be licensed under a different
license if specified in their respective directories.
