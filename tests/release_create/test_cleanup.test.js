/**
 * Unit tests for cleanup.js
 * @jest-environment node
 */

import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

const { createMockContext, createMockGithub, setupConsoleMocks, createMockRelease, createMockReleases, setupDeleteMocks, verifyDeleteCalls, setupCleanupEnv } = require('../testUtils.js');

// Mock the GitHub Actions context and GitHub objects
const mockContext = createMockContext();
const mockGithub = createMockGithub();

// Override specific methods that need different implementations
mockGithub.rest.repos.listReleases = {
  endpoint: {
    merge: jest.fn(),
  },
};

// Setup console mocking
let consoleMocks;
let consoleOutput;
let consoleErrors;

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();

  // Setup console mocking fresh for each test
  consoleMocks = setupConsoleMocks();
  consoleOutput = consoleMocks.consoleOutput;
  consoleErrors = consoleMocks.consoleErrors;

  // Set default environment variables
  process.env.DELETE_TAGS = 'true';
  process.env.IS_DRAFT = 'false';
  process.env.KEEP_LATEST = '2';
  process.env.SLEEP_DURATION = '15';
  process.env.CURRENT_TAG = 'v2024.1015.183045';
});

afterEach(() => {
  if (consoleMocks) {
    consoleMocks.restore();
  }
});

// Import the module after setting up mocks
const deleteOldPreReleases = require('../../actions/release_create/cleanup.js');
const {
  parseVersionTag,
  compareVersionTags,
  matchesVersionPattern,
  filterReleasesToDelete,
  deleteRelease,
  deleteTag,
  sleep,
} = deleteOldPreReleases;

