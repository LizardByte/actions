/**
 * Pre-release cleanup script for GitHub Actions
 * This script deletes old pre-releases and optionally their tags.
 */

/**
 * Parse a version tag string into numeric parts
 * @param {string} tagName - Tag name (e.g., "v1.2.3.4")
 * @returns {Array<number>} Array of numeric version parts
 */
function parseVersionTag(tagName) {
  return tagName.match(/\d+/g).map(Number);
}

/**
 * Compare two version tags
 * @param {string} a - First tag name
 * @param {string} b - Second tag name
 * @returns {number} -1 if a < b, 1 if a > b, 0 if equal
 */
function compareVersionTags(a, b) {
  const aParts = parseVersionTag(a);
  const bParts = parseVersionTag(b);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    if (aParts[i] === undefined) return -1;
    if (bParts[i] === undefined) return 1;
    if (aParts[i] < bParts[i]) return -1;
    if (aParts[i] > bParts[i]) return 1;
  }
  return 0;
}

/**
 * Check if a tag matches the version pattern
 * @param {string} tagName - Tag name to check
 * @returns {boolean} True if tag matches pattern
 */
function matchesVersionPattern(tagName) {
  const regexPattern = /^v(\d{4,})\.(\d{1,4})\.(\d{1,6})(\.\d{1,2})?/;
  return regexPattern.test(tagName);
}

/**
 * Filter releases to delete based on criteria
 * @param {Array} allReleases - All releases from the repository
 * @param {boolean} isDraft - Whether the current release is a draft
 * @param {string} currentTag - Current release tag
 * @param {number} keepLatest - Number of latest pre-releases to keep
 * @returns {Array} Releases to delete
 */
function filterReleasesToDelete(allReleases, isDraft, currentTag, keepLatest) {
  let releasesToDelete = [];

  if (isDraft) {
    // When creating a draft, delete all other draft releases
    releasesToDelete = allReleases.filter(release =>
      release.draft &&
      matchesVersionPattern(release.tag_name) &&
      release.tag_name !== currentTag
    );
    console.log('Matched Draft releases:', releasesToDelete.map(release => release.tag_name));
  } else {
    // When creating a non-draft pre-release, delete all except the latest N pre-releases
    // Filter matching pre-releases, excluding the currentTag
    releasesToDelete = allReleases.filter(release =>
      release.prerelease &&
      matchesVersionPattern(release.tag_name) &&
      release.tag_name !== currentTag
    );
    console.log('Matched Pre-release tags:', releasesToDelete.map(release => release.tag_name));

    // Sort by tag/version number (e.g. v1.2.3 or v1.2.3.4)
    releasesToDelete.sort((a, b) => compareVersionTags(a.tag_name, b.tag_name));

    // Output sorted pre-releases
    console.log('Sorted Pre-release tags:', releasesToDelete.map(release => release.tag_name));

    // Keep only the releases to delete (remove the latest N from the list)
    // keepLatest represents total pre-releases to keep INCLUDING currentTag
    // If currentTag is already in the list, it was filtered out, so keep (keepLatest - 1) others
    // If currentTag is NOT in the list, it will be created, so keep (keepLatest - 1) existing ones
    if (keepLatest > 0) {
      const effectiveKeepLatest = keepLatest - 1;
      releasesToDelete = releasesToDelete.slice(0, -effectiveKeepLatest);
    }
    // If keepLatest is 0, delete all
  }

  console.log('Releases to delete:', releasesToDelete.map(release => release.tag_name));

  return releasesToDelete;
}

/**
 * Delete a release
 * @param {Object} github - GitHub API object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} release - Release object to delete
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function deleteRelease(github, owner, repo, release) {
  console.log(`Deleting release: ${release.tag_name}`);
  try {
    await github.rest.repos.deleteRelease({
      owner: owner,
      repo: repo,
      release_id: release.id
    });
    return true;
  } catch (error) {
    console.error(`Failed to delete release: ${release.tag_name}`);
    console.error(error);
    return false;
  }
}

/**
 * Delete a tag
 * @param {Object} github - GitHub API object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} release - Release object whose tag to delete
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function deleteTag(github, owner, repo, release) {
  console.log(`Deleting tag: ${release.tag_name}`);
  try {
    await github.rest.git.deleteRef({
      owner: owner,
      repo: repo,
      ref: `tags/${release.tag_name}`
    });
    return true;
  } catch (error) {
    console.error(`Failed to delete tag: ${release.tag_name}`);
    console.error(error);
    return false;
  }
}

/**
 * Sleep for a specified duration
 * @param {number} seconds - Duration in seconds
 * @returns {Promise} Promise that resolves after the duration
 */
function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Main function to delete old pre-releases
 * @param {Object} params - Function parameters
 * @param {Object} params.github - GitHub API object
 * @param {Object} params.context - GitHub Actions context object
 */
async function deleteOldPreReleases({ github, context }) {
  // Process inputs
  const DELETE_TAGS = process.env.DELETE_TAGS.toLowerCase() === 'true';
  const IS_DRAFT = process.env.IS_DRAFT.toLowerCase() === 'true';
  const KEEP_LATEST = Number.parseInt(process.env.KEEP_LATEST, 10);
  const SLEEP_DURATION = Number.parseInt(process.env.SLEEP_DURATION, 10);
  const CURRENT_TAG = process.env.CURRENT_TAG;

  console.log(`DELETE_TAGS: ${DELETE_TAGS}`);
  console.log(`IS_DRAFT: ${IS_DRAFT}`);
  console.log(`KEEP_LATEST: ${KEEP_LATEST}`);
  console.log(`CURRENT_TAG: ${CURRENT_TAG}`);

  // List all releases
  const repoOpts = github.rest.repos.listReleases.endpoint.merge({
    owner: context.repo.owner,
    repo: context.repo.repo,
  });
  const allReleases = await github.paginate(repoOpts);

  for (const release of allReleases) {
    console.log(`Release: ${release.tag_name}`);
    console.log(`Is pre-release: ${release.prerelease}`);
    console.log(`Is draft: ${release.draft}`);
    console.log(`Matches regex: ${matchesVersionPattern(release.tag_name)}`);
  }

  // Filter releases to delete
  const releasesToDelete = filterReleasesToDelete(allReleases, IS_DRAFT, CURRENT_TAG, KEEP_LATEST);

  // Delete the releases
  for (const release of releasesToDelete) {
    await deleteRelease(github, context.repo.owner, context.repo.repo, release);
  }

  // Sleep to allow any on release deleted event workflow runs to be created
  // If the tag is deleted before the workflow run is created, the run will fail to be created
  await sleep(SLEEP_DURATION);

  // Delete tags if requested
  if (DELETE_TAGS) {
    for (const release of releasesToDelete) {
      await deleteTag(github, context.repo.owner, context.repo.repo, release);
    }
  }
}

module.exports = deleteOldPreReleases;
module.exports.parseVersionTag = parseVersionTag;
module.exports.compareVersionTags = compareVersionTags;
module.exports.matchesVersionPattern = matchesVersionPattern;
module.exports.filterReleasesToDelete = filterReleasesToDelete;
module.exports.deleteRelease = deleteRelease;
module.exports.deleteTag = deleteTag;
module.exports.sleep = sleep;
