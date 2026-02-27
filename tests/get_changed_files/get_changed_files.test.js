import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

const { createMockContext, createMockGithub, createMockCore, setupConsoleMocks } = require('../testUtils.js');

const getChangedFilesAction = require('../../actions/get_changed_files/get_changed_files.js');
const { getChangedFiles } = getChangedFilesAction;

let consoleMocks;
let consoleOutput;

beforeEach(() => {
  jest.clearAllMocks();
  consoleMocks = setupConsoleMocks();
  consoleOutput = consoleMocks.consoleOutput;

  // Clear environment variables
  delete process.env.INPUT_PR_NUMBER;
});

afterEach(() => {
  if (consoleMocks) {
    consoleMocks.restore();
  }
});

describe('getChangedFiles', () => {
  test('should return list of changed file paths', async () => {
    const mockGithub = createMockGithub();
    const mockContext = createMockContext();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([
      { filename: 'src/index.js' },
      { filename: 'README.md' },
      { filename: 'package.json' },
    ]);

    const files = await getChangedFiles(mockGithub, mockContext, 42);

    expect(files).toEqual(['src/index.js', 'README.md', 'package.json']);
    expect(mockGithub.rest.pulls.listFiles.endpoint.merge).toHaveBeenCalledWith({
      owner: 'test-org',
      repo: 'test-repo',
      pull_number: 42,
    });
  });

  test('should convert string pr number to number', async () => {
    const mockGithub = createMockGithub();
    const mockContext = createMockContext();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([{ filename: 'file.js' }]);

    await getChangedFiles(mockGithub, mockContext, '99');

    expect(mockGithub.rest.pulls.listFiles.endpoint.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 99 })
    );
  });

  test('should return empty array when no files changed', async () => {
    const mockGithub = createMockGithub();
    const mockContext = createMockContext();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([]);

    const files = await getChangedFiles(mockGithub, mockContext, 1);

    expect(files).toEqual([]);
  });
});

describe('getChangedFilesAction', () => {
  test('should set CHANGED_FILES output', async () => {
    const mockGithub = createMockGithub();
    const mockContext = createMockContext();
    const mockCore = createMockCore();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([
      { filename: 'src/a.js' },
      { filename: 'src/b.js' },
    ]);
    process.env.INPUT_PR_NUMBER = '10';

    await getChangedFilesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setOutput).toHaveBeenCalledWith('CHANGED_FILES', 'src/a.js\nsrc/b.js');
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('should log changed files', async () => {
    const mockGithub = createMockGithub();
    const mockContext = createMockContext();
    const mockCore = createMockCore();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([{ filename: 'file.txt' }]);
    process.env.INPUT_PR_NUMBER = '5';

    await getChangedFilesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(consoleOutput.some(line => line.includes('PR #5'))).toBe(true);
    expect(consoleOutput.some(line => line.includes('file.txt'))).toBe(true);
  });

  test('should use context PR number when INPUT_PR_NUMBER not set', async () => {
    const mockGithub = createMockGithub();
    const mockContext = {
      ...createMockContext(),
      payload: { pull_request: { number: 7 } },
    };
    const mockCore = createMockCore();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([{ filename: 'changed.js' }]);

    await getChangedFilesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).not.toHaveBeenCalled();
    expect(mockCore.setOutput).toHaveBeenCalledWith('CHANGED_FILES', 'changed.js');
  });

  test('should fail when no PR number is available', async () => {
    const mockGithub = createMockGithub();
    const mockContext = {
      ...createMockContext(),
      payload: {},
    };
    const mockCore = createMockCore();

    await getChangedFilesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('No pull request number provided')
    );
  });

  test('should fail when API throws an error', async () => {
    const mockGithub = createMockGithub();
    const mockContext = createMockContext();
    const mockCore = createMockCore();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockRejectedValue(new Error('API error'));
    process.env.INPUT_PR_NUMBER = '1';

    await getChangedFilesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('API error'));
  });
});
