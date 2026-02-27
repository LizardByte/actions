import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { createMockContext, createMockGithub, createMockCore, setupConsoleMocks } = require('../testUtils.js');

const checkTrailingSpacesAction = require('../../actions/check_trailing_spaces/check_trailing_spaces.js');
const {
  isTextFile,
  shouldIgnoreFile,
  getAllFiles,
  checkTrailingSpaces,
  checkEmptyLineAtEof,
  checkMissingNewlineAtEof,
  getChangedFilesFromApi,
  resolveFilesToCheck,
  runChecks,
  reportResults,
} = checkTrailingSpacesAction;

let tmpDir;
let consoleMocks;
let consoleOutput;

/**
 * Write a file to the temp directory.
 * @param {string} name - filename
 * @param {string} content - file content (as raw string, no auto newline)
 * @returns {string} full path to created file
 */
function writeTmpFile(name, content) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

beforeEach(() => {
  jest.clearAllMocks();
  consoleMocks = setupConsoleMocks();
  consoleOutput = consoleMocks.consoleOutput;

  // Create a fresh temp directory for each test
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-trailing-spaces-test-'));

  // Clear environment variables
  delete process.env.INPUT_PR_NUMBER;
  delete process.env.INPUT_CHANGED_FILES;
  delete process.env.INPUT_CHECK_ALL_FILES;
  delete process.env.INPUT_CHECK_EMPTY_LINE_AT_EOF;
  delete process.env.INPUT_CHECK_MISSING_NEWLINE_AT_EOF;
  delete process.env.INPUT_SOURCE_DIRECTORY;
  delete process.env.INPUT_IGNORE_PATTERNS;
});

afterEach(() => {
  if (consoleMocks) {
    consoleMocks.restore();
  }
  // Clean up temp directory
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('isTextFile', () => {
  test('should return true for a text file', () => {
    const filePath = writeTmpFile('text.txt', 'Hello, world!\n');
    expect(isTextFile(filePath)).toBe(true);
  });

  test('should return false for an empty file', () => {
    const filePath = writeTmpFile('empty.txt', '');
    expect(isTextFile(filePath)).toBe(false);
  });

  test('should return false for a binary file (contains null byte)', () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    fs.writeFileSync(filePath, buf);
    expect(isTextFile(filePath)).toBe(false);
  });

  test('should return false for a non-existent file', () => {
    expect(isTextFile(path.join(tmpDir, 'nonexistent.txt'))).toBe(false);
  });

  test('should return false for a directory', () => {
    expect(isTextFile(tmpDir)).toBe(false);
  });
});

describe('shouldIgnoreFile', () => {
  test('should return false when no patterns are provided', () => {
    expect(shouldIgnoreFile('src/index.js', [])).toBe(false);
  });

  test('should return false when patterns is null', () => {
    expect(shouldIgnoreFile('src/index.js', null)).toBe(false);
  });

  test('should match simple extension pattern', () => {
    expect(shouldIgnoreFile('image.png', ['*.png'])).toBe(true);
  });

  test('should match file in subdirectory with extension pattern', () => {
    expect(shouldIgnoreFile('assets/image.png', ['*.png'])).toBe(true);
  });

  test('should not match file with different extension', () => {
    expect(shouldIgnoreFile('image.jpg', ['*.png'])).toBe(false);
  });

  test('should match exact filename', () => {
    expect(shouldIgnoreFile('package-lock.json', ['package-lock.json'])).toBe(true);
  });

  test('should match with question mark wildcard', () => {
    expect(shouldIgnoreFile('file1.txt', ['file?.txt'])).toBe(true);
  });

  test('should not match when pattern does not fit', () => {
    expect(shouldIgnoreFile('file10.txt', ['file?.txt'])).toBe(false);
  });

  test('should ignore empty patterns', () => {
    expect(shouldIgnoreFile('file.js', ['', '  ', '*.ts'])).toBe(false);
  });

  test('should handle Windows path separators', () => {
    expect(shouldIgnoreFile(String.raw`src\image.png`, ['*.png'])).toBe(true);
  });

  test('should match against multiple patterns', () => {
    expect(shouldIgnoreFile('image.jpg', ['*.png', '*.jpg', '*.gif'])).toBe(true);
  });
});

describe('getAllFiles', () => {
  test('should return all files in directory', () => {
    writeTmpFile('a.txt', 'a\n');
    writeTmpFile('b.txt', 'b\n');
    const files = getAllFiles(tmpDir);
    expect(files).toHaveLength(2);
  });

  test('should recurse into subdirectories', () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    writeTmpFile('root.txt', 'root\n');
    fs.writeFileSync(path.join(subDir, 'sub.txt'), 'sub\n');

    const files = getAllFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.some(f => f.endsWith('root.txt'))).toBe(true);
    expect(files.some(f => f.endsWith('sub.txt'))).toBe(true);
  });

  test('should skip .git directory', () => {
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir);
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    writeTmpFile('real.txt', 'content\n');

    const files = getAllFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/real\.txt$/);
  });

  test('should return empty array for empty directory', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);
    expect(getAllFiles(emptyDir)).toEqual([]);
  });

  test('should handle unreadable directory gracefully', () => {
    // Pass a non-existent directory - readdirSync will throw
    const nonExistent = path.join(tmpDir, 'does-not-exist');
    expect(getAllFiles(nonExistent)).toEqual([]);
  });
});

