/**
 * Repository auditing script for GitHub Actions
 * This script fetches all repositories in an organization and runs various audits on them.
 */

/**
 * Validate repository description
 * @param {Object} repo - Repository object
 * @returns {Array} Array of issue strings
 */
function validateDescription(repo) {
  const issues = [];

  // Check if the description exists
  if (repo.description) {
    // Ensure the description does not begin or end with whitespace
    if (repo.description !== repo.description.trim()) {
      issues.push('Description contains leading or trailing whitespace');
    }

    // Ensure the description ends with a period
    if (!repo.description.endsWith('.')) {
      issues.push('Description does not end with a period');
    }

    // Ensure the description is not too short
    if (repo.description.length < 10) {
      issues.push('Description is too short (less than 10 characters)');
    }
  } else {
    issues.push('Missing description');
  }

  return issues;
}

/**
 * Validate repository settings
 * @param {Object} repo - Repository object
 * @returns {Array} Array of issue strings
 */
function validateSettings(repo) {
  const issues = [];

  // Ensure issues are enabled
  if (!repo.has_issues) {
    issues.push('Issues are disabled');
  }

  return issues;
}

/**
 * Validate merge types
 * @param {Object} repo - Repository object
 * @param {string} allowMergeCommit - Expected merge commit setting
 * @param {string} allowSquashMerge - Expected squash merge setting
 * @param {string} allowRebaseMerge - Expected rebase merge setting
 * @returns {Array} Array of issue strings
 */
function validateMergeTypes(repo, allowMergeCommit, allowSquashMerge, allowRebaseMerge) {
  const issues = [];

  // Check merge commit setting
  if (allowMergeCommit === 'disabled' && repo.allow_merge_commit) {
    issues.push('Merge commits should be disabled');
  } else if (allowMergeCommit === 'enabled' && !repo.allow_merge_commit) {
    issues.push('Merge commits should be enabled');
  }

  // Check squash merge setting
  if (allowSquashMerge === 'disabled' && repo.allow_squash_merge) {
    issues.push('Squash merge should be disabled');
  } else if (allowSquashMerge === 'enabled' && !repo.allow_squash_merge) {
    issues.push('Squash merge should be enabled');
  }

  // Check rebase merge setting
  if (allowRebaseMerge === 'disabled' && repo.allow_rebase_merge) {
    issues.push('Rebase merge should be disabled');
  } else if (allowRebaseMerge === 'enabled' && !repo.allow_rebase_merge) {
    issues.push('Rebase merge should be enabled');
  }

  return issues;
}

/**
 * Validate discussions configuration
 * @param {Object} repo - Repository object
 * @param {string} checkDiscussions - Discussion check mode ('org', 'repo', or 'off')
 * @param {string} orgDiscussionsRepo - Name of the org discussions repository
 * @returns {Array} Array of issue strings
 */
function validateDiscussions(repo, checkDiscussions, orgDiscussionsRepo) {
  const issues = [];

  if (checkDiscussions === 'org') {
    // Using org-wide discussions, repo discussions should be disabled
    // Exception: the designated org discussions repo is allowed to have discussions
    if (repo.has_discussions && repo.name !== orgDiscussionsRepo) {
      issues.push('Repository discussions should be disabled (using org-wide discussions)');
    }
  } else if (checkDiscussions === 'repo') {
    // Using repo discussions, every repo should have discussions enabled
    if (!repo.has_discussions) {
      issues.push('Repository discussions should be enabled');
    }
  }

  return issues;
}

/**
 * Validate community health files
 * @param {Object} repo - Repository object
 * @param {boolean} checkReadme - Whether to check for README
 * @param {boolean} checkLicense - Whether to check for LICENSE
 * @param {boolean} checkCodeOfConduct - Whether to check for CODE_OF_CONDUCT
 * @param {boolean} checkContributing - Whether to check for CONTRIBUTING
 * @param {boolean} checkSecurity - Whether to check for SECURITY
 * @param {boolean} checkSponsors - Whether to check for sponsors
 * @returns {Array} Array of issue strings
 */