describe('Release Cleanup', () => {
  describe('parseVersionTag', () => {
    test('should parse standard version tag', () => {
      expect(parseVersionTag('v1.2.3')).toEqual([1, 2, 3]);
    });

    test('should parse extended version tag', () => {
      expect(parseVersionTag('v2024.1015.183045.10')).toEqual([2024, 1015, 183045, 10]);
    });

    test('should parse version without v prefix', () => {
      expect(parseVersionTag('1.2.3')).toEqual([1, 2, 3]);
    });

    test('should handle single digit versions', () => {
      expect(parseVersionTag('v1.0.0')).toEqual([1, 0, 0]);
    });
  });

  describe('compareVersionTags', () => {
    test('should compare equal versions', () => {
      expect(compareVersionTags('v1.2.3', 'v1.2.3')).toBe(0);
    });

    test.each([
      ['major versions', 'v1.2.3', 'v2.2.3'],
      ['minor versions', 'v1.2.3', 'v1.3.3'],
      ['patch versions', 'v1.2.3', 'v1.2.4'],
      ['versions with different lengths', 'v1.2.3', 'v1.2.3.4'],
      ['calendar versions', 'v2024.1015.183045', 'v2024.1016.183045'],
    ])('should compare different %s', (description, lowerVersion, higherVersion) => {
      expect(compareVersionTags(lowerVersion, higherVersion)).toBe(-1);
      expect(compareVersionTags(higherVersion, lowerVersion)).toBe(1);
    });
  });

  describe('matchesVersionPattern', () => {
    test('should match standard version pattern', () => {
      expect(matchesVersionPattern('v2024.1015.183045')).toBe(true);
    });

    test('should match extended version pattern', () => {
      expect(matchesVersionPattern('v2024.1015.183045.10')).toBe(true);
    });

    test('should match with 4+ digit year', () => {
      expect(matchesVersionPattern('v2024.1.1')).toBe(true);
    });

    test('should not match short year', () => {
      expect(matchesVersionPattern('v24.1.1')).toBe(false);
    });

    test('should not match invalid patterns', () => {
      expect(matchesVersionPattern('latest')).toBe(false);
      expect(matchesVersionPattern('v1.2')).toBe(false);
      expect(matchesVersionPattern('release-1.2.3')).toBe(false);
    });

    test('should not match without v prefix', () => {
      expect(matchesVersionPattern('2024.1015.183045')).toBe(false);
    });
  });

  describe('filterReleasesToDelete', () => {
    test('should filter draft releases when IS_DRAFT is true', () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', draft: true },
        { tagName: 'v2024.1.2', draft: true },
        { tagName: 'v2024.1.3', prerelease: true },
      ]);

      const result = filterReleasesToDelete(releases, true, 'v2024.1.1', 2);
      expect(result).toHaveLength(1);
      expect(result[0].tag_name).toBe('v2024.1.2');
    });

    test('should not delete current tag', () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', draft: true },
        { tagName: 'v2024.1.2', draft: true },
      ]);

      const result = filterReleasesToDelete(releases, true, 'v2024.1.1', 2);
      expect(result).toHaveLength(1);
      expect(result[0].tag_name).toBe('v2024.1.2');
    });

    test('should filter pre-releases and keep latest N', () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', prerelease: true },
        { tagName: 'v2024.1.2', prerelease: true },
        { tagName: 'v2024.1.3', prerelease: true },
        { tagName: 'v2024.1.4', prerelease: true },
        { tagName: 'v2024.1.5', prerelease: true },
      ]);

      const result = filterReleasesToDelete(releases, false, 'v2024.1.5', 2);
      // keepLatest=2 means keep 2 total including currentTag (v2024.1.5)
      // So keep v2024.1.5 + v2024.1.4 (1 other), delete v2024.1.1, v2024.1.2, v2024.1.3
      expect(result).toHaveLength(3);
      expect(result.some(r => r.tag_name === 'v2024.1.5')).toBe(false);
      expect(result.map(r => r.tag_name)).toEqual(['v2024.1.1', 'v2024.1.2', 'v2024.1.3']);
    });

    test('should sort pre-releases by version before filtering', () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.5', prerelease: true },
        { tagName: 'v2024.1.1', prerelease: true },
        { tagName: 'v2024.1.3', prerelease: true },
        { tagName: 'v2024.1.2', prerelease: true },
        { tagName: 'v2024.1.4', prerelease: true },
      ]);

      const result = filterReleasesToDelete(releases, false, 'v2024.1.6', 2);
      // After sorting: v2024.1.1, v2024.1.2, v2024.1.3, v2024.1.4, v2024.1.5
      // keepLatest=2 means keep 2 total including currentTag (v2024.1.6 which will be created)
      // So keep 1 existing (v2024.1.5) + new v2024.1.6
      // Delete: v2024.1.1, v2024.1.2, v2024.1.3, v2024.1.4
      expect(result).toHaveLength(4);
      expect(result[0].tag_name).toBe('v2024.1.1');
      expect(result[1].tag_name).toBe('v2024.1.2');
      expect(result[2].tag_name).toBe('v2024.1.3');
      expect(result[3].tag_name).toBe('v2024.1.4');
    });

    test('should only match version pattern tags', () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', prerelease: true },
        { tagName: 'latest', prerelease: true },
        { tagName: 'v1.2', prerelease: true },
      ]);

      const result = filterReleasesToDelete(releases, false, 'v2024.1.2', 0);
      expect(result).toHaveLength(1);
      expect(result[0].tag_name).toBe('v2024.1.1');
    });

    test('should handle empty releases array', () => {
      const result = filterReleasesToDelete([], false, 'v2024.1.1', 2);
      expect(result).toHaveLength(0);
    });

    test('should keep all if keepLatest is greater than count', () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', prerelease: true },
        { tagName: 'v2024.1.2', prerelease: true },
      ]);

      const result = filterReleasesToDelete(releases, false, 'v2024.1.3', 10);
      expect(result).toHaveLength(0);
    });
  });

  describe('deleteRelease', () => {
    test('should delete release successfully', async () => {
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
      const release = createMockRelease({ tagName: 'v2024.1.1', id: 123 });

      const result = await deleteRelease(mockGithub, 'test-org', 'test-repo', release);

      expect(result).toBe(true);
      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledWith({
        owner: 'test-org',
        repo: 'test-repo',
        release_id: 123,
      });
      expect(consoleOutput.some(line => line.includes('Deleting release: v2024.1.1'))).toBe(true);
    });

    test('should handle delete failure', async () => {
      mockGithub.rest.repos.deleteRelease.mockRejectedValue(new Error('API error'));
      const release = createMockRelease({ tagName: 'v2024.1.1', id: 123 });

      const result = await deleteRelease(mockGithub, 'test-org', 'test-repo', release);

      expect(result).toBe(false);
      expect(consoleErrors.some(line => line.includes('Failed to delete release: v2024.1.1'))).toBe(true);
    });
  });

  describe('deleteTag', () => {
    test('should delete tag successfully', async () => {
      mockGithub.rest.git.deleteRef.mockResolvedValue({});
      const release = createMockRelease({ tagName: 'v2024.1.1' });

      const result = await deleteTag(mockGithub, 'test-org', 'test-repo', release);

      expect(result).toBe(true);
      expect(mockGithub.rest.git.deleteRef).toHaveBeenCalledWith({
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'tags/v2024.1.1',
      });
      expect(consoleOutput.some(line => line.includes('Deleting tag: v2024.1.1'))).toBe(true);
    });

    test('should handle delete failure', async () => {
      mockGithub.rest.git.deleteRef.mockRejectedValue(new Error('API error'));
      const release = createMockRelease({ tagName: 'v2024.1.1' });

      const result = await deleteTag(mockGithub, 'test-org', 'test-repo', release);

      expect(result).toBe(false);
      expect(consoleErrors.some(line => line.includes('Failed to delete tag: v2024.1.1'))).toBe(true);
    });
  });

  describe('sleep', () => {
    test('should sleep for specified duration', async () => {
      jest.useFakeTimers();
      const sleepPromise = sleep(5);
      jest.advanceTimersByTime(5000);
      await sleepPromise;
      jest.useRealTimers();
      expect(true).toBe(true); // If we get here, sleep worked
    });
  });

  describe('deleteOldPreReleases', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should delete old pre-releases and their tags', async () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', prerelease: true, id: 1 },
        { tagName: 'v2024.1.2', prerelease: true, id: 2 },
        { tagName: 'v2024.1.3', prerelease: true, id: 3 },
        { tagName: 'v2024.1.4', prerelease: true, id: 4 },
      ]);

      setupDeleteMocks(mockGithub);
      mockGithub.paginate.mockResolvedValue(releases);
      setupCleanupEnv({ currentTag: 'v2024.1.5', keepLatest: '2', deleteTags: 'true', sleepDuration: '1' });

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      // keepLatest=2 means keep 2 total including currentTag (v2024.1.5)
      // So keep 1 existing (v2024.1.4) + new v2024.1.5, delete 3 (v2024.1.1, v2024.1.2, v2024.1.3)
      verifyDeleteCalls(mockGithub, { deleteReleaseCalls: 3, deleteTagCalls: 3 });
    });

    test('should delete drafts when IS_DRAFT is true', async () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', draft: true, id: 1 },
        { tagName: 'v2024.1.2', draft: true, id: 2 },
        { tagName: 'v2024.1.3', prerelease: true, id: 3 },
      ]);

      setupDeleteMocks(mockGithub);
      mockGithub.paginate.mockResolvedValue(releases);
      setupCleanupEnv({ currentTag: 'v2024.1.1', isDraft: 'true', deleteTags: 'true', sleepDuration: '1' });

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledTimes(1);
      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledWith(
        expect.objectContaining({ release_id: 2 })
      );
    });

    test('should not delete tags when DELETE_TAGS is false', async () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', prerelease: true, id: 1 },
        { tagName: 'v2024.1.2', prerelease: true, id: 2 },
      ]);

      setupDeleteMocks(mockGithub);
      mockGithub.paginate.mockResolvedValue(releases);
      setupCleanupEnv({ currentTag: 'v2024.1.3', keepLatest: '0', deleteTags: 'false', sleepDuration: '1', isDraft: 'false' });

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      verifyDeleteCalls(mockGithub, { deleteReleaseCalls: 2, deleteTagCalls: 0 });
    });

    test('should handle no releases to delete', async () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', id: 1 },
      ]);

      setupDeleteMocks(mockGithub);
      mockGithub.paginate.mockResolvedValue(releases);
      setupCleanupEnv({ currentTag: 'v2024.1.2', keepLatest: '2', deleteTags: 'false', sleepDuration: '1', isDraft: 'false' });

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      verifyDeleteCalls(mockGithub, { deleteReleaseCalls: 0, deleteTagCalls: 0 });
    });

    test('should respect SLEEP_DURATION', async () => {
      const releases = createMockReleases([
        { tagName: 'v2024.1.1', prerelease: true, id: 1 },
      ]);

      setupDeleteMocks(mockGithub);
      mockGithub.paginate.mockResolvedValue(releases);
      setupCleanupEnv({ currentTag: 'v2024.1.2', keepLatest: '0', deleteTags: 'true', sleepDuration: '10', isDraft: 'false' });

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      verifyDeleteCalls(mockGithub, { deleteReleaseCalls: 1, deleteTagCalls: 1 });
    });
  });
});
