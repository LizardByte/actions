import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./fixture.js');
const { STATE_PATH, blobSha, loadConfig, properties } = require('../../actions/org_sync/config.js');
const { readState, differences, regular } = require('../../actions/org_sync/planner.js');
const { booleanInput, options } = require('../../actions/org_sync/org_sync.js');

let f;
beforeEach(() => { f = fixture(); f.policy(); });
afterEach(() => { jest.restoreAllMocks(); f.cleanup(); });
const calls = route => f.github.request.mock.calls.filter(([actual]) => actual === route);
const policy = rules => f.policy({ version: 1, rules });
const mapping = (extra = {}) => ({ source: 'workflow.yml', destination: '.github/workflows/docs.yml', ...extra });

describe('file replication and profile lifecycle', () => {
  test('batches multiple binary and executable files into one tree, commit, and PR', async () => {
    policy([{ id: 'common', files: [mapping(), { source: 'image.bin', destination: 'image.bin', permissions: '100755' }] }]);
    const bytes = Buffer.from([0, 128, 255, 10]);
    f.write('image.bin', bytes);
    const repo = f.add('org/app', { 'README.md': 'owned by repository' });
    const results = await f.run();
    expect(results[0].status).toBe('updated');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('shared workflow\n');
    expect(f.blobs.get(f.entries(repo, 'bot/org-sync-files').get('image.bin').sha)).toEqual(bytes);
    expect(f.entries(repo, 'bot/org-sync-files').get('image.bin').mode).toBe('100755');
    expect(f.content(repo, 'README.md')).toBe('owned by repository');
    expect(calls('POST /repos/{owner}/{repo}/git/trees')).toHaveLength(1);
    expect(calls('POST /repos/{owner}/{repo}/git/commits')).toHaveLength(1);
    expect(calls('POST /repos/{owner}/{repo}/pulls')).toHaveLength(1);
  });

  test('is unchanged on a second run with an open PR and after merging it', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('unchanged');
    expect(f.writes()).toHaveLength(0);
    f.merge(repo);
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('unchanged');
    expect(f.writes()).toHaveLength(0);
  });

  test('removes a deselected profile workflow while retaining unrelated repository files', async () => {
    const repo = f.add('org/app', { 'local.yml': 'local' }, ['docs']);
    await f.run();
    f.merge(repo);
    repo.profiles = [];
    const result = (await f.run())[0];
    expect(result.status).toBe('updated');
    expect(result.changes).toContainEqual({ path: '.github/workflows/docs.yml', operation: 'remove' });
    expect(f.content(repo, '.github/workflows/docs.yml')).toBeNull();
    expect(f.content(repo, 'local.yml')).toBe('local');
    expect(JSON.parse(f.content(repo, STATE_PATH)).files).toEqual({});
  });

  test('cleans up an inactive sync mapping on the initial reconciliation', async () => {
    const repo = f.add('org/app', { '.github/workflows/docs.yml': 'old replicated workflow' });
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBeNull();
    expect((await f.run())[0].status).toBe('unchanged');
  });

  test('closes an unmerged profile PR when deselection makes all of its changes unnecessary', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    repo.profiles = [];
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('closed');
    expect(repo.pulls[0].state).toBe('closed');
    expect(calls('POST /repos/{owner}/{repo}/git/commits')).toHaveLength(0);
    repo.profiles = ['docs'];
    expect((await f.run())[0].status).toBe('updated');
    expect(repo.pulls).toHaveLength(2);
  });

  test('retains a shared path while another matching profile remains selected', async () => {
    policy([{ id: 'docs', profile: 'docs', files: [mapping()] }, { id: 'docker', profile: 'docker', files: [mapping()] }]);
    const repo = f.add('org/app', {}, ['docs', 'docker']);
    await f.run();
    f.merge(repo);
    repo.profiles = ['docker'];
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('unchanged');
    expect(f.writes()).toHaveLength(0);
    expect(f.content(repo, '.github/workflows/docs.yml', 'main')).toBe('shared workflow\n');
  });

  test('preserves a pre-existing create-if-missing file, even when empty or deselected', async () => {
    policy([{ id: 'docs', profile: 'docs', files: [mapping({ mode: 'create_if_missing' })] }]);
    const repo = f.add('org/app', { '.github/workflows/docs.yml': '' }, ['docs']);
    expect((await f.run())[0].status).toBe('unchanged');
    repo.profiles = [];
    expect((await f.run())[0].status).toBe('unchanged');
    expect(f.content(repo, '.github/workflows/docs.yml', 'main')).toBe('');
    expect(f.writes()).toHaveLength(0);
  });

  test('creates an absent starter file once and removes it on deselection', async () => {
    policy([{ id: 'docs', profile: 'docs', files: [mapping({ mode: 'create_if_missing' })] }]);
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.write('workflow.yml', 'new source which must not overwrite the starter');
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('unchanged');
    expect(f.writes()).toHaveLength(0);
    f.merge(repo);
    repo.profiles = [];
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBeNull();
  });

  test('preserves a starter customized after the action created it', async () => {
    policy([{ id: 'docs', profile: 'docs', files: [mapping({ mode: 'create_if_missing' })] }]);
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.merge(repo);
    f.advance(repo, { '.github/workflows/docs.yml': 'maintainer customization' });
    repo.profiles = [];
    const result = (await f.run())[0];
    expect(result.warnings).toContain('Preserved modified create-if-missing file: .github/workflows/docs.yml');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('maintainer customization');
    expect(JSON.parse(f.content(repo, STATE_PATH)).files).toEqual({});
  });

  test('preserves a starter with a locally changed executable bit', async () => {
    policy([{ id: 'docs', profile: 'docs', files: [mapping({ mode: 'create_if_missing', permissions: '100644' })] }]);
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.merge(repo);
    f.advance(repo, { '.github/workflows/docs.yml': { content: 'shared workflow\n', mode: '100755' } });
    repo.profiles = [];
    const result = (await f.run())[0];
    expect(result.warnings).toContain('Preserved modified create-if-missing file: .github/workflows/docs.yml');
    expect(f.entries(repo, 'bot/org-sync-files').get('.github/workflows/docs.yml').mode).toBe('100755');
  });

  test.each(['deselection', 'policy removal'])('refuses to discard a customized unmerged file during %s', async cleanup => {
    policy([{ id: 'starter', profile: 'docs', files: [mapping({ mode: 'create_if_missing' })] }]);
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    const customized = f.advance(repo, { '.github/workflows/docs.yml': 'pending customization' }, 'bot/org-sync-files');
    if (cleanup === 'deselection') repo.profiles = [];
    else policy([{ id: 'replacement', files: [mapping({ destination: 'new.yml' })] }]);
    f.github.request.mockClear();
    expect((await f.run())[0].error).toContain('merge or revert it before cleanup');
    expect(repo.refs.get('bot/org-sync-files')).toBe(customized);
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('pending customization');
    expect(f.writes()).toHaveLength(0);
  });

  test('preserves a file created on the base branch while its starter PR was open', async () => {
    policy([{ id: 'docs', profile: 'docs', files: [mapping({ mode: 'create_if_missing' })] }]);
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.advance(repo, { '.github/workflows/docs.yml': 'created on main' });
    expect((await f.run())[0].status).toBe('closed');
    expect(f.content(repo, '.github/workflows/docs.yml', 'main')).toBe('created on main');
  });

  test('keeps base-branch changes when updating an existing sync PR', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    const oldBot = repo.refs.get('bot/org-sync-files');
    const newBase = f.advance(repo, { 'new-local.txt': 'base change' });
    f.write('workflow.yml', 'updated template');
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, 'new-local.txt')).toBe('base change');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('updated template');
    expect(f.commits.get(repo.refs.get('bot/org-sync-files')).parents).toEqual([oldBot, newBase]);
    expect(calls('PATCH /repos/{owner}/{repo}/git/refs/{ref}')[0][1].force).toBe(false);
  });

  test('handles policy removals without deleting locally modified former files', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.merge(repo);
    f.advance(repo, { '.github/workflows/docs.yml': 'customized former file' });
    policy([{ id: 'replacement', files: [mapping({ destination: 'new.yml' })] }]);
    const result = (await f.run())[0];
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('customized former file');
    expect(result.warnings).toContain('Preserved modified file removed from policy: .github/workflows/docs.yml');
    expect(f.content(repo, 'new.yml')).toBe('shared workflow\n');
  });

  test('removes an unchanged former managed path when policy replaces it', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.merge(repo);
    policy([{ id: 'replacement', files: [mapping({ destination: 'new.yml' })] }]);
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBeNull();
  });

  test('supports explicit removals and treats an absent removal path as unchanged', async () => {
    policy([{ id: 'cleanup', files: [{ destination: 'old.yml', mode: 'remove' }] }]);
    const repo = f.add('org/app', { 'old.yml': 'obsolete' });
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, 'old.yml')).toBeNull();
    f.merge(repo);
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('unchanged');
    expect(f.writes()).toHaveLength(0);
  });
});