function validateCommunityFiles(repo, checkReadme, checkLicense, checkCodeOfConduct, checkContributing, checkSecurity, checkSponsors) {
  const issues = [];

  if (checkReadme && !repo.has_readme) {
    issues.push('Missing README file');
  }

  if (checkLicense && !repo.has_license) {
    issues.push('Missing LICENSE file');
  }

  if (checkCodeOfConduct && !repo.has_code_of_conduct) {
    issues.push('Missing CODE_OF_CONDUCT file');
  }

  if (checkContributing && !repo.has_contributing) {
    issues.push('Missing CONTRIBUTING file');
  }

  if (checkSecurity && !repo.has_security_policy) {
    issues.push('Missing SECURITY policy');
  }

  if (checkSponsors && !repo.has_sponsors) {
    issues.push('Sponsors not activated');
  }

  return issues;
}

/**
 * Report failures for a given check
 * @param {Object} core - GitHub Actions core object
 * @param {string} checkName - Name of the check being performed
 * @param {Array} failures - Array of failure objects with repo, html_url, and issues properties
 * @param {string} icon - Icon to display for failures (default: '❌')
 */
function reportFailures(core, checkName, failures, icon = '❌') {
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`${icon} ${failure.repo}:`);
      for (const issue of failure.issues) {
        console.log(`   - ${issue}`);
      }
      console.log(`   URL: ${failure.html_url}\n`);
    }
    core.setFailed(`${failures.length} ${checkName} check(s) failed. See logs above for details.`);
  } else {
    console.log(`\n✅ All ${checkName} checks passed!`);
  }
}

/**
 * Run an audit check on all repositories
 * @param {Object} core - GitHub Actions core object
 * @param {Array} repos - Array of repository objects
 * @param {string} checkName - Name of the check being performed
 * @param {Function} validationFn - Function that takes a repo and returns an array of issues
 * @param {string} icon - Icon to display for failures (default: '❌')
 */
function runAudit(core, repos, checkName, validationFn, icon = '❌') {
  const failures = [];

  console.log(`=== Checking ${checkName} ===\n`);

  for (const repo of repos) {
    const issues = validationFn(repo);

    if (issues.length > 0) {
      failures.push({
        repo: repo.name,
        html_url: repo.html_url,
        issues: issues
      });
    } else {
      console.log(`✅ ${repo.name}`);
    }
  }

  reportFailures(core, checkName, failures, icon);
}

/**
 * Check if a file exists in a repository
 * @param {Object} github - GitHub API object
 * @param {string} owner - Owner name
 * @param {string} repo - Repository name
 * @param {string} path - File path
 * @returns {Promise<boolean>} Whether the file exists
 */
