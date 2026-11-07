const fs = require('node:fs');
const path = require('node:path');
const sodium = require('../../actions/org_sync/node_modules/libsodium-wrappers');
const fixture = require('./administration-fixture.js');
const run = require('../../actions/org_sync/admin.js');
const { definition, definitions } = require('../../actions/org_sync/schemas.js');
const { secretValues, credential } = require('../../actions/org_sync/admin-config.js');
const { encrypt } = require('../../actions/org_sync/credentials.js');

let f;
let keypair;
const property = { property_name: 'sync_mode', value_type: 'single_select', allowed_values: ['included', 'excluded'],
  required: true, default_value: 'included' };
const policy = config => f.write('admin.json', { organizations: ['target'], ...config });
const env = { INPUT_PROPERTIES_FILE: '', INPUT_ADMIN_CONFIG: 'admin.json', INPUT_ORGANIZATION: 'target' };

test('unset organization profiles copy, clear, and verify using GitHub null/empty-string equivalence', async () => {
  const source = f.organizations.get('source');
  const target = f.organizations.get('target');
  source.settings.company = null;
  source.settings.twitter_username = 'SharedAccount';
  target.settings.company = 'Old company';
  target.settings.twitter_username = null;
  policy({ source_organization: 'source', settings: { from_source: ['company', 'twitter_username'] } });
  const result = (await f.run(env))[0];
  expect(result.status).toBe('updated');
  expect(target.settings).toMatchObject({ company: '', twitter_username: 'SharedAccount' });
  target.settings.company = null;
  expect((await f.run(env))[0].status).toBe('unchanged');
});

beforeAll(async () => { await sodium.ready; keypair = sodium.crypto_box_keypair(); });
beforeEach(() => {
  f = fixture({ key_id: 'public-key', key: sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL) });
});
afterEach(() => { f.remove(); jest.restoreAllMocks(); });

test('dry runs plan complete schemas across every allowed organization without writing', async () => {
  const results = await f.run({ INPUT_DRY_RUN: 'true' });
  expect(results.map(result => result.status)).toEqual(['planned', 'planned']);
  expect(results[0].changes[0]).toMatchObject({ kind: 'schema', operation: 'create', after: definition(property) });
  expect(f.writes).toHaveLength(0);
  expect(f.core.setOutput).toHaveBeenCalledWith('changed_organizations', 2);
});

test('schema-only delivery needs no file policy and retains unrelated properties and repo assignments', async () => {
  const target = f.organizations.get('target');
  target.schema = [{ property_name: 'local', value_type: 'string' }];
  target.values = [{ repository_full_name: 'target/app', properties: [{ property_name: 'sync_mode', value: 'excluded' }] }];
  expect((await f.run({ INPUT_ORGANIZATION: 'target' }))[0].status).toBe('updated');
  expect(target.schema.find(value => value.property_name === 'local')).toEqual({ property_name: 'local', value_type: 'string' });
  expect(target.values[0].properties[0].value).toBe('excluded');
  const count = f.writes.length;
  expect((await f.run({ INPUT_ORGANIZATION: 'target' }))[0].status).toBe('unchanged');
  expect(f.writes).toHaveLength(count);
  expect(f.writes.every(write => write.route === 'PATCH /orgs/{org}/properties/schema')).toBe(true);
});

test('schema updates send complete optional fields and report default changes', async () => {
  f.organizations.get('target').schema = [{ ...definition(property), description: 'Old', values_editable_by: 'org_and_repo_actors' }];
  f.write('properties.json', { properties: [{ ...property, default_value: 'excluded', description: 'New' }] });
  const result = (await f.run({ INPUT_ORGANIZATION: 'target' }))[0];
  expect(result.changes[0].before.default_value).toBe('included');
  expect(f.writes[0].properties[0]).toMatchObject({ description: 'New', default_value: 'excluded',
    require_explicit_values: false, values_editable_by: 'org_actors' });
});

test('schema type changes and inherited property updates fail before any writes', async () => {
  f.organizations.get('target').schema = [{ ...definition(property), source_type: 'enterprise' }];
  expect((await f.run({ INPUT_ORGANIZATION: 'target' }))[0].status).toBe('unchanged');
  f.write('properties.json', { properties: [{ ...property, default_value: 'excluded' }] });
  expect((await f.run({ INPUT_ORGANIZATION: 'target' }))[0].error).toContain('inherited');
  f.organizations.get('target').schema = [{ ...definition(property), value_type: 'string', allowed_values: null }];
  expect((await f.run({ INPUT_ORGANIZATION: 'target' }))[0].error).toContain('type changes');
  expect(f.writes).toHaveLength(0);
});

