/**
 * Check Trailing Spaces script for GitHub Actions
 * Checks files for trailing spaces, empty lines at EOF, and missing newline at EOF.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Determine if a file is a text file by reading its content and checking for binary characters.
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if the file appears to be a text file
 */
function isTextFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) {
      return false;
    }

    // Read a sample of the file (up to 8KB) to detect binary content
    const SAMPLE_SIZE = 8192;
    const buffer = Buffer.alloc(Math.min(stat.size, SAMPLE_SIZE));
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
      fs.closeSync(fd);
    }

    // Check for null bytes which indicate binary content
    for (const element of buffer) {
      if (element === 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file path matches any of the ignore patterns.
 * @param {string} filePath - Path to check
 * @param {string[]} ignorePatterns - Array of glob patterns to ignore
 * @returns {boolean} True if the file should be ignored
 */
function shouldIgnoreFile(filePath, ignorePatterns) {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return false;
  }

  const normalizedPath = filePath.replaceAll('\\', '/');

  for (const pattern of ignorePatterns) {
    if (!pattern.trim()) {
      continue;
    }
    // Convert simple glob pattern to regex.
    // Escape special regex chars except * and ? which we handle specially.
    const regexStr = pattern.trim()
      .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)  // Escape special regex chars (not * or ?)
      .replaceAll('*', '.*')  // * becomes .*
      .replaceAll('?', '.');  // ? becomes .
    const regex = new RegExp(`(^|/)${regexStr}$`);
    if (regex.test(normalizedPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Get all files in a directory recursively, excluding .git directory.
 * @param {string} dir - Directory to search
 * @returns {string[]} Array of file paths
 */
function getAllFiles(dir) {
  const files = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip .git directory
          if (entry === '.git') {
            continue;
          }
          walk(fullPath);
        } else {
          files.push(fullPath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Check a single file for trailing spaces.
 * @param {string} filePath - Path to the file
 * @returns {{file: string, line: number}[]} Array of violations found
 */
function checkTrailingSpaces(filePath) {
  const violations = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check if line ends with a space or tab without using a backtracking regex.
      // line.length > 0 avoids a pointless check on empty lines.
      if (line.length > 0) {
        const lastChar = line[line.length - 1];
        if (lastChar === ' ' || lastChar === '\t') {
          violations.push({ file: filePath, line: i + 1 });
        }
      }
    }
  } catch {
    // Skip files we can't read
  }
  return violations;
}

/**
 * Check a single file for an empty line at EOF.
 * Returns the last line number of the file when a violation is found so the
 * caller can produce a precise annotation, or -1 when no violation exists.
 * @param {string} filePath - Path to the file
 * @returns {number} Last line number (1-based) if the file ends with a blank line, otherwise -1
 */
function checkEmptyLineAtEof(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.length === 0) {
      return -1;
    }
    const lines = content.split('\n');
    const lastLine = lines[lines.length - 1];
    // If file ends with \n, last element of split is ''
    // If file ends with \n\n, last two elements are '' and ''
    // We consider the file as ending with an empty line if the last line is empty
    // AND there's more than one line (to avoid flagging single-line files that just have \n)
    if (lastLine === '' && lines.length > 1 && lines[lines.length - 2] === '') {
      return lines.length - 1;  // 1-based index of the last non-empty trailing newline
    }
    return -1;
  } catch {
    return -1;
  }
}

/**
 * Check a single file for a missing newline at EOF.
 * Returns the last line number of the file when a violation is found so the
 * caller can produce a precise annotation, or -1 when no violation exists.
 * @param {string} filePath - Path to the file
 * @returns {number} Last line number (1-based) if the file is missing a newline at EOF, otherwise -1
 */
function checkMissingNewlineAtEof(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return -1;
    }

    const buffer = Buffer.alloc(1);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, 1, stat.size - 1);
    } finally {
      fs.closeSync(fd);
    }

    if (buffer[0] !== 0x0a) {
      // Count lines to get a 1-based last line number for the annotation
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.split('\n').length;
    }
    return -1;
  } catch {
    return -1;
  }
}

/**
 * Get the list of changed files for a pull request via the GitHub API.
 * This logic is inlined here (rather than require'd from get_changed_files) because
 * GitHub Actions only checks out the specific action directory at runtime, so a
 * relative require('../get_changed_files/...') would not resolve.
 * @param {Object} github - GitHub API object
 * @param {Object} context - GitHub Actions context object
 * @param {number|string} prNumber - Pull request number
 * @returns {Promise<string[]>} Array of changed file paths
 */