describe('scope and operational behavior', () => {
  test.each(['organization', 'repository'])('uses configurable property names through %s discovery and deselection', async scope => {
    const repo = f.add('org/app');
    repo.values = [
      { property_name: 'lb_sync_mode', value: 'included' },
      { property_name: 'lb_workflow_profiles', value: ['docs'] },
      { property_name: 'sync_mode', value: 'excluded' },
      { property_name: 'workflow_profiles', value: [] },
    ];
    const inputs = { INPUT_SYNC_MODE_PROPERTY: 'lb_sync_mode', INPUT_WORKFLOW_PROFILES_PROPERTY: 'lb_workflow_profiles',
      ...(scope === 'repository' ? { INPUT_REPOSITORY: 'org/app' } : {}) };
    expect((await f.run(inputs))[0].status).toBe('updated');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('shared workflow\n');
    f.merge(repo);
    repo.values[1].value = [];
    const result = (await f.run(inputs))[0];
    expect(result.status).toBe('updated');
    expect(result.changes).toContainEqual({ path: '.github/workflows/docs.yml', operation: 'remove' });
    expect(f.content(repo, '.github/workflows/docs.yml')).toBeNull();
    f.merge(repo);
    repo.values[0].value = 'excluded';
    f.github.request.mockClear();
    expect((await f.run(inputs))[0].status).toBe('excluded');
    expect(f.writes()).toHaveLength(0);
  });

  test('rechecks the configured profile property before writes', async () => {
    const repo = f.add('org/app');
    repo.values = [
      { property_name: 'delivery_mode', value: 'included' },
      { property_name: 'delivery_profiles', value: ['docs'] },
    ];
    f.hook = route => { if (route.endsWith('/properties/values')) repo.values[1].value = []; };
    const result = (await f.run({ INPUT_SYNC_MODE_PROPERTY: 'delivery_mode', INPUT_WORKFLOW_PROFILES_PROPERTY: 'delivery_profiles' }))[0];
    expect(result.error).toContain('Properties changed');
    expect(f.writes()).toHaveLength(0);
  });

  test('requires explicit property overrides instead of falling back to LizardByte names', async () => {
    const repo = f.add('org/app');
    repo.values = [
      { property_name: 'lb_sync_mode', value: 'included' },
      { property_name: 'lb_workflow_profiles', value: ['docs'] },
    ];
    expect((await f.run())[0].error).toBe('Missing or invalid sync_mode');
    expect(f.writes()).toHaveLength(0);
  });

  test('uses one repository and property inventory per org, and deduplicates repository IDs', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    f.add('other/app', {}, ['docs']);
    f.github.paginate.mockImplementation(async (route, args) => route.endsWith('/repos')
      ? (args.org === 'org' ? [repo, repo] : [...f.repos.values()].filter(item => item.owner.login === args.org))
      : [...f.repos.values()].filter(item => item.owner.login === args.org).map(item => ({ repository_id: item.id,
        repository_full_name: item.full_name, properties: [{ property_name: 'sync_mode', value: 'included' }, { property_name: 'workflow_profiles', value: ['docs'] }] })));
    expect(await f.run({ INPUT_DRY_RUN: 'true' })).toHaveLength(2);
    expect(f.github.paginate).toHaveBeenCalledTimes(4);
    expect(f.writes()).toHaveLength(0);
  });

  test('narrows an exact repository without listing organization repositories', async () => {
    f.add('org/app', {}, ['docs']);
    f.add('org/unrelated', {}, ['docs']);
    const result = await f.run({ INPUT_REPOSITORY: 'org/app', INPUT_DRY_RUN: 'true' });
    expect(result).toHaveLength(1);
    expect(result[0].repository).toBe('org/app');
    expect(f.github.paginate).not.toHaveBeenCalled();
  });

  test('exact-repository rules target only the designated .github repositories', async () => {
    policy([{ id: 'pr-template', repositories: ['org/.github', 'other/.github'], files: [mapping()] }]);
    f.add('org/.github');
    f.add('other/.github');
    f.add('org/app');
    const result = await f.run({ INPUT_DRY_RUN: 'true' });
    expect(result.map(item => item.repository)).toEqual(['org/.github', 'other/.github']);
    expect(f.github.paginate).not.toHaveBeenCalled();
  });

  test('narrows by organization and respects per-rule organization selectors', async () => {
    policy([{ id: 'one-org', organizations: ['org'], files: [mapping()] }]);
    f.add('org/app');
    f.add('other/app');
    expect((await f.run({ INPUT_ORGANIZATION: 'org', INPUT_DRY_RUN: 'true' })).map(item => item.repository)).toEqual(['org/app']);
    expect(await f.run({ INPUT_ORGANIZATION: 'other', INPUT_DRY_RUN: 'true' })).toEqual([]);
  });

  test('skips private, archived and source repos, includes forks, and respects excluded mode', async () => {
    f.add('org/private', {}, ['docs'], { private: true });
    f.add('org/archived', {}, ['docs'], { archived: true });
    f.add('org/source', {}, ['docs']);
    f.add('org/fork', {}, ['docs'], { fork: true });
    f.add('org/excluded', {}, ['docs']).syncMode = 'excluded';
    const result = await f.run({ INPUT_DRY_RUN: 'true' });
    expect(result.map(item => item.status).sort()).toEqual(['excluded', 'planned']);
    expect(result.map(item => item.repository)).toEqual(['org/excluded', 'org/fork']);
  });

  test('honors explicit filter overrides and redacts private target details and errors', async () => {
    f.policy({ version: 1, include_archived: true, include_private: true, include_forks: false, include_source: true,
      rules: [{ id: 'all', files: [mapping()] }] });
    f.add('org/source', {}, [], { archived: true });
    f.add('org/secret', {}, [], { private: true, truncated: true });
    f.add('org/fork', {}, [], { fork: true });
    const result = await f.run({ INPUT_DRY_RUN: 'true' });
    expect(result).toHaveLength(2);
    expect(result.find(item => item.repository === '[private repository]')).toEqual({ repository: '[private repository]', status: 'failed' });
    expect(JSON.stringify(f.core.setOutput.mock.calls)).not.toContain('secret');
    expect(f.core.setFailed).toHaveBeenCalledWith('1 repositories failed synchronization; inspect the results output');
  });

  test('does not treat empty profiles as an exclusion from general replication', async () => {
    policy([{ id: 'general', files: [mapping()] }]);
    f.add('org/app').values = [{ property_name: 'sync_mode', value: 'included' }];
    expect((await f.run({ INPUT_DRY_RUN: 'true' }))[0].status).toBe('planned');
  });

  test('supports dry runs and makes no Git or PR writes', async () => {
    f.add('org/app', { '.github/workflows/docs.yml': 'old' }, ['docs']);
    const result = await f.run({ INPUT_DRY_RUN: 'true' });
    expect(result[0].changes).toContainEqual({ path: '.github/workflows/docs.yml', operation: 'update' });
    expect(f.writes()).toHaveLength(0);
    expect(f.core.setOutput).toHaveBeenCalledWith('changed_repositories', 1);
    expect(f.core.setOutput).toHaveBeenCalledWith('failed_repositories', 0);
  });

  test('continues other repository work after a target fails', async () => {
    f.add('org/bad', {}, ['docs'], { truncated: true });
    const good = f.add('org/good', {}, ['docs']);
    expect((await f.run()).map(item => item.status)).toEqual(['failed', 'updated']);
    expect(f.content(good, '.github/workflows/docs.yml')).toBe('shared workflow\n');
  });
});

