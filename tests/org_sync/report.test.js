const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const writeSyncReport = require('../../actions/org_sync/report.js');

let directory;
let outputs;
let core;
const context = { sha: 'source-revision', ref: 'refs/pull/1/merge' };

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'org-sync-report-test-'));
  outputs = {};
  core = {
    setOutput: jest.fn((name, value) => { outputs[name] = value; }),
    summary: { addHeading: jest.fn(), addRaw: jest.fn(), addTable: jest.fn(), write: jest.fn() },
  };
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  jest.restoreAllMocks();
});

test('preview reports preserve partial failures and their exact changes in the artifact', async () => {
  const results = [
    { repository: 'org/app', status: 'planned', changes: [{ path: 'old.yml', operation: 'remove' }], warnings: [] },
    { repository: 'other/*', status: 'failed', error: 'Property access denied' },
    { repository: 'org/mirror', status: 'excluded' },
  ];
  const report = await writeSyncReport({ core, context, outputDirectory: directory, env: {
    SYNC_DRY_RUN: 'true', SYNC_RESULTS: JSON.stringify(results), SYNC_OUTCOME: 'failure',
    SYNC_CHANGED: '1', SYNC_FAILED: '1', SYNC_ORGANIZATION: 'org', SYNC_REPOSITORY: 'org/app',
  } });
  expect(report).toEqual({ dry_run: true, source_commit: 'source-revision', source_ref: 'refs/pull/1/merge',
    organization: 'org', repository: 'org/app', outcome: 'failure', changed_repositories: 1,
    failed_repositories: 1, results });
  expect(JSON.parse(await fs.readFile(outputs.report_file, 'utf8'))).toEqual(report);
  expect(outputs.artifact_name).toBe(`file-sync-${path.basename(directory)}`);
  expect(core.summary.addHeading).toHaveBeenCalledWith('File sync preview');
  expect(core.summary.addTable.mock.calls[0][0].slice(1)).toEqual([
    ['org/app', 'planned', '1'], ['other/*', 'failed', '0'], ['org/mirror', 'excluded', '0'],
  ]);
  expect(core.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('Dry run only'));
  expect(core.summary.write).toHaveBeenCalledTimes(1);
});

test('delivery reports retain target PR URLs and mark their mode accurately', async () => {
  const results = [{ repository: 'org/app', status: 'updated', changes: [],
    pull_request: 'https://github.com/org/app/pull/42' }];
  const report = await writeSyncReport({ core, context, outputDirectory: directory,
    env: { SYNC_DRY_RUN: 'false', SYNC_RESULTS: JSON.stringify(results), SYNC_OUTCOME: 'success' } });
  expect(report.dry_run).toBe(false);
  expect(report.results).toEqual(results);
  expect(core.summary.addHeading).toHaveBeenCalledWith('File synchronization');
  const prose = core.summary.addRaw.mock.calls.flat().join('');
  expect(prose).toContain('Delivery enabled');
  expect(prose).not.toMatch(/Dry run only|No target/);
});

test('a fatal sync without outputs still produces a delivery diagnostic', async () => {
  const report = await writeSyncReport({ core, context, outputDirectory: directory,
    env: { SYNC_DRY_RUN: 'false', SYNC_OUTCOME: 'failure' } });
  expect(report.results).toEqual([]);
  expect(report.changed_repositories).toBe(0);
  expect(report.failed_repositories).toBe(0);
  expect(report.organization).toBeNull();
  expect(report.repository).toBeNull();
  expect(core.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('**failure**'));
});

test('repeated invocations allocate separate report directories and artifact names', async () => {
  jest.spyOn(os, 'tmpdir').mockReturnValue(directory);
  const options = { core, context, env: { SYNC_DRY_RUN: 'true' } };
  await writeSyncReport(options);
  const first = { ...outputs };
  await writeSyncReport(options);
  expect(outputs.report_file).not.toBe(first.report_file);
  expect(outputs.artifact_name).not.toBe(first.artifact_name);
  expect(JSON.parse(await fs.readFile(first.report_file, 'utf8')).dry_run).toBe(true);
  expect(JSON.parse(await fs.readFile(outputs.report_file, 'utf8')).dry_run).toBe(true);
});

test.each([undefined, '', 'FALSE', '0'])('rejects invalid mode %s before publishing a report', async mode => {
  await expect(writeSyncReport({ core, context, env: { SYNC_DRY_RUN: mode } }))
    .rejects.toThrow('Expected an explicit file sync dry-run mode');
  expect(core.setOutput).not.toHaveBeenCalled();
  expect(core.summary.write).not.toHaveBeenCalled();
});

test.each(['{}', '{invalid-json'])('rejects malformed output %s before publishing a report', async results => {
  await expect(writeSyncReport({ core, context, env: { SYNC_DRY_RUN: 'true', SYNC_RESULTS: results } }))
    .rejects.toThrow();
  expect(core.setOutput).not.toHaveBeenCalled();
  expect(core.summary.write).not.toHaveBeenCalled();
});

test('uses the composite action environment when no explicit environment is passed', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, SYNC_DRY_RUN: 'true' });
  const report = await writeSyncReport({ core, context, outputDirectory: directory });
  expect(report.dry_run).toBe(true);
});

test.each(['true', 'false'])('administration reports preserve separate results/counts in mode %s', async dryRun => {
  const organizations = [{ organization: 'org', status: 'planned', changes: [{ kind: 'schema', name: 'mode' }] },
    { organization: 'blocked', status: 'failed' }];
  const report = await writeSyncReport({ core, context, outputDirectory: directory, env: {
    SYNC_DRY_RUN: dryRun, SYNC_ADMIN_ENABLED: 'true', SYNC_ADMIN_RESULTS: JSON.stringify(organizations),
    SYNC_ADMIN_CHANGED: '1', SYNC_ADMIN_FAILED: '1', SYNC_ADMIN_OUTCOME: 'failure', SYNC_OUTCOME: 'skipped',
  } });
  expect(report.outcome).toBe('failure');
  expect(report.organization_results).toEqual(organizations);
  expect(report.changed_organizations).toBe(1);
  expect(report.failed_organizations).toBe(1);
  expect(core.summary.addHeading).toHaveBeenCalledWith('Organization synchronization');
  expect(core.summary.addTable).toHaveBeenCalledTimes(2);
  expect(core.summary.addTable.mock.calls[1][0].slice(1)).toEqual([['org', 'planned', '1'], ['blocked', 'failed', '0']]);
});

test('successful schema-only runs and runtime preparation failures have accurate outcomes', async () => {
  let report = await writeSyncReport({ core, context, outputDirectory: directory,
    env: { SYNC_DRY_RUN: 'true', SYNC_ADMIN_ENABLED: 'true', SYNC_ADMIN_OUTCOME: 'success', SYNC_OUTCOME: 'skipped' } });
  expect(report.outcome).toBe('success');
  expect(report.changed_organizations).toBe(0);
  expect(report.failed_organizations).toBe(0);
  report = await writeSyncReport({ core, context, outputDirectory: directory,
    env: { SYNC_DRY_RUN: 'false', SYNC_PREPARATION_OUTCOME: 'failure' } });
  expect(report.outcome).toBe('failure');
});

test('malformed organization output fails before publishing a report', async () => {
  await expect(writeSyncReport({ core, context, env: { SYNC_DRY_RUN: 'true', SYNC_ADMIN_RESULTS: '{}' } }))
    .rejects.toThrow('Expected an array of organization sync results');
  expect(core.setOutput).not.toHaveBeenCalled();
});
