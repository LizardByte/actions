/**
 * Pinact automation script for GitHub Actions
 * This script runs pinact on repositories to update GitHub Actions to use commit hashes.
 */

const { execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

/**
 * Validate that a string is safe for use in shell commands
 * Only allows alphanumeric characters, dots, hyphens, underscores, and forward slashes
 * @param {string} value - Value to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateSafeString(value, fieldName) {
  // Allow word characters (alphanumeric + underscore), dots, hyphens, and forward slashes
  // \w = [a-zA-Z0-9_], then add ., /, and - (hyphen at the end is literal)
  if (!/^[\w./-]+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Contains unsafe characters.`);
  }
  return true;
}

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

/**
 * Logger class for colored console output
 */
class Logger {
  /**
   * Colorize text with the given color codes
   * @param {string} text - Text to colorize
   * @param {string} colorCode - ANSI color code
   * @returns {string} Colorized text
   */
  static colorize(text, colorCode) {
    return colorCode + text + colors.reset;
  }

  /**
   * Log a header message
   * @param {string} message - Message to log
   */
  static header(message) {
    const coloredMsg = this.colorize(message, colors.bright + colors.cyan);
    console.log(coloredMsg);
  }

  /**
   * Log a success message
   * @param {string} message - Message to log
   */
  static success(message) {
    const coloredMsg = this.colorize(message, colors.green);
    console.log(coloredMsg);
  }

  /**
   * Log an error message
   * @param {string} message - Message to log
   */
  static error(message) {
    const coloredMsg = this.colorize(message, colors.red);
    console.log(coloredMsg);
  }

  /**
   * Log a warning message
   * @param {string} message - Message to log
   */
  static warning(message) {
    const coloredMsg = this.colorize(message, colors.yellow);
    console.log(coloredMsg);
  }

  /**
   * Log an info message
   * @param {string} message - Message to log
   */
  static info(message) {
    const coloredMsg = this.colorize(message, colors.blue);
    console.log(coloredMsg);
  }

  /**
   * Log a plain message
   * @param {string} message - Message to log
   */
  static log(message) {
    console.log(message);
  }
}

/**
 * Execute a shell command and return the output
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {string} Command output
 */
function execCommand(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', ...options });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

// Cache for executable paths
const executablePaths = {};

/**
 * Find the full path to an executable
 * @param {string} executable - Executable name (e.g., 'git', 'go')
 * @returns {string} Full path to executable
 */
function findExecutable(executable) {
  // Return cached path if available
  if (executablePaths[executable]) {
    return executablePaths[executable];
  }

  try {
    // Use 'where' on Windows, 'which' on Unix-like systems
    const command = process.platform === 'win32' ? 'where' : 'which';
    const result = execCommand(`${command} ${executable}`);

    // On Windows, 'where' might return multiple paths, take the first one
    const execPath = result.split('\n')[0].trim();

    // Cache the result
    executablePaths[executable] = execPath;
    return execPath;
  } catch (error) {
    throw new Error(`Could not find ${executable} executable in PATH: ${error.message}`);
  }
}

/**
 * Fetch the latest release tag from GitHub
 * @param {string} repo - Repository in format owner/repo
 * @returns {Promise<string>} Latest release tag
 */
async function fetchLatestReleaseTag(repo) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: {
        'User-Agent': 'LizardByte-Actions-Pinact',
        'Accept': 'application/vnd.github+json'
      }
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const release = JSON.parse(data);

          if (!release.tag_name) {
            reject(new Error('No tag_name found in release data'));
            return;
          }

          // Validate tag_name to prevent command injection
          try {
            validateSafeString(release.tag_name, 'tag_name');
          } catch (error) {
            reject(error);
            return;
          }

          Logger.info('Latest release: ' + release.tag_name);
          resolve(release.tag_name);
        } catch (error) {
          reject(new Error('Failed to parse release data: ' + error.message));
        }
      });
    }).on('error', (error) => {
      reject(new Error('Failed to fetch latest release: ' + error.message));
    });
  });
}

