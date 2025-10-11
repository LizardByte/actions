/**
 * Unit tests for audit.js
 * @jest-environment node
 */

/* eslint-env jest */

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
      getContent: jest.fn(),
      getCommunityProfileMetrics: jest.fn(),
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
    description: 'Valid description.',
    html_url: 'https://github.com/test-org/repo1',
    has_issues: true,
    fork: false,
    allow_merge_commit: false,
    allow_squash_merge: true,
    allow_rebase_merge: false,
    has_discussions: false,
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

// Helper function to setup standard mocks for a successful test
function setupStandardMocks(repoData = {}, communityFiles = {}, repoListItem = {}) {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([createRepoListItem(repoListItem)]);
  mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData(repoData) });
  mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
    data: { files: communityFiles },
  });
  mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });
}

// Helper function to run audit and check for success
async function expectAuditSuccess(checkName) {
  await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
  expect(mockCore.setFailed).not.toHaveBeenCalled();
  if (checkName) {
    expect(consoleOutput.some(line => line.includes(`✅ All ${checkName} checks passed!`))).toBe(true);
  }
}

// Helper function to run audit and check for failure
async function expectAuditFailure(expectedMessage) {
  await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
  expect(mockCore.setFailed).toHaveBeenCalled();
  if (expectedMessage) {
    expect(consoleOutput.some(line => line.includes(expectedMessage))).toBe(true);
  }
}

// Helper function to setup mocks for repository filtering tests
function setupFilteringMocks(repoList) {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue(repoList);
  mockGithub.rest.repos.get.mockResolvedValue({ data: createRepoData() });
  mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({ data: { files: {} } });
  mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });
}

// Helper function to setup mocks for forked repository tests
function setupForkedRepoMocks(repoName = 'forked-repo') {
  mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
  mockGithub.paginate.mockResolvedValue([
    createRepoListItem({ name: repoName, fork: true }),
  ]);
  mockGithub.rest.repos.get.mockResolvedValue({
    data: createRepoData({ name: repoName, fork: true }),
  });
  mockGithub.rest.repos.getCommunityProfileMetrics.mockRejectedValueOnce({ status: 404 });
}

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();
  consoleOutput = [];
  console.log = jest.fn((...args) => {
    consoleOutput.push(args.join(' '));
  });

  // Set default environment variables
  process.env.INPUT_GITHUB_ORG = 'test-org';
  process.env.INPUT_INCLUDE_ARCHIVED = 'false';
  process.env.INPUT_INCLUDE_FORKED = 'false';
  process.env.INPUT_INCLUDE_PRIVATE = 'false';
  process.env.INPUT_EXCLUDED_REPOS = '';
  process.env.INPUT_CHECK_DESCRIPTION = 'true';
  process.env.INPUT_ALLOW_EMPTY_DESCRIPTION = 'false';
  process.env.INPUT_CHECK_SETTINGS = 'false';
  process.env.INPUT_CHECK_MERGE_TYPES = 'false';
  process.env.INPUT_ALLOW_MERGE_COMMIT = 'disabled';
  process.env.INPUT_ALLOW_SQUASH_MERGE = 'enabled';
  process.env.INPUT_ALLOW_REBASE_MERGE = 'disabled';
  process.env.INPUT_CHECK_DISCUSSIONS = 'off';
  process.env.INPUT_ORG_DISCUSSIONS_REPO = '.github';
  process.env.INPUT_CHECK_COMMUNITY_FILES = 'false';
  process.env.INPUT_CHECK_README = 'false';
  process.env.INPUT_CHECK_LICENSE = 'false';
  process.env.INPUT_CHECK_CODE_OF_CONDUCT = 'false';
  process.env.INPUT_CHECK_CONTRIBUTING = 'false';
  process.env.INPUT_CHECK_SECURITY = 'false';
  process.env.INPUT_CHECK_SPONSORS = 'false';
});

afterEach(() => {
  console.log = originalConsoleLog;
});

// Import the module after setting up mocks
const auditRepositories = require('../../actions/audit_repos/audit.js');

