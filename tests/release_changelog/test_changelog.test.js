/**
 * Unit tests for changelog.js
 * @jest-environment node
 */

/* eslint-env jest */

const { createMockContext, createMockGithub, createMockCore, setupConsoleMocks, createMockReleases, setupBranchCreationMocks, verifyBranchCreation, setupChangelogWorkflow } = require('../testUtils.js');

// Mock the GitHub Actions core, context, and GitHub objects
const mockCore = createMockCore();
const mockContext = createMockContext();
const mockGithub = createMockGithub();

// Setup console mocking
let consoleMocks;
let consoleOutput;

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();

  // Setup console mocking fresh for each test
  consoleMocks = setupConsoleMocks();
  consoleOutput = consoleMocks.consoleOutput;

  // Set default environment variables
  process.env.changelog_branch = 'changelog';
  process.env.changelog_file = 'CHANGELOG.md';
});

afterEach(() => {
  if (consoleMocks) {
    consoleMocks.restore();
  }
});

// Import the module after setting up mocks
const generateReleaseChangelog = require('../../actions/release_changelog/changelog.js');
const {
  formatDate,
  transformReleaseBody,
  generateChangelogHeader,
  generateChangelogBody,
  generateChangelogFooter,
  generateChangelog,
  fetchAllReleases,
  createOrphanedBranch,
  updateChangelogFile,
} = generateReleaseChangelog;

// Test helper functions
function setupMockFileContent(sha, content) {
  mockGithub.rest.repos.getContent.mockResolvedValue({
    data: {
      sha,
      content: Buffer.from(content).toString('base64'),
    },
  });
}

function setupMockFileNotFound() {
  mockGithub.rest.repos.getContent.mockRejectedValue({ status: 404 });
}

function setupMockFileError(status, message) {
  mockGithub.rest.repos.getContent.mockRejectedValue({ status, message });
}

function setupBranchExistsError() {
  mockGithub.rest.git.createRef.mockRejectedValue({ status: 422, message: 'Reference already exists' });
}

