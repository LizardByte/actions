/**
 * Build a pull request comment containing links to selected workflow artifacts.
 */

/**
 * Parse newline-separated artifact name patterns.
 * @param {string} value - Raw pattern input.
 * @returns {string[]} Artifact name patterns.
 */
function parsePatterns(value) {
  const patterns = value
    .split(/\r?\n/)
    .map(pattern => pattern.trim())
    .filter(Boolean);

  return patterns.length > 0 ? patterns : ['*'];
}

/**
 * Convert a simple artifact-name glob to a regular expression.
 * @param {string} pattern - Glob pattern supporting * and ? wildcards.
 * @returns {RegExp} Anchored regular expression.
 */
function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll('*', '.*')
    .replaceAll('?', '.');

  return new RegExp(`^${escaped}$`);
}

/**
 * Filter and sort artifacts by their names.
 * @param {Object[]} artifacts - Workflow artifact objects.
 * @param {string[]} patterns - Artifact name glob patterns.
 * @returns {Object[]} Matching artifacts sorted by name.
 */
function selectArtifacts(artifacts, patterns) {
  const matchers = patterns.map(globToRegExp);

  return artifacts
    .filter(artifact => matchers.some(matcher => matcher.test(artifact.name)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Escape characters with special meaning in a Markdown link label.
 * @param {string} value - Link label.
 * @returns {string} Escaped link label.
 */
function escapeLinkLabel(value) {
  return value.replace(/([\\[\]])/g, String.raw`\$1`);
}

/**
 * Normalize and validate an optional pull request number.
 * @param {number|string|null|undefined} value - Pull request number value.
 * @returns {string} Normalized pull request number, or an empty string.
 */
function normalizePrNumber(value) {
  const prNumber = String(value ?? '');
  if (prNumber === '') {
    return '';
  }

  if (!/^\d+$/.test(prNumber)) {
    throw new Error(`Invalid PR number value: ${prNumber}`);
  }

  return prNumber;
}

/**
 * Resolve the pull request associated with a source workflow run.
 * @param {Object} github - GitHub API object.
 * @param {Object} context - GitHub Actions context object.
 * @param {Object} sourceRun - Source workflow run.
 * @param {number|string|null|undefined} providedPrNumber - Optional explicit PR number.
 * @returns {Promise<string>} Pull request number.
 */
async function resolvePrNumber(github, context, sourceRun, providedPrNumber) {
  let prNumber = normalizePrNumber(providedPrNumber);
  if (prNumber) {
    return prNumber;
  }

  const eventName = sourceRun.event || '';
  if (eventName !== 'pull_request') {
    throw new Error(`Source workflow run event is "${eventName || 'unknown'}", not "pull_request".`);
  }

  prNumber = normalizePrNumber(sourceRun.pull_requests?.[0]?.number);
  if (prNumber) {
    return prNumber;
  }

  const headBranch = sourceRun.head_branch || '';
  const headRepository = sourceRun.head_repository || {};
  const headRepositoryName = headRepository.full_name || '';
  const headOwner = headRepository.owner?.login
    || headRepository.owner?.name
    || headRepositoryName.split('/')[0]
    || '';
  const head = headOwner && headBranch ? `${headOwner}:${headBranch}` : '';

  if (head) {
    console.log(`workflow_run.pull_requests is empty; resolving PR from head ${head}.`);
    const pullRequests = await github.paginate(github.rest.pulls.list, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      head,
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });
    const baseRepository = `${context.repo.owner}/${context.repo.repo}`;
    const matchingSha = pullRequests.find(pullRequest => pullRequest.head?.sha === sourceRun.head_sha);
    const matchingBase = pullRequests.find(
      pullRequest => pullRequest.base?.repo?.full_name === baseRepository
    );
    const pullRequest = matchingSha || matchingBase || pullRequests[0];
    prNumber = normalizePrNumber(pullRequest?.number);
  }

  if (!prNumber) {
    throw new Error([
      'Unable to determine PR number for pull_request workflow run.',
      `head_repository=${headRepositoryName || '<unknown>'}`,
      `head_branch=${headBranch || '<unknown>'}`,
      `head_sha=${sourceRun.head_sha || '<unknown>'}`,
      `payload_pull_requests=${sourceRun.pull_requests?.length || 0}`,
    ].join(' '));
  }

  return prNumber;
}

/**
 * Build the Markdown body for the pull request comment.
 * @param {Object} params - Comment parameters.
 * @param {Object[]} params.artifacts - Selected workflow artifacts.
 * @param {string} params.owner - Repository owner.
 * @param {string} params.repo - Repository name.
 * @param {string} params.runId - Workflow run ID.
 * @param {string} params.serverUrl - GitHub server URL.
 * @param {string} params.title - Comment heading.
 * @returns {string} Markdown comment body.
 */
function formatComment({ artifacts, owner, repo, runId, serverUrl, title }) {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const runUrl = `${baseUrl}/${owner}/${repo}/actions/runs/${runId}`;
  const lines = [
    `## ${title}`,
    '',
  ];

  if (artifacts.length === 0) {
    lines.push(`No artifacts matched the configured patterns in [workflow run ${runId}](${runUrl}).`);
    return lines.join('\n');
  }

  lines.push(`Artifacts from [workflow run ${runId}](${runUrl}):`, '');

  for (const artifact of artifacts) {
    const artifactUrl = `${runUrl}/artifacts/${artifact.id}`;
    lines.push(`- [${escapeLinkLabel(artifact.name)}](${artifactUrl})`);
  }

  lines.push('', '<sub>You must be signed in to GitHub to download workflow artifacts.</sub>');
  return lines.join('\n');
}

/**
 * List all artifacts for a workflow run.
 * @param {Object} github - GitHub API object.
 * @param {Object} context - GitHub Actions context object.
 * @param {number} runId - Workflow run ID.
 * @returns {Promise<Object[]>} Workflow artifacts.
 */
async function listArtifacts(github, context, runId) {
  const options = github.rest.actions.listWorkflowRunArtifacts.endpoint.merge({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: runId,
    per_page: 100,
  });

  return github.paginate(options);
}

/**
 * Get a workflow run by ID.
 * @param {Object} github - GitHub API object.
 * @param {Object} context - GitHub Actions context object.
 * @param {number} runId - Workflow run ID.
 * @returns {Promise<Object>} Workflow run.
 */
async function getWorkflowRun(github, context, runId) {
  const { data } = await github.rest.actions.getWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: runId,
  });

  return data;
}

