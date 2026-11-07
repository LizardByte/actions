const fixture = require('./administration-fixture.js');

let f;
const prefix = 'https://hooks.example.test/receivers/';
const selection = overrides => ({ id: 'notifications', source_url_prefix: prefix, unsigned: true, ...overrides });
const hook = (id, url, overrides = {}) => ({ id, name: 'web', events: ['push'], active: true,
  config: { url, content_type: 'json', insecure_ssl: '0' }, ...overrides });
const policy = entries => f.write('admin.json', { organizations: ['target'], source_organization: 'source', webhooks: entries });
const run = overrides => f.run({ INPUT_PROPERTIES_FILE: '', INPUT_ADMIN_CONFIG: 'admin.json', INPUT_ORGANIZATION: 'target', ...overrides });

beforeEach(() => { f = fixture({}); });
afterEach(() => { f.remove(); });

test('prefix selections copy matching hooks and their individual event policies without serializing credential URLs', async () => {
  const source = f.organizations.get('source');
  source.hooks = [hook(1, `${prefix}private-value-a`, { events: ['push', 'pull_request'] }),
    hook(2, `${prefix}private-value-b`, { active: false, events: ['issues'] }),
    hook(3, 'https://cla.example.test/receiver'), hook(4, 'https://hooks.example.test.evil/receivers/trap'),
    hook(5, 'https://hooks.example.test/receivers-other/trap'), hook(6, `${prefix}service`, { name: 'legacy-service' })];
  const target = f.organizations.get('target');
  target.hooks = [hook(10, 'https://cla.example.test/local')];
  policy([selection()]);
  const preview = (await run({ INPUT_DRY_RUN: 'true' }))[0];
  expect(preview.status).toBe('planned'); expect(preview.changes).toHaveLength(2); expect(f.writes).toHaveLength(0);
  expect(JSON.stringify(preview)).not.toContain('https://'); expect(JSON.stringify(preview)).not.toContain('private-value');
  expect((await run())[0].status).toBe('updated');
  expect(target.hooks).toHaveLength(3);
  expect(target.hooks[1]).toMatchObject({ active: true, events: ['push', 'pull_request'] });
  expect(target.hooks[2]).toMatchObject({ active: false, events: ['issues'] });
  expect(target.hooks[0].config.url).toBe('https://cla.example.test/local');
});

test('an empty or OAuth-filtered source group fails before destination changes', async () => {
  policy([selection()]);
  expect(await run({ INPUT_DRY_RUN: 'true' })).toEqual([]);
  expect(f.core.setFailed).toHaveBeenCalledWith('Source webhook group is empty or inaccessible: notifications');
  expect(f.writes).toHaveLength(0);
});

test('prefix matching normalizes the URL authority while preserving the original receiver URL', async () => {
  f.organizations.get('source').hooks = [hook(1, 'https://HOOKS.EXAMPLE.TEST/receivers/private-value')];
  policy([selection({ source_url_prefix: 'https://HOOKS.EXAMPLE.TEST/receivers/' })]);
  expect((await run())[0].status).toBe('updated');
  expect(f.organizations.get('target').hooks[0].config.url).toBe('https://HOOKS.EXAMPLE.TEST/receivers/private-value');
});

test('overlapping groups fail before any destination writes', async () => {
  f.organizations.get('source').hooks = [hook(1, `${prefix}private-value`)];
  policy([selection(), selection({ id: 'other', source_url_prefix: 'https://hooks.example.test/' })]);
  expect(await run()).toEqual([]); expect(f.core.setFailed).toHaveBeenCalledWith('Overlapping webhook selections');
  expect(f.writes).toHaveLength(0);
});

test('group create_if_missing preserves existing hook metadata and signing settings', async () => {
  f.organizations.get('source').hooks = [hook(1, `${prefix}private-value`)];
  const target = f.organizations.get('target');
  target.hooks = [hook(10, `${prefix}private-value`, { active: false })];
  target.hookSecrets.set(10, 'local-signing');
  policy([selection({ mode: 'create_if_missing' })]);
  expect((await run())[0].status).toBe('unchanged');
  expect(target.hooks[0].active).toBe(false); expect(target.hookSecrets.get(10)).toBe('local-signing');
});

test.each([
  { source_url_prefix: 'https://hooks.example.test/receivers' },
  { source_url_prefix: 'https://user:password@hooks.example.test/receivers/' },
  { source_url_prefix: `${prefix}?token=private` },
  { source_url_prefix: `${prefix}#private` },
  { source_url_prefix: 'file:///receivers/' },
  { source_url: `${prefix}private-value` },
  { url: `${prefix}override` },
])('invalid or conflicting group selectors fail without API writes: %j', async overrides => {
  policy([selection(overrides)]);
  await run();
  expect(f.core.setFailed).toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
});