describe('Release Changelog Generator', () => {
  describe('formatDate', () => {
    test('should format date correctly', () => {
      const date = new Date('2024-03-15T10:30:00Z');
      expect(formatDate(date)).toBe('2024-03-15');
    });

    test('should pad single digit month and day', () => {
      const date = new Date('2024-01-05T10:30:00Z');
      expect(formatDate(date)).toBe('2024-01-05');
    });

    test('should handle December correctly', () => {
      const date = new Date('2024-12-31T23:59:59Z');
      expect(formatDate(date)).toBe('2024-12-31');
    });
  });

  describe('transformReleaseBody', () => {
    test('should transform ## headers to ### headers', () => {
      const body = '## Features\nSome feature\n## Bug Fixes\nSome fix';
      const expected = '### Features\nSome feature\n### Bug Fixes\nSome fix';
      expect(transformReleaseBody(body)).toBe(expected);
    });

    test('should not transform headers without newline', () => {
      const body = '## Features';
      expect(transformReleaseBody(body)).toBe('## Features');
    });

    test('should handle empty body', () => {
      expect(transformReleaseBody('')).toBe('');
    });

    test('should handle body without headers', () => {
      const body = 'Some text without headers';
      expect(transformReleaseBody(body)).toBe('Some text without headers');
    });
  });

  describe('generateChangelogHeader', () => {
    test('should generate valid changelog header', () => {
      const header = generateChangelogHeader();
      expect(header).toContain('<!-- # Changelog -->');
      expect(header).toContain('All notable changes to this project will be documented in this file.');
      expect(header).toContain('Keep a Changelog');
      expect(header).toContain('Calendar Versioning');
      expect(header).toContain('LizardByte');
    });
  });

  describe('generateChangelogBody', () => {
    test('should generate changelog body from releases', () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T12:00:00Z',
          body: '## Features\nInitial release\n',
        },
        {
          tagName: 'v1.1.0',
          createdAt: '2024-02-01T12:00:00Z',
          body: '## Improvements\nBug fixes\n',
        },
      ]);

      const body = generateChangelogBody(releases);
      expect(body).toContain('[v1.1.0] - 2024-02-01');
      expect(body).toContain('[v1.0.0] - 2024-01-01');
      expect(body).toContain('### Improvements');
      expect(body).toContain('### Features');
    });

    test('should filter out prereleases', () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: 'Release\n',
        },
        {
          tagName: 'v1.1.0-beta',
          createdAt: '2024-02-01T00:00:00Z',
          body: 'Beta\n',
          prerelease: true,
        },
      ]);

      const body = generateChangelogBody(releases);
      expect(body).toContain('v1.0.0');
      expect(body).not.toContain('v1.1.0-beta');
    });

    test('should filter out drafts', () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: 'Release\n',
        },
        {
          tagName: 'v1.1.0',
          createdAt: '2024-02-01T00:00:00Z',
          body: 'Draft\n',
          draft: true,
        },
      ]);

      const body = generateChangelogBody(releases);
      expect(body).toContain('v1.0.0');
      expect(body).not.toContain('v1.1.0');
    });

    test('should handle empty releases array', () => {
      const body = generateChangelogBody([]);
      expect(body).toBe('');
    });

    test('should reverse releases to show newest first', () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: 'First\n',
        },
        {
          tagName: 'v2.0.0',
          createdAt: '2024-02-01T00:00:00Z',
          body: 'Second\n',
        },
      ]);

      const body = generateChangelogBody(releases);
      const v2Index = body.indexOf('v2.0.0');
      const v1Index = body.indexOf('v1.0.0');
      expect(v2Index).toBeLessThan(v1Index);
    });
  });

  describe('generateChangelogFooter', () => {
    test('should generate footer with release URLs', () => {
      const releases = createMockReleases([
        { tagName: 'v1.0.0' },
        { tagName: 'v1.1.0' },
      ]);

      const footer = generateChangelogFooter(releases);
      expect(footer).toContain('[v1.0.0]: https://github.com/test/repo/releases/tag/v1.0.0');
      expect(footer).toContain('[v1.1.0]: https://github.com/test/repo/releases/tag/v1.1.0');
    });

    test('should filter out prereleases and drafts', () => {
      const releases = createMockReleases([
        { tagName: 'v1.0.0' },
        { tagName: 'v1.1.0-beta', prerelease: true },
        { tagName: 'v1.2.0', draft: true },
      ]);

      const footer = generateChangelogFooter(releases);
      expect(footer).toContain('v1.0.0');
      expect(footer).not.toContain('v1.1.0-beta');
      expect(footer).not.toContain('v1.2.0');
    });

    test('should handle empty releases array', () => {
      const footer = generateChangelogFooter([]);
      expect(footer).toBe('');
    });

    test('should reverse releases to show newest first', () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          tagName: 'v2.0.0',
          createdAt: '2024-02-01T00:00:00Z',
        },
      ]);

      const footer = generateChangelogFooter(releases);
      const v2Index = footer.indexOf('[v2.0.0]:');
      const v1Index = footer.indexOf('[v1.0.0]:');
      expect(v2Index).toBeLessThan(v1Index);
    });
  });

  describe('generateChangelog', () => {
    test('should generate complete changelog', () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T12:00:00Z',
          body: '## Features\nInitial release\n',
        },
      ]);

      const changelog = generateChangelog(releases);
      expect(changelog).toContain('<!-- # Changelog -->');
      expect(changelog).toContain('[v1.0.0] - 2024-01-01');
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('[v1.0.0]: https://github.com/test/repo/releases/tag/v1.0.0');
    });
  });

  describe('fetchAllReleases', () => {
    test('should fetch all releases with pagination', async () => {
      const page1 = new Array(100).fill(null).map((_, i) => ({
        tag_name: `v1.${i}.0`,
        created_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));
      const page2 = new Array(50).fill(null).map((_, i) => ({
        tag_name: `v2.${i}.0`,
        created_at: `2024-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));

      mockGithub.rest.repos.listReleases
        .mockResolvedValueOnce({ data: page1 })
        .mockResolvedValueOnce({ data: page2 });

      const releases = await fetchAllReleases(mockGithub, mockContext);
      expect(releases).toHaveLength(150);
      expect(mockGithub.rest.repos.listReleases).toHaveBeenCalledTimes(2);
    });

    test('should sort releases by creation date', async () => {
      const releases = [
        { tag_name: 'v2.0.0', created_at: '2024-02-01T00:00:00Z' },
        { tag_name: 'v1.0.0', created_at: '2024-01-01T00:00:00Z' },
        { tag_name: 'v3.0.0', created_at: '2024-03-01T00:00:00Z' },
      ];

      mockGithub.rest.repos.listReleases.mockResolvedValue({ data: releases });

      const sorted = await fetchAllReleases(mockGithub, mockContext);
      expect(sorted[0].tag_name).toBe('v1.0.0');
      expect(sorted[1].tag_name).toBe('v2.0.0');
      expect(sorted[2].tag_name).toBe('v3.0.0');
    });

    test('should handle empty releases', async () => {
      mockGithub.rest.repos.listReleases.mockResolvedValue({ data: [] });

      const releases = await fetchAllReleases(mockGithub, mockContext);
      expect(releases).toHaveLength(0);
    });
  });

  describe('createOrphanedBranch', () => {
    test('should create orphaned branch successfully', async () => {
      const blobSha = 'blob-sha-123';
      const treeSha = 'tree-sha-456';
      const commitSha = 'commit-sha-789';

      setupBranchCreationMocks(mockGithub, { blobSha, treeSha, commitSha });

      await createOrphanedBranch(mockGithub, mockContext, 'test content', 'changelog', 'CHANGELOG.md');

      verifyBranchCreation(mockGithub, {
        content: 'test content',
        branch: 'changelog',
        filePath: 'CHANGELOG.md',
        blobSha,
        treeSha,
      });
    });
  });

  describe('updateChangelogFile', () => {
    test('should update existing file', async () => {
      setupMockFileContent('existing-file-sha', 'old content');
      mockGithub.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

      const result = await updateChangelogFile(mockGithub, mockContext, 'new content', 'changelog', 'CHANGELOG.md');

      expect(result).toBe(true);
      expect(mockGithub.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'test-org',
        repo: 'test-repo',
        path: 'CHANGELOG.md',
        ref: 'changelog',
      });

      expect(mockGithub.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
        owner: 'test-org',
        repo: 'test-repo',
        path: 'CHANGELOG.md',
        message: 'chore: update CHANGELOG.md',
        content: Buffer.from('new content').toString('base64'),
        sha: 'existing-file-sha',
        branch: 'changelog',
      });
    });

    test('should skip commit when content has not changed', async () => {
      setupMockFileContent('existing-file-sha', 'unchanged content');
      mockGithub.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

      const result = await updateChangelogFile(mockGithub, mockContext, 'unchanged content', 'changelog', 'CHANGELOG.md');

      expect(result).toBe(false);
      expect(mockGithub.rest.repos.getContent).toHaveBeenCalled();
      expect(mockGithub.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('No changes detected in CHANGELOG.md, skipping commit'))).toBe(true);
    });

    test('should create new file if it does not exist', async () => {
      setupMockFileNotFound();
      mockGithub.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

      const result = await updateChangelogFile(mockGithub, mockContext, 'new content', 'changelog', 'CHANGELOG.md');

      expect(result).toBe(true);
      expect(mockGithub.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
        owner: 'test-org',
        repo: 'test-repo',
        path: 'CHANGELOG.md',
        message: 'chore: create CHANGELOG.md',
        content: Buffer.from('new content').toString('base64'),
        sha: null,
        branch: 'changelog',
      });
    });

    test('should throw error if getContent fails with non-404 error', async () => {
      setupMockFileError(500, 'Server error');

      await expect(updateChangelogFile(mockGithub, mockContext, 'new content', 'changelog', 'CHANGELOG.md'))
        .rejects.toThrow('Failed to fetch the file: Server error');
    });
  });

  describe('generateReleaseChangelog', () => {
    test('should generate changelog and create new branch', async () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: '## Features\nInitial release\n',
        },
      ]);

      setupChangelogWorkflow(mockGithub, releases);

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setOutput).toHaveBeenCalledWith('changelog', expect.stringContaining('v1.0.0'));
      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('✅ Changelog generation completed successfully!'))).toBe(true);
    });

    test('should use default branch and file names when environment variables are not set', async () => {
      delete process.env.changelog_branch;
      delete process.env.changelog_file;

      setupChangelogWorkflow(mockGithub);

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.git.createRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'refs/heads/changelog',
        })
      );

      expect(mockGithub.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            expect.objectContaining({ path: 'CHANGELOG.md' }),
          ]),
        })
      );
    });

    test('should update existing branch', async () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: 'Release\n',
        },
      ]);

      setupChangelogWorkflow(mockGithub, releases);
      setupBranchExistsError();
      setupMockFileContent('file-sha', 'old content');
      mockGithub.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
      expect(mockCore.setOutput).toHaveBeenCalled();
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });

    test('should handle errors and set action as failed', async () => {
      mockGithub.rest.repos.listReleases.mockRejectedValue(new Error('API error'));

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith('Action failed with error: API error');
    });

    test('should handle non-422 errors when creating branch', async () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: 'Release\n',
        },
      ]);

      setupChangelogWorkflow(mockGithub, releases);
      mockGithub.rest.git.createRef.mockRejectedValue({ status: 500, message: 'Internal server error' });

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockCore.setFailed).toHaveBeenCalledWith('Action failed with error: Failed to create or update changelog: Internal server error');
    });

    test('should use custom branch and file names from environment', async () => {
      process.env.changelog_branch = 'custom-branch';
      process.env.changelog_file = 'CUSTOM.md';

      setupChangelogWorkflow(mockGithub);

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.git.createRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'refs/heads/custom-branch',
        })
      );

      expect(mockGithub.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            expect.objectContaining({ path: 'CUSTOM.md' }),
          ]),
        })
      );
    });

    test('should skip commit when changelog content has not changed', async () => {
      const releases = createMockReleases([
        {
          tagName: 'v1.0.0',
          createdAt: '2024-01-01T00:00:00Z',
          body: '## Features\nInitial release\n',
        },
      ]);

      setupChangelogWorkflow(mockGithub, releases);
      mockGithub.rest.git.createRef.mockRejectedValue({ status: 422, message: 'Reference already exists' });

      // Generate the same changelog content that would be created
      const expectedChangelog = generateChangelog(releases);

      mockGithub.rest.repos.getContent.mockResolvedValue({
        data: {
          sha: 'file-sha',
          content: Buffer.from(expectedChangelog).toString('base64'),
        },
      });

      await generateReleaseChangelog({ github: mockGithub, context: mockContext, core: mockCore });

      expect(mockGithub.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockCore.setOutput).toHaveBeenCalledWith('changelog', expectedChangelog);
      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(consoleOutput.some(line => line.includes('No changes detected in CHANGELOG.md, skipping commit'))).toBe(true);
      expect(consoleOutput.some(line => line.includes('No changes detected, CHANGELOG.md not updated'))).toBe(true);
    });
  });
});