test('choice removal refuses assigned values, including private repositories, but permits unused choices', async () => {
  const target = f.organizations.get('target');
  target.schema = [definition({ ...property, allowed_values: ['included', 'excluded', 'old'] })];
  target.values = [{ repository_full_name: 'target/private-name', properties: [{ property_name: 'sync_mode', value: 'old' }] }];
  let result = (await f.run({ INPUT_ORGANIZATION: 'target' }))[0];
  expect(result.error).toContain('invalidate repository values');
  expect(JSON.stringify(result)).not.toContain('private-name');
  expect(f.writes).toHaveLength(0);
  target.values[0].properties[0].value = 'included';
  result = (await f.run({ INPUT_ORGANIZATION: 'target' }))[0];
  expect(result.status).toBe('updated');
});

test('schema races and failed verification retain failure status and attempted changes', async () => {
  let reads = 0;
  f.hook = (route, args) => {
    if (route === 'GET /orgs/{org}/properties/schema' && args.org === 'target' && ++reads === 2) {
      f.organizations.get('target').schema = [definition({ ...property, description: 'Concurrent change' })];
    }
  };
  expect((await f.run({ INPUT_ORGANIZATION: 'target' }))[0].error).toContain('changed during planning');
  expect(f.writes).toHaveLength(0);
  f.hook = route => { if (route.startsWith('PATCH')) throw Object.assign(new Error('sensitive-response'), { status: 403 }); };
  const result = (await f.run({ INPUT_ORGANIZATION: 'source' }))[0];
  expect(result.status).toBe('failed');
  expect(result.error).toContain('HTTP 403');
  expect(result.error).not.toContain('sensitive-response');
});

test('one inaccessible org does not prevent safe orgs from completing', async () => {
  f.hook = (_, args) => { if (args.org === 'source') throw Object.assign(new Error('forbidden'), { status: 403 }); };
  const results = await f.run();
  expect(results.map(result => result.status)).toEqual(['failed', 'updated']);
  expect(f.core.setOutput).toHaveBeenCalledWith('failed_organizations', 1);
});

test('file-only mode performs no administration reads and invalid modes/configurations fail before writes', async () => {
  expect(await f.run({ INPUT_PROPERTIES_FILE: '', INPUT_SYNC_FILES: 'true' })).toEqual([]);
  expect(f.requests).toHaveLength(0);
  for (const invalid of [{ INPUT_DRY_RUN: 'yes' }, { INPUT_SYNC_FILES: 'no' }, { INPUT_CONCURRENCY: '0' },
    { INPUT_ORGANIZATION: 'outside' }, { INPUT_REPOSITORY: 'target/app' },
    { INPUT_PROPERTIES_FILE: '../escape.json' }, { INPUT_PROPERTIES_FILE: '', INPUT_SYNC_FILES: 'false' }]) {
    expect(await f.run(invalid)).toEqual([]);
  }
  expect(f.writes).toHaveLength(0);
  expect(f.core.setFailed).toHaveBeenCalled();
});

test.each([
  { secrets: [{ name: 'TOKEN', value: 'never-inline', value_key: 'token', visibility: 'all' }] },
  { secrets: [{ name: 'TOKEN', value_key: 'token' }] },
  { variables: [{ name: 'GITHUB_RESERVED', value: 'x', visibility: 'all' }] },
  { variables: [{ name: 'VAR', value: 'x', from_source: 'X', visibility: 'all' }] },
  { variables: [{ name: 'VAR', value: 'x', visibility: 'all', organizations: ['outside'] }] },
  { variables: [{ name: 'VAR', value: 'x', visibility: 'all', repository_names: ['app'] }] },
  { settings: { values: { unsupported: true } } },
  { settings: { from_source: ['web_commit_signoff_required'] } },
  { actions: { workflow: { default_workflow_permissions: 'admin' } } },
  { source_organization: 'outside' },
  { unexpected: true },
])('rejects invalid administrative policy %# without touching orgs', async config => {
  policy(config);
  expect(await f.run(env)).toEqual([]);
  expect(f.writes).toHaveLength(0);
});

