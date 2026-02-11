/**
 * Unit tests for pinact.js
 * @jest-environment node
 */

/* eslint-env jest */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');

// Mock child_process
jest.mock('node:child_process');

// Mock fs
jest.mock('node:fs');

// Mock https
jest.mock('node:https');

// Mock the GitHub Actions core, context, and GitHub objects
const mockCore = {
  setFailed: jest.fn(),
};

const mockContext = {
  repo: {
    owner: 'test-org',
  },
};

const mockGithub = {
  rest: {
    repos: {
      listForOrg: {
        endpoint: {
          merge: jest.fn(),
        },
      },
      listForUser: {
        endpoint: {
          merge: jest.fn(),
        },
      },
      get: jest.fn(),
    },
    pulls: {
      list: jest.fn(),
      create: jest.fn(),
    },
  },
  paginate: jest.fn(),
};

// Mock console methods
const originalConsoleLog = console.log;
let consoleOutput = [];

// Helper function to create a standard repository data object
function createRepoData(overrides = {}) {
  return {
    name: 'repo1',
    description: 'Test repository.',
    html_url: 'https://github.com/test-org/repo1',
    default_branch: 'master',
    archived: false,
    fork: false,
    ...overrides,
  };
}

// Helper function to create a standard repository list item
function createRepoListItem(overrides = {}) {
  return {
    name: 'repo1',
    archived: false,
    fork: false,
    private: false,
    ...overrides,
  };
}

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();
  consoleOutput = [];
  console.log = jest.fn((...args) => {
    consoleOutput.push(args.join(' '));
  });

  // Set default environment variables
  process.env.INPUT_DRY_RUN = 'false';
  process.env.INPUT_GIT_AUTHOR_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
  process.env.INPUT_GIT_AUTHOR_NAME = 'github-actions[bot]';
  process.env.INPUT_GITHUB_ORG = 'test-org';
  process.env.INPUT_PINACT_REPO = 'suzuki-shunsuke/pinact';
  process.env.INPUT_PINACT_VERSION = 'latest';
  process.env.INPUT_PR_BRANCH_NAME = 'pinact-updates';
  process.env.INPUT_REPO = '';
  process.env.GITHUB_TOKEN = 'test-token';

  // Setup default fs mocks
  fs.existsSync.mockReturnValue(true);
  fs.readdirSync.mockReturnValue(['workflow.yml']);
  fs.mkdtempSync.mockImplementation((prefix) => {
    if (prefix.includes('pinact-config-')) {
      return '.tmp/pinact-config-test';
    }
    return '.tmp/pinact-test';
  });
  fs.rmSync.mockImplementation(() => {});
  fs.writeFileSync.mockImplementation(() => {});

  // Setup default execSync mocks
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (command.includes('git status --porcelain')) {
      return '';  // No changes by default
    }
    if (command.includes('git diff')) {
      return '';  // No diff by default
    }
    return '';
  });

  // Setup default https.get mock for fetching latest release
  const mockResponse = {
    on: jest.fn((event, callback) => {
      if (event === 'data') {
        // Immediately call with mock data
        callback(JSON.stringify({
          tag_name: 'v3.9.0',
          name: 'v3.9.0',
          draft: false,
          prerelease: false
        }));
      } else if (event === 'end') {
        // Immediately call end
        callback();
      }
      return mockResponse;
    })
  };

  const mockRequest = {
    on: jest.fn(() => {
      // Don't call error callback by default
      return mockRequest;
    })
  };

  https.get.mockImplementation((options, callback) => {
    callback(mockResponse);
    return mockRequest;
  });
});

afterEach(() => {
  console.log = originalConsoleLog;
});

// Import the module after setting up mocks
const runPinactAction = require('../../actions/pinact/pinact.js');

// Helper functions to reduce code duplication

/**
 * Setup basic mocks for a successful action run with no repos
 */
function setupBasicMocks() {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([]);
}

/**
 * Setup execSync mock for repository with changes
 */