/**
 * Install pinact
 * @param {string} pinactRepo - Repository to install from (format: owner/repo)
 * @param {string} pinactVersion - Version to install (tag, commit hash, or 'latest')
 * @returns {Promise<string>} Path to pinact binary
 */
async function installPinact(pinactRepo, pinactVersion) {
  Logger.log('');
  Logger.header('=== Installing pinact ===');
  Logger.log('Repository: ' + pinactRepo);
  Logger.log('Version: ' + pinactVersion);
  Logger.log('');

  try {
    // Validate inputs to prevent command injection
    validateSafeString(pinactRepo, 'pinactRepo');
    validateSafeString(pinactVersion, 'pinactVersion');

    // Find git and go executables once with full paths for security
    // These are cached in executablePaths for reuse throughout the action
    executablePaths.go = findExecutable('go');
    executablePaths.git = findExecutable('git');

    // Use the found go executable to get GOPATH
    const gopath = execFileSync(executablePaths.go, ['env', 'GOPATH'], { encoding: 'utf-8' }).trim();
    const pinactPath = path.join(gopath, 'bin', process.platform === 'win32' ? 'pinact.exe' : 'pinact');

    // Resolve 'latest' to actual version tag
    let actualVersion = pinactVersion;
    if (pinactVersion === 'latest') {
      actualVersion = await fetchLatestReleaseTag(pinactRepo);
      Logger.log('');
    }

    // Check if this is using a custom repo or non-standard version
    const isDefaultRepo = pinactRepo === 'suzuki-shunsuke/pinact';
    const isStandardVersion = /^v?\d+\.\d+\.\d+/.test(actualVersion);

    // Only use go install for default repo with standard versions
    if (isDefaultRepo && isStandardVersion) {
      // Use the module path (not package path) with version for go install
      const installUrl = 'github.com/' + pinactRepo + '@' + actualVersion;
      execFileSync(executablePaths.go, ['install', installUrl + '/cmd/pinact'], { stdio: 'inherit' });
    } else {
      // For custom repos, branches, or commit hashes, clone and build manually
      Logger.info('Building from source (repo: ' + pinactRepo + ', version: ' + actualVersion + ')...');
      Logger.log('');

      const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pinact-build-'));
      const repoPath = path.join(tmpDir, 'pinact');

      try {
        // Clone the repository using execFileSync
        const cloneUrl = 'https://github.com/' + pinactRepo + '.git';
        execFileSync(executablePaths.git, ['clone', cloneUrl, repoPath], { stdio: 'inherit' });

        // Checkout the specific version (branch or commit)
        execFileSync(executablePaths.git, ['checkout', actualVersion], { cwd: repoPath, stdio: 'inherit' });

        // Build and install
        execFileSync(executablePaths.go, ['install', './cmd/pinact'], { cwd: repoPath, stdio: 'inherit' });
      } finally {
        // Clean up
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    Logger.success('✅ Pinact installed at: ' + pinactPath);
    Logger.log('');
    return pinactPath;
  } catch (error) {
    throw new Error('Failed to install pinact: ' + error.message);
  }
}

/**
 * Run pinact on a repository
 * @param {string} pinactPath - Path to pinact binary
 * @param {string} repoPath - Path to the cloned repository
 * @param {string} pinactConfigPath - Optional path to pinact configuration file
 * @returns {boolean} True if changes were made
 */
function runPinact(pinactPath, repoPath, pinactConfigPath = '') {
  Logger.log('Running pinact on repository...');

  try {
    // Run pinact with the 'run' command, optionally with --config
    const pinactArgs = ['run'];
    if (pinactConfigPath) {
      pinactArgs.push('--config', pinactConfigPath);
    }
    execFileSync(pinactPath, pinactArgs, { cwd: repoPath, stdio: 'inherit' });

    // Check if there are any changes
    const status = execFileSync(executablePaths.git, ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8' }).trim();

    if (status) {
      Logger.success('✅ Pinact made changes to workflow files');
      Logger.log('');

      // Show the diff with color
      Logger.header('=== Changes made by pinact ===');
      Logger.log('');
      try {
        const diff = execFileSync(executablePaths.git, ['diff', '--color=always', '.github/workflows'], { cwd: repoPath, encoding: 'utf-8' });
        Logger.log(diff);
      } catch (diffError) {
        Logger.warning('⚠️  Could not display diff: ' + diffError.message);
      }
      Logger.header('=== End of diff ===');
      Logger.log('');

      return true;
    } else {
      Logger.info('ℹ️  No changes made by pinact');
      Logger.log('');
      return false;
    }
  } catch (error) {
    throw new Error('Failed to run pinact: ' + error.message);
  }
}

/**
 * Configure git for commits
 * @param {string} repoPath - Path to the repository
 * @param {string} authorName - Git author name
 * @param {string} authorEmail - Git author email
 */
function configureGit(repoPath, authorName, authorEmail) {
  execFileSync(executablePaths.git, ['config', 'user.name', authorName], { cwd: repoPath });
  execFileSync(executablePaths.git, ['config', 'user.email', authorEmail], { cwd: repoPath });
}

/**
 * Create a branch, commit changes, and push
 * @param {string} repoPath - Path to the repository
 * @param {Object} options - Commit and push options
 * @param {string} options.branchName - Name of the branch to create
 * @param {string} options.authorName - Git author name
 * @param {string} options.authorEmail - Git author email
 * @param {boolean} options.dryRun - Whether this is a dry run
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} options.token - GitHub token for authentication
 */
function commitAndPush(repoPath, options) {
  const { branchName, authorName, authorEmail, dryRun, owner, repo, token } = options;

  Logger.log('Creating branch and committing changes...');

  configureGit(repoPath, authorName, authorEmail);

  // Create and checkout new branch
  execFileSync(executablePaths.git, ['checkout', '-b', branchName], { cwd: repoPath });

  // Add all changes
  execFileSync(executablePaths.git, ['add', '.github/workflows'], { cwd: repoPath });

  // Commit changes
  const commitMessage = 'chore: update GitHub Actions to use commit hashes';
  execFileSync(executablePaths.git, ['commit', '-m', commitMessage], { cwd: repoPath });

  if (dryRun) {
    Logger.info('🔍 DRY RUN: Would push to branch: ' + branchName + ' (skipping)');
    Logger.log('');
  } else {
    // Set remote URL with token to ensure authentication works
    // Security Note: Token is from GitHub Actions secrets, used only for authentication
    // It's passed via URL which is necessary for git authentication but not logged
    const repoUrl = 'https://x-access-token:' + token + '@github.com/' + owner + '/' + repo + '.git';
    execFileSync(executablePaths.git, ['remote', 'set-url', 'origin', repoUrl], { cwd: repoPath });

    // Push branch
    execFileSync(executablePaths.git, ['push', '-u', 'origin', branchName], { cwd: repoPath });
    Logger.success('✅ Changes committed and pushed to branch: ' + branchName);
    Logger.log('');
  }
}

/**
 * Check if a pull request already exists
 * @param {Object} github - GitHub API object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - Branch name to check
 * @returns {Promise<Object|null>} Existing PR or null
 */
async function findExistingPR(github, owner, repo, branchName) {
  try {
    const { data: pulls } = await retryWithBackoff(async () => {
      return await github.rest.pulls.list({
        owner: owner,
        repo: repo,
        state: 'open',
        head: owner + ':' + branchName
      });
    });

    return pulls.length > 0 ? pulls[0] : null;
  } catch (error) {
    Logger.warning('⚠️  Could not check for existing PRs: ' + error.message);
    return null;
  }
}

/**
 * Create a pull request
 * @param {Object} github - GitHub API object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - Branch name
 * @param {string} defaultBranch - Default branch name
 * @param {boolean} dryRun - Whether this is a dry run
 * @returns {Promise<Object>} Created pull request
 */
async function createPullRequest(github, owner, repo, branchName, defaultBranch, dryRun) {
  Logger.log('Creating pull request...');

  if (dryRun) {
    Logger.info('🔍 DRY RUN: Would create PR from ' + branchName + ' to ' + defaultBranch + ' (skipping)');
    Logger.log('');
    return { html_url: 'dry-run-mode', number: 0 };
  }

  // Check if PR already exists
  const existingPR = await findExistingPR(github, owner, repo, branchName);

  if (existingPR) {
    Logger.info('ℹ️  Pull request already exists: ' + existingPR.html_url);
    Logger.log('');
    return existingPR;
  }

  const title = 'chore: update GitHub Actions to use commit hashes';
  const body = `This PR updates GitHub Actions to use commit hashes instead of tags for improved security.

Changes were automatically generated by [pinact](https://github.com/suzuki-shunsuke/pinact)
and the LizardByte/actions [pinact action](https://github.com/LizardByte/actions/tree/master/actions/pinact).

## Benefits
- Prevents tag hijacking attacks
- Ensures immutable action versions
- Improves security posture

Please review the changes before merging.`;

  try {
    const { data: pr } = await github.rest.pulls.create({
      owner: owner,
      repo: repo,
      title: title,
      body: body,
      head: branchName,
      base: defaultBranch
    });

    Logger.success('✅ Pull request created: ' + pr.html_url);
    Logger.log('');
    return pr;
  } catch (error) {
    throw new Error('Failed to create pull request: ' + error.message);
  }
}

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<*>} Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a rate limit error
      const isRateLimit = error.status === 429 ||
                         error.status === 403 && error.message.includes('rate limit');

      if (isRateLimit && attempt < maxRetries) {
        // Get retry-after header if available
        const retryAfter = error.response?.headers['retry-after'];
        const delay = retryAfter ? Number.parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, attempt);

        const seconds = delay / 1000;
        const attemptInfo = '(attempt ' + (attempt + 1) + '/' + maxRetries + ')';
        Logger.warning('⚠️  Rate limit hit, retrying in ' + seconds + ' seconds... ' + attemptInfo);
        await sleep(delay);
        continue;
      }

      // For non-rate-limit errors, don't retry
      if (!isRateLimit) {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * Get the default branch for a repository
 * @param {Object} github - GitHub API object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<string>} Default branch name
 */
async function getDefaultBranch(github, owner, repo) {
  const { data: repository } = await retryWithBackoff(async () => {
    return await github.rest.repos.get({
      owner: owner,
      repo: repo
    });
  });

  if (!repository.default_branch) {
    throw new Error('Could not determine default branch for ' + owner + '/' + repo);
  }

  return repository.default_branch;
}

/**
 * Clone a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} token - GitHub token
 * @param {string} targetPath - Path to clone to
 * @param {string} defaultBranch - Default branch to checkout
 */
function cloneRepository(owner, repo, token, targetPath, defaultBranch) {
  Logger.log('Cloning repository ' + owner + '/' + repo + '...');

  const repoUrl = 'https://x-access-token:' + token + '@github.com/' + owner + '/' + repo + '.git';
  execFileSync(executablePaths.git, ['clone', '--depth', '1', '--branch', defaultBranch, repoUrl, targetPath], { stdio: 'inherit' });

  Logger.success('✅ Repository cloned');
  Logger.log('');
}

/**
 * Process a single repository
 * @param {Object} github - GitHub API object
 * @param {Object} options - Processing options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} options.token - GitHub token
 * @param {string} options.pinactPath - Path to pinact binary
 * @param {string} options.pinactConfigPath - Optional path to pinact configuration file
 * @param {string} options.branchName - Branch name for PR
 * @param {string} options.authorName - Git author name
 * @param {string} options.authorEmail - Git author email
 * @param {boolean} options.dryRun - Whether this is a dry run
 * @returns {Promise<Object>} Result object with success, prCreated, and error properties
 */
async function processRepository(github, options) {
  const { owner, repo, token, pinactPath, pinactConfigPath, branchName, authorName, authorEmail, dryRun } = options;
  Logger.log('');
  Logger.header('=== Processing ' + owner + '/' + repo + ' ===');
  Logger.log('');

  // Get default branch
  const defaultBranch = await getDefaultBranch(github, owner, repo);
  Logger.log('Default branch: ' + defaultBranch);
  Logger.log('');

  // Create temporary directory for cloning
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pinact-'));
  const repoPath = path.join(tmpDir, repo);

  try {
    // Clone repository
    cloneRepository(owner, repo, token, repoPath, defaultBranch);

    // Run pinact
    const hasChanges = runPinact(pinactPath, repoPath, pinactConfigPath);

    if (hasChanges) {
      // Commit and push changes
      commitAndPush(repoPath, {
        branchName,
        authorName,
        authorEmail,
        dryRun,
        owner,
        repo,
        token
      });

      // Create pull request
      await createPullRequest(github, owner, repo, branchName, defaultBranch, dryRun);

      return { success: true, prCreated: true };
    } else {
      Logger.log('No changes needed for ' + owner + '/' + repo);
      Logger.log('');
      return { success: true, prCreated: false };
    }
  } catch (error) {
    Logger.error('❌ Failed to process ' + owner + '/' + repo + ': ' + error.message);
    Logger.log('');
    return { success: false, prCreated: false, error: error.message };
  } finally {
    // Clean up temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
      Logger.warning('⚠️  Failed to clean up temporary directory: ' + error.message);
    }
  }
}