test('settings copy explicit source fields, preserve destination-specific fields, and verify idempotency', async () => {
  f.organizations.get('source').settings.web_commit_signoff_required = true;
  f.organizations.get('target').settings.custom_local_setting = 'preserved';
  policy({ source_organization: 'source', organizations: ['target'],
    settings: { from_source: ['web_commit_signoff_required'], values: { default_repository_permission: 'none' } } });
  expect((await f.run(env))[0].status).toBe('updated');
  expect(f.organizations.get('target').settings).toMatchObject({ web_commit_signoff_required: true,
    default_repository_permission: 'none', custom_local_setting: 'preserved' });
  expect((await f.run(env))[0].status).toBe('unchanged');
});

test('Actions policies retain unspecified fields and resolve selected repositories inside each organization', async () => {
  const repo = f.repo('target', '.github');
  f.organizations.get('target').permissions.sha_pinning_required = true;
  policy({ actions: { permissions: { enabled_repositories: 'selected', allowed_actions: 'selected' },
    repository_names: ['.github'], selected_actions: { github_owned_allowed: true, verified_allowed: false,
      patterns_allowed: ['source/*@*'] },
    workflow: { can_approve_pull_request_reviews: true }, retention: { days: 30 } } });
  const result = (await f.run(env))[0];
  expect(result.status).toBe('updated');
  expect(f.organizations.get('target').permissions.sha_pinning_required).toBe(true);
  expect(f.organizations.get('target').actionsRepositories).toEqual([repo.id]);
  expect(f.organizations.get('target').workflow.default_workflow_permissions).toBe('read');
  expect(f.organizations.get('target').retention.days).toBe(30);
  expect((await f.run(env))[0].status).toBe('unchanged');
});

test('source Actions settings can be mirrored with explicit overrides', async () => {
  f.organizations.get('source').workflow.can_approve_pull_request_reviews = true;
  policy({ source_organization: 'source', actions: {
    from_source: ['workflow'], workflow: { default_workflow_permissions: 'write' } } });
  expect((await f.run(env))[0].status).toBe('updated');
  expect(f.organizations.get('target').workflow).toEqual({ can_approve_pull_request_reviews: true,
    default_workflow_permissions: 'write' });
});

test('variables copy source values, apply selected access, and omit plaintext values from results', async () => {
  const repo = f.repo('target', 'app');
  f.organizations.get('source').variables.set('SOURCE_VAR', { name: 'SOURCE_VAR', value: 'source-variable-value', visibility: 'all' });
  policy({ source_organization: 'source', variables: [{ name: 'DEST_VAR', from_source: 'SOURCE_VAR',
    visibility: 'selected', repository_names: ['app'] }] });
  const result = (await f.run(env))[0];
  expect(result.status).toBe('updated');
  expect(f.organizations.get('target').variables.get('DEST_VAR').value).toBe('source-variable-value');
  expect(f.organizations.get('target').access.get('DEST_VAR')).toEqual([repo.id]);
  expect(JSON.stringify(result)).not.toContain('source-variable-value');
  expect((await f.run(env))[0].status).toBe('unchanged');
});

test.each(['actions', 'dependabot', 'codespaces'])('%s secrets use a decryptable sealed box and explicit visibility', async kind => {
  const repo = f.repo('target', '.github');
  const plaintext = 'secret with quotes " and newline\n, unicode: 日本語';
  policy({ secrets: [{ name: 'TOKEN', kind, value_key: 'token', visibility: 'selected', repository_names: ['.github'] }] });
  const result = (await f.run({ ...env, INPUT_SECRET_VALUES: JSON.stringify({ token: plaintext }) }))[0];
  expect(result.status).toBe('updated');
  const ciphertext = sodium.from_base64(f.organizations.get('target').ciphertext.get(`${kind}/TOKEN`), sodium.base64_variants.ORIGINAL);
  expect(sodium.to_string(sodium.crypto_box_seal_open(ciphertext, keypair.publicKey, keypair.privateKey))).toBe(plaintext);
  expect(f.organizations.get('target').access.get(`${kind}/TOKEN`)).toEqual([repo.id]);
  expect(JSON.stringify(result)).not.toContain(plaintext);
  expect(JSON.stringify(f.core.setOutput.mock.calls)).not.toContain(plaintext);
  expect(f.core.setSecret).toHaveBeenCalledWith(plaintext);
});

