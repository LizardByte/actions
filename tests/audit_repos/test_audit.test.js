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
  });
});
