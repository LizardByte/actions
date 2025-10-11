/**
 * Repository auditing script for GitHub Actions
 * This script fetches all repositories in an organization and runs various audits on them.
 */

module.exports = async ({ github, context, core }) => {
  // Parse inputs
  const githubOrg = process.env.INPUT_GITHUB_ORG || context.repo.owner;
  const includeArchived = process.env.INPUT_INCLUDE_ARCHIVED.toLowerCase() === 'true';
  const includeForked = process.env.INPUT_INCLUDE_FORKED.toLowerCase() === 'true';
  const excludedRepos = process.env.INPUT_EXCLUDED_REPOS
    .split(',')
    .map(repo => repo.trim())
    .filter(repo => repo.length > 0);
  const checkDescription = process.env.INPUT_CHECK_DESCRIPTION.toLowerCase() === 'true';
  const checkSettings = process.env.INPUT_CHECK_SETTINGS.toLowerCase() === 'true';

  /**
   * Report failures for a given check
   * @param {Object} core - GitHub Actions core object
   * @param {string} checkName - Name of the check being performed
   * @param {Array} failures - Array of failure objects with repo, html_url, and issues properties
   * @param {string} icon - Icon to display for failures (default: '❌')
   */
  function reportFailures(core, checkName, failures, icon = '❌') {
    if (failures.length > 0) {
      failures.forEach(failure => {
        console.log(`${icon} ${failure.repo}:`);
        failure.issues.forEach(issue => console.log(`   - ${issue}`));
        console.log(`   URL: ${failure.html_url}\n`);
      });
      core.setFailed(`${failures.length} ${checkName} check(s) failed. See logs above for details.`);
    } else {
      console.log(`\n✅ All ${checkName} checks passed!`);
    }
  }

  /**
   * Validate repository description
   * @param {Object} repo - Repository object
   * @returns {Array} Array of issue strings
   */
  function validateDescription(repo) {
    const issues = [];

    // Check if the description exists
    if (!repo.description) {
      issues.push('Missing description');
    } else {
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
   * Fetch all repositories from the organization or user
   * @param {Object} github - GitHub API object
   * @param {string} owner - Organization or username
   * @returns {Promise<Array>} Array of repository objects
   */
  async function fetchRepositories(github, owner) {
    console.log('=== Fetching Repositories ===\n');
    console.log(`Organization/User: ${owner}`);
    console.log(`Include Archived: ${includeArchived}`);
    console.log(`Include Forked: ${includeForked}`);
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
        // Not an org, try as a user
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

    // Filter excluded repos
    if (excludedRepos.length > 0) {
      repos = repos.filter(repo => !excludedRepos.includes(repo.name));
    }

    console.log(`Found ${repos.length} repositories to audit (${allRepos.length} total)\n`);

    // return repo data needed for validation
    return repos.map(repo => ({
      name: repo.name,
      description: repo.description || '',
      html_url: repo.html_url,
      has_issues: repo.has_issues,
      has_wiki: repo.has_wiki,
      has_projects: repo.has_projects,
      archived: repo.archived,
      fork: repo.fork
    }));
  }

  /**
   * Main audit function - fetches repos and runs all audits
   * @param {Object} github - GitHub API object
   * @param {Object} context - GitHub Actions context
   * @param {Object} core - GitHub Actions core object
   */
  async function auditRepositories(github, context, core) {
    // Fetch all repositories
    const repos = await fetchRepositories(github, githubOrg);

    if (repos.length === 0) {
      console.log('⚠️ No repositories found to audit.');
      return;
    }

    // Define all audits to run
    const audits = [];

    if (checkDescription) {
      audits.push({ name: 'Repository Descriptions', fn: validateDescription });
    }

    if (checkSettings) {
      audits.push({ name: 'Repository Settings', fn: validateSettings });
    }

    if (audits.length === 0) {
      console.log('⚠️ No audit checks are enabled. Enable at least one check.');
      return;
    }

    // Run all audits
    let hasFailures = false;
    for (const audit of audits) {
      try {
        runAudit(core, repos, audit.name, audit.fn);
      } catch (error) {
        // runAudit will set the failure, but we need to continue with other audits
        hasFailures = true;
      }
      console.log(''); // Add spacing between audit sections
    }

    // Summary
    console.log('=== Audit Summary ===');
    console.log(`Organization/User: ${githubOrg}`);
    console.log(`Total repositories audited: ${repos.length}`);
    console.log(`Total audits performed: ${audits.length}`);
    console.log(`Checks enabled: ${audits.map(a => a.name).join(', ')}`);
    console.log(`\nWorkflow completed. Check sections above for detailed results.`);
  }

  // Run the audit
  await auditRepositories(github, context, core);
};
