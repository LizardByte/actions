/**
 * Shared test utilities for JavaScript tests
 */

import {
  jest,
  expect,
} from '@jest/globals';

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
    error: jest.fn(),
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

/**
 * Setup mocks for successful branch creation
 * @param {Object} mockGithub - Mock GitHub object
 * @param {Object} options - Options for mock setup
 */
function setupBranchCreationMocks(mockGithub, {
  blobSha = 'blob-sha',
  treeSha = 'tree-sha',
  commitSha = 'commit-sha',
} = {}) {
  mockGithub.rest.git.createBlob.mockResolvedValue({ data: { sha: blobSha } });
  mockGithub.rest.git.createTree.mockResolvedValue({ data: { sha: treeSha } });
  mockGithub.rest.git.createCommit.mockResolvedValue({ data: { sha: commitSha } });
  mockGithub.rest.git.createRef.mockResolvedValue({});
}

/**
 * Verify branch creation was called correctly
 * @param {Object} mockGithub - Mock GitHub object
 * @param {Object} options - Expected call parameters
 */
function verifyBranchCreation(mockGithub, {
  owner = 'test-org',
  repo = 'test-repo',
  content = 'test content',
  branch = 'changelog',
  filePath = 'CHANGELOG.md',
  blobSha = 'blob-sha-123',
  treeSha = 'tree-sha-456',
} = {}) {
  expect(mockGithub.rest.git.createBlob).toHaveBeenCalledWith({
    owner,
    repo,
    content,
    encoding: 'utf-8',
  });

  expect(mockGithub.rest.git.createTree).toHaveBeenCalledWith({
    owner,
    repo,
    tree: [{
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    }],
  });

  expect(mockGithub.rest.git.createCommit).toHaveBeenCalledWith({
    owner,
    repo,
    message: `chore: create ${filePath}`,
    tree: treeSha,
    parents: [],
  });

  expect(mockGithub.rest.git.createRef).toHaveBeenCalledWith({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: expect.any(String),
  });
}

/**
 * Setup mocks for cleanup/delete operations
 * @param {Object} mockGithub - Mock GitHub object
 */
function setupDeleteMocks(mockGithub) {
  mockGithub.rest.repos.listReleases.endpoint.merge.mockReturnValue({});
  mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
  mockGithub.rest.git.deleteRef.mockResolvedValue({});
}

/**
 * Verify delete operations were called
 * @param {Object} mockGithub - Mock GitHub object
 * @param {Object} expectations - What to expect
 */
function verifyDeleteCalls(mockGithub, {
  deleteReleaseCalls = 0,
  deleteTagCalls = 0,
} = {}) {
  if (deleteReleaseCalls > 0) {
    expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledTimes(deleteReleaseCalls);
  } else {
    expect(mockGithub.rest.repos.deleteRelease).not.toHaveBeenCalled();
  }

  if (deleteTagCalls > 0) {
    expect(mockGithub.rest.git.deleteRef).toHaveBeenCalledTimes(deleteTagCalls);
  } else {
    expect(mockGithub.rest.git.deleteRef).not.toHaveBeenCalled();
  }
}

/**
 * Setup environment variables for cleanup tests
 * @param {Object} options - Environment variable values
 */
function setupCleanupEnv({
  currentTag = 'v2024.1.5',
  keepLatest = '2',
  deleteTags = 'true',
  sleepDuration = '1',
  isDraft = 'false',
} = {}) {
  process.env.CURRENT_TAG = currentTag;
  process.env.KEEP_LATEST = keepLatest;
  process.env.DELETE_TAGS = deleteTags;
  process.env.SLEEP_DURATION = sleepDuration;
  process.env.IS_DRAFT = isDraft;
}

/**
 * Setup mocks for changelog generation workflow
 * @param {Object} mockGithub - Mock GitHub object
 * @param {Array} releases - Array of releases to return
 */
function setupChangelogWorkflow(mockGithub, releases = []) {
  mockGithub.rest.repos.listReleases.mockResolvedValue({ data: releases });
  setupBranchCreationMocks(mockGithub);
}

module.exports = {
  createMockContext,
  createMockGithub,
  createMockCore,
  setupConsoleMocks,
  createMockRelease,
  createMockReleases,
  setupBranchCreationMocks,
  verifyBranchCreation,
  setupDeleteMocks,
  verifyDeleteCalls,
  setupCleanupEnv,
  setupChangelogWorkflow,
};