/**
 * Fetch all repositories from the organization
 * @param {Object} github - GitHub API object
 * @param {string} owner - Organization or username
 * @param {boolean} includeForks - Whether to include forked repositories
 * @returns {Promise<Array>} Array of repository objects
 */
async function fetchRepositories(github, owner, includeForks = false) {
  Logger.log('');
  Logger.header('=== Fetching repositories from ' + owner + ' ===');
  Logger.log('');

  // Try to fetch as org first, fall back to user repos
  let allRepos;
  try {
    const opts = github.rest.repos.listForOrg.endpoint.merge({
      org: owner,
      per_page: 100
    });
    allRepos = await retryWithBackoff(async () => {
      return await github.paginate(opts);
    });
  } catch (error) {
    if (error.status === 404) {
      // Not an org, try as user
      Logger.info('Not an organization, trying as user...');
      Logger.log('');
      const opts = github.rest.repos.listForUser.endpoint.merge({
        username: owner,
        per_page: 100
      });
      allRepos = await retryWithBackoff(async () => {
        return await github.paginate(opts);
      });
    } else {
      throw error;
    }
  }

  // Filter out archived repos, and optionally forked repos
  const repos = includeForks
    ? allRepos.filter(repo => !repo.archived)
    : allRepos.filter(repo => !repo.archived && !repo.fork);

  const repoCount = repos.length;
  const totalCount = allRepos.length;
  const excludedTypes = includeForks ? 'archived' : 'archived and forked';
  Logger.log('Found ' + repoCount + ' repositories to process (' + totalCount + ' total, excluding ' + excludedTypes + ')');
  Logger.log('');

  return repos.map(repo => repo.name);
}