function setupExecSyncWithChanges() {
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (command.includes('git status --porcelain')) {
      return 'M .github/workflows/test.yml\n';
    }
    if (command.includes('git diff')) {
      return 'diff --git a/.github/workflows/test.yml';
    }
    return '';
  });
}

/**
 * Setup execSync mock for default branch detection with changes
 */
function setupExecSyncForDefaultBranch() {
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (command.includes('git status --porcelain')) {
      return 'M .github/workflows/test.yml\n';
    }
    return '';
  });
}

/**
 * Setup mocks for a single repository with changes
 */
function setupSingleRepoWithChanges() {
  setupExecSyncWithChanges();

  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([createRepoListItem()]);
  mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
  mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });
  mockGithub.rest.pulls.create.mockResolvedValue({
    data: { html_url: 'https://github.com/test-org/repo1/pull/1', number: 1 }
  });
}

/**
 * Setup mocks for a single repository without changes
 */
function setupSingleRepoNoChanges() {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([createRepoListItem()]);
  mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
  mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });
}

/**
 * Setup mocks for multiple repositories with changes
 */
function setupMultipleReposWithChanges() {
  setupExecSyncWithChanges();

  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([
    createRepoListItem({ name: 'repo1' }),
    createRepoListItem({ name: 'repo2' }),
  ]);
  mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
  mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });
  mockGithub.rest.pulls.create.mockResolvedValue({
    data: { html_url: 'https://github.com/test-org/repo1/pull/1' }
  });
}

/**
 * Setup mocks for error scenarios
 */
function setupErrorMocks(errorType) {
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (errorType === 'clone' && command.includes('git clone')) {
      throw new Error('Clone failed');
    }
    if (errorType === 'pinact' && command.includes('pinact') && command.includes('run') && !command.includes('go install')) {
      const error = new Error('Command failed: pinact run\nPinact execution failed');
      error.status = 1;
      throw error;
    }
    if (command.includes('git status') || command.includes('git config')) {
      return '';
    }
    return '';
  });
}

/**
 * Setup mocks for diff error
 */
function setupDiffErrorMocks() {
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (command.includes('git status --porcelain')) {
      return 'M .github/workflows/test.yml\n';
    }
    if (command.includes('git diff')) {
      throw new Error('Diff failed');
    }
    return '';
  });
}

/**
 * Setup GitHub mocks for single repo with various configurations
 */
function setupGitHubMocksForSingleRepo(options = {}) {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([createRepoListItem()]);
  mockGithub.rest.repos.get.mockResolvedValue({
    data: createRepoData(options.repoDataOverrides || {})
  });
  mockGithub.rest.pulls.list.mockResolvedValue({ data: options.existingPulls || [] });
  if (options.withPullCreate !== false) {
    mockGithub.rest.pulls.create.mockResolvedValue({
      data: { html_url: 'https://github.com/test-org/repo1/pull/1' }
    });
  }
}

/**
 * Run test with different platform
 */
async function runWithPlatform(platform, testFn) {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    await testFn();
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
}

/**
 * Verify execSync was called with git clone
 */
function expectGitClone(repoUrl) {
  expect(execSync).toHaveBeenCalledWith(
    expect.stringContaining('git clone ' + repoUrl),
    expect.any(Object)
  );
}

/**
 * Verify execSync was called with git checkout
 */
function expectGitCheckout(ref) {
  expect(execSync).toHaveBeenCalledWith(
    'git checkout ' + ref,
    expect.any(Object)
  );
}

/**
 * Verify execSync was called with go install ./cmd/pinact
 */
function expectGoInstallLocal() {
  expect(execSync).toHaveBeenCalledWith(
    'go install ./cmd/pinact',
    expect.any(Object)
  );
}

/**
 * Setup execSync mock for no changes
 */
function setupExecSyncNoChanges() {
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (command.includes('git status --porcelain')) {
      return '';  // No changes
    }
    return '';
  });
}

/**
 * Setup execSync mock with detailed diff output
 */