test('secrets plan without plaintext, but delivery refuses missing inputs before any writes', async () => {
  policy({ secrets: [{ name: 'TOKEN', value_key: 'token', visibility: 'private' }] });
  const preview = (await f.run({ ...env, INPUT_DRY_RUN: 'true' }))[0];
  expect(preview.status).toBe('planned');
  expect(preview.warnings).toContain('Secret value required for delivery: actions/TOKEN');
  expect((await f.run(env))[0].error).toContain('Missing supplied secret value');
  expect(f.writes).toHaveLength(0);
});

test('create-if-missing preserves existing secrets and variables without requiring supplied values', async () => {
  const target = f.organizations.get('target');
  target.secrets.set('actions/TOKEN', { name: 'TOKEN', visibility: 'all' });
  target.variables.set('VAR', { name: 'VAR', value: '', visibility: 'all' });
  policy({ secrets: [{ name: 'TOKEN', value_key: 'token', visibility: 'private', mode: 'create_if_missing' }],
    variables: [{ name: 'VAR', value: 'replacement', visibility: 'private', mode: 'create_if_missing' }] });
  expect((await f.run(env))[0].status).toBe('unchanged');
  expect(f.writes).toHaveLength(0);
});

test('missing selected repositories fail closed and scope filters do not broaden access', async () => {
  policy({ organizations: ['source'], secrets: [{ name: 'TOKEN', value_key: 'x', visibility: 'all' }] });
  expect((await f.run(env))[0].status).toBe('unchanged');
  policy({ variables: [{ name: 'VAR', value: 'value', visibility: 'selected', repository_names: ['missing'] }] });
  expect((await f.run(env))[0].error).toContain('missing or inaccessible');
  expect(f.writes).toHaveLength(0);
});

test('raw credential/API failures and malformed secret JSON cannot leak values in errors', async () => {
  expect(() => secretValues('{"token":"private-fragment', f.core)).toThrow('secret_values must be a JSON object');
  policy({ variables: [{ name: 'VAR', value: 'private-fragment', visibility: 'all' }] });
  f.hook = () => { throw Object.assign(new Error('private-fragment'), { status: 401 }); };
  const result = await f.run(env);
  expect(JSON.stringify(result)).not.toContain('private-fragment');
  expect(JSON.stringify(f.core.setFailed.mock.calls)).not.toContain('private-fragment');
});

test('source credentials can be separate from the destination organization credential', async () => {
  const sourceGithub = f.github;
  f.github.constructor = jest.fn(() => sourceGithub);
  policy({});
  expect((await f.run({ ...env, INPUT_SOURCE_TOKEN: 'source-only-token' }))[0].status).toBe('unchanged');
  expect(f.github.constructor).toHaveBeenCalledWith({ auth: 'source-only-token', baseUrl: 'https://api.github.com' });
});

test('default environment execution and configuration read failures remain diagnostic', async () => {
  const previous = process.env;
  process.env = { ...previous, INPUT_SOURCE_DIRECTORY: f.root, INPUT_PROPERTIES_FILE: 'properties.json' };
  try { expect(await run({ github: f.github, core: f.core })).toHaveLength(2); }
  finally { process.env = previous; }
  fs.writeFileSync(path.join(f.root, 'properties.json'), '{invalid');
  expect(await f.run()).toEqual([]);
  expect(f.core.setFailed).toHaveBeenLastCalledWith('Cannot read administration configuration: properties.json');
});

test.each([
  { property_name: 'x', value_type: 'string', unknown: true },
  { property_name: 'bad.name', value_type: 'string' },
  { property_name: 'x', value_type: 'unexpected' },
  { property_name: 'x', value_type: 'string', required: 'yes' },
  { property_name: 'x', value_type: 'single_select', allowed_values: [] },
  { property_name: 'x', value_type: 'single_select', allowed_values: ['x'], default_value: 'missing' },
  { property_name: 'x', value_type: 'multi_select', allowed_values: ['x'], default_value: 'x' },
  { property_name: 'x', value_type: 'string', allowed_values: ['x'] },
  { property_name: 'x', value_type: 'true_false', default_value: 'yes' },
  { property_name: 'x', value_type: 'url', default_value: 'not a URL' },
])('rejects invalid schema definitions %#', value => {
  expect(() => definition(value)).toThrow();
});