async function getChangedFilesFromApi(github, context, prNumber) {
  const opts = github.rest.pulls.listFiles.endpoint.merge({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: Number(prNumber),
  });
  const changedFiles = await github.paginate(opts);
  return changedFiles.map(file => file.filename);
}

/**
 * Parse the list of files to check from inputs.
 * @param {Object} options - Options object
 * @param {string} options.changedFilesInput - Newline-separated list of files provided directly
 * @param {boolean} options.checkAllFiles - Whether to check all files
 * @param {string} options.sourceDirectory - Directory to check when checkAllFiles is true
 * @param {Object} options.github - GitHub API object
 * @param {Object} options.context - GitHub Actions context
 * @param {string|number} options.prNumber - Pull request number
 * @returns {Promise<string[]>} Array of file paths to check
 */
async function resolveFilesToCheck({ changedFilesInput, checkAllFiles, sourceDirectory, github, context, prNumber }) {
  // If files are provided directly, use them
  if (changedFilesInput?.trim()) {
    console.log('Using provided changed_files input.');
    return changedFilesInput.split('\n').map(f => f.trim()).filter(f => f.length > 0);
  }

  // If checking all files, find them on disk
  if (checkAllFiles) {
    console.log(`Checking all files in: ${sourceDirectory}`);
    return getAllFiles(sourceDirectory);
  }

  // Otherwise, get changed files from the GitHub API
  if (!prNumber) {
    console.log('No PR number available. Falling back to checking all files.');
    return getAllFiles(sourceDirectory);
  }

  console.log(`Getting changed files for PR #${prNumber}...`);
  const files = await getChangedFilesFromApi(github, context, prNumber);
  console.log(`Found ${files.length} changed files.`);
  return files;
}

/**
 * Push an EOF violation entry only when the check is enabled and the detector returns a valid line.
 * @param {boolean} enabled - Whether this check is enabled
 * @param {Function} detector - Function that returns a line number ≥ 1 on violation, or -1 on pass
 * @param {string} filePath - Path to the file being checked
 * @param {{file: string, lastLine: number}[]} target - Array to push the result into
 */
function pushEofViolation(enabled, detector, filePath, target) {
  if (!enabled) {
    return;
  }
  const lastLine = detector(filePath);
  if (lastLine !== -1) {
    target.push({ file: filePath, lastLine });
  }
}

/**
 * Run all checks on the given list of files.
 * @param {string[]} files - List of file paths to check
 * @param {Object} options - Check options
 * @param {boolean} options.checkEmptyLineAtEof - Whether to check for empty lines at EOF
 * @param {boolean} options.checkMissingNewlineAtEof - Whether to check for missing newline at EOF
 * @param {string[]} options.ignorePatterns - Patterns of files to ignore
 * @returns {{trailingSpaces: {file: string, line: number}[], emptyLines: {file: string, lastLine: number}[], missingNewlines: {file: string, lastLine: number}[]}} Results
 */
function runChecks(files, { checkEmptyLineAtEof: checkEmpty, checkMissingNewlineAtEof: checkMissing, ignorePatterns }) {
  const trailingSpaces = [];
  const emptyLines = [];
  const missingNewlines = [];

  for (const filePath of files) {
    // Skip files that don't exist
    if (!fs.existsSync(filePath)) {
      continue;
    }

    // Skip ignored files
    if (shouldIgnoreFile(filePath, ignorePatterns)) {
      continue;
    }

    // Only check text files
    if (!isTextFile(filePath)) {
      continue;
    }

    // Check for trailing spaces
    const spaceViolations = checkTrailingSpaces(filePath);
    trailingSpaces.push(...spaceViolations);

    // Check for empty lines at EOF
    pushEofViolation(checkEmpty, checkEmptyLineAtEof, filePath, emptyLines);

    // Check for missing newline at EOF
    pushEofViolation(checkMissing, checkMissingNewlineAtEof, filePath, missingNewlines);
  }

  return { trailingSpaces, emptyLines, missingNewlines };
}

/**
 * Emit GitHub workflow annotations and print a summary.
 * Uses core.error() with file/startLine so GitHub renders inline PR annotations
 * pointing to the exact line of each violation.
 * @param {{trailingSpaces: {file: string, line: number}[], emptyLines: {file: string, lastLine: number}[], missingNewlines: {file: string, lastLine: number}[]}} results
 * @param {Object} core - GitHub Actions core object
 * @returns {boolean} True if any violations were found
 */
