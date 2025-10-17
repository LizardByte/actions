/**
 * Shared test utilities for JavaScript tests
 */

/**
 * Create mock GitHub context object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object} Mock context object
 */
function createMockContext(owner = 'test-org', repo = 'test-repo') {
  return {
    repo: {
      owner,
      repo,
    },
  };
}

/**
 * Create mock GitHub API object
 * @returns {Object} Mock GitHub API object
 */
function createMockGithub() {
  return {
    rest: {
      repos: {
        listReleases: jest.fn(),
        getContent: jest.fn(),
        createOrUpdateFileContents: jest.fn(),
        deleteRelease: jest.fn(),
      },
      git: {
        createBlob: jest.fn(),
        createTree: jest.fn(),
        createCommit: jest.fn(),
        createRef: jest.fn(),
        deleteRef: jest.fn(),
      },
    },
    paginate: jest.fn(),
  };
}

/**
 * Create mock GitHub Actions core object
 * @returns {Object} Mock core object
 */
function createMockCore() {
  return {
    setFailed: jest.fn(),
    setOutput: jest.fn(),
  };
}

/**
 * Setup console mocking for tests
 * @returns {Object} Object with consoleOutput, consoleErrors arrays and restore function
 */
function setupConsoleMocks() {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const consoleOutput = [];
  const consoleErrors = [];

  console.log = jest.fn((...args) => {
    consoleOutput.push(args.join(' '));
  });

  console.error = jest.fn((...args) => {
    consoleErrors.push(args.join(' '));
  });

  return {
    consoleOutput,
    consoleErrors,
    restore: () => {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    },
  };
}

/**
 * Create a mock release object
 * @param {Object} options - Release options
 * @returns {Object} Mock release object
 */
function createMockRelease({
  tagName = 'v1.0.0',
  createdAt = '2024-01-01T00:00:00Z',
  body = '',
  htmlUrl = `https://github.com/test/repo/releases/tag/${tagName}`,
  prerelease = false,
  draft = false,
  id = null,
} = {}) {
  const release = {
    tag_name: tagName,
    created_at: createdAt,
    body,
    html_url: htmlUrl,
    prerelease,
    draft,
  };

  if (id !== null) {
    release.id = id;
  }

  return release;
}

/**
 * Create multiple mock releases
 * @param {Array} configs - Array of release configurations
 * @returns {Array} Array of mock release objects
 */
function createMockReleases(configs) {
  return configs.map(config => createMockRelease(config));
}

module.exports = {
  createMockContext,
  createMockGithub,
  createMockCore,
  setupConsoleMocks,
  createMockRelease,
  createMockReleases,
};