describe('checkTrailingSpaces', () => {
  test('should return empty array for clean file', () => {
    const filePath = writeTmpFile('clean.txt', 'line one\nline two\n');
    expect(checkTrailingSpaces(filePath)).toEqual([]);
  });

  test('should detect trailing spaces', () => {
    const filePath = writeTmpFile('spaces.txt', 'line one   \nline two\n');
    const violations = checkTrailingSpaces(filePath);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ file: filePath, line: 1 });
  });

  test('should detect trailing tabs', () => {
    const filePath = writeTmpFile('tabs.txt', 'line one\t\nline two\n');
    const violations = checkTrailingSpaces(filePath);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
  });

  test('should detect multiple violations', () => {
    const filePath = writeTmpFile('multi.txt', 'line one   \nline two\nline three  \n');
    const violations = checkTrailingSpaces(filePath);
    expect(violations).toHaveLength(2);
    expect(violations[0].line).toBe(1);
    expect(violations[1].line).toBe(3);
  });

  test('should return empty for non-existent file', () => {
    expect(checkTrailingSpaces(path.join(tmpDir, 'missing.txt'))).toEqual([]);
  });

  test('should detect violations on any line number', () => {
    const filePath = writeTmpFile('deep.txt', 'ok\nok\nok\nbad   \nok\n');
    const violations = checkTrailingSpaces(filePath);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(4);
  });
});

describe('checkEmptyLineAtEof', () => {
  test('should return -1 for a file with proper newline at end', () => {
    const filePath = writeTmpFile('good.txt', 'line one\nline two\n');
    expect(checkEmptyLineAtEof(filePath)).toBe(-1);
  });

  test('should return last line number for file ending with blank line', () => {
    // 'line one\nline two\n\n' splits into ['line one', 'line two', '', '']
    // lines.length - 1 = 3
    const filePath = writeTmpFile('blank.txt', 'line one\nline two\n\n');
    expect(checkEmptyLineAtEof(filePath)).toBe(3);
  });

  test('should return -1 for empty file', () => {
    const filePath = writeTmpFile('empty.txt', '');
    expect(checkEmptyLineAtEof(filePath)).toBe(-1);
  });

  test('should return -1 for file missing newline at end', () => {
    const filePath = writeTmpFile('nonewline.txt', 'no newline');
    expect(checkEmptyLineAtEof(filePath)).toBe(-1);
  });

  test('should return -1 for non-existent file', () => {
    expect(checkEmptyLineAtEof(path.join(tmpDir, 'missing.txt'))).toBe(-1);
  });

  test('should return last line number for multiple blank lines at end', () => {
    // 'content\n\n\n' splits into ['content', '', '', '']
    // lines.length - 1 = 3
    const filePath = writeTmpFile('multi.txt', 'content\n\n\n');
    expect(checkEmptyLineAtEof(filePath)).toBe(3);
  });
});

