# artifact_comment

Post links to selected workflow artifacts in a pull request comment. The action uses a stable message ID, so later
workflow runs update the existing comment instead of adding another comment.

## 🛠️ Prep Work

Run this action from a `workflow_run` workflow after the CI workflow that uploads the artifacts has completed. This
gives the follow-up workflow its own trusted token, including when the source pull request came from a fork. The token
needs permission to read Actions artifacts and write pull request comments:

```yaml
permissions:
  actions: read
  pull-requests: write
```

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
name: Comment PR Artifacts

on:
  workflow_run:
    workflows: ["CI"]
    types:
      - completed

permissions: {}

jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    permissions:
      actions: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - name: Comment with build artifacts
        uses: LizardByte/actions/actions/artifact_comment@master
        with:
          artifact_patterns: |
            build-linux-*
            build-windows-*
```

Each non-empty line in `artifact_patterns` is matched against the complete artifact name. `*` matches any number of
characters and `?` matches one character. A literal artifact name is therefore also a valid pattern.

## 📥 Inputs

| Name                | Description                                                                  | Default                               | Required |
|---------------------|------------------------------------------------------------------------------|---------------------------------------|----------|
| `artifact_patterns` | Newline-separated artifact name patterns. Supports `*` and `?` wildcards.    | `*`                                   | `false`  |
| `dry_run`           | Build the comment and outputs without posting it.                            | `false`                               | `false`  |
| `message_id`        | Stable ID used to find and update the existing comment.                      | `artifact-comment`                    | `false`  |
| `pr_number`         | Pull request number. By default it is resolved from the source workflow run. |                                       | `false`  |
| `run_id`            | Workflow run ID whose artifacts should be listed.                            | Source workflow run, then current run | `false`  |
| `title`             | Markdown heading text for the comment.                                       | `Build artifacts`                     | `false`  |
| `token`             | GitHub token used to read artifacts and post the pull request comment.       | `${{ github.token }}`                 | `false`  |

## 📤 Outputs

| Name              | Description                                                   |
|-------------------|---------------------------------------------------------------|
| `artifact_count`  | Number of artifacts included in the comment.                  |
| `artifact_names`  | Newline-separated names of artifacts included in the comment. |
| `comment_created` | Whether a new pull request comment was created.               |
| `comment_body`    | Generated Markdown comment body.                              |
| `comment_id`      | ID of the created or updated pull request comment.            |
| `comment_updated` | Whether an existing pull request comment was updated.         |
| `pr_number`       | Pull request number resolved for the source workflow run.     |

## 📝 Notes

- The default `message_id` creates one sticky artifact comment per pull request. Set a different ID for each workflow
  if multiple workflows should maintain separate artifact comments.
- When no artifact matches, the action updates the comment to say that the source workflow run produced no matching
  artifacts. This prevents links from an older run from remaining visible.
- Artifact download links require the reader to sign in to GitHub and stop working when GitHub expires or deletes the
  artifact.
- The action first uses the pull request attached to the source workflow run. If GitHub omits that association, it
  resolves the open pull request from the source repository, branch, and head SHA.