function reportResults({ trailingSpaces, emptyLines, missingNewlines }, core) {
  let hasViolations = false;

  if (trailingSpaces.length > 0) {
    hasViolations = true;
    console.log('Found files containing lines with spaces or tabs at end-of-line.');
    console.log("TIP: If you're using a JetBrains IDE, enable \"Editor > General > On Save > Remove trailing spaces on: All lines\" in settings.\".");
    console.log('==========================================================================');
    for (const { file, line } of trailingSpaces) {
      // core.error emits a ::error:: workflow command that GitHub renders as an inline annotation
      core.error(`${file}:${line}: Trailing whitespace at end of line.`, { title: 'Trailing Whitespace', file, startLine: line });
    }
    console.log('');
  }

  if (emptyLines.length > 0) {
    hasViolations = true;
    console.log('Found files ending with blank lines. Please remove all blank lines at the end, keeping only the final newline:');
    console.log("TIP: If you're using a JetBrains IDE, enable \"Editor > General > On Save > Remove trailing blank lines at the end of saved files\" in settings.\".");
    console.log('=================================================================================================================');
    for (const { file, lastLine } of emptyLines) {
      core.error(`${file}:${lastLine}: File ends with blank lines. Please remove all trailing blank lines, keeping only the final newline.`, { title: 'Trailing Blank Lines', file, startLine: lastLine });
    }
    console.log('');
  }

  if (missingNewlines.length > 0) {
    hasViolations = true;
    console.log('Found files where the last line does not end in a newline.');
    console.log('Please add a newline (not an empty line) to the files below:');
    console.log('');
    console.log("TIP: If you're using VSCode, enable \"Insert Final Newline\" in settings.");
    console.log("TIP: If you're using a JetBrains IDE, enable \"Editor > General > On Save > Ensure every saved file ends with a line break\" in settings.\".");
    console.log('==============================================================');
    for (const { file, lastLine } of missingNewlines) {
      core.error(`${file}:${lastLine}: File is missing a newline at the end. Please add a trailing newline.`, { title: 'Missing Newline at EOF', file, startLine: lastLine });
    }
    console.log('');
  }

  return hasViolations;
}

/**
 * Main function to check files for trailing spaces and related issues.
 * @param {Object} params - Function parameters
 * @param {Object} params.github - GitHub API object
 * @param {Object} params.context - GitHub Actions context object
 * @param {Object} params.core - GitHub Actions core object
 */
async function checkTrailingSpacesAction({ github, context, core }) {
  const prNumber = process.env.INPUT_PR_NUMBER || context.payload?.pull_request?.number;
  const changedFilesInput = process.env.INPUT_CHANGED_FILES || '';
  const checkAllFiles = (process.env.INPUT_CHECK_ALL_FILES || 'false').toLowerCase() === 'true';
  const checkEmpty = (process.env.INPUT_CHECK_EMPTY_LINE_AT_EOF || 'true').toLowerCase() === 'true';
  const checkMissing = (process.env.INPUT_CHECK_MISSING_NEWLINE_AT_EOF || 'true').toLowerCase() === 'true';
  const sourceDirectory = process.env.INPUT_SOURCE_DIRECTORY || '.';
  const ignorePatternsRaw = process.env.INPUT_IGNORE_PATTERNS || '';
  const ignorePatterns = ignorePatternsRaw.split('\n').map(p => p.trim()).filter(p => p.length > 0);

  console.log('Check for trailing spaces inside text files');
  console.log('===========================================');

  try {
    const files = await resolveFilesToCheck({
      changedFilesInput,
      checkAllFiles,
      sourceDirectory,
      github,
      context,
      prNumber,
    });

    if (files.length === 0) {
      console.log('No files to check.');
      return;
    }

    console.log(`Checking ${files.length} file(s)...\n`);

    const results = runChecks(files, {
      checkEmptyLineAtEof: checkEmpty,
      checkMissingNewlineAtEof: checkMissing,
      ignorePatterns,
    });

    const hasViolations = reportResults(results, core);

    if (hasViolations) {
      core.setFailed('Found files with trailing spaces, empty lines at EOF, or missing newline at EOF.');
    } else {
      console.log('✓ All checked files passed.');
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

module.exports = checkTrailingSpacesAction;
module.exports.isTextFile = isTextFile;
module.exports.shouldIgnoreFile = shouldIgnoreFile;
module.exports.getAllFiles = getAllFiles;
module.exports.checkTrailingSpaces = checkTrailingSpaces;
module.exports.checkEmptyLineAtEof = checkEmptyLineAtEof;
module.exports.checkMissingNewlineAtEof = checkMissingNewlineAtEof;
module.exports.getChangedFilesFromApi = getChangedFilesFromApi;
module.exports.resolveFilesToCheck = resolveFilesToCheck;
module.exports.runChecks = runChecks;
module.exports.reportResults = reportResults;