describe('checkMissingNewlineAtEof', () => {
  test('should return -1 for file ending with newline', () => {
    const filePath = writeTmpFile('good.txt', 'line one\nline two\n');
    expect(checkMissingNewlineAtEof(filePath)).toBe(-1);
  });

  test('should return last line number for file missing newline at end', () => {
    // 'no newline here' splits into ['no newline here'] → 1 line
    const filePath = writeTmpFile('nonewline.txt', 'no newline here');
    expect(checkMissingNewlineAtEof(filePath)).toBe(1);
  });

  test('should return -1 for empty file', () => {
    const filePath = writeTmpFile('empty.txt', '');
    expect(checkMissingNewlineAtEof(filePath)).toBe(-1);
  });

  test('should return -1 for non-existent file', () => {
    expect(checkMissingNewlineAtEof(path.join(tmpDir, 'missing.txt'))).toBe(-1);
  });

  test('should return -1 for file ending with blank line (has newline)', () => {
    const filePath = writeTmpFile('blankend.txt', 'content\n\n');
    expect(checkMissingNewlineAtEof(filePath)).toBe(-1);
  });

  test('should return correct line number for multi-line file missing newline', () => {
    // 'line one\nline two' splits into ['line one', 'line two'] → 2 lines
    const filePath = writeTmpFile('multiline.txt', 'line one\nline two');
    expect(checkMissingNewlineAtEof(filePath)).toBe(2);
  });
});

describe('resolveFilesToCheck', () => {
  let mockGithub;
  let mockContext;

  beforeEach(() => {
    mockGithub = createMockGithub();
    mockContext = createMockContext();
  });

  test('should use changedFilesInput when provided', async () => {
    const files = await resolveFilesToCheck({
      changedFilesInput: 'src/a.js\nsrc/b.js',
      checkAllFiles: false,
      sourceDirectory: '.',
      github: mockGithub,
      context: mockContext,
      prNumber: null,
    });

    expect(files).toEqual(['src/a.js', 'src/b.js']);
    expect(consoleOutput.some(l => l.includes('provided changed_files input'))).toBe(true);
  });

  test('should handle filenames containing spaces', async () => {
    const files = await resolveFilesToCheck({
      changedFilesInput: 'src/my file.js\nsrc/other file.ts',
      checkAllFiles: false,
      sourceDirectory: '.',
      github: mockGithub,
      context: mockContext,
      prNumber: null,
    });

    expect(files).toEqual(['src/my file.js', 'src/other file.ts']);
  });

  test('should handle trailing whitespace around filenames in input', async () => {
    const files = await resolveFilesToCheck({
      changedFilesInput: '  src/a.js  \n  src/b.js  ',
      checkAllFiles: false,
      sourceDirectory: '.',
      github: mockGithub,
      context: mockContext,
      prNumber: null,
    });

    expect(files).toEqual(['src/a.js', 'src/b.js']);
  });

  test('should get all files when checkAllFiles is true', async () => {
    writeTmpFile('file1.txt', 'content\n');
    writeTmpFile('file2.txt', 'content\n');

    const files = await resolveFilesToCheck({
      changedFilesInput: '',
      checkAllFiles: true,
      sourceDirectory: tmpDir,
      github: mockGithub,
      context: mockContext,
      prNumber: null,
    });

    expect(files).toHaveLength(2);
    expect(consoleOutput.some(l => l.includes('Checking all files'))).toBe(true);
  });

  test('should use GitHub API when PR number is provided', async () => {
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockResolvedValue([
      { filename: 'changed.js' },
      { filename: 'other.ts' },
    ]);

    const files = await resolveFilesToCheck({
      changedFilesInput: '',
      checkAllFiles: false,
      sourceDirectory: '.',
      github: mockGithub,
      context: mockContext,
      prNumber: 5,
    });

    expect(files).toEqual(['changed.js', 'other.ts']);
    expect(consoleOutput.some(l => l.includes('PR #5'))).toBe(true);
  });

  test('should fall back to all files when no PR number and no changed_files', async () => {
    writeTmpFile('fallback.txt', 'content\n');

    const files = await resolveFilesToCheck({
      changedFilesInput: '',
      checkAllFiles: false,
      sourceDirectory: tmpDir,
      github: mockGithub,
      context: mockContext,
      prNumber: null,
    });

    expect(files).toHaveLength(1);
    expect(consoleOutput.some(l => l.includes('Falling back to checking all files'))).toBe(true);
  });
});

