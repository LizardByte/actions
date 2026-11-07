const fixture = require('./administration-fixture.js');
const { defaultScope } = require('../../actions/org_sync/security.js');

let f;
let target;
let source;
const env = { INPUT_PROPERTIES_FILE: '', INPUT_ADMIN_CONFIG: 'admin.json', INPUT_ORGANIZATION: 'target' };
const policy = config => f.write('admin.json', { organizations: ['target'], source_organization: 'source', ...config });
const hook = overrides => ({ id: 'shared', url: 'https://example.test/private-hook', secret_env: 'HOOK_SECRET', ...overrides });
const run = inputs => f.run({ ...env, HOOK_SECRET: 'signing-secret-value', ...inputs });
const result = async inputs => (await run(inputs))[0];
const configuration = overrides => ({ name: 'Baseline', values: { dependabot_alerts: 'enabled' }, ...overrides });
const savedConfig = overrides => ({ id: 42, name: 'Baseline', dependabot_alerts: 'enabled', target_type: 'organization', ...overrides });

beforeEach(() => { f = fixture({}); target = f.organizations.get('target'); source = f.organizations.get('source'); });
afterEach(() => { f.remove(); jest.restoreAllMocks(); });

test('blocked-user copying is additive and dry runs never block or unblock', async () => {
  source.blocks = ['Source-User']; target.blocks = ['local-user'];
  policy({ blocked_users: { from_source: true, users: ['extra-user', 'SOURCE-USER'] } });
  expect((await result({ INPUT_DRY_RUN: 'true' })).changes).toHaveLength(2);
  expect(f.writes).toHaveLength(0);
  expect((await result()).status).toBe('updated');
  expect(target.blocks).toEqual(['local-user', 'extra-user', 'source-user']);
  expect((await result()).status).toBe('unchanged');
});

test('unblocking requires remove_extra and does not modify the source', async () => {
  source.blocks = ['shared']; target.blocks = ['shared', 'local'];
  policy({ blocked_users: { from_source: true, remove_extra: true } });
  expect((await result()).changes).toMatchObject([{ kind: 'blocked_user', name: 'local', before: true, after: false }]);
  expect(target.blocks).toEqual(['shared']); expect(source.blocks).toEqual(['shared']);
});

test.each(['race', 'verification'])('blocked-user %s fails safely', async mode => {
  policy({ blocked_users: { users: ['shared'] } });
  let reads = 0;
  f.hook = route => {
    if (route === 'GET /orgs/{org}/blocks' && ++reads === (mode === 'race' ? 2 : 3)) target.blocks = mode === 'race' ? ['shared'] : [];
  };
  expect((await result()).status).toBe('failed');
  expect(f.writes).toHaveLength(mode === 'race' ? 0 : 1);
});

test('webhooks copy metadata with overrides and supplied signing secrets without exposing URLs or values', async () => {
  source.hooks = [{ id: 90, name: 'web', events: ['issues'], active: false,
    config: { url: 'https://example.test/source', content_type: 'form', insecure_ssl: '0', secret: '********' } }];
  policy({ webhooks: [hook({ source_url: 'https://example.test/source', events: ['push', 'issues'], active: true })] });
  const preview = await result({ INPUT_DRY_RUN: 'true', HOOK_SECRET: '' });
  expect(preview.status).toBe('planned'); expect(preview.warnings).toHaveLength(1); expect(f.writes).toHaveLength(0);
  const delivered = await result();
  expect(delivered.status).toBe('updated');
  expect(target.hooks[0]).toMatchObject({ active: true, events: ['push', 'issues'], config: { content_type: 'form' } });
  expect(target.hookSecrets.get(target.hooks[0].id)).toBe('signing-secret-value');
  expect(f.core.setSecret).toHaveBeenCalledWith('signing-secret-value');
  const report = JSON.stringify(delivered);
  expect(report).not.toContain('https://'); expect(report).not.toContain('signing-secret-value');
  expect((await result({ HOOK_SECRET: 'rotated' })).status).toBe('updated');
  expect(target.hookSecrets.get(target.hooks[0].id)).toBe('rotated');
});

