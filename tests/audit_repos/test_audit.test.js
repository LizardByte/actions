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
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'This is a valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: {
          files: {
            readme: { name: 'README.md' },
            license: { name: 'LICENSE' },
            code_of_conduct: null,
            contributing: null,
            security: null,
          },
        },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ All Description checks passed!'))).toBe(true);
    });

    test('should fail when description is missing', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: null,
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Description check(s) failed')
      );
      expect(consoleOutput.some(line => line.includes('Missing description'))).toBe(true);
    });

    test('should fail when description does not end with period', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'This is a description without period',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Description does not end with a period'))).toBe(true);
    });

    test('should fail when description has leading/trailing whitespace', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: '  This description has whitespace.  ',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Description contains leading or trailing whitespace'))).toBe(true);
    });

    test('should fail when description is too short', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Short.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Description is too short'))).toBe(true);
    });
  });

  describe('Settings Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_SETTINGS = 'true';
    });

    test('should pass when issues are enabled', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ All Settings checks passed!'))).toBe(true);
    });

    test('should fail when issues are disabled', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: false,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Issues are disabled'))).toBe(true);
    });
  });

  describe('Merge Types Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_MERGE_TYPES = 'true';
    });

    test('should pass when merge settings match configuration', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ All Merge Types checks passed!'))).toBe(true);
    });

    test('should fail when merge commit should be disabled but is enabled', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Merge commits should be disabled'))).toBe(true);
    });

    test('should fail when merge commit should be enabled but is disabled', async () => {
      process.env.INPUT_ALLOW_MERGE_COMMIT = 'enabled';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Merge commits should be enabled'))).toBe(true);
    });

    test('should fail when squash merge should be disabled but is enabled', async () => {
      process.env.INPUT_ALLOW_SQUASH_MERGE = 'disabled';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Squash merge should be disabled'))).toBe(true);
    });

    test('should fail when squash merge should be enabled but is disabled', async () => {
      process.env.INPUT_ALLOW_SQUASH_MERGE = 'enabled';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: false,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Squash merge should be enabled'))).toBe(true);
    });

    test('should fail when rebase merge should be disabled but is enabled', async () => {
      process.env.INPUT_ALLOW_REBASE_MERGE = 'enabled';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Rebase merge should be enabled'))).toBe(true);
    });

    test('should fail when rebase merge should be enabled but is disabled', async () => {
      process.env.INPUT_ALLOW_REBASE_MERGE = 'enabled';
      process.env.INPUT_ALLOW_REBASE_MERGE = 'disabled';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: true,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Rebase merge should be disabled'))).toBe(true);
    });
  });

  describe('Discussions Validation', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_DISCUSSIONS = 'org';
    });

    test('should pass when repo discussions are disabled for org-wide discussions', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ All Discussions checks passed!'))).toBe(true);
    });

    test('should fail when repo discussions are enabled but should be disabled', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: true,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Repository discussions should be disabled'))).toBe(true);
    });

    test('should allow discussions on the org discussions repo', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: '.github', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: '.github',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/.github',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: true,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });

    test('should pass when repo discussions are enabled for repo-wide discussions', async () => {
      process.env.INPUT_CHECK_DISCUSSIONS = 'repo';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: true,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ All Discussions checks passed!'))).toBe(true);
    });

    test('should fail when repo discussions are disabled but should be enabled', async () => {
      process.env.INPUT_CHECK_DISCUSSIONS = 'repo';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Repository discussions should be enabled'))).toBe(true);
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
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: {
          files: {
            readme: { name: 'README.md' },
            license: { name: 'LICENSE' },
            code_of_conduct: { name: 'CODE_OF_CONDUCT.md' },
            contributing: { name: 'CONTRIBUTING.md' },
            security: { name: 'SECURITY.md' },
          },
        },
      });

      mockGithub.rest.repos.getContent.mockResolvedValue({ data: {} });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ All Community Health Files checks passed!'))).toBe(true);
    });

    test('should fail when community files are missing', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: {
          files: {
            readme: null,
            license: null,
            code_of_conduct: null,
            contributing: null,
            security: null,
          },
        },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

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
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
        { name: 'repo2', archived: true, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should include archived repositories when requested', async () => {
      process.env.INPUT_INCLUDE_ARCHIVED = 'true';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: true, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should filter out forked repositories when not included', async () => {
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
        { name: 'repo2', archived: false, fork: true, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should include private repositories when requested', async () => {
      process.env.INPUT_INCLUDE_PRIVATE = 'true';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: true },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });

    test('should filter out excluded repositories', async () => {
      process.env.INPUT_EXCLUDED_REPOS = 'repo2, repo3';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
        { name: 'repo2', archived: false, fork: false, private: false },
        { name: 'repo3', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Default Fallback Values', () => {
    beforeEach(() => {
      // Clear all environment variables to test fallback values
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
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      // Should use 'test-org' from mockContext.repo.owner
      expect(mockGithub.paginate).toHaveBeenCalled();
    });

    test('should use .github as default org discussions repo', async () => {
      process.env.INPUT_CHECK_DISCUSSIONS = 'org';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: '.github', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: '.github',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/.github',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: true,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      // Should allow discussions on .github repo (the default)
      expect(mockCore.setFailed).not.toHaveBeenCalled();
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
      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'forked-repo', archived: false, fork: true, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'forked-repo',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/forked-repo',
          has_issues: true,
          fork: true,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics
        .mockRejectedValueOnce({ status: 404 });

      // Mock getContent to return README found, LICENSE not found
      let getContentCallCount = 0;
      mockGithub.rest.repos.getContent.mockImplementation(() => {
        getContentCallCount++;
        if (getContentCallCount === 1) {
          // org FUNDING.yml
          return Promise.reject({ status: 404 });
        } else if (getContentCallCount === 2) {
          // README.md found
          return Promise.resolve({ data: {} });
        } else {
          // LICENSE not found and repo FUNDING.yml
          return Promise.reject({ status: 404 });
        }
      });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('Missing LICENSE file'))).toBe(true);
    });
  });

  describe('File Existence Checks', () => {
    beforeEach(() => {
      process.env.INPUT_CHECK_DESCRIPTION = 'false';
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'true';
      process.env.INPUT_CHECK_README = 'true';
      process.env.INPUT_CHECK_LICENSE = 'true';
      process.env.INPUT_CHECK_SPONSORS = 'true';
    });

    test('should find README in alternate locations', async () => {
      process.env.INPUT_INCLUDE_FORKED = 'true';
      process.env.INPUT_CHECK_SPONSORS = 'false';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'forked-repo', archived: false, fork: true, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'forked-repo',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/forked-repo',
          has_issues: true,
          fork: true,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics
        .mockRejectedValueOnce({ status: 404 });

      // Mock getContent - README found in .github/ folder (second location), LICENSE found
      let getContentCallCount = 0;
      mockGithub.rest.repos.getContent.mockImplementation(() => {
        getContentCallCount++;
        if (getContentCallCount === 1) {
          // org FUNDING.yml
          return Promise.reject({ status: 404 });
        } else if (getContentCallCount === 2) {
          // README.md not found in root
          return Promise.reject({ status: 404 });
        } else if (getContentCallCount === 3) {
          // README not found in root
          return Promise.reject({ status: 404 });
        } else if (getContentCallCount === 4) {
          // README.rst not found in root
          return Promise.reject({ status: 404 });
        } else if (getContentCallCount === 5) {
          // README.txt not found in root
          return Promise.reject({ status: 404 });
        } else if (getContentCallCount === 6) {
          // .github/README.md found!
          return Promise.resolve({ data: {} });
        } else if (getContentCallCount === 7) {
          // LICENSE found
          return Promise.resolve({ data: {} });
        } else {
          // repo FUNDING.yml
          return Promise.reject({ status: 404 });
        }
      });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });


    test('should handle repo fetch errors gracefully', async () => {
      process.env.INPUT_CHECK_SPONSORS = 'false';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
        { name: 'repo2', archived: false, fork: false, private: false },
      ]);

      // First repo fails to fetch details, second succeeds
      let getCallCount = 0;
      mockGithub.rest.repos.get.mockImplementation(() => {
        getCallCount++;
        if (getCallCount === 1) {
          return Promise.reject(new Error('Repository access denied'));
        } else {
          return Promise.resolve({
            data: {
              name: 'repo2',
              description: 'Valid description.',
              html_url: 'https://github.com/test-org/repo2',
              has_issues: true,
              fork: false,
              allow_merge_commit: false,
              allow_squash_merge: true,
              allow_rebase_merge: false,
              has_discussions: false,
            },
          });
        }
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

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

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate
        .mockRejectedValueOnce(orgError)
        .mockResolvedValueOnce([
          { name: 'repo1', archived: false, fork: false, private: false },
        ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      mockGithub.rest.repos.getCommunityProfileMetrics.mockResolvedValue({
        data: { files: {} },
      });

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('Not an organization, trying as user'))).toBe(true);
      expect(mockGithub.rest.repos.listForUser.endpoint.merge).toHaveBeenCalled();
    });

    test('should handle community health API errors gracefully', async () => {
      process.env.INPUT_CHECK_COMMUNITY_FILES = 'true';
      process.env.INPUT_CHECK_README = 'true';

      mockGithub.rest.repos.listForOrg.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue([
        { name: 'repo1', archived: false, fork: false, private: false },
      ]);

      mockGithub.rest.repos.get.mockResolvedValue({
        data: {
          name: 'repo1',
          description: 'Valid description.',
          html_url: 'https://github.com/test-org/repo1',
          has_issues: true,
          fork: false,
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          has_discussions: false,
        },
      });

      const apiError = new Error('API rate limit exceeded');
      mockGithub.rest.repos.getCommunityProfileMetrics
        .mockRejectedValueOnce({ status: 404 }) // org .github
        .mockRejectedValueOnce(apiError); // repo community health

      mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });

      await auditRepositories({ github: mockGithub, context: mockContext, core: mockCore });

      expect(consoleOutput.some(line => line.includes('⚠️  Could not fetch community health for repo1'))).toBe(true);
      expect(mockCore.setFailed).toHaveBeenCalled(); // Should fail because README is missing
    });
  });
});
