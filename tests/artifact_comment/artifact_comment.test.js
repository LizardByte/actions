import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

const { setupConsoleMocks } = require('../testUtils.js');

const artifactCommentAction = require('../../actions/artifact_comment/artifact_comment.js');
const {
  escapeLinkLabel,
  formatComment,
  getWorkflowRun,
  globToRegExp,
  listArtifacts,
  normalizePrNumber,
  parsePatterns,
  resolvePrNumber,
  selectArtifacts,
} = artifactCommentAction;

function createMockContext(overrides = {}) {
  return {
    repo: {
      owner: 'test-org',
      repo: 'test-repo',
    },
    runId: 123,
    serverUrl: 'https://github.com',
    ...overrides,
  };
}

function createMockGithub() {
  return {
    rest: {
      actions: {
        getWorkflowRun: jest.fn().mockResolvedValue({ data: createSourceRun() }),
        listWorkflowRunArtifacts: {
          endpoint: {
            merge: jest.fn().mockReturnValue({ endpoint: 'artifacts' }),
          },
        },
      },
      pulls: {
        list: jest.fn(),
      },
    },
    paginate: jest.fn(),
  };
}

function createSourceRun(overrides = {}) {
  return {
    event: 'pull_request',
    head_branch: 'feature',
    head_repository: {
      full_name: 'contributor/test-repo',
      owner: {
        login: 'contributor',
      },
    },
    head_sha: 'head-sha',
    pull_requests: [{ number: 42 }],
    ...overrides,
  };
}

function createMockCore() {
  return {
    setFailed: jest.fn(),
    setOutput: jest.fn(),
  };
}

let consoleMocks;

beforeEach(() => {
  jest.clearAllMocks();
  consoleMocks = setupConsoleMocks();
  delete process.env.INPUT_ARTIFACT_PATTERNS;
  delete process.env.INPUT_PR_NUMBER;
  delete process.env.INPUT_RUN_ID;
  delete process.env.INPUT_TITLE;
});

afterEach(() => {
  consoleMocks.restore();
});

describe('parsePatterns', () => {
  test('trims patterns and ignores empty lines', () => {
    expect(parsePatterns(' build-* \r\n\r\n exact-name\n')).toEqual(['build-*', 'exact-name']);
  });

  test('defaults to all artifacts when no pattern is provided', () => {
    expect(parsePatterns(' \n ')).toEqual(['*']);
  });
});

describe('globToRegExp', () => {
  test('supports wildcards while treating other regular expression characters literally', () => {
    const matcher = globToRegExp('release.v1+?-*');

    expect(matcher.test('release.v1+a-linux')).toBe(true);
    expect(matcher.test('releaseXv1+a-linux')).toBe(false);
    expect(matcher.test('release.v1+-linux')).toBe(false);
  });
});

describe('selectArtifacts', () => {
  test('selects matching artifact names and sorts them', () => {
    const artifacts = [
      { id: 3, name: 'documentation' },
      { id: 2, name: 'build-windows-x64' },
      { id: 4, name: 'coverage' },
      { id: 1, name: 'build-linux-x64' },
    ];

    const selected = selectArtifacts(artifacts, ['build-*-x64', 'documentation']);

    expect(selected).toEqual([
      { id: 1, name: 'build-linux-x64' },
      { id: 2, name: 'build-windows-x64' },
      { id: 3, name: 'documentation' },
    ]);
  });
});

describe('escapeLinkLabel', () => {
  test('escapes brackets and backslashes in artifact names', () => {
    expect(escapeLinkLabel('build[linux]\\x64')).toBe('build\\[linux\\]\\\\x64');
  });
});

describe('normalizePrNumber', () => {
  test('normalizes valid numbers and allows an omitted value', () => {
    expect(normalizePrNumber(42)).toBe('42');
    expect(normalizePrNumber(undefined)).toBe('');
  });

  test('rejects a non-numeric value', () => {
    expect(() => normalizePrNumber('PR-42')).toThrow('Invalid PR number value: PR-42');
  });
});