describe('getChangedFilesFromApi', () => {
  let mockGithub;
  let mockContext;

  beforeEach(() => {
    mockGithub = createMockGithub();
    mockContext = createMockContext();
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
  });

  test('should return list of changed file paths from the API', async () => {
    mockGithub.paginate.mockResolvedValue([
      { filename: 'src/index.js' },
      { filename: 'README.md' },
    ]);

    const files = await getChangedFilesFromApi(mockGithub, mockContext, 42);

    expect(files).toEqual(['src/index.js', 'README.md']);
    expect(mockGithub.rest.pulls.listFiles.endpoint.merge).toHaveBeenCalledWith({
      owner: 'test-org',
      repo: 'test-repo',
      pull_number: 42,
    });
  });

  test('should convert string pr number to a Number', async () => {
    mockGithub.paginate.mockResolvedValue([{ filename: 'file.js' }]);

    await getChangedFilesFromApi(mockGithub, mockContext, '7');

    expect(mockGithub.rest.pulls.listFiles.endpoint.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 7 })
    );
  });

  test('should return empty array when no files changed', async () => {
    mockGithub.paginate.mockResolvedValue([]);

    const files = await getChangedFilesFromApi(mockGithub, mockContext, 1);

    expect(files).toEqual([]);
  });
});

describe('runChecks', () => {
  test('should return empty results for clean files', () => {
    const filePath = writeTmpFile('clean.txt', 'line one\nline two\n');
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: true,
      checkMissingNewlineAtEof: true,
      ignorePatterns: [],
    });
    expect(results.trailingSpaces).toHaveLength(0);
    expect(results.emptyLines).toHaveLength(0);
    expect(results.missingNewlines).toHaveLength(0);
  });

  test('should detect trailing spaces', () => {
    const filePath = writeTmpFile('spaces.txt', 'line   \nline two\n');
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: true,
      checkMissingNewlineAtEof: true,
      ignorePatterns: [],
    });
    expect(results.trailingSpaces).toHaveLength(1);
  });

  test('should detect empty line at eof and include last line number', () => {
    // 'line\n\n' → ['line', '', ''] → lines.length - 1 = 2
    const filePath = writeTmpFile('eof.txt', 'line\n\n');
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: true,
      checkMissingNewlineAtEof: false,
      ignorePatterns: [],
    });
    expect(results.emptyLines).toHaveLength(1);
    expect(results.emptyLines[0]).toEqual({ file: filePath, lastLine: 2 });
  });

  test('should detect missing newline at eof and include last line number', () => {
    // 'no newline' → 1 line
    const filePath = writeTmpFile('nonewline.txt', 'no newline');
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: false,
      checkMissingNewlineAtEof: true,
      ignorePatterns: [],
    });
    expect(results.missingNewlines).toHaveLength(1);
    expect(results.missingNewlines[0]).toEqual({ file: filePath, lastLine: 1 });
  });

  test('should skip non-existent files', () => {
    const results = runChecks([path.join(tmpDir, 'missing.txt')], {
      checkEmptyLineAtEof: true,
      checkMissingNewlineAtEof: true,
      ignorePatterns: [],
    });
    expect(results.trailingSpaces).toHaveLength(0);
    expect(results.emptyLines).toHaveLength(0);
    expect(results.missingNewlines).toHaveLength(0);
  });

  test('should skip binary files', () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02]));
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: true,
      checkMissingNewlineAtEof: true,
      ignorePatterns: [],
    });
    expect(results.trailingSpaces).toHaveLength(0);
  });

  test('should skip ignored files', () => {
    const filePath = writeTmpFile('ignored.png', 'not really a png   \n');
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: true,
      checkMissingNewlineAtEof: true,
      ignorePatterns: ['*.png'],
    });
    expect(results.trailingSpaces).toHaveLength(0);
  });

  test('should skip empty line check when disabled', () => {
    const filePath = writeTmpFile('eof.txt', 'line\n\n');
    const results = runChecks([filePath], {
      checkEmptyLineAtEof: false,
      checkMissingNewlineAtEof: false,
      ignorePatterns: [],
    });
    expect(results.emptyLines).toHaveLength(0);
    expect(results.missingNewlines).toHaveLength(0);
  });
});