/**
 * Build the artifact comment and expose it to the composite action.
 * @param {Object} params - Function parameters.
 * @param {Object} params.github - GitHub API object.
 * @param {Object} params.context - GitHub Actions context object.
 * @param {Object} params.core - GitHub Actions core object.
 */
async function artifactCommentAction({ github, context, core }) {
  try {
    const rawRunId = process.env.INPUT_RUN_ID || String(context.runId);
    if (!/^[1-9]\d*$/.test(rawRunId)) {
      throw new Error(`Invalid workflow run ID: "${rawRunId}".`);
    }

    const runId = Number(rawRunId);
    const sourceRun = await getWorkflowRun(github, context, runId);
    const prNumber = await resolvePrNumber(
      github,
      context,
      sourceRun,
      process.env.INPUT_PR_NUMBER
    );
    const patterns = parsePatterns(process.env.INPUT_ARTIFACT_PATTERNS || '*');
    const artifacts = await listArtifacts(github, context, runId);
    const selectedArtifacts = selectArtifacts(artifacts, patterns);
    const commentBody = formatComment({
      artifacts: selectedArtifacts,
      owner: context.repo.owner,
      repo: context.repo.repo,
      runId: rawRunId,
      serverUrl: context.serverUrl || 'https://github.com',
      title: process.env.INPUT_TITLE || 'Build artifacts',
    });

    console.log(`Found ${artifacts.length} artifact(s); selected ${selectedArtifacts.length}.`);
    core.setOutput('ARTIFACT_COUNT', String(selectedArtifacts.length));
    core.setOutput('ARTIFACT_NAMES', selectedArtifacts.map(artifact => artifact.name).join('\n'));
    core.setOutput('COMMENT_BODY', commentBody);
    core.setOutput('PR_NUMBER', prNumber);
  } catch (error) {
    core.setFailed(`Failed to build artifact comment: ${error.message}`);
  }
}

module.exports = artifactCommentAction;
module.exports.escapeLinkLabel = escapeLinkLabel;
module.exports.formatComment = formatComment;
module.exports.getWorkflowRun = getWorkflowRun;
module.exports.globToRegExp = globToRegExp;
module.exports.listArtifacts = listArtifacts;
module.exports.normalizePrNumber = normalizePrNumber;
module.exports.parsePatterns = parsePatterns;
module.exports.resolvePrNumber = resolvePrNumber;
module.exports.selectArtifacts = selectArtifacts;