describe('Audit Repositories', () => {
  describe('Description Validation', () => {
    test('should pass when description is valid', async () => {
      setupStandardMocks({ description: 'This is a valid description.' });
      await expectAuditSuccess('Description');
    });

    test('should fail when description is missing', async () => {
      setupStandardMocks({ description: null });
      await expectAuditFailure('Missing description');
    });

    test('should pass when description is missing but allowEmptyDescription is true', async () => {
      process.env.INPUT_ALLOW_EMPTY_DESCRIPTION = 'true';
      setupStandardMocks({ description: null });
      await expectAuditSuccess('Description');
    });

    test('should pass when description is empty string but allowEmptyDescription is true', async () => {
      process.env.INPUT_ALLOW_EMPTY_DESCRIPTION = 'true';
      setupStandardMocks({ description: '' });
      await expectAuditSuccess('Description');
    });

    test('should fail when description does not end with period', async () => {
      setupStandardMocks({ description: 'This is a description without period' });
      await expectAuditFailure('Description does not end with a period');
    });

    test('should fail when description does not end with period even with allowEmptyDescription', async () => {
      process.env.INPUT_ALLOW_EMPTY_DESCRIPTION = 'true';
      setupStandardMocks({ description: 'This is a description without period' });
      await expectAuditFailure('Description does not end with a period');
    });

    test('should fail when description has leading/trailing whitespace', async () => {
      setupStandardMocks({ description: '  This description has whitespace.  ' });
      await expectAuditFailure('Description contains leading or trailing whitespace');
    });

    test('should fail when description is too short', async () => {
      setupStandardMocks({ description: 'Short.' });
      await expectAuditFailure('Description is too short');
    });
  });

  describe('Settings Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_SETTINGS = 'true';
    });

    test('should pass when issues are enabled', async () => {
      setupStandardMocks({ has_issues: true });
      await expectAuditSuccess('Settings');
    });

    test('should fail when issues are disabled', async () => {
      setupStandardMocks({ has_issues: false });
      await expectAuditFailure('Issues are disabled');
    });
  });

  describe('Merge Types Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_MERGE_TYPES = 'true';
    });

    test('should pass when merge settings match configuration', async () => {
      setupStandardMocks();
      await expectAuditSuccess('Merge Types');
    });

    test('should fail when merge commit should be disabled but is enabled', async () => {
      setupStandardMocks({ allow_merge_commit: true });
      await expectAuditFailure('Merge commits should be disabled');
    });

    test('should fail when merge commit should be enabled but is disabled', async () => {
      process.env.INPUT_ALLOW_MERGE_COMMIT = 'enabled';
      setupStandardMocks({ allow_merge_commit: false });
      await expectAuditFailure('Merge commits should be enabled');
    });

    test('should fail when squash merge should be disabled but is enabled', async () => {
      process.env.INPUT_ALLOW_SQUASH_MERGE = 'disabled';
      setupStandardMocks({ allow_squash_merge: true });
      await expectAuditFailure('Squash merge should be disabled');
    });

    test('should fail when squash merge should be enabled but is disabled', async () => {
      process.env.INPUT_ALLOW_SQUASH_MERGE = 'enabled';
      setupStandardMocks({ allow_squash_merge: false });
      await expectAuditFailure('Squash merge should be enabled');
    });

    test('should fail when rebase merge should be disabled but is enabled', async () => {
      process.env.INPUT_ALLOW_REBASE_MERGE = 'enabled';
      setupStandardMocks({ allow_rebase_merge: false });
      await expectAuditFailure('Rebase merge should be enabled');
    });

    test('should fail when rebase merge should be enabled but is disabled', async () => {
      process.env.INPUT_ALLOW_REBASE_MERGE = 'disabled';
      setupStandardMocks({ allow_rebase_merge: true });
      await expectAuditFailure('Rebase merge should be disabled');
    });
  });

  describe('Discussions Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_DISCUSSIONS = 'org';
    });

    test('should pass when repo discussions are disabled for org-wide discussions', async () => {
      setupStandardMocks({ has_discussions: false });
      await expectAuditSuccess('Discussions');
    });

    test('should fail when repo discussions are enabled but should be disabled', async () => {
      setupStandardMocks({ has_discussions: true });
      await expectAuditFailure('Repository discussions should be disabled');
    });

    test('should allow discussions on the org discussions repo', async () => {
      setupStandardMocks(
        { name: '.github', has_discussions: true },
        {},
        { name: '.github' }
      );
      await expectAuditSuccess();
    });

    test('should pass when repo discussions are enabled for repo-wide discussions', async () => {
      process.env.INPUT_CHECK_DISCUSSIONS = 'repo';
      setupStandardMocks({ has_discussions: true });
      await expectAuditSuccess('Discussions');
    });

    test('should fail when repo discussions are disabled but should be enabled', async () => {
      process.env.INPUT_CHECK_DISCUSSIONS = 'repo';
      setupStandardMocks({ has_discussions: false });
      await expectAuditFailure('Repository discussions should be enabled');
    });
  });

  describe('Community Files Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'true';
      process.env.INPUT_CHECK_README = 'true';
      process.env.INPUT_CHECK_LICENSE = 'true';
      process.env.INPUT_CHECK_CODE_OF_CONDUCT = 'true';
      process.env.INPUT_CHECK_CONTRIBUTING = 'true';
      process.env.INPUT_CHECK_SECURITY = 'true';
      process.env.INPUT_CHECK_SPONSORS = 'true';
    });

    test('should pass when all community files exist', async () => {
      const communityFiles = {
        readme: { name: 'README.md' },
        license: { name: 'LICENSE' },
        code_of_conduct: { name: 'CODE_OF_CONDUCT.md' },
        contributing: { name: 'CONTRIBUTING.md' },
        security: { name: 'SECURITY.md' },
      };
      setupStandardMocks({}, communityFiles);
      mockGithub.rest.repos.getContent.mockResolvedValue({ data: {} });
      await expectAuditSuccess('Community Health Files');
    });

    test('should fail when community files are missing', async () => {
      const communityFiles = {
        readme: null,
        license: null,
        code_of_conduct: null,
        contributing: null,
        security: null,
      };
      setupStandardMocks({}, communityFiles);
      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Missing README file'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Missing LICENSE file'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Missing CODE_OF_CONDUCT file'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Missing CONTRIBUTING file'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Missing SECURITY policy'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('Sponsors not activated'))).toBe(true);
    });
  });

  describe('Repository Filtering', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
    });

    test('should filter out archived repositories when not included', async () => {
      setupFilteringMocks([
        createRepoListItem({ name: 'repo1', archived: false }),
        createRepoListItem({ name: 'repo2', archived: true }),
      ]);

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should include archived repositories when requested', async () => {
      process.env.INPUT_INCLUDE_ARCHIVED = 'true';
      setupStandardMocks({}, {}, { archived: true });
      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should filter out forked repositories when not included', async () => {
      setupFilteringMocks([
        createRepoListItem({ name: 'repo1', fork: false }),
        createRepoListItem({ name: 'repo2', fork: true }),
      ]);

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should include private repositories when requested', async () => {
      process.env.INPUT_INCLUDE_PRIVATE = 'true';
      setupStandardMocks({}, {}, { private: true });
      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should filter out excluded repositories', async () => {
      process.env.INPUT_EXCLUDED_REPOS = 'repo2, repo3';
      setupFilteringMocks([
        createRepoListItem({ name: 'repo1' }),
        createRepoListItem({ name: 'repo2' }),
        createRepoListItem({ name: 'repo3' }),
      ]);

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Default Fallback Values', () => {
    beforeEach(() => {
      delete process.env.INPUT_GITHUB_ORG;
      delete process.env.INPUT_ORG_DISCUSSIONS_REPO;
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_SETTINGS = 'false';
      process.env.INPUT_CHECK_MERGE_TYPES = 'false';
      process.env.INPUT_CHECK_DISCUSSIONS = 'off';
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'false';
      process.env.INPUT_INCLUDE_ARCHIVED = 'false';
      process.env.INPUT_INCLUDE_FORKED = 'false';
      process.env.INPUT_INCLUDE_PRIVATE = 'false';
      process.env.INPUT_EXCLUDED_REPOS = '';
      process.env.INPUT_ALLOW_MERGE_COMMIT = 'disabled';
      process.env.INPUT_ALLOW_SQUASH_MERGE = 'enabled';
      process.env.INPUT_ALLOW_REBASE_MERGE = 'disabled';
      process.env.INPUT_CHECK_README = 'false';
      process.env.INPUT_CHECK_LICENSE = 'false';
      process.env.INPUT_CHECK_CODE_OF_CONDUCT = 'false';
      process.env.INPUT_CHECK_CONTRIBUTING = 'false';
      process.env.INPUT_CHECK_SECURITY = 'false';
      process.env.INPUT_CHECK_SPONSORS = 'false';
    });

    test('should use context.repo.owner when INPUT_GITHUB_ORG is not set', async () => {
      setupStandardMocks();
      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockGithub.paginate).toHaveBeenCalled();
    });

    test('should use .github as default org discussions repo', async () => {
      process.env.INPUT_CHECK_DISCUSSIONS = 'org';
      setupStandardMocks(
        { name: '.github', has_discussions: true },
        {},
        { name: '.github' }
      );
      await expectAuditSuccess();
    });
  });

  describe('Fork Handling', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'true';
      process.env.INPUT_CHECK_README = 'true';
      process.env.INPUT_CHECK_LICENSE = 'true';
      process.env.INPUT_INCLUDE_FORKED = 'true';
    });

    test('should check README and LICENSE for forked repos', async () => {
      setupForkedRepoMocks();
      let getContentCallCount = 0;
      mockGithub.rest.repos.getContent.mockImplementation(() => {
        getContentCallCount++;
        if (getContentCallCount === 1) return Promise.reject({ status: 404 }); // org FUNDING.yml
        if (getContentCallCount === 2) return Promise.resolve({ data: {} }); // README.md found
        return Promise.reject({ status: 404 }); // LICENSE not found
      });

      await expectAuditFailure('Missing LICENSE file');
    });
  });

  describe('File Existence Checks', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'true';
      process.env.INPUT_CHECK_README = 'true';
      process.env.INPUT_CHECK_LICENSE = 'true';
      process.env.INPUT_CHECK_SPONSORS = 'false';
      process.env.INPUT_INCLUDE_FORKED = 'true';
    });

    test('should find README in alternate locations', async () => {
      setupForkedRepoMocks();
      let getContentCallCount = 0;
      mockGithub.rest.repos.getContent.mockImplementation(() => {
        getContentCallCount++;
        if (getContentCallCount === 1) return Promise.reject({ status: 404 }); // org FUNDING.yml
        if (getContentCallCount >= 2 && getContentCallCount <= 5) return Promise.reject({ status: 404 }); // README variants
        if (getContentCallCount === 6) return Promise.resolve({ data: {} }); // .github/README.md found
        if (getContentCallCount === 7) return Promise.resolve({ data: {} }); // LICENSE found
        return Promise.reject({ status: 404 }); // repo FUNDING.yml
      });

      await expectAuditSuccess();
    });

    test('should handle repo fetch errors gracefully', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        createRepoListItem({ name: 'repo1' }),
        createRepoListItem({ name: 'repo2' }),
      ]);

      let getCallCount = 0;
      mockGithub.rest.repos.get.mockImplementation(() => {
        getCallCount++;
        if (getCallCount === 1) return Promise.reject(new Error('Repository access denied'));
        return Promise.resolve({ data: createRepoData({ name: 'repo2' }) });
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({ data: { files: {} } });
      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(consoleOutput.some(line => line.includes('⚠️  Could not fetch details for repo1'))).toBe(true);
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle API errors gracefully', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockRejectedValue(new Error('API Error'));

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch repositories')
      );
    });

    test('should fallback to user repos when org fetch fails with 404', async () => {
      const orgError = new Error('Not Found');
      orgError.status = 404;

      setupStandardMocks();
      mockGithub.paginate
        .mockRejectedValueOnce(orgError)
        .mockResolvedValueOnce([createRepoListItem()]);

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(consoleOutput.some(line => line.includes('Not an organization, trying as user'))).toBe(true);
      expect(mockGithub.rest.repos.listForUser.endpoint.merge).toHaveBeenCalled();
    });

    test('should handle community health API errors gracefully', async () => {
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'true';
      process.env.INPUT_CHECK_README = 'true';

      setupStandardMocks();
      const apiError = new Error('API rate limit exceeded');
      mockGithub.rest.repos.getCommunityProfileMetrics
        .mockRejectedValueOnce({ status: 404 })
        .mockRejectedValueOnce(apiError);

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });
      expect(consoleOutput.some(line => line.includes('⚠️  Could not fetch community health for repo1'))).toBe(true);
      expect(mockCore.setFailed).toHaveBeenCalled();
    });
  });
});