describe('reportResults', () => {
  test('should return false when no violations', () => {
    const mockCore = createMockCore();
    const result = reportResults({ trailingSpaces: [], emptyLines: [], missingNewlines: [] }, mockCore);
    expect(result).toBe(false);
    expect(mockCore.error).not.toHaveBeenCalled();
  });

  test('should return true and call core.error with file+line annotation for trailing spaces', () => {
    const mockCore = createMockCore();
    const result = reportResults({
      trailingSpaces: [{ file: 'file.txt', line: 5 }],
      emptyLines: [],
      missingNewlines: [],
    }, mockCore);
    expect(result).toBe(true);
    expect(mockCore.error).toHaveBeenCalledWith(
      expect.stringMatching(/file\.txt:5.*Trailing whitespace/),
      expect.objectContaining({ title: 'Trailing Whitespace', file: 'file.txt', startLine: 5 })
    );
  });

  test('should return true and call core.error with file+lastLine annotation for empty lines', () => {
    const mockCore = createMockCore();
    const result = reportResults({
      trailingSpaces: [],
      emptyLines: [{ file: 'eof.txt', lastLine: 3 }],
      missingNewlines: [],
    }, mockCore);
    expect(result).toBe(true);
    expect(mockCore.error).toHaveBeenCalledWith(
      expect.stringMatching(/eof\.txt:3.*blank lines/),
      expect.objectContaining({ title: 'Trailing Blank Lines', file: 'eof.txt', startLine: 3 })
    );
  });

  test('should return true and call core.error with file+lastLine annotation for missing newlines', () => {
    const mockCore = createMockCore();
    const result = reportResults({
      trailingSpaces: [],
      emptyLines: [],
      missingNewlines: [{ file: 'nonewline.txt', lastLine: 2 }],
    }, mockCore);
    expect(result).toBe(true);
    expect(mockCore.error).toHaveBeenCalledWith(
      expect.stringMatching(/nonewline\.txt:2.*missing a newline/),
      expect.objectContaining({ title: 'Missing Newline at EOF', file: 'nonewline.txt', startLine: 2 })
    );
  });

  test('should report all violation types via core.error', () => {
    const mockCore = createMockCore();
    const result = reportResults({
      trailingSpaces: [{ file: 'a.txt', line: 1 }],
      emptyLines: [{ file: 'b.txt', lastLine: 4 }],
      missingNewlines: [{ file: 'c.txt', lastLine: 7 }],
    }, mockCore);
    expect(result).toBe(true);
    expect(mockCore.error).toHaveBeenCalledTimes(3);
    expect(mockCore.error).toHaveBeenCalledWith(
      expect.stringMatching(/a\.txt:1/), expect.objectContaining({ title: 'Trailing Whitespace', file: 'a.txt', startLine: 1 })
    );
    expect(mockCore.error).toHaveBeenCalledWith(
      expect.stringMatching(/b\.txt:4/), expect.objectContaining({ title: 'Trailing Blank Lines', file: 'b.txt', startLine: 4 })
    );
    expect(mockCore.error).toHaveBeenCalledWith(
      expect.stringMatching(/c\.txt:7/), expect.objectContaining({ title: 'Missing Newline at EOF', file: 'c.txt', startLine: 7 })
    );
  });

  test('should log a header message for each violation type', () => {
    const mockCore = createMockCore();
    reportResults({
      trailingSpaces: [{ file: 'a.txt', line: 1 }],
      emptyLines: [{ file: 'b.txt', lastLine: 2 }],
      missingNewlines: [{ file: 'c.txt', lastLine: 1 }],
    }, mockCore);
    expect(consoleOutput.some(l => l.includes('spaces or tabs at end-of-line'))).toBe(true);
    expect(consoleOutput.some(l => l.includes('ending with blank lines'))).toBe(true);
    expect(consoleOutput.some(l => l.includes('does not end in a newline'))).toBe(true);
  });
});