test('explicit unsigned hooks clear opaque signing and create_if_missing preserves existing signing and metadata', async () => {
  policy({ webhooks: [hook({ secret_env: undefined, unsigned: true })] });
  expect((await result()).status).toBe('updated'); expect((await result()).status).toBe('updated');
  target.hooks[0].config.secret = '********'; target.hookSecrets.set(target.hooks[0].id, 'local');
  policy({ webhooks: [hook({ mode: 'create_if_missing', active: false })] });
  expect((await result({ HOOK_SECRET: '' })).status).toBe('unchanged');
  expect(target.hookSecrets.get(target.hooks[0].id)).toBe('local'); expect(target.hooks[0].active).toBe(true);
});

test('webhook signing values can be supplied by key, but absent values cannot erase signing', async () => {
  policy({ webhooks: [hook({ secret_env: undefined, secret_value_key: 'hook-signing' })] });
  expect((await result()).error).toContain('Missing signing secret'); expect(f.writes).toHaveLength(0);
  expect((await result({ INPUT_SECRET_VALUES: JSON.stringify({ 'hook-signing': 'from-input' }) })).status).toBe('updated');
  expect(target.hookSecrets.get(target.hooks[0].id)).toBe('from-input');
});

test.each(['source', 'target'])('ambiguous %s hooks fail without writes', async org => {
  const value = { id: 20, name: 'web', events: ['push'], active: true,
    config: { url: 'https://example.test/private-hook', content_type: 'json' } };
  f.organizations.get(org).hooks = [value, { ...value, id: 21 }];
  policy({ webhooks: [hook(org === 'source' ? { source_url: value.config.url } : {})] });
  await result(); expect(f.core.setFailed).toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
});

test.each(['race', 'verification', 'raw error'])('webhook %s never reports false success or credentials', async mode => {
  policy({ webhooks: [hook()] });
  let reads = 0;
  f.hook = route => {
    if (mode === 'race' && route === 'GET /orgs/{org}/hooks' && ++reads === 2) target.hooks = [{ name: 'web', config: { url: hook().url } }];
    if (mode === 'verification' && route === 'GET /orgs/{org}/hooks/{hook_id}') target.hooks[0].active = false;
    if (mode === 'raw error' && route.startsWith('POST')) throw Object.assign(new Error('signing-secret-value'), { status: 403 });
  };
  const actual = await result(); expect(actual.status).toBe('failed');
  expect(JSON.stringify(actual)).not.toContain('signing-secret-value');
});

test('security configuration copying retains unmanaged settings and does not attach existing repositories', async () => {
  source.security = [savedConfig({ description: 'Shared', secret_scanning: 'enabled' })];
  target.security = [savedConfig({ name: 'Local' })];
  policy({ security_configurations: [configuration({ source_name: 'Baseline', values: { description: 'Destination' } })] });
  expect((await result({ INPUT_DRY_RUN: 'true' })).status).toBe('planned'); expect(f.writes).toHaveLength(0);
  expect((await result()).status).toBe('updated');
  expect(target.security.find(value => value.name === 'Baseline')).toMatchObject({ description: 'Destination', secret_scanning: 'enabled' });
  expect(target.security.find(value => value.name === 'Local')).toBeDefined();
  expect(f.writes.some(write => write.route.includes('/attach'))).toBe(false);
  expect((await result()).status).toBe('unchanged');
});

test('security config updates preserve unspecified destination fields and skip unchanged inherited definitions', async () => {
  target.security = [savedConfig({ dependabot_alerts: 'disabled', secret_scanning: 'enabled' })];
  policy({ security_configurations: [configuration()] });
  expect((await result()).status).toBe('updated'); expect(target.security[0].secret_scanning).toBe('enabled');
  target.security[0].target_type = 'global';
  expect((await result()).status).toBe('unchanged');
  target.security[0].dependabot_alerts = 'disabled';
  expect((await result()).error).toContain('Inherited');
});