describe('write protection and races', () => {
  test.each([
    ['missing sync property', [], 'Missing or invalid sync_mode'],
    ['invalid sync value', [{ property_name: 'sync_mode', value: 'maybe' }], 'Missing or invalid sync_mode'],
    ['invalid profile type', [{ property_name: 'sync_mode', value: 'included' }, { property_name: 'workflow_profiles', value: 'docs' }], 'Invalid workflow_profiles'],
  ])('rejects %s', async (_, values, error) => {
    f.add().values = values;
    expect((await f.run())[0].error).toBe(error);
    expect(f.core.setFailed).toHaveBeenCalled();
    expect(f.writes()).toHaveLength(0);
  });

  test.each(['160000', '120000'])('rejects managed submodule/symlink mode %s', async mode => {
    const repo = f.add('org/app', { '.github/workflows/docs.yml': { content: 'target', mode } }, ['docs']);
    expect((await f.run())[0].status).toBe('failed');
    expect(f.writes()).toHaveLength(0);
    expect(f.content(repo, '.github/workflows/docs.yml', 'main')).toBe('target');
  });

  test('rejects managed paths colliding with directories or ancestor files', async () => {
    f.add('org/app', { '.github/workflows/docs.yml/local': 'unrelated' }, ['docs']);
    expect((await f.run())[0].error).toContain('collides');
    expect(f.writes()).toHaveLength(0);
  });

  test('rejects a file ancestor blocking a managed destination', async () => {
    f.add('org/app', { '.github': 'an ordinary file' }, ['docs']);
    expect((await f.run())[0].error).toContain('collides');
    expect(f.writes()).toHaveLength(0);
  });

  test('does not overwrite a foreign sync branch', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    repo.refs.set('bot/org-sync-files', repo.refs.get('main'));
    expect((await f.run())[0].error).toContain('not owned');
    expect(f.writes()).toHaveLength(0);
  });

  test('does not overwrite unrelated edits on its bot branch', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.advance(repo, { 'maintainer.txt': 'keep me' }, 'bot/org-sync-files');
    f.github.request.mockClear();
    expect((await f.run())[0].error).toContain('unrelated edits');
    expect(f.writes()).toHaveLength(0);
  });

  test('rechecks property changes before any writes', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    f.hook = route => { if (route.endsWith('/properties/values')) repo.profiles = []; };
    expect((await f.run())[0].error).toContain('Properties changed');
    expect(f.writes()).toHaveLength(0);
  });

  test.each([
    ['id', 1234], ['full_name', 'outside/app'], ['default_branch', 'renamed'],
    ['private', true], ['archived', true], ['fork', true],
  ])('rechecks repository %s before any writes', async (field, value) => {
    f.add('org/app', {}, ['docs']);
    const request = f.github.request.getMockImplementation();
    f.github.request.mockImplementation(async (route, args) => {
      const response = await request(route, args);
      return route === 'GET /repos/{owner}/{repo}' ? { data: { ...response.data, [field]: value } } : response;
    });
    expect((await f.run())[0].error).toContain('Repository identity or eligibility changed');
    expect(f.writes()).toHaveLength(0);
  });

  test('does not publish a plan after the default branch advances', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    f.hook = route => { if (route === 'POST /repos/{owner}/{repo}/git/commits') f.advance(repo, { 'local.txt': 'new base' }); };
    expect((await f.run())[0].error).toContain('Default branch advanced');
    expect(repo.refs.has('bot/org-sync-files')).toBe(false);
    expect(repo.pulls).toHaveLength(0);
  });

  test('refuses a non-fast-forward if the bot branch advances concurrently', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.write('workflow.yml', 'next template');
    f.hook = route => {
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}') f.advance(repo, { 'concurrent.txt': 'preserve' }, 'bot/org-sync-files');
    };
    expect((await f.run())[0].error).toContain('Not a fast-forward');
    expect(f.content(repo, 'concurrent.txt')).toBe('preserve');
  });
});