/**
 * Setup pinact configuration
 * @param {string} pinactConfig - Pinact configuration YAML content
 * @returns {string} Path to config file if created, empty string otherwise
 */
function setupPinactConfig(pinactConfig) {
  if (!pinactConfig) {
    return '';
  }

  const configDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pinact-config-'));
  const pinactConfigPath = path.join(configDir, '.pinact.yaml');
  fs.writeFileSync(pinactConfigPath, pinactConfig, 'utf-8');
  Logger.success('Created pinact configuration file at ' + pinactConfigPath);
  Logger.log('');
  return pinactConfigPath;
}

/**
 * Determine which repositories to process
 * @param {string} repo - Specific repository (owner/repo format)
 * @param {Object} github - GitHub API object
 * @param {string} githubOrg - Organization or user
 * @param {boolean} includeForks - Whether to include forked repositories
 * @param {Object} core - GitHub Actions core object
 * @returns {Promise<Object>} Object with owner and repos array
 */
async function determineRepositories(repo, github, githubOrg, includeForks, core) {
  // Normalize repo input - handle cases like "owner/" or just "owner"
  const normalizedRepo = repo ? repo.trim() : '';

  if (normalizedRepo && normalizedRepo !== githubOrg && normalizedRepo !== githubOrg + '/') {
    // Process single repository
    const parts = normalizedRepo.split('/');

    // Handle case where repo is in format "owner/" with empty repo name
    if (parts.length === 2 && !parts[1]) {
      Logger.warning('⚠️  Repo input appears to be incomplete: "' + normalizedRepo + '". Processing all repositories instead.');
      Logger.log('');
      const repos = await fetchRepositories(github, githubOrg, includeForks);
      return { owner: githubOrg, repos: repos };
    }

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      core.setFailed('Invalid repo format: "' + normalizedRepo + '". Expected format: owner/repo');
      return null;
    }

    // Validate owner and repo names
    try {
      validateSafeString(parts[0], 'repository owner');
      validateSafeString(parts[1], 'repository name');
    } catch (error) {
      core.setFailed(error.message);
      return null;
    }

    return { owner: parts[0], repos: [parts[1]] };
  } else {
    // Process all repositories in org
    const repos = await fetchRepositories(github, githubOrg, includeForks);
    return { owner: githubOrg, repos: repos };
  }
}