test('security defaults are copied using destination configuration IDs and support split defaults in one run', async () => {
  source.security = [savedConfig()];
  source.defaults = [{ default_for_new_repos: 'all', configuration: { value: { id: 42 } } }];
  policy({ security_configurations: [configuration({ source_name: 'Baseline', copy_default: true })] });
  expect((await result()).status).toBe('updated');
  expect(target.defaults[0].configuration.id).not.toBe(42);
  expect(defaultScope(target.defaults, target.security[0].id)).toBe('all');
  policy({ security_configurations: [configuration({ default_for_new_repos: 'public' }),
    configuration({ name: 'Private', default_for_new_repos: 'private_and_internal' })] });
  expect((await result()).status).toBe('updated');
  expect(target.defaults.map(value => value.default_for_new_repos)).toEqual(['public', 'private_and_internal']);
  expect((await result()).status).toBe('unchanged');
  policy({ security_configurations: [configuration({ default_for_new_repos: 'none' })] });
  expect((await result()).status).toBe('updated');
  expect(target.defaults).toHaveLength(1);
});

test('overlapping managed security defaults fail before writes', async () => {
  policy({ security_configurations: [configuration({ default_for_new_repos: 'all' }),
    configuration({ name: 'Private', default_for_new_repos: 'private_and_internal' })] });
  expect((await result()).error).toContain('Overlapping'); expect(f.writes).toHaveLength(0);
});

test('security reviewer references require a destination-specific override and are redacted from reports', async () => {
  const options = { reviewers: [{ reviewer_id: 873221, reviewer_type: 'TEAM' }] };
  source.security = [savedConfig({ secret_scanning_delegated_bypass_options: options })];
  policy({ security_configurations: [configuration({ source_name: 'Baseline' })] });
  await result(); expect(f.core.setFailed).toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
  policy({ security_configurations: [configuration({ source_name: 'Baseline', organizations: ['target'],
    values: { secret_scanning_delegated_bypass_options: options } })] });
  const actual = await result(); expect(actual.status).toBe('updated'); expect(JSON.stringify(actual)).not.toContain('873221');
});

test.each(['configuration race', 'configuration verification', 'default race', 'default verification'])('security %s is detected', async mode => {
  target.security = [savedConfig({ dependabot_alerts: 'disabled' })];
  policy({ security_configurations: [configuration({ default_for_new_repos: 'public' })] });
  const reads = { configuration: 0, defaults: 0 };
  f.hook = route => {
    if (route === 'GET /orgs/{org}/code-security/configurations/{configuration_id}') {
      ++reads.configuration;
      if (mode === 'configuration race' || mode === 'configuration verification' && reads.configuration === 2) {
        target.security[0].dependabot_alerts = 'not_set';
      }
    }
    if (route === 'GET /orgs/{org}/code-security/configurations/defaults' && ++reads.defaults === 2 && mode === 'default race') {
      target.defaults = [{ default_for_new_repos: 'all', configuration: { id: 999 } }];
    }
    if (mode === 'default verification' && route.startsWith('GET') && target.defaults.length) target.defaults = [];
  };
  expect((await result()).status).toBe('failed');
});

test.each([
  { blocked_users: { unknown: true } }, { blocked_users: { users: ['bad/name'] } },
  { blocked_users: { remove_extra: 'true' } }, { webhooks: {} }, { webhooks: [hook({ id: '' })] },
  { webhooks: [hook({ url: 'file:///tmp/hook' })] }, { webhooks: [hook({ active: 'true' })] },
  { webhooks: [hook({ secret_env: undefined })] }, { webhooks: [hook({ unsigned: true })] },
  { webhooks: [hook(), hook({ id: 'duplicate-url' })] },
  { security_configurations: {} }, { security_configurations: [configuration({ name: '' })] },
  { security_configurations: [configuration({ copy_default: true })] },
  { security_configurations: [configuration({ values: { unknown_feature: true } })] },
  { security_configurations: [configuration({ values: { dependabot_alerts: 'yes' } })] },
  { security_configurations: [configuration({ source_name: 'Missing' })] },
])('invalid resource policy fails before writes: %j', async config => {
  policy(config); await result(); expect(f.core.setFailed).toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
});