describe('configuration validation', () => {
  test.each([
    { INPUT_SYNC_MODE_PROPERTY: 'bad name' },
    { INPUT_WORKFLOW_PROFILES_PROPERTY: 'bad\nname' },
    { INPUT_SYNC_MODE_PROPERTY: 123 },
    { INPUT_WORKFLOW_PROFILES_PROPERTY: {} },
    { INPUT_SYNC_MODE_PROPERTY: 'same', INPUT_WORKFLOW_PROFILES_PROPERTY: 'same' },
  ])('rejects invalid custom property names before API access %#', async inputs => {
    expect(await f.run(inputs)).toEqual([]);
    expect(f.core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Custom property names'));
    expect(f.github.request).not.toHaveBeenCalled();
    expect(f.github.paginate).not.toHaveBeenCalled();
  });

  test('reports configured property names in validation errors and uses neutral defaults', () => {
    expect(options({})).toMatchObject({ syncModeProperty: 'sync_mode', workflowProfilesProperty: 'workflow_profiles' });
    const names = { syncModeProperty: 'delivery_mode', workflowProfilesProperty: 'delivery_profiles' };
    const mode = { property_name: 'delivery_mode', value: 'included' };
    const profiles = { property_name: 'delivery_profiles', value: ['docs'] };
    expect(() => properties([], names)).toThrow('Missing or invalid delivery_mode');
    expect(() => properties([mode, profiles, profiles], names)).toThrow('Duplicate delivery_profiles');
    expect(() => properties([mode, { ...profiles, value: 'docs' }], names)).toThrow('Invalid delivery_profiles');
  });

  test.each(['../escape', '/absolute', '.git/config', 'C:/secret', 'a\\b', 'a//b', 'a/./b', ' leading'])('rejects unsafe file path %s', destination => {
    policy([{ id: 'bad', files: [mapping({ destination })] }]);
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow();
  });

  test.each([
    { version: 2, rules: [] },
    { version: 1, id: '../bad', rules: [{}] },
    { version: 1, include_private: 'true', rules: [{}] },
    { version: 1, rules: [{ id: 'x', files: [] }] },
    { version: 1, rules: [{ id: 'x', profile: 'bad profile', files: [mapping()] }] },
    { version: 1, rules: [{ id: 'x', repositories: ['elsewhere/app'], files: [mapping()] }] },
    { version: 1, rules: [{ id: 'x', repositories: [], files: [mapping()] }] },
    { version: 1, rules: [{ id: 'x', repositories: ['org/app'], organizations: ['org'], files: [mapping()] }] },
    { version: 1, rules: [{ id: 'x', files: [null] }] },
    { version: 1, rules: [{ id: 'x', files: [mapping({ mode: 'unexpected' })] }] },
    { version: 1, rules: [{ id: 'x', files: [mapping({ destination: STATE_PATH })] }] },
    { version: 1, rules: [{ id: 'x', files: [mapping({ permissions: '120000' })] }] },
    { version: 1, rules: [{ id: 'x', files: [mapping({ mode: 'remove' })] }] },
    { version: 1, rules: [{ id: 'x', files: [mapping()] }, { id: 'x', files: [mapping()] }] },
  ])('rejects invalid policy %#', invalid => {
    f.policy(invalid);
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow();
  });

  test('rejects duplicate organizations and sources resolving outside the source root', () => {
    f.write('organizations.json', JSON.stringify(['org', 'ORG']));
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow('Duplicate');
    f.write('organizations.json', JSON.stringify(['org']));
    const original = fs.realpathSync;
    jest.spyOn(fs, 'realpathSync').mockImplementation(value => value === path.join(f.root, 'workflow.yml')
      ? path.join(f.root, '..', 'outside.yml') : original(value));
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow('escapes');
  });

  test('reports invalid action inputs and disallows scope expansion or writing main', async () => {
    f.add('org/app', {}, ['docs']);
    expect(() => booleanInput('yes', false)).toThrow();
    expect(booleanInput('', true)).toBe(true);
    expect(booleanInput('false', true)).toBe(false);
    expect(() => options({ INPUT_BRANCH: 'bad branch' })).toThrow();
    expect(() => options({ INPUT_CONCURRENCY: '20' })).toThrow();
    expect(() => options({ INPUT_PR_TITLE: 'bad\ntitle' })).toThrow();
    await f.run({ INPUT_ORGANIZATION: 'unapproved' });
    expect(f.core.setFailed).toHaveBeenCalledWith('Requested organization is outside the configured list');
    await f.run({ INPUT_REPOSITORY: 'unapproved/app' });
    expect(f.core.setFailed).toHaveBeenCalledWith('Requested repository is outside the configured policy');
    expect((await f.run({ INPUT_BRANCH: 'main' }))[0].error).toContain('default branch');
    expect(f.writes()).toHaveLength(0);
  });

  test('validates ownership state and incomplete metadata', () => {
    expect(() => readState('{', 'org-sync')).toThrow();
    expect(() => readState(JSON.stringify({ version: 1, id: 'other', files: {} }), 'org-sync')).toThrow('another controller');
    expect(() => readState(JSON.stringify({ version: 1, id: 'org-sync', files: 1 }), 'org-sync')).toThrow();
    expect(() => readState(JSON.stringify({ version: 1, id: 'org-sync', files: { bad: { mode: 'sync', sha: 'bad' } } }), 'org-sync')).toThrow();
    expect(() => properties(null)).toThrow();
    expect(() => properties([{ property_name: 'sync_mode', value: 'included' }, { property_name: 'workflow_profiles', value: [] }, { property_name: 'workflow_profiles', value: [] }])).toThrow('Duplicate');
    expect(() => regular({ type: 'tree' })).toThrow();
    expect(differences(new Map(), new Map())).toEqual([]);
    expect(blobSha(Buffer.from('hello'))).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  });
});

describe('reconciliation recovery and API boundaries', () => {
  test('updates an owned PR title without creating a new commit', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    f.github.request.mockClear();
    expect((await f.run({ INPUT_PR_TITLE: 'chore: revised title' }))[0].status).toBe('updated');
    expect(repo.pulls[0].title).toBe('chore: revised title');
    expect(calls('POST /repos/{owner}/{repo}/git/commits')).toHaveLength(0);
    repo.pulls[0].body += '\nOld generated text';
    expect((await f.run({ INPUT_PR_TITLE: 'chore: revised title' }))[0].status).toBe('updated');
    expect(repo.pulls[0].body).not.toContain('Old generated text');
  });

  test('recovers an existing bot branch after PR creation failed', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    f.hook = route => { if (route === 'POST /repos/{owner}/{repo}/pulls') throw new Error('Temporary PR failure'); };
    expect((await f.run())[0].status).toBe('failed');
    expect(repo.refs.has('bot/org-sync-files')).toBe(true);
    f.hook = null;
    f.github.request.mockClear();
    expect((await f.run())[0].status).toBe('updated');
    expect(repo.pulls).toHaveLength(1);
    expect(calls('POST /repos/{owner}/{repo}/git/commits')).toHaveLength(0);
  });

  test('leaves foreign PRs and ambiguous comparison responses untouched', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation((route, args) => route.includes('/compare/')
      ? Promise.resolve({ data: { files: Array.from({ length: 300 }, () => ({ filename: STATE_PATH })) } })
      : original(route, args));
    expect((await f.run())[0].error).toContain('Incomplete sync branch comparison');
    f.github.request.mockImplementation(original);
    repo.pulls[0].body = 'A human pull request';
    expect((await f.run())[0].error).toContain('not owned');
    repo.pulls.push({ ...repo.pulls[0], number: 2 });
    expect((await f.run())[0].error).toContain('Multiple open');
  });

  test.each([STATE_PATH, 'unrelated.txt'])('validates the previous path in a renamed branch file: %s', async previous => {
    f.add('org/app', {}, ['docs']);
    await f.run();
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation((route, args) => route.includes('/compare/')
      ? Promise.resolve({ data: { files: [{ filename: '.github/workflows/docs.yml', previous_filename: previous }] } })
      : original(route, args));
    const result = (await f.run())[0];
    expect(result.status).toBe(previous === STATE_PATH ? 'unchanged' : 'failed');
  });

  test('reports empty/ineligible default branches and propagates non-404 reference errors', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    repo.refs.clear();
    expect((await f.run())[0].error).toContain('Initialize the target');
    f.hook = route => { if (route.endsWith('/git/ref/{ref}')) throw Object.assign(new Error('Ref forbidden'), { status: 403 }); };
    expect((await f.run())[0].error).toBe('Ref forbidden');
    expect(f.writes()).toHaveLength(0);
  });

  test('rejects unexpected state encoding and incorrect server blob hashes', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    f.state(repo, {});
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation(async (route, args) => {
      const response = await original(route, args);
      if (route === 'GET /repos/{owner}/{repo}/git/blobs/{file_sha}') response.data.encoding = 'utf8';
      return response;
    });
    expect((await f.run())[0].error).toContain('Unexpected state blob encoding');
    f.github.request.mockImplementation(async (route, args) => {
      const response = await original(route, args);
      if (route === 'POST /repos/{owner}/{repo}/git/blobs') response.data.sha = 'incorrect';
      return response;
    });
    expect((await f.run())[0].error).toContain('blob hash');
    expect(repo.refs.has('bot/org-sync-files')).toBe(false);
  });

  test('handles both unchanged dry runs and already pending changes without writes', async () => {
    const repo = f.add('org/app');
    expect((await f.run({ INPUT_DRY_RUN: 'true' }))[0].status).toBe('unchanged');
    repo.profiles = ['docs'];
    await f.run();
    f.github.request.mockClear();
    expect((await f.run({ INPUT_DRY_RUN: 'true' }))[0].status).toBe('planned');
    expect(f.writes()).toHaveLength(0);
  });

  test('drops stale ownership records for files already removed by maintainers', async () => {
    const repo = f.add('org/app');
    f.state(repo, { 'gone.txt': { mode: 'sync', sha: blobSha(Buffer.from('gone')) } });
    policy([{ id: 'general', files: [mapping()] }]);
    const result = (await f.run())[0];
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(f.content(repo, STATE_PATH)).files).not.toHaveProperty('gone.txt');
  });

  test('validates recorded permissions and can clean up older state records', async () => {
    const repo = f.add('org/app', { 'old.yml': 'old contents' });
    f.state(repo, { 'old.yml': { mode: 'sync', sha: blobSha(Buffer.from('old contents')) } });
    policy([{ id: 'common', files: [mapping()] }]);
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, 'old.yml')).toBeNull();
    expect(() => readState(JSON.stringify({ version: 1, id: 'org-sync', files: {
      'old.yml': { mode: 'sync', sha: blobSha(Buffer.from('old')), permissions: '120000' },
    } }), 'org-sync')).toThrow('Invalid managed file state');
  });

  test('removes pending former files and closes an unmerged starter after deselection', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    await f.run();
    policy([{ id: 'replacement', files: [mapping({ destination: 'replacement.yml' })] }]);
    expect((await f.run())[0].status).toBe('updated');
    expect(f.content(repo, '.github/workflows/docs.yml')).toBeNull();
    f.merge(repo);
    policy([{ id: 'starter', profile: 'docs', files: [mapping({ destination: 'starter.yml', mode: 'create_if_missing' })] }]);
    await f.run();
    repo.profiles = [];
    await f.run();
    expect(f.content(repo, 'starter.yml', 'main')).toBeNull();
  });

  test('rejects conflicting destination definitions before creating a branch', async () => {
    policy([{ id: 'first', files: [mapping()] }, { id: 'second', files: [mapping({ mode: 'create_if_missing' })] }]);
    f.add('org/app');
    expect((await f.run())[0].error).toContain('Conflicting mappings');
    expect(f.writes()).toHaveLength(0);
  });

  test('lets valid organizations continue when another org is inaccessible', async () => {
    const repo = f.add('org/app', {}, ['docs']);
    const original = f.github.paginate.getMockImplementation();
    f.github.paginate.mockImplementation((route, args) => args.org === 'other'
      ? Promise.reject(new Error('Other organization is inaccessible')) : original(route, args));
    const results = await f.run();
    expect(results.map(result => result.status)).toEqual(['updated', 'failed']);
    expect(f.content(repo, '.github/workflows/docs.yml')).toBe('shared workflow\n');
  });

  test('reports incomplete property inventories without exposing private repo names', async () => {
    f.policy({ version: 1, include_private: true, rules: [{ id: 'common', files: [mapping()] }] });
    f.add('org/public');
    f.add('org/private', {}, [], { private: true });
    const original = f.github.paginate.getMockImplementation();
    f.github.paginate.mockImplementation((route, args) => route.endsWith('/properties/values')
      ? Promise.resolve([]) : original(route, args));
    const results = await f.run();
    expect(results).toHaveLength(2);
    expect(results.every(result => result.status === 'failed')).toBe(true);
    expect(JSON.stringify(results)).not.toContain('org/private');
  });

  test('redacts excluded and invalid private property values', async () => {
    f.policy({ version: 1, include_private: true, rules: [{ id: 'common', files: [mapping()] }] });
    f.add('org/hidden-excluded', {}, [], { private: true }).syncMode = 'excluded';
    f.add('org/hidden-invalid', {}, [], { private: true }).values = [];
    const result = await f.run();
    expect(result.map(row => row.repository)).toEqual(['[private repository]', '[private repository]']);
    expect(result.map(row => row.status).sort()).toEqual(['excluded', 'failed']);
  });

  test('uses exact lookups for source skips, unavailable repos, and renamed repos', async () => {
    f.add('org/source');
    expect(await f.run({ INPUT_REPOSITORY: 'org/source' })).toEqual([]);
    expect((await f.run({ INPUT_REPOSITORY: 'org/missing' }))[0].error).toBe('Repository lookup failed');
    f.add('org/renamed').full_name = 'different/new-name';
    expect((await f.run({ INPUT_REPOSITORY: 'org/renamed' }))[0].error).toContain('renamed or transferred');
  });

  test('redacts exact private property lookup failures', async () => {
    f.policy({ version: 1, include_private: true, rules: [{ id: 'common', files: [mapping()] }] });
    f.add('org/private', {}, [], { private: true });
    f.hook = route => { if (route.endsWith('/properties/values')) throw new Error('secret name'); };
    expect((await f.run({ INPUT_REPOSITORY: 'org/private' }))[0]).toEqual({
      repository: '[unavailable repository]', status: 'failed', error: 'Repository lookup failed',
    });
  });

  test('rejects inconsistent canonical owners returned by discovery', async () => {
    f.add('org/app', {}, ['docs']);
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation(async (route, args) => {
      const response = await original(route, args);
      if (route === 'GET /repos/{owner}/{repo}') response.data = { ...response.data, owner: { login: 'unapproved' } };
      return response;
    });
    expect((await f.run({ INPUT_REPOSITORY: 'org/app' }))[0].error).toContain('Unexpected canonical');
  });
});