test('schema defaults cover every supported type, including URLs and multi-select defaults', () => {
  expect(definition({ property_name: 'flag', value_type: 'true_false', default_value: 'false' }).default_value).toBe('false');
  expect(definition({ property_name: 'url', value_type: 'url', default_value: 'https://example.test' }).value_type).toBe('url');
  expect(definition({ property_name: 'choice', value_type: 'multi_select', allowed_values: ['a'], default_value: ['a'] })
    .default_value).toEqual(['a']);
  expect(() => definitions({ properties: [property, property] })).toThrow('Duplicate property names');
  expect(() => credential({ name: 'V', value: 'x', visibility: 'all', kind: 'actions' }, 'variable', ['source'])).toThrow();
});

test('bad recipient public keys are rejected without passing plaintext to GitHub', async () => {
  await expect(encrypt('value', { key: 'bad-base64', key_id: 'id' })).rejects.toThrow('Invalid secret public key');
  await expect(encrypt('value', { key: sodium.to_base64(new Uint8Array(1), sodium.base64_variants.ORIGINAL), key_id: 'id' }))
    .rejects.toThrow('length');
});

test('environment-mapped secrets work without a JSON copy and missing/empty values cannot erase secrets', async () => {
  policy({ secrets: [{ name: 'TOKEN', value_env: 'SHARED_TOKEN', visibility: 'all' }] });
  expect((await f.run({ ...env, SHARED_TOKEN: 'environment-supplied-secret' }))[0].status).toBe('updated');
  expect(f.core.setSecret).toHaveBeenCalledWith('environment-supplied-secret');
  const count = f.writes.length;
  expect((await f.run({ ...env, SHARED_TOKEN: '' }))[0].error).toContain('Missing supplied secret value');
  expect(f.writes).toHaveLength(count);
  expect(JSON.stringify(f.core.setOutput.mock.calls)).not.toContain('environment-supplied-secret');
});

test('variables reconcile changed values and selected access while preserving unrelated entries', async () => {
  const repo = f.repo('target', 'app');
  const target = f.organizations.get('target');
  target.variables.set('VAR', { name: 'VAR', value: 'old', visibility: 'selected' });
  target.variables.set('UNMANAGED', { name: 'UNMANAGED', value: 'local', visibility: 'all' });
  target.access.set('VAR', []);
  policy({ variables: [{ name: 'VAR', value: 'new', visibility: 'selected', repository_names: ['app'] }] });
  expect((await f.run(env))[0].status).toBe('updated');
  expect(target.access.get('VAR')).toEqual([repo.id]);
  expect(target.variables.get('UNMANAGED').value).toBe('local');
  expect(f.writes[0].route).toBe('PATCH /orgs/{org}/actions/variables/{name}');
});

test('existing secrets are deliberately set again and access policy changes are verified', async () => {
  f.organizations.get('target').secrets.set('actions/TOKEN', { name: 'TOKEN', visibility: 'all' });
  policy({ secrets: [{ name: 'TOKEN', value_key: 'token', visibility: 'private' }] });
  const options = { ...env, INPUT_SECRET_VALUES: '{"token":"rotated-value"}' };
  expect((await f.run(options))[0].status).toBe('updated');
  expect((await f.run(options))[0].status).toBe('updated');
  expect(f.organizations.get('target').secrets.get('actions/TOKEN').visibility).toBe('private');
});

test('active selected-actions and repository policies can be updated idempotently', async () => {
  const target = f.organizations.get('target');
  const repo = f.repo('target', 'app');
  target.permissions = { enabled_repositories: 'selected', allowed_actions: 'selected', sha_pinning_required: true };
  policy({ actions: { permissions: { enabled_repositories: 'selected' }, repository_names: ['app'],
    selected_actions: { patterns_allowed: ['source/*@*'] } } });
  expect((await f.run(env))[0].status).toBe('updated');
  expect(target.actionsRepositories).toEqual([repo.id]);
  expect(target.selected_actions.github_owned_allowed).toBe(true);
  expect((await f.run(env))[0].status).toBe('unchanged');
});

