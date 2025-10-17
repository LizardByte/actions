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

module.exports = {
  createMockContext,
  createMockGithub,
  createMockCore,
  setupConsoleMocks,
};