function setupExecSyncWithDetailedDiff() {
  execSync.mockImplementation((command) => {
    if (command.includes('go env GOPATH')) {
      return '/home/user/go\n';
    }
    if (command.includes('git status --porcelain')) {
      return 'M .github/workflows/test.yml\n';
    }
    if (command.includes('git diff')) {
      return 'diff --git a/.github/workflows/test.yml\n--- a/.github/workflows/test.yml\n+++ b/.github/workflows/test.yml';
    }
    return '';
  });
}

/**
 * Test default branch error with fake timers
 */
async function testDefaultBranchError(defaultBranchValue) {
  jest.useFakeTimers();

  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([createRepoListItem()]);

  const repoData = createRepoData();
  if (defaultBranchValue === 'DELETE') {
    delete repoData.default_branch;
  } else {
    repoData.default_branch = defaultBranchValue;
  }

  mockGithub.rest.repos.get.mockResolvedValue({ data: repoData });

  const actionPromise = runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

  await jest.runAllTimersAsync();
  await actionPromise;

  jest.useRealTimers();

  expect(mockGithub.rest.repos.get).toHaveBeenCalled();
}

/**
 * Setup and run test for repository filtering
 */
async function testRepositoryFiltering(repos, expectedCount, expectedMessage) {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue(repos);
  mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
  mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });

  await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

  expect(consoleOutput.some(line => line.includes('Found ' + expectedCount + ' repositories'))).toBe(true);
  if (expectedMessage) {
    expect(consoleOutput.some(line => line.includes(expectedMessage))).toBe(true);
  }
}

/**
 * Setup https.get mock to return specific response or error
 * @param {Object} options - Mock configuration
 * @param {string} options.responseData - JSON string to return in response
 * @param {Error} options.error - Error to throw
 */
function setupHttpsMock(options = {}) {
  if (options.error) {
    const mockRequest = {
      on: jest.fn((event, callback) => {
        if (event === 'error') {
          callback(options.error);
        }
        return mockRequest;
      })
    };
    https.get.mockImplementation(() => mockRequest);
  } else {
    const mockResponse = {
      on: jest.fn((event, callback) => {
        if (event === 'data') {
          callback(options.responseData);
        } else if (event === 'end') {
          callback();
        }
        return mockResponse;
      })
    };
    const mockRequest = {
      on: jest.fn(() => mockRequest)
    };
    https.get.mockImplementation((opts, callback) => {
      callback(mockResponse);
      return mockRequest;
    });
  }
}

