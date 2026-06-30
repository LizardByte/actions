<div align="center">
  <img
    src="https://raw.githubusercontent.com/LizardByte/.github/refs/heads/master/branding/logos/logo.svg"
    alt="LizardByte icon"
    width="256"
  />
  <h1 align="center">LizardByte actions</h1>
  <h4 align="center">Reusable actions for GitHub workflows.</h4>
</div>

<div align="center">
  <a href="https://github.com/LizardByte/actions"><img src="https://img.shields.io/github/stars/lizardbyte/actions.svg?logo=github&style=for-the-badge" alt="GitHub stars"></a>
  <a href="https://github.com/LizardByte/actions/actions/workflows/ci.yml.svg?query=branch%3Amaster"><img src="https://img.shields.io/github/actions/workflow/status/lizardbyte/actions/ci.yml.svg?branch=master&label=CI%20build&logo=github&style=for-the-badge" alt="GitHub Workflow Status (CI)"></a>
  <a href="https://github.com/LizardByte/actions/actions/workflows/ci-tests.yml.svg?query=branch%3Amaster"><img src="https://img.shields.io/github/actions/workflow/status/lizardbyte/actions/ci-tests.yml.svg?branch=master&label=CI%20tests&logo=github&style=for-the-badge" alt="GitHub Workflow Status (CI-Tests)"></a>
  <a href="https://codecov.io/gh/LizardByte/actions"><img src="https://img.shields.io/endpoint.svg?url=https%3A%2F%2Fapp.lizardbyte.dev%2Fdashboard%2Fshields%2Fcodecov%2Factions.json&style=for-the-badge&logo=codecov" alt="Codecov"></a>
  <a href="https://sonarcloud.io/project/overview?id=LizardByte_actions"><img src="https://img.shields.io/sonar/quality_gate/LizardByte_actions.svg?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&logo=sonarqubecloud&label=sonarcloud" alt="SonarCloud"></a>
</div>

## actions

| Action                                                | Description                                                                     | Type      | Language         |
|-------------------------------------------------------|---------------------------------------------------------------------------------|-----------|------------------|
| [audit_repos](actions/audit_repos#readme)             | Audit repositories in an organization                                           | composite | javascript       |
| [facebook_post](actions/facebook_post#readme)         | Post to Facebook page/group using Graph API                                     | docker    | python           |
| [get_changed_files](actions/get_changed_files#readme) | Get the list of changed files in a pull request                                 | composite | javascript       |
| [monitor_space](actions/monitor_space#readme)         | Monitor and track minimum free disk space                                       | composite | bash             |
| [pinact](actions/pinact#readme)                       | Run pinact against repositories in an organization and create PRs for updates   | composite | javascript       |
| [more_space](actions/more_space#readme)               | Free up disk space in GitHub Actions runners                                    | composite | bash             |
| [release_changelog](actions/release_changelog#readme) | Generate a changelog for the latest release                                     | composite | javascript       |
| [release_create](actions/release_create#readme)       | Create a new release                                                            | composite | bash, javascript |
| [release_homebrew](actions/release_homebrew#readme)   | Validate and update Homebrew formula                                            | composite | bash, python     |
| [release_setup](actions/release_setup#readme)         | Prepare a release                                                               | docker    | python           |
| [screenshot](actions/screenshot#readme)               | Setup cross-platform screenshot CLI tool                                        | composite | bash             |
| [setup_cuda](actions/setup_cuda#readme)               | Set up NVIDIA CUDA Toolkit on Linux runners                                     | composite | bash             |
| [setup_python](actions/setup_python#readme)           | Set up Python environment                                                       | composite | bash             |
| [trailing_spaces](actions/trailing_spaces#readme)     | Check files for trailing spaces, empty lines at EOF, and missing newline at EOF | composite | javascript       |
| [virtual_desktop](actions/virtual_desktop#readme)     | Setup virtual desktop for GUI apps on Linux                                     | composite | bash             |

## Contributions

Contributions are welcome!
See our [Contributor's Guide](https://docs.lizardbyte.dev/latest/developers/code_of_conduct.html).

### Patterns

#### Workflows

This repo has two workflows to test the actions:

- [ci.yml](.github/workflows/ci.yml)
  - A matrix is generated for each action based on the `ci-matrix.json` file in the action's directory. To add or remove
    a matrix, edit the `ci-matrix.json` file.
  - Each action should have at least one matrix defined.
  - If anything needs run before the action is run, create a `pre-ci.sh` file in the action's directory.
  - If anything needs run after the action is run, create a `post-ci.sh` file in the action's directory.
- [ci-tests.yml](.github/workflows/ci-tests.yml)
  - This workflow runs unit tests for the repo using pytest and Jest.
  - Tests should 100% cover JavaScript and Python code.

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
