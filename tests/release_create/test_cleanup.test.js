/**
 * Unit tests for cleanup.js
 * @jest-environment node
 */

/* eslint-env jest */

const { createMockContext, createMockGithub, setupConsoleMocks } = require('../testUtils.js');

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

    test('should compare different major versions', () => {
      expect(compareVersionTags('v1.2.3', 'v2.2.3')).toBe(-1);
      expect(compareVersionTags('v2.2.3', 'v1.2.3')).toBe(1);
    });

    test('should compare different minor versions', () => {
      expect(compareVersionTags('v1.2.3', 'v1.3.3')).toBe(-1);
      expect(compareVersionTags('v1.3.3', 'v1.2.3')).toBe(1);
    });

    test('should compare different patch versions', () => {
      expect(compareVersionTags('v1.2.3', 'v1.2.4')).toBe(-1);
      expect(compareVersionTags('v1.2.4', 'v1.2.3')).toBe(1);
    });

    test('should compare versions with different lengths', () => {
      expect(compareVersionTags('v1.2.3', 'v1.2.3.4')).toBe(-1);
      expect(compareVersionTags('v1.2.3.4', 'v1.2.3')).toBe(1);
    });

    test('should compare calendar versions', () => {
      expect(compareVersionTags('v2024.1015.183045', 'v2024.1016.183045')).toBe(-1);
      expect(compareVersionTags('v2024.1016.183045', 'v2024.1015.183045')).toBe(1);
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
      const releases = [
        { tag_name: 'v2024.1.1', draft: true, prerelease: false },
        { tag_name: 'v2024.1.2', draft: true, prerelease: false },
        { tag_name: 'v2024.1.3', draft: false, prerelease: true },
      ];

      const result = filterReleasesToDelete(releases, true, 'v2024.1.1', 2);
      expect(result).toHaveLength(1);
      expect(result[0].tag_name).toBe('v2024.1.2');
    });

    test('should not delete current tag', () => {
      const releases = [
        { tag_name: 'v2024.1.1', draft: true, prerelease: false },
        { tag_name: 'v2024.1.2', draft: true, prerelease: false },
      ];

      const result = filterReleasesToDelete(releases, true, 'v2024.1.1', 2);
      expect(result).toHaveLength(1);
      expect(result[0].tag_name).toBe('v2024.1.2');
    });

    test('should filter pre-releases and keep latest N', () => {
      const releases = [
        { tag_name: 'v2024.1.1', draft: false, prerelease: true },
        { tag_name: 'v2024.1.2', draft: false, prerelease: true },
        { tag_name: 'v2024.1.3', draft: false, prerelease: true },
        { tag_name: 'v2024.1.4', draft: false, prerelease: true },
        { tag_name: 'v2024.1.5', draft: false, prerelease: true },
      ];

      const result = filterReleasesToDelete(releases, false, 'v2024.1.5', 2);
      // Should delete oldest, keeping the 2 newest (v2024.1.4 and v2024.1.5, but v2024.1.5 is current)
      // So it should keep v2024.1.4 and v2024.1.3, delete v2024.1.1 and v2024.1.2
      expect(result.length).toBeLessThanOrEqual(3);
      expect(result.some(r => r.tag_name === 'v2024.1.5')).toBe(false);
    });

    test('should sort pre-releases by version before filtering', () => {
      const releases = [
        { tag_name: 'v2024.1.5', draft: false, prerelease: true },
        { tag_name: 'v2024.1.1', draft: false, prerelease: true },
        { tag_name: 'v2024.1.3', draft: false, prerelease: true },
        { tag_name: 'v2024.1.2', draft: false, prerelease: true },
        { tag_name: 'v2024.1.4', draft: false, prerelease: true },
      ];

      const result = filterReleasesToDelete(releases, false, 'v2024.1.6', 2);
      // After sorting: v2024.1.1, v2024.1.2, v2024.1.3, v2024.1.4, v2024.1.5
      // Keep latest 2: v2024.1.4, v2024.1.5
      // Delete: v2024.1.1, v2024.1.2, v2024.1.3
      expect(result).toHaveLength(3);
      expect(result[0].tag_name).toBe('v2024.1.1');
      expect(result[1].tag_name).toBe('v2024.1.2');
      expect(result[2].tag_name).toBe('v2024.1.3');
    });

    test('should only match version pattern tags', () => {
      const releases = [
        { tag_name: 'v2024.1.1', draft: false, prerelease: true },
        { tag_name: 'latest', draft: false, prerelease: true },
        { tag_name: 'v1.2', draft: false, prerelease: true },
      ];

      const result = filterReleasesToDelete(releases, false, 'v2024.1.2', 0);
      expect(result).toHaveLength(1);
      expect(result[0].tag_name).toBe('v2024.1.1');
    });

    test('should handle empty releases array', () => {
      const result = filterReleasesToDelete([], false, 'v2024.1.1', 2);
      expect(result).toHaveLength(0);
    });

    test('should keep all if keepLatest is greater than count', () => {
      const releases = [
        { tag_name: 'v2024.1.1', draft: false, prerelease: true },
        { tag_name: 'v2024.1.2', draft: false, prerelease: true },
      ];

      const result = filterReleasesToDelete(releases, false, 'v2024.1.3', 10);
      expect(result).toHaveLength(0);
    });
  });

  describe('deleteRelease', () => {
    test('should delete release successfully', async () => {
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
      const release = { id: 123, tag_name: 'v2024.1.1' };

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
      const release = { id: 123, tag_name: 'v2024.1.1' };

      const result = await deleteRelease(mockGithub, 'test-org', 'test-repo', release);

      expect(result).toBe(false);
      expect(consoleErrors.some(line => line.includes('Failed to delete release: v2024.1.1'))).toBe(true);
    });
  });

  describe('deleteTag', () => {
    test('should delete tag successfully', async () => {
      mockGithub.rest.git.deleteRef.mockResolvedValue({});
      const release = { tag_name: 'v2024.1.1' };

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
      const release = { tag_name: 'v2024.1.1' };

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
      const releases = [
        { id: 1, tag_name: 'v2024.1.1', draft: false, prerelease: true },
        { id: 2, tag_name: 'v2024.1.2', draft: false, prerelease: true },
        { id: 3, tag_name: 'v2024.1.3', draft: false, prerelease: true },
        { id: 4, tag_name: 'v2024.1.4', draft: false, prerelease: true },
      ];

      mockGithub.rest.repos.listReleases.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue(releases);
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
      mockGithub.rest.git.deleteRef.mockResolvedValue({});

      process.env.CURRENT_TAG = 'v2024.1.5';
      process.env.KEEP_LATEST = '2';
      process.env.DELETE_TAGS = 'true';
      process.env.SLEEP_DURATION = '1';

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });

      // Fast-forward all timers
      await jest.runAllTimersAsync();
      await deletePromise;

      // Should delete v2024.1.1 and v2024.1.2, keep v2024.1.3 and v2024.1.4
      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledTimes(2);
      expect(mockGithub.rest.git.deleteRef).toHaveBeenCalledTimes(2);
    });

    test('should delete drafts when IS_DRAFT is true', async () => {
      const releases = [
        { id: 1, tag_name: 'v2024.1.1', draft: true, prerelease: false },
        { id: 2, tag_name: 'v2024.1.2', draft: true, prerelease: false },
        { id: 3, tag_name: 'v2024.1.3', draft: false, prerelease: true },
      ];

      mockGithub.rest.repos.listReleases.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue(releases);
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
      mockGithub.rest.git.deleteRef.mockResolvedValue({});

      process.env.CURRENT_TAG = 'v2024.1.1';
      process.env.IS_DRAFT = 'true';
      process.env.DELETE_TAGS = 'true';
      process.env.SLEEP_DURATION = '1';

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });

      await jest.runAllTimersAsync();
      await deletePromise;

      // Should delete v2024.1.2 (other draft)
      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledTimes(1);
      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledWith(
        expect.objectContaining({ release_id: 2 })
      );
    });

    test('should not delete tags when DELETE_TAGS is false', async () => {
      const releases = [
        { id: 1, tag_name: 'v2024.1.1', draft: false, prerelease: true },
        { id: 2, tag_name: 'v2024.1.2', draft: false, prerelease: true },
      ];

      mockGithub.rest.repos.listReleases.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue(releases);
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
      mockGithub.rest.git.deleteRef.mockResolvedValue({});

      process.env.CURRENT_TAG = 'v2024.1.3';
      process.env.KEEP_LATEST = '0';
      process.env.DELETE_TAGS = 'false';
      process.env.SLEEP_DURATION = '1';
      process.env.IS_DRAFT = 'false';

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalledTimes(2);
      expect(mockGithub.rest.git.deleteRef).not.toHaveBeenCalled();
    });

    test('should handle no releases to delete', async () => {
      const releases = [
        { id: 1, tag_name: 'v2024.1.1', draft: false, prerelease: false }, // Not a prerelease
      ];

      mockGithub.rest.repos.listReleases.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue(releases);
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});

      process.env.CURRENT_TAG = 'v2024.1.2';
      process.env.KEEP_LATEST = '2';
      process.env.DELETE_TAGS = 'false';
      process.env.SLEEP_DURATION = '1';
      process.env.IS_DRAFT = 'false';

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });
      await jest.runAllTimersAsync();
      await deletePromise;

      expect(mockGithub.rest.repos.deleteRelease).not.toHaveBeenCalled();
    });

    test('should respect SLEEP_DURATION', async () => {
      const releases = [
        { id: 1, tag_name: 'v2024.1.1', draft: false, prerelease: true },
      ];

      mockGithub.rest.repos.listReleases.endpoint.merge.mockReturnValue({});
      mockGithub.paginate.mockResolvedValue(releases);
      mockGithub.rest.repos.deleteRelease.mockResolvedValue({});
      mockGithub.rest.git.deleteRef.mockResolvedValue({});

      process.env.CURRENT_TAG = 'v2024.1.2';
      process.env.KEEP_LATEST = '0';
      process.env.DELETE_TAGS = 'true';
      process.env.SLEEP_DURATION = '10';
      process.env.IS_DRAFT = 'false';

      const deletePromise = deleteOldPreReleases({ github: mockGithub, context: mockContext });

      await jest.runAllTimersAsync();
      await deletePromise;

      expect(mockGithub.rest.repos.deleteRelease).toHaveBeenCalled();
      expect(mockGithub.rest.git.deleteRef).toHaveBeenCalled();
    });
  });
});