describe('Pinact Action', () => {
  describe('Installation', () => {
    test('should install pinact with latest version', async () => {
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Should fetch latest release via https
      expect(https.get).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.github.com',
          path: '/repos/suzuki-shunsuke/pinact/releases/latest'
        }),
        expect.any(Function)
      );
      // Should install with resolved version (v3.9.0)
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('go install github.com/suzuki-shunsuke/pinact/cmd/pinact@v3.9.0'),
        expect.any(Object)
      );
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });

    test('should install pinact with specific version', async () => {
      process.env.INPUT_PINACT_VERSION = 'v1.2.3';
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('go install github.com/suzuki-shunsuke/pinact/cmd/pinact@v1.2.3'),
        expect.any(Object)
      );
    });

    test('should install pinact from custom repository', async () => {
      process.env.INPUT_PINACT_REPO = 'custom-org/pinact-fork';
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Should fetch latest release tag via https
      expect(https.get).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.github.com',
          path: '/repos/custom-org/pinact-fork/releases/latest'
        }),
        expect.any(Function)
      );
      // Custom repos should use clone and build, not go install
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git clone https://github.com/custom-org/pinact-fork.git'),
        expect.any(Object)
      );
      expect(execSync).toHaveBeenCalledWith(
        'go install ./cmd/pinact',
        expect.any(Object)
      );
    });

    test('should install pinact from custom repository with specific version', async () => {
      process.env.INPUT_PINACT_REPO = 'custom-org/pinact-fork';
      process.env.INPUT_PINACT_VERSION = 'v1.2.3';
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Custom repos should use clone and build even with standard version
      expectGitClone('https://github.com/custom-org/pinact-fork.git');
      expectGitCheckout('v1.2.3');
      expectGoInstallLocal();
    });

    test('should build from source for branch names', async () => {
      process.env.INPUT_PINACT_VERSION = 'feat/my-branch';
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expectGitClone('https://github.com/suzuki-shunsuke/pinact.git');
      expectGitCheckout('feat/my-branch');
      expectGoInstallLocal();
    });

    test('should build from source for commit hashes', async () => {
      process.env.INPUT_PINACT_VERSION = 'abc123def456';
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git clone'),
        expect.any(Object)
      );
      expectGitCheckout('abc123def456');
    });

    test('should handle installation failure', async () => {
      // Mock https.get to simulate network error
      setupHttpsMock({ error: new Error('Network error') });
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to install pinact')
      );
    });

    test('should handle invalid JSON response from GitHub API', async () => {
      // Mock https response with invalid JSON
      setupHttpsMock({ responseData: 'invalid json{' });
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to install pinact')
      );
    });

    test('should handle missing tag_name in GitHub API response', async () => {
      // Mock https response without tag_name
      setupHttpsMock({ responseData: JSON.stringify({ name: 'some release' }) });
      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to install pinact')
      );
    });

    test('should handle build from source failure and cleanup errors', async () => {
      process.env.INPUT_PINACT_VERSION = 'feat/my-branch';

      execSync.mockImplementation((command) => {
        if (command.includes('go env GOPATH')) {
          return '/home/user/go\n';
        }
        if (command.includes('git clone')) {
          return '';
        }
        if (command.includes('git checkout')) {
          throw new Error('Checkout failed');
        }
        return '';
      });

      // Make cleanup also fail
      let rmSyncCallCount = 0;
      fs.rmSync.mockImplementation(() => {
        rmSyncCallCount++;
        if (rmSyncCallCount === 1) {
          // First cleanup attempt (in catch block) should fail
          throw new Error('Cleanup failed');
        }
        // Other cleanup calls succeed
      });

      setupBasicMocks();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Checkout failed')
      );
      // Verify cleanup was attempted despite failing
      expect(fs.rmSync).toHaveBeenCalled();
    });

    test('should detect Windows platform for pinact binary path', async () => {
      setupBasicMocks();

      await runWithPlatform('win32', async () => {
        await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });
      });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('go install'),
        expect.any(Object)
      );
    });

    test('should detect non-Windows platform for pinact binary path', async () => {
      setupBasicMocks();

      await runWithPlatform('linux', async () => {
        await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });
      });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('go install'),
        expect.any(Object)
      );
    });

    test('should use context.repo.owner when INPUT_GITHUB_ORG is not set', async () => {
      delete process.env.INPUT_GITHUB_ORG;

      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Should use context.repo.owner (test-org)
      expect(consoleOutput.some(line => line.includes('test-org'))).toBe(true);

      // Restore INPUT_GITHUB_ORG
      process.env.INPUT_GITHUB_ORG = 'test-org';
    });

    test('should use INPUT_TOKEN when GITHUB_TOKEN is not set', async () => {
      delete process.env.GITHUB_TOKEN;
      process.env.INPUT_TOKEN = 'input-token-value';

      setupSingleRepoWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Verify token was used (check for git clone with token)
      const cloneCalls = execSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('git clone')
      );
      expect(cloneCalls.length).toBeGreaterThan(0);
      expect(cloneCalls[0][0]).toContain('x-access-token:');

      // Restore GITHUB_TOKEN
      process.env.GITHUB_TOKEN = 'test-token';
    });
  });

  describe('Repository Fetching', () => {
    test('should fetch repositories from organization', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        createRepoListItem({ name: 'repo1' }),
        createRepoListItem({ name: 'repo2' }),
      ]);
      mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
      mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.paginate).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Found 2 repositories'))).toBe(true);
    });

    test('should filter out archived repositories', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        createRepoListItem({ name: 'repo1', archived: false }),
        createRepoListItem({ name: 'repo2', archived: true }),
      ]);
      mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
      mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Found 1 repositories'))).toBe(true);
    });

    test('should filter out forked repositories by default', async () => {
      await testRepositoryFiltering(
        [
          createRepoListItem({ name: 'repo1', fork: false }),
          createRepoListItem({ name: 'repo2', fork: true }),
        ],
        1,
        'excluding archived and forked'
      );
    });

    test('should include forked repositories when includeForks is true', async () => {
      process.env.INPUT_INCLUDE_FORKS = 'true';

      await testRepositoryFiltering(
        [
          createRepoListItem({ name: 'repo1', fork: false }),
          createRepoListItem({ name: 'repo2', fork: true }),
        ],
        2,
        'excluding archived'
      );

      expect(consoleOutput.some(line => line.includes('excluding archived and forked'))).toBe(false);

      // Clean up
      delete process.env.INPUT_INCLUDE_FORKS;
    });

    test('should fallback to user repos if org fetch fails', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.status = 404;
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce([createRepoListItem()]);
      mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
      mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Not an organization'))).toBe(true);
    });
  });

  describe('Single Repository Mode', () => {
    test('should process specific repository when repo is specified', async () => {
      process.env.INPUT_REPO = 'test-org/specific-repo';
      mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData({ name: 'specific-repo' }) });
      mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Specific repository'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('specific-repo'))).toBe(true);
    });

    test('should handle invalid repo format', async () => {
      process.env.INPUT_REPO = 'invalid-format';

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid repo format')
      );
    });

    test('should use correct owner when repo is specified', async () => {
      process.env.INPUT_REPO = 'different-org/repo';
      mockGithub.rest.repos.get.mockResolvedValue({
        data: createRepoData({ name: 'repo' })
      });
      mockGithub.rest.pulls.list.mockResolvedValue({ data: [] });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('different-org/repo'))).toBe(true);
    });
  });

  describe('Workflow Detection', () => {
    test('should run pinact even without .github/workflows directory', async () => {
      fs.existsSync.mockReturnValue(false);
      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Pinact should run - it determines what files to process
      expect(consoleOutput.some(line => line.includes('Running pinact'))).toBe(true);
    });

    test('should process repository with yml workflows', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['workflow.yml', 'another.yml']);
      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Running pinact'))).toBe(true);
    });

    test('should process repository with yaml workflows', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['workflow.yaml']);
      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Running pinact'))).toBe(true);
    });
  });

  describe('Pinact Execution', () => {
    test('should skip PR creation when no changes are made', async () => {
      setupExecSyncNoChanges();
      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('No changes made by pinact'))).toBe(true);
      expect(mockGithub.rest.pulls.create).not.toHaveBeenCalled();
    });

    test('should create PR when changes are made', async () => {
      setupSingleRepoWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Pinact made changes'))).toBe(true);
      expect(mockGithub.rest.pulls.create).toHaveBeenCalled();
    });

    test('should use --config option when config is provided', async () => {
      const pinactConfig = 'files:\n  - pattern: \'*.ya?ml\'\nupdates:\n  - action: actions/checkout';

      process.env.INPUT_PINACT_CONFIG = pinactConfig;

      setupSingleRepoWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Verify config file was created in temp directory
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.pinact.yaml'),
        pinactConfig,
        'utf-8'
      );

      // Verify pinact was called with --config option
      const pinactCalls = execSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('pinact') && call[0].includes('run')
      );
      expect(pinactCalls.length).toBeGreaterThan(0);
      expect(pinactCalls[0][0]).toContain('--config');

      // Verify config file was cleaned up
      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('pinact-config-'),
        expect.objectContaining({ recursive: true, force: true })
      );
    });
  });

  describe('Git Operations', () => {
    test('should configure git with custom author', async () => {
      process.env.INPUT_GIT_AUTHOR_NAME = 'Custom Bot';
      process.env.INPUT_GIT_AUTHOR_EMAIL = 'bot@example.com';

      setupSingleRepoWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git config user.name "Custom Bot"'),
        expect.any(Object)
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git config user.email "bot@example.com"'),
        expect.any(Object)
      );
    });

    test('should create branch with custom name', async () => {
      process.env.INPUT_PR_BRANCH_NAME = 'custom-branch';

      setupSingleRepoWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git checkout -b custom-branch'),
        expect.any(Object)
      );
    });

    test('should commit with appropriate message', async () => {
      setupSingleRepoWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('chore: update GitHub Actions to use commit hashes'),
        expect.any(Object)
      );
    });
  });

  describe('Pull Request Creation', () => {
    beforeEach(() => {
      setupSingleRepoWithChanges();
    });

    test('should create PR when none exists', async () => {
      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-org',
          repo: 'repo1',
          head: 'pinact-updates',
          base: 'master',
          title: expect.stringContaining('chore: update GitHub Actions')
        })
      );
    });

    test('should not create duplicate PR if one exists', async () => {
      mockGithub.rest.pulls.list.mockResolvedValue({
        data: [{
          html_url: 'https://github.com/test-org/repo1/pull/1',
          number: 1
        }]
      });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.pulls.create).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Pull request already exists'))).toBe(true);
    });

    test('should use default branch when creating PR', async () => {

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          base: 'master'
        })
      );
    });
  });

  describe('Default Branch Detection', () => {
    test('should use detected default branch', async () => {
      setupExecSyncForDefaultBranch();
      setupGitHubMocksForSingleRepo({
        repoDataOverrides: { default_branch: 'main' }
      });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Default branch: main'))).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle repository processing errors gracefully', async () => {
      setupErrorMocks('clone');
      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Failed to process'))).toBe(true);
      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(mockCore.setFailed.mock.calls[0][0]).toContain('Failed to process');
    });

    test('should clean up temporary directory on error', async () => {
      setupErrorMocks('clone');
      setupSingleRepoNoChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('pinact-'),
        expect.objectContaining({ recursive: true, force: true })
      );
    });
  });

  describe('Summary Output', () => {
    test('should display summary with PR count', async () => {
      setupMultipleReposWithChanges();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Repositories processed: 2'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Pull requests created/updated: 2'))).toBe(true);
    });
  });

  describe('Dry Run Mode', () => {
    beforeEach(() => {
      process.env.INPUT_DRY_RUN = 'true';
      setupSingleRepoWithChanges();
    });

    test('should not push changes in dry run mode', async () => {
      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Dry Run Mode:') && line.includes('ENABLED'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('DRY RUN:') && line.includes('Would push'))).toBe(true);

      const pushCalls = execSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('git push')
      );
      expect(pushCalls).toHaveLength(0);
    });

    test('should not create PR in dry run mode', async () => {
      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('DRY RUN:') && line.includes('Would create PR'))).toBe(true);
      expect(mockGithub.rest.pulls.create).not.toHaveBeenCalled();
    });

    test('should display summary with dry run messaging', async () => {
      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Pull requests that would be created: 1'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('potential PRs'))).toBe(true);
    });

    test('should still show diff output in dry run mode', async () => {
      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Changes made by pinact'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('diff --git'))).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    test('should retry on rate limit error', async () => {
      const rateLimitError = new Error('rate limit exceeded');
      rateLimitError.status = 429;

      setupSingleRepoNoChanges();
      mockGithub.rest.repos.get
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: createRepoData() });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Rate limit hit'))).toBe(true);
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(2);
    });

    test('should retry on 403 rate limit error', async () => {
      const rateLimitError = new Error('You have exceeded a secondary rate limit');
      rateLimitError.status = 403;

      setupSingleRepoNoChanges();
      mockGithub.rest.repos.get
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: createRepoData() });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(2);
    });

    test('should use retry-after header when provided', async () => {
      jest.useFakeTimers();

      const rateLimitError = new Error('rate limit exceeded');
      rateLimitError.status = 429;
      rateLimitError.response = {
        headers: {
          'retry-after': '2' // 2 seconds
        }
      };

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([createRepoListItem()]);
      mockGithub.rest.repos.get
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: createRepoData() });

      const actionPromise = runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Fast-forward through the retry delay (2 seconds from retry-after header)
      await jest.advanceTimersByTimeAsync(2000);

      await actionPromise;

      jest.useRealTimers();

      expect(consoleOutput.some(line => line.includes('Rate limit hit, retrying in 2 seconds'))).toBe(true);
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(2);
    });

    test('should not retry non-rate-limit errors', async () => {
      const otherError = new Error('Not found');
      otherError.status = 404;

      process.env.INPUT_REPO = 'test-org/nonexistent';
      mockGithub.rest.repos.get.mockRejectedValue(otherError);

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Default Branch API Detection', () => {
    test('should use detected default branch from API', async () => {
      setupExecSyncWithChanges();
      setupGitHubMocksForSingleRepo({
        repoDataOverrides: { default_branch: 'main' }
      });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Default branch: main'))).toBe(true);
    });
  });

  describe('Diff Output', () => {
    test('should display diff when changes are made', async () => {
      setupExecSyncWithDetailedDiff();
      setupGitHubMocksForSingleRepo();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Changes made by pinact'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('diff --git'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('End of diff'))).toBe(true);
    });

    test('should handle diff errors gracefully', async () => {
      setupDiffErrorMocks();
      setupGitHubMocksForSingleRepo();

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Could not display diff'))).toBe(true);
    });
  });

  describe('Additional Error Coverage', () => {
    test('should handle pinact execution failure', async () => {
      setupErrorMocks('pinact');
      setupGitHubMocksForSingleRepo({ withPullCreate: false });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      const output = consoleOutput.join(' ');
      expect(output).toContain('Failed to process');
      expect(output).toContain('Failed to run pinact');
      expect(mockCore.setFailed).toHaveBeenCalled();
    });

    test('should handle findExistingPR error', async () => {
      setupExecSyncWithChanges();
      setupGitHubMocksForSingleRepo();
      mockGithub.rest.pulls.list.mockRejectedValue(new Error('API error'));

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Could not check for existing PRs'))).toBe(true);
    });

    test('should handle PR creation failure', async () => {
      setupExecSyncWithChanges();
      setupGitHubMocksForSingleRepo();
      mockGithub.rest.pulls.create.mockRejectedValue(new Error('PR creation failed'));

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Failed to process'))).toBe(true);
      expect(mockCore.setFailed).toHaveBeenCalled();
    });

    test('should handle non-404 errors when fetching repositories', async () => {
      const serverError = new Error('Server error');
      serverError.status = 500;

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockRejectedValue(serverError);

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(mockCore.setFailed.mock.calls[0][0]).toContain('Server error');
    });

    test('should handle cleanup failure after processing', async () => {
      setupExecSyncWithChanges();
      setupGitHubMocksForSingleRepo();

      // Make rmSync fail
      fs.rmSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Failed to clean up temporary directory'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Permission denied'))).toBe(true);
    });

    test('should throw last error after exhausting all retries', async () => {
      // Use fake timers to speed up retry delays
      jest.useFakeTimers();

      const rateLimitError = new Error('rate limit exceeded');
      rateLimitError.status = 429;

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([createRepoListItem()]);

      // Always fail with rate limit error
      let callCount = 0;
      mockGithub.rest.repos.get.mockImplementation(async () => {
        callCount++;
        throw rateLimitError;
      });

      // Start the action
      const actionPromise = runPinactAction({ github: mockGithub, context: mockContext, core: mockCore });

      // Fast-forward through all the retry delays
      // There are 3 retries with delays: 1s, 2s, 4s
      await jest.advanceTimersByTimeAsync(1000); // First retry
      await jest.advanceTimersByTimeAsync(2000); // Second retry
      await jest.advanceTimersByTimeAsync(4000); // Third retry

      // Wait for the action to complete
      await actionPromise;

      // Restore real timers
      jest.useRealTimers();

      // Should have called 4 times total (initial + 3 retries)
      expect(callCount).toBe(4);

      // Should log retry attempts
      const output = consoleOutput.join(' ');
      expect(output).toContain('Rate limit hit');
    });

    test('should throw error when default_branch is null', async () => {
      await testDefaultBranchError(null);
    });

    test('should throw error when default_branch is undefined', async () => {
      await testDefaultBranchError('DELETE');
    });

    test('should throw error when default_branch is empty string', async () => {
      await testDefaultBranchError('');
    });
  });
});