/**
 * Process all repositories
 * @param {Object} github - GitHub API object
 * @param {Array} repos - Array of repository names
 * @param {string} owner - Repository owner
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Results and errors
 */
async function processAllRepositories(github, repos, owner, options) {
  const results = [];
  const errors = [];

  for (const repoName of repos) {
    const result = await processRepository(github, {
      owner,
      repo: repoName,
      ...options
    });

    if (result.prCreated) {
      results.push(repoName);
    }

    if (!result.success) {
      errors.push({ repo: repoName, error: result.error });
    }
  }

  return { results, errors };
}

/**
 * Print action configuration
 * @param {Object} config - Configuration object
 */
function printActionConfig(config) {
  Logger.header('=== Pinact Action ===');
  Logger.log('');
  const dryRunStatus = config.dryRun ? 'ENABLED' : 'DISABLED';
  Logger.log('Dry Run Mode: ' + (config.dryRun ? Logger.colorize(dryRunStatus, colors.blue) : dryRunStatus));
  Logger.log('Git Author: ' + config.gitAuthorName + ' <' + config.gitAuthorEmail + '>');
  Logger.log('PR Branch Name: ' + config.prBranchName);
  Logger.log('Pinact Repository: ' + config.pinactRepo);
  Logger.log('Pinact Version: ' + config.pinactVersion);
  if (config.pinactConfig) {
    const lineCount = config.pinactConfig.split('\n').length;
    Logger.log('Pinact Config: Provided (' + lineCount + ' lines)');
  }

  if (config.repo) {
    Logger.log('Target: Specific repository (' + config.repo + ')');
  } else {
    Logger.log('Target: All repositories in ' + config.githubOrg);
  }
}