describe('runner inputs and file representation', () => {
  test('accepts source-path destinations and executable source permissions', async () => {
    policy([{ id: 'common', files: [{ source: 'workflow.yml' }] }]);
    const statSync = fs.statSync;
    jest.spyOn(fs, 'statSync').mockImplementation(value => {
      const result = statSync(value);
      if (value === path.join(f.root, 'workflow.yml')) result.mode |= 0o111;
      return result;
    });
    const repo = f.add('org/app');
    expect((await f.run())[0].status).toBe('updated');
    expect(f.entries(repo, 'bot/org-sync-files').get('workflow.yml').mode).toBe('100755');
  });

  test.each(['line\nbreak', `delete${String.fromCharCode(127)}`])('rejects control characters in destination %s', destination => {
    policy([{ id: 'invalid', files: [mapping({ destination })] }]);
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow();
  });

  test('rejects non-regular source files and executable permissions on a remove operation', () => {
    policy([{ id: 'remove', files: [{ destination: 'old', mode: 'remove', permissions: '100644' }] }]);
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow('Remove mappings');
    policy([{ id: 'source', files: [{ source: 'directory' }] }]);
    fs.mkdirSync(path.join(f.root, 'directory'));
    expect(() => loadConfig({ sourceDirectory: f.root, configFile: 'policy.json', organizationsFile: 'organizations.json' })).toThrow('regular files');
  });

  test('reads defaults from the GitHub runner environment', async () => {
    f.write('.github/file-sync.json', fs.readFileSync(path.join(f.root, 'policy.json')));
    f.add('org/app', {}, ['docs']);
    const original = process.env;
    process.env = { ...original, GITHUB_WORKSPACE: f.root, INPUT_DRY_RUN: 'true' };
    delete process.env.INPUT_SOURCE_DIRECTORY;
    delete process.env.INPUT_CONFIG;
    delete process.env.INPUT_ORGANIZATIONS_FILE;
    try {
      const run = require('../../actions/org_sync/org_sync.js');
      expect((await run({ github: f.github, context: f.context, core: f.core }))[0].status).toBe('planned');
    } finally {
      process.env = original;
    }
  });

  test('uses the working directory when no workspace input is supplied', async () => {
    f.write('.github/file-sync.json', fs.readFileSync(path.join(f.root, 'policy.json')));
    f.add('org/app', {}, ['docs']);
    const resolve = path.resolve;
    jest.spyOn(path, 'resolve').mockImplementation((...parts) => parts.length === 1 && parts[0] === '.' ? f.root : resolve(...parts));
    const run = require('../../actions/org_sync/org_sync.js');
    expect((await run({ github: f.github, context: f.context, core: f.core, env: {} }))[0].status).toBe('updated');
    expect(() => options({ INPUT_REPOSITORY: 'org/..' })).toThrow('Invalid repository');
    expect(properties([{ property_name: 'sync_mode', value: 'included' }, { property_name: 'workflow_profiles', value: null }]).profiles.size).toBe(0);
  });
});