describe('checkTrailingSpacesAction', () => {
  let mockGithub;
  let mockContext;
  let mockCore;

  beforeEach(() => {
    mockGithub = createMockGithub();
    mockContext = createMockContext();
    mockCore = createMockCore();
  });

  test('should pass when all files are clean', async () => {
    const filePath = writeTmpFile('clean.txt', 'all good\n');
    process.env.INPUT_CHANGED_FILES = filePath;

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).not.toHaveBeenCalled();
    expect(consoleOutput.some(l => l.includes('✓ All checked files passed'))).toBe(true);
  });

  test('should fail when trailing spaces found', async () => {
    const filePath = writeTmpFile('bad.txt', 'trailing   \n');
    process.env.INPUT_CHANGED_FILES = filePath;

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('trailing spaces'));
  });

  test('should fail when empty line at EOF found', async () => {
    const filePath = writeTmpFile('blank.txt', 'content\n\n');
    process.env.INPUT_CHANGED_FILES = filePath;
    process.env.INPUT_CHECK_EMPTY_LINE_AT_EOF = 'true';

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).toHaveBeenCalled();
  });

  test('should fail when missing newline at EOF found', async () => {
    const filePath = writeTmpFile('nonewline.txt', 'no newline');
    process.env.INPUT_CHANGED_FILES = filePath;
    process.env.INPUT_CHECK_MISSING_NEWLINE_AT_EOF = 'true';

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).toHaveBeenCalled();
  });

  test('should pass when no files to check', async () => {
    // Create a completely empty source directory so there are no files to check
    const emptyDir = path.join(tmpDir, 'empty-dir');
    fs.mkdirSync(emptyDir);
    process.env.INPUT_CHECK_ALL_FILES = 'true';
    process.env.INPUT_SOURCE_DIRECTORY = emptyDir;

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).not.toHaveBeenCalled();
    expect(consoleOutput.some(l => l.includes('No files to check'))).toBe(true);
  });

  test('should log the number of files to check', async () => {
    const filePath = writeTmpFile('file.txt', 'ok\n');
    process.env.INPUT_CHANGED_FILES = filePath;

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(consoleOutput.some(l => l.includes('Checking 1 file(s)'))).toBe(true);
  });

  test('should use check_all_files from environment', async () => {
    writeTmpFile('all1.txt', 'clean\n');
    writeTmpFile('all2.txt', 'clean\n');
    process.env.INPUT_CHECK_ALL_FILES = 'true';
    process.env.INPUT_SOURCE_DIRECTORY = tmpDir;

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).not.toHaveBeenCalled();
    expect(consoleOutput.some(l => l.includes('Checking 2 file(s)'))).toBe(true);
  });

  test('should respect ignore_patterns', async () => {
    const filePath = writeTmpFile('ignore.png', 'trailing   \n');
    process.env.INPUT_CHANGED_FILES = filePath;
    process.env.INPUT_IGNORE_PATTERNS = '*.png';

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('should handle errors gracefully', async () => {
    process.env.INPUT_CHECK_ALL_FILES = 'false';
    process.env.INPUT_SOURCE_DIRECTORY = '.';
    mockGithub.rest.pulls = {
      listFiles: {
        endpoint: {
          merge: jest.fn().mockReturnValue({}),
        },
      },
    };
    mockGithub.paginate.mockRejectedValue(new Error('Network error'));
    process.env.INPUT_PR_NUMBER = '42';

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });

  test('should not check empty_line and missing_newline when disabled', async () => {
    const filePath = writeTmpFile('eof.txt', 'content\n\n');
    const filePath2 = writeTmpFile('nonewline.txt', 'no newline');
    process.env.INPUT_CHANGED_FILES = `${filePath}\n${filePath2}`;
    process.env.INPUT_CHECK_EMPTY_LINE_AT_EOF = 'false';
    process.env.INPUT_CHECK_MISSING_NEWLINE_AT_EOF = 'false';

    await checkTrailingSpacesAction({ github: mockGithub, context: mockContext, core: mockCore });

    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });
});