/**
 * Print summary
 * @param {number} totalRepos - Total repositories processed
 * @param {Array} results - Results array
 * @param {Array} errors - Errors array
 * @param {string} owner - Repository owner
 * @param {boolean} dryRun - Whether this is a dry run
 */
function printSummary(totalRepos, results, errors, owner, dryRun) {
  Logger.log('');
  Logger.header('=== Summary ===');
  Logger.log('');
  Logger.log('Repositories processed: ' + totalRepos);
  if (dryRun) {
    Logger.log('Pull requests that would be created: ' + results.length);
  } else {
    Logger.log('Pull requests created/updated: ' + results.length);
  }

  if (results.length > 0) {
    const prType = dryRun ? 'potential ' : '';
    Logger.log('');
    Logger.log('Repositories with ' + prType + 'PRs:');
    for (const repoName of results) {
      Logger.log('  - ' + owner + '/' + repoName);
    }
  }

  if (errors.length > 0) {
    Logger.log('');
    Logger.error('❌ Errors occurred in ' + errors.length + ' repository(ies):');
    for (const { repo, error } of errors) {
      Logger.log('  - ' + owner + '/' + repo + ': ' + error);
    }
  }
}

/**
 * Cleanup pinact configuration
 * @param {string} pinactConfigPath - Path to config file
 */