describe('resolvePrNumber', () => {
  test('uses an explicitly provided pull request number', async () => {
    const github = createMockGithub();
    const context = createMockContext();

    await expect(resolvePrNumber(github, context, { event: 'push' }, '99')).resolves.toBe('99');
    expect(github.paginate).not.toHaveBeenCalled();
  });

  test('uses the pull request attached to the source workflow run', async () => {
    const github = createMockGithub();
    const context = createMockContext();

    await expect(resolvePrNumber(github, context, createSourceRun(), '')).resolves.toBe('42');
    expect(github.paginate).not.toHaveBeenCalled();
  });

  test('falls back to an open pull request with the matching head SHA', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const sourceRun = createSourceRun({ pull_requests: [] });
    github.paginate.mockResolvedValue([
      { number: 10, head: { sha: 'other-sha' } },
      { number: 20, head: { sha: 'head-sha' } },
    ]);

    await expect(resolvePrNumber(github, context, sourceRun, '')).resolves.toBe('20');
    expect(github.paginate).toHaveBeenCalledWith(github.rest.pulls.list, {
      owner: 'test-org',
      repo: 'test-repo',
      state: 'open',
      head: 'contributor:feature',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });
  });

  test('prefers a pull request targeting the current repository when the SHA changed', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const sourceRun = createSourceRun({
      head_repository: {
        full_name: 'contributor/test-repo',
        owner: { name: 'contributor' },
      },
      pull_requests: [],
    });
    github.paginate.mockResolvedValue([
      { number: 10, base: { repo: { full_name: 'somewhere/else' } } },
      { number: 20, base: { repo: { full_name: 'test-org/test-repo' } } },
    ]);

    await expect(resolvePrNumber(github, context, sourceRun, '')).resolves.toBe('20');
  });

  test('uses the most recently updated candidate as a final fallback', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const sourceRun = createSourceRun({
      head_repository: { full_name: 'contributor/test-repo' },
      pull_requests: [],
    });
    github.paginate.mockResolvedValue([{ number: 10 }]);

    await expect(resolvePrNumber(github, context, sourceRun, '')).resolves.toBe('10');
  });

  test('rejects a source workflow that was not triggered by a pull request', async () => {
    const github = createMockGithub();
    const context = createMockContext();

    await expect(resolvePrNumber(github, context, { event: 'push' }, '')).rejects.toThrow(
      'Source workflow run event is "push", not "pull_request".'
    );
  });

  test('reports an unknown source event when workflow metadata omits it', async () => {
    const github = createMockGithub();
    const context = createMockContext();

    await expect(resolvePrNumber(github, context, {}, '')).rejects.toThrow(
      'Source workflow run event is "unknown", not "pull_request".'
    );
  });

  test('reports source details when no pull request can be resolved', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const sourceRun = createSourceRun({
      head_branch: '',
      head_repository: null,
      head_sha: '',
      pull_requests: [],
    });

    await expect(resolvePrNumber(github, context, sourceRun, '')).rejects.toThrow(
      'Unable to determine PR number for pull_request workflow run. '
      + 'head_repository=<unknown> head_branch=<unknown> head_sha=<unknown> payload_pull_requests=0'
    );
  });
});

describe('formatComment', () => {
  test('builds direct links for selected artifacts', () => {
    const comment = formatComment({
      artifacts: [
        { id: 10, name: 'build[linux]' },
        { id: 20, name: 'build-windows' },
      ],
      owner: 'test-org',
      repo: 'test-repo',
      runId: '123',
      serverUrl: 'https://github.example.com/',
      title: 'Downloads',
    });

    expect(comment).toBe([
      '## Downloads',
      '',
      'Artifacts from [workflow run 123](https://github.example.com/test-org/test-repo/actions/runs/123):',
      '',
      '- [build\\[linux\\]](https://github.example.com/test-org/test-repo/actions/runs/123/artifacts/10)',
      '- [build-windows](https://github.example.com/test-org/test-repo/actions/runs/123/artifacts/20)',
      '',
      '<sub>You must be signed in to GitHub to download workflow artifacts.</sub>',
    ].join('\n'));
  });

  test('links to the workflow run when no artifacts match', () => {
    const comment = formatComment({
      artifacts: [],
      owner: 'test-org',
      repo: 'test-repo',
      runId: '123',
      serverUrl: 'https://github.com',
      title: 'Build artifacts',
    });

    expect(comment).toBe([
      '## Build artifacts',
      '',
      'No artifacts matched the configured patterns in [workflow run 123](https://github.com/test-org/test-repo/actions/runs/123).',
    ].join('\n'));
  });
});