async function checkFileExists(github, owner, repo, path) {
  try {
    await github.rest.repos.getContent({
      owner: owner,
      repo: repo,
      path: path
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if README file exists in repository
 * @param {Object} github - GitHub API object
 * @param {string} owner - Owner name
 * @param {string} repo - Repository name
 * @returns {Promise<boolean>} Whether README exists
 */
async function checkReadmeExists(github, owner, repo) {
  const readmeVariants = ['README.md', 'README', 'README.rst', 'README.txt'];
  const readmeLocations = ['', '.github/', 'docs/'];

  for (const location of readmeLocations) {
    for (const variant of readmeVariants) {
      const exists = await checkFileExists(github, owner, repo, `${location}${variant}`);
      if (exists) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if LICENSE file exists in repository
 * @param {Object} github - GitHub API object
 * @param {string} owner - Owner name
 * @param {string} repo - Repository name
 * @returns {Promise<boolean>} Whether LICENSE exists
 */
async function checkLicenseExists(github, owner, repo) {
  const licenseVariants = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md'];
  const licenseLocations = ['', '.github/', 'docs/'];

  for (const location of licenseLocations) {
    for (const variant of licenseVariants) {
      const exists = await checkFileExists(github, owner, repo, `${location}${variant}`);
      if (exists) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if FUNDING.yml exists in repository or organization
 * @param {Object} github - GitHub API object
 * @param {string} owner - Owner name
 * @param {string} repo - Repository name
 * @returns {Promise<boolean>} Whether FUNDING.yml exists
 */
async function checkFundingExists(github, owner, repo) {
  const fundingPaths = ['.github/FUNDING.yml', 'FUNDING.yml'];

  for (const path of fundingPaths) {
    const exists = await checkFileExists(github, owner, repo, path);
    if (exists) {
      return true;
    }
  }
  return false;
}

/**
 * Fetch detailed repository information
 * @param {Object} github - GitHub API object
 * @param {string} owner - Owner name
 * @param {Object} repo - Basic repository object
 * @param {Object} orgCommunityHealth - Organization-level community health files
 * @param {boolean} orgHasFunding - Whether org has FUNDING.yml
 * @returns {Promise<Object|null>} Detailed repository object or null if error
 */
async function fetchRepositoryDetails(github, owner, repo, orgCommunityHealth, orgHasFunding) {
  try {
    // Fetch full repository details
    const { data: fullRepo } = await github.rest.repos.get({
      owner: owner,
      repo: repo.name
    });

    // Fetch community health files
    let communityHealth = {
      has_readme: false,
      has_license: false,
      has_code_of_conduct: false,
      has_contributing: false,
      has_security_policy: false
    };

    // Skip community health check for forks as GitHub API doesn't support it
    // Instead, forks inherit from org-level
    if (fullRepo.fork) {
      // Forks inherit org-level community health files (except README and LICENSE - check if fork has them)
      const has_readme = await checkReadmeExists(github, owner, repo.name);
      const has_license = await checkLicenseExists(github, owner, repo.name);

      communityHealth = {
        has_readme: has_readme,
        has_license: has_license,
        has_code_of_conduct: orgCommunityHealth.has_code_of_conduct,
        has_contributing: orgCommunityHealth.has_contributing,
        has_security_policy: orgCommunityHealth.has_security_policy
      };
    } else {
      try {
        const { data: health } = await github.rest.repos.getCommunityProfileMetrics({
          owner: owner,
          repo: repo.name
        });

        communityHealth = {
          has_readme: health.files?.readme !== null,
          has_license: health.files?.license !== null,
          has_code_of_conduct: health.files?.code_of_conduct !== null,
          has_contributing: health.files?.contributing !== null,
          has_security_policy: health.files?.security !== null
        };
      } catch (error) {
        // Community health API might fail, continue with defaults
        console.log(`⚠️  Could not fetch community health for ${repo.name}: ${error.message}`);
      }

      // For non-forks, merge with org-level (org-level provides fallback)
      communityHealth = {
        has_readme: communityHealth.has_readme,
        has_license: communityHealth.has_license,
        has_code_of_conduct: communityHealth.has_code_of_conduct || orgCommunityHealth.has_code_of_conduct,
        has_contributing: communityHealth.has_contributing || orgCommunityHealth.has_contributing,
        has_security_policy: communityHealth.has_security_policy || orgCommunityHealth.has_security_policy
      };
    }

    // Check if sponsors are activated (via FUNDING.yml)
    // Check repo-level first, then consider org-level
    const repoHasFunding = await checkFundingExists(github, owner, repo.name);
    const has_sponsors = repoHasFunding || orgHasFunding;

    return {
      name: fullRepo.name,
      description: fullRepo.description || '',
      html_url: fullRepo.html_url,
      has_issues: fullRepo.has_issues,
      has_wiki: fullRepo.has_wiki,
      has_pages: fullRepo.has_pages,
      allow_merge_commit: fullRepo.allow_merge_commit,
      allow_squash_merge: fullRepo.allow_squash_merge,
      allow_rebase_merge: fullRepo.allow_rebase_merge,
      has_discussions: fullRepo.has_discussions,
      ...communityHealth,
      has_sponsors: has_sponsors
    };
  } catch (error) {
    console.log(`⚠️  Could not fetch details for ${repo.name}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch all repositories from the organization or user
 * @param {Object} github - GitHub API object
 * @param {string} owner - Organization or username
 * @param {boolean} includeArchived - Include archived repositories
 * @param {boolean} includeForked - Include forked repositories
 * @param {boolean} includePrivate - Include private repositories
 * @param {Array} excludedRepos - List of repository names to exclude
 * @returns {Promise<Array>} Array of repository objects
 */
async function fetchRepositories(github, owner, includeArchived, includeForked, includePrivate, excludedRepos) {
  console.log('=== Fetching Repositories ===\n');
  console.log(`Organization/User: ${owner}`);
  console.log(`Include Archived: ${includeArchived}`);
  console.log(`Include Forked: ${includeForked}`);
  console.log(`Include Private: ${includePrivate}`);
  console.log(`Excluded Repos: ${excludedRepos.length > 0 ? excludedRepos.join(', ') : 'None'}\n`);

  // Try to fetch as org first, fall back to user repos
  let allRepos;
  try {
    const opts = github.rest.repos.listForOrg.endpoint.merge({
      org: owner,
      per_page: 100
    });
    allRepos = await github.paginate(opts);
  } catch (error) {
    if (error.status === 404) {
      // Not an org, try as user
      console.log(`Not an organization, trying as user...\n`);
      const opts = github.rest.repos.listForUser.endpoint.merge({
        username: owner,
        per_page: 100
      });
      allRepos = await github.paginate(opts);
    } else {
      throw error;
    }
  }

  // Apply filters
  let repos = allRepos;

  // Filter archived repos
  if (!includeArchived) {
    repos = repos.filter(repo => !repo.archived);
  }

  // Filter forked repos
  if (!includeForked) {
    repos = repos.filter(repo => !repo.fork);
  }

  // Filter private repos
  if (!includePrivate) {
    repos = repos.filter(repo => !repo.private);
  }

  // Filter excluded repos
  if (excludedRepos.length > 0) {
    repos = repos.filter(repo => !excludedRepos.includes(repo.name));
  }

  console.log(`Found ${repos.length} repositories to audit (${allRepos.length} total)\n`);

  // Check if org-level .github repo exists with FUNDING.yml
  const orgHasFunding = await checkFundingExists(github, owner, '.github');
  if (orgHasFunding) {
    console.log('✅ Organization has FUNDING.yml in .github repo\n');
  } else {
    console.log('ℹ️  No organization-level FUNDING.yml found\n');
  }

  // Check if org-level .github repo exists with community health files
  let orgCommunityHealth = {
    has_readme: false,
    has_license: false,
    has_code_of_conduct: false,
    has_contributing: false,
    has_security_policy: false
  };

  try {
    const { data: orgHealth } = await github.rest.repos.getCommunityProfileMetrics({
      owner: owner,
      repo: '.github'
    });

    orgCommunityHealth = {
      has_readme: orgHealth.files?.readme !== null,
      has_license: orgHealth.files?.license !== null,
      has_code_of_conduct: orgHealth.files?.code_of_conduct !== null,
      has_contributing: orgHealth.files?.contributing !== null,
      has_security_policy: orgHealth.files?.security !== null
    };

    if (orgCommunityHealth.has_license || orgCommunityHealth.has_code_of_conduct ||
        orgCommunityHealth.has_contributing || orgCommunityHealth.has_security_policy) {
      console.log('✅ Organization has community health files in .github repo\n');
    }
  } catch {
    // No org-level community health files
    console.log('ℹ️  No organization-level community health files found\n');
  }

  // Fetch detailed information for each repository
  console.log('Fetching detailed repository information...\n');
  const detailedRepos = await Promise.all(
    repos.map(async (repo) => {
      return fetchRepositoryDetails(github, owner, repo, orgCommunityHealth, orgHasFunding);
    })
  );

  // Filter out any repos that could not be fetched
  repos = detailedRepos.filter(repo => repo !== null);

  return repos;
}

/**
 * Main audit function
 */
async function auditRepositories({ github, context, core }) {
  // Parse inputs
  const githubOrg = process.env.INPUT_GITHUB_ORG || context.repo.owner;
  const includeArchived = process.env.INPUT_INCLUDE_ARCHIVED.toLowerCase() === 'true';
  const includeForked = process.env.INPUT_INCLUDE_FORKED.toLowerCase() === 'true';
  const includePrivate = process.env.INPUT_INCLUDE_PRIVATE.toLowerCase() === 'true';
  const excludedRepos = process.env.INPUT_EXCLUDED_REPOS
    .split(',')
    .map(repo => repo.trim())
    .filter(repo => repo.length > 0);
  const checkDescription = process.env.INPUT_CHECK_DESCRIPTION.toLowerCase() === 'true';
  const checkSettings = process.env.INPUT_CHECK_SETTINGS.toLowerCase() === 'true';
  const checkMergeTypes = process.env.INPUT_CHECK_MERGE_TYPES.toLowerCase() === 'true';
  const allowMergeCommit = process.env.INPUT_ALLOW_MERGE_COMMIT.toLowerCase();
  const allowSquashMerge = process.env.INPUT_ALLOW_SQUASH_MERGE.toLowerCase();
  const allowRebaseMerge = process.env.INPUT_ALLOW_REBASE_MERGE.toLowerCase();
  const checkDiscussions = process.env.INPUT_CHECK_DISCUSSIONS.toLowerCase();
  const orgDiscussionsRepo = process.env.INPUT_ORG_DISCUSSIONS_REPO || '.github';
  const checkCommunityFiles = process.env.INPUT_CHECK_COMMUNITY_FILES.toLowerCase() === 'true';
  const checkReadme = process.env.INPUT_CHECK_README.toLowerCase() === 'true';
  const checkLicense = process.env.INPUT_CHECK_LICENSE.toLowerCase() === 'true';
  const checkCodeOfConduct = process.env.INPUT_CHECK_CODE_OF_CONDUCT.toLowerCase() === 'true';
  const checkContributing = process.env.INPUT_CHECK_CONTRIBUTING.toLowerCase() === 'true';
  const checkSecurity = process.env.INPUT_CHECK_SECURITY.toLowerCase() === 'true';
  const checkSponsors = process.env.INPUT_CHECK_SPONSORS.toLowerCase() === 'true';

  // Start the audit process
  console.log(`=== Repository Audit for ${githubOrg} ===\n`);

  // Fetch repositories
  let repositories;
  try {
    repositories = await fetchRepositories(github, githubOrg, includeArchived, includeForked, includePrivate, excludedRepos);
  } catch (error) {
    core.setFailed(`Failed to fetch repositories: ${error.message}`);
    return;
  }

  // Run audits
  if (checkDescription) {
    runAudit(core, repositories, 'Description', validateDescription);
  }

  if (checkSettings) {
    runAudit(core, repositories, 'Settings', validateSettings);
  }

  if (checkMergeTypes) {
    runAudit(core, repositories, 'Merge Types', (repo) => validateMergeTypes(repo, allowMergeCommit, allowSquashMerge, allowRebaseMerge));
  }

  if (checkDiscussions !== 'off') {
    runAudit(core, repositories, 'Discussions', (repo) => validateDiscussions(repo, checkDiscussions, orgDiscussionsRepo));
  }

  if (checkCommunityFiles) {
    runAudit(core, repositories, 'Community Health Files', (repo) => validateCommunityFiles(repo, checkReadme, checkLicense, checkCodeOfConduct, checkContributing, checkSecurity, checkSponsors));
  }
}

module.exports = auditRepositories;