function cleanupPinactConfig(pinactConfigPath) {
  if (!pinactConfigPath) {
    return;
  }

  try {
    const configDir = path.dirname(pinactConfigPath);
    fs.rmSync(configDir, { recursive: true, force: true });
  } catch (error) {
    Logger.warning('⚠️  Failed to clean up config directory: ' + error.message);
  }
}

/**
 * Main function
 */
async function runPinactAction({ github, context, core }) {
  // Parse inputs
  const dryRun = process.env.INPUT_DRY_RUN === 'true';
  const gitAuthorEmail = process.env.INPUT_GIT_AUTHOR_EMAIL;
  const gitAuthorName = process.env.INPUT_GIT_AUTHOR_NAME;
  const githubOrg = process.env.INPUT_GITHUB_ORG || context.repo.owner;
  const includeForks = process.env.INPUT_INCLUDE_FORKS === 'true';
  const pinactConfig = process.env.INPUT_PINACT_CONFIG || '';
  const pinactRepo = process.env.INPUT_PINACT_REPO;
  const pinactVersion = process.env.INPUT_PINACT_VERSION;
  const prBranchName = process.env.INPUT_PR_BRANCH_NAME;
  const repo = process.env.INPUT_REPO;
  const token = process.env.PINACT_GITHUB_TOKEN || process.env.INPUT_TOKEN || process.env.GITHUB_TOKEN;

  printActionConfig({
    dryRun,
    gitAuthorEmail,
    gitAuthorName,
    githubOrg,
    pinactConfig,
    pinactRepo,
    pinactVersion,
    prBranchName,
    repo
  });

  try {
    // Install pinact
    const pinactPath = await installPinact(pinactRepo, pinactVersion);

    // Create config file if config is provided
    const pinactConfigPath = setupPinactConfig(pinactConfig);

    // Determine which repositories to process
    const repoInfo = await determineRepositories(repo, github, githubOrg, includeForks, core);
    if (!repoInfo) {
      return; // Error already set by determineRepositories
    }

    const { owner, repos: reposToProcess } = repoInfo;

    // Process each repository
    const { results, errors } = await processAllRepositories(github, reposToProcess, owner, {
      token,
      pinactPath,
      pinactConfigPath,
      branchName: prBranchName,
      authorName: gitAuthorName,
      authorEmail: gitAuthorEmail,
      dryRun
    });

    // Print summary
    printSummary(reposToProcess.length, results, errors, owner, dryRun);

    if (errors.length > 0) {
      core.setFailed('Failed to process ' + errors.length + ' repository(ies). See logs for details.');
      return;
    }

    Logger.log('');
    Logger.success('✅ Pinact action completed successfully!');

    // Clean up config file if it was created
    cleanupPinactConfig(pinactConfigPath);
  } catch (error) {
    core.setFailed('Pinact action failed: ' + error.message);
  }
}

module.exports = runPinactAction;
