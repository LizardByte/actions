/**
 * Get Changed Files script for GitHub Actions
 * This script fetches the list of changed files in a pull request.
 */

/**
 * Get the list of changed files for a pull request.
 * @param {Object} github - GitHub API object
 * @param {Object} context - GitHub Actions context object
 * @param {number|string} prNumber - Pull request number
 * @returns {Promise<string[]>} Array of changed file paths
 */
async function getChangedFiles(github, context, prNumber) {
  const opts = github.rest.pulls.listFiles.endpoint.merge({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: Number(prNumber),
  });
  const changedFiles = await github.paginate(opts);
  return changedFiles.map(file => file.filename);
}

/**
 * Main function to get and output changed files.
 * @param {Object} params - Function parameters
 * @param {Object} params.github - GitHub API object
 * @param {Object} params.context - GitHub Actions context object
 * @param {Object} params.core - GitHub Actions core object
 */
async function getChangedFilesAction({ github, context, core }) {
  const prNumber = process.env.INPUT_PR_NUMBER || context.payload?.pull_request?.number;

  if (!prNumber) {
    core.setFailed('No pull request number provided. Set the pr_number input or run this action in a pull_request event.');
    return;
  }

  console.log(`Getting changed files for PR #${prNumber} in ${context.repo.owner}/${context.repo.repo}`);

  try {
    const files = await getChangedFiles(github, context, prNumber);
    const changedFilesString = files.join('\n');

    console.log(`Changed files:\n${changedFilesString}`);
    core.setOutput('CHANGED_FILES', changedFilesString);
  } catch (error) {
    core.setFailed(`Failed to get changed files: ${error.message}`);
  }
}

module.exports = getChangedFilesAction;
module.exports.getChangedFiles = getChangedFiles;