test('enabling selected actions requires a complete policy and never reads the inactive endpoint', async () => {
  policy({ actions: { permissions: { allowed_actions: 'selected' },
    selected_actions: { patterns_allowed: [] } } });
  expect((await f.run(env))[0].error).toContain('all selected_actions fields');
  expect(f.writes).toHaveLength(0);
  expect(f.requests.some(request => request.route === 'GET /orgs/{org}/actions/permissions/selected-actions')).toBe(false);
});

test('settings verification failures retain partial delivery results', async () => {
  policy({ settings: { values: { web_commit_signoff_required: true } } });
  f.hook = route => {
    if (route === 'GET /orgs/{org}' && f.writes.length) f.organizations.get('target').settings.web_commit_signoff_required = false;
  };
  const result = (await f.run(env))[0];
  expect(result.status).toBe('failed');
  expect(result.error).toContain('verification failed');
  expect(result.changes[0]).toMatchObject({ name: 'organization', status: 'pending' });
});

test('generic planning/delivery failures and invalid source responses do not expose raw messages', async () => {
  policy({ variables: [{ name: 'VAR', value: 'value', visibility: 'all' }] });
  f.github.paginate.mockResolvedValueOnce([null]);
  expect((await f.run(env))[0].error).toBe('Organization administration planning failed');
  policy({ source_organization: 'source', variables: [{ name: 'VAR', from_source: 'MISSING', visibility: 'all' }] });
  expect(await f.run(env)).toEqual([]);
  expect(f.core.setFailed).toHaveBeenLastCalledWith(expect.stringContaining('HTTP 404'));
});

test('malformed supplied values, secret selectors, scopes and schemas fail without changes', async () => {
  expect(() => secretValues('{"secret":null}', f.core)).toThrow('nonempty strings');
  expect(() => secretValues('{"secret":""}', f.core)).toThrow('nonempty strings');
  expect(() => credential({ name: 'S', value_key: 'x', value_env: 'ENV', visibility: 'all' }, 'secret', ['source'])).toThrow();
  expect(() => credential({ name: 'S', value_env: 'bad env', visibility: 'all' }, 'secret', ['source'])).toThrow();
  expect(() => definitions({ properties: 'wrong' })).toThrow();
  policy({ organizations: [] });
  expect(await f.run(env)).toEqual([]);
  expect(f.writes).toHaveLength(0);
});

test('organization discovery alone cannot authorize secret or variable distribution', async () => {
  f.write('admin.json', { secrets: [{ name: 'TOKEN', value_key: 'token', visibility: 'all' }] });
  expect(await f.run(env)).toEqual([]);
  expect(f.core.setFailed).toHaveBeenLastCalledWith(expect.stringContaining('requires explicit organizations'));
  policy({ variables: [{ name: 'VAR', value: 'value', visibility: 'all' }] });
  f.add('new-org');
  f.write('organizations.json', ['source', 'target', 'new-org']);
  const results = await f.run({ INPUT_PROPERTIES_FILE: '', INPUT_ADMIN_CONFIG: 'admin.json' });
  expect(results.map(result => result.status)).toEqual(['unchanged', 'updated', 'unchanged']);
  expect(f.writes.every(write => write.org === 'target')).toBe(true);
});

test('credential results redact discovered repository IDs and unexpected crypto failures', async () => {
  f.repo('target', 'private-repo');
  policy({ secrets: [{ name: 'TOKEN', value_key: 'token', visibility: 'selected', repository_names: ['private-repo'] }] });
  let results = await f.run({ ...env, INPUT_SECRET_VALUES: '{"token":"sensitive-synthetic-value"}' });
  expect(results[0].changes[0].after).toEqual({ visibility: 'selected', selected_repository_count: 1 });
  expect(JSON.stringify(results)).not.toContain('private-repo');
  expect(JSON.stringify(results)).not.toContain('repository_ids');
  jest.spyOn(sodium, 'crypto_box_seal').mockImplementation(() => { throw new Error('sensitive-synthetic-value'); });
  results = await f.run({ ...env, INPUT_SECRET_VALUES: '{"token":"sensitive-synthetic-value"}' });
  expect(results[0].error).toBe('Organization administration delivery failed');
  expect(JSON.stringify(f.core.setOutput.mock.calls)).not.toContain('sensitive-synthetic-value');
});