describe('listArtifacts', () => {
  test('uses pagination to retrieve every artifact from the requested run', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const artifacts = [{ id: 1, name: 'build' }];
    github.paginate.mockResolvedValue(artifacts);

    await expect(listArtifacts(github, context, 456)).resolves.toEqual(artifacts);
    expect(github.rest.actions.listWorkflowRunArtifacts.endpoint.merge).toHaveBeenCalledWith({
      owner: 'test-org',
      repo: 'test-repo',
      run_id: 456,
      per_page: 100,
    });
    expect(github.paginate).toHaveBeenCalledWith({ endpoint: 'artifacts' });
  });
});

describe('getWorkflowRun', () => {
  test('gets the source workflow run from the current repository', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const sourceRun = createSourceRun();
    github.rest.actions.getWorkflowRun.mockResolvedValue({ data: sourceRun });

    await expect(getWorkflowRun(github, context, 456)).resolves.toEqual(sourceRun);
    expect(github.rest.actions.getWorkflowRun).toHaveBeenCalledWith({
      owner: 'test-org',
      repo: 'test-repo',
      run_id: 456,
    });
  });
});

describe('artifactCommentAction', () => {
  test('filters artifacts and sets comment outputs from configured inputs', async () => {
    const github = createMockGithub();
    const context = createMockContext({ serverUrl: 'https://github.example.com' });
    const core = createMockCore();
    github.paginate.mockResolvedValue([
      { id: 1, name: 'build-linux' },
      { id: 2, name: 'coverage' },
      { id: 3, name: 'build-windows' },
    ]);
    process.env.INPUT_ARTIFACT_PATTERNS = 'build-*';
    process.env.INPUT_PR_NUMBER = '77';
    process.env.INPUT_RUN_ID = '456';
    process.env.INPUT_TITLE = 'Test builds';

    await artifactCommentAction({ github, context, core });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('ARTIFACT_COUNT', '2');
    expect(core.setOutput).toHaveBeenCalledWith('ARTIFACT_NAMES', 'build-linux\nbuild-windows');
    expect(core.setOutput).toHaveBeenCalledWith(
      'COMMENT_BODY',
      expect.stringContaining('## Test builds')
    );
    expect(core.setOutput).toHaveBeenCalledWith(
      'COMMENT_BODY',
      expect.stringContaining('https://github.example.com/test-org/test-repo/actions/runs/456/artifacts/1')
    );
    expect(core.setOutput).toHaveBeenCalledWith('PR_NUMBER', '77');
    expect(consoleMocks.consoleOutput).toContain('Found 3 artifact(s); selected 2.');
  });

  test('uses context defaults and reports when no artifacts match', async () => {
    const github = createMockGithub();
    const context = createMockContext({ serverUrl: undefined });
    const core = createMockCore();
    github.paginate.mockResolvedValue([]);

    await artifactCommentAction({ github, context, core });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('ARTIFACT_COUNT', '0');
    expect(core.setOutput).toHaveBeenCalledWith('ARTIFACT_NAMES', '');
    expect(core.setOutput).toHaveBeenCalledWith(
      'COMMENT_BODY',
      expect.stringContaining('https://github.com/test-org/test-repo/actions/runs/123')
    );
    expect(core.setOutput).toHaveBeenCalledWith('PR_NUMBER', '42');
  });

  test('fails for an invalid workflow run ID', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const core = createMockCore();
    process.env.INPUT_RUN_ID = 'not-a-run';

    await artifactCommentAction({ github, context, core });

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to build artifact comment: Invalid workflow run ID: "not-a-run".'
    );
    expect(github.paginate).not.toHaveBeenCalled();
  });

  test('reports GitHub API failures', async () => {
    const github = createMockGithub();
    const context = createMockContext();
    const core = createMockCore();
    github.paginate.mockRejectedValue(new Error('API unavailable'));

    await artifactCommentAction({ github, context, core });

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to build artifact comment: API unavailable'
    );
  });
});
