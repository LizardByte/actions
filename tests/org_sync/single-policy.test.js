const fs = require('node:fs');
const path = require('node:path');
const fileFixture = require('./fixture.js').fixture;
const adminFixture = require('./administration-fixture.js');
const runAdministration = require('../../actions/org_sync/admin.js');
const runFiles = require('../../actions/org_sync/org_sync.js');
const { section } = require('../../actions/org_sync/policy.js');

const property = { property_name: 'sync_mode', value_type: 'single_select', required: true,
  allowed_values: ['included', 'excluded'], default_value: 'included' };
const webhook = { id: 'events', url: 'https://example.test/events', events: ['push'], unsigned: true };
let files;
let admin;
let document;
let env;

beforeEach(() => {
  files = fileFixture();
  admin = adminFixture({});
  files.write('organizations.json', JSON.stringify(['source', 'target']));
  files.write('shared.md', 'shared file\n');
  document = { version: 1, files: { rules: [{ id: 'shared', files: [{ source: 'shared.md' }] }] },
    properties: [property], administration: { source_organization: 'source',
      settings: { values: { web_commit_signoff_required: true } }, webhooks: [webhook] } };
  env = { INPUT_SOURCE_DIRECTORY: files.root, INPUT_CONFIG: 'sync.json', INPUT_ADMIN_CONFIG: 'sync.json',
    INPUT_PROPERTIES_FILE: 'sync.json' };
});

afterEach(() => { files.cleanup(); admin.remove(); });
const save = () => files.write('sync.json', JSON.stringify(document));
const administer = overrides => runAdministration({ github: admin.github, core: admin.core, env: { ...env, ...overrides } });

test('one policy delivers files, schemas, and settings while leaving source administration unchanged', async () => {
  const target = files.add('target/app');
  save();
  const results = await administer();
  expect(results.map(result => result.status)).toEqual(['updated', 'updated']);
  expect(admin.organizations.get('source').schema[0].property_name).toBe('sync_mode');
  expect(admin.organizations.get('source').settings.web_commit_signoff_required).toBe(false);
  expect(admin.organizations.get('source').hooks).toHaveLength(0);
  expect(admin.organizations.get('target').settings.web_commit_signoff_required).toBe(true);
  expect(admin.organizations.get('target').hooks).toHaveLength(1);
  expect(admin.writes.filter(write => write.org === 'source').every(write => write.route.includes('/properties/schema'))).toBe(true);
  const fileResults = await runFiles({ github: files.github, core: files.core, context: files.context, env });
  expect(fileResults[0].status).toBe('updated');
  expect(files.content(target, 'shared.md')).toBe('shared file\n');
  expect(admin.core.setFailed).not.toHaveBeenCalled();
  expect(files.core.setFailed).not.toHaveBeenCalled();
});

test('adding only a registry entry provisions settings and schemas without extending credential access', async () => {
  admin.repo('target', 'app');
  document.administration.variables = [{ name: 'ACCOUNT', value: 'shared-account', visibility: 'selected',
    repository_names: ['app'], organizations: ['target'] }];
  save();
  await administer();
  const before = fs.readFileSync(path.join(files.root, 'sync.json'), 'utf8');
  admin.add('new-org');
  files.write('organizations.json', JSON.stringify(['source', 'target', 'new-org']));
  await administer();
  const added = admin.organizations.get('new-org');
  expect(added.settings.web_commit_signoff_required).toBe(true);
  expect(added.schema[0].property_name).toBe('sync_mode');
  expect(added.hooks).toHaveLength(1);
  expect(added.variables.size).toBe(0);
  expect(added.secrets.size).toBe(0);
  expect(admin.organizations.get('target').access.get('ACCOUNT')).toHaveLength(1);
  expect(fs.readFileSync(path.join(files.root, 'sync.json'), 'utf8')).toBe(before);
});

test('source exclusion is case insensitive and a source-only registry still reconciles schemas', async () => {
  files.write('organizations.json', JSON.stringify(['source']));
  document.administration.source_organization = 'SOURCE';
  save();
  const results = await administer();
  expect(results[0].changes.map(change => change.kind)).toEqual(['schema']);
  expect(admin.organizations.get('source').settings.web_commit_signoff_required).toBe(false);
  expect(admin.requests.every(request => request.route.includes('/properties/schema'))).toBe(true);
  expect(admin.core.setFailed).not.toHaveBeenCalled();
});

test('combined-policy file-only runs do not load schemas, secrets, or administration', async () => {
  document.properties = 'invalid schema intentionally unused in file-only mode';
  document.administration.secrets = [{ name: 'INVALID' }];
  save();
  files.add('target/app');
  const fileOnly = { ...env, INPUT_ADMIN_CONFIG: '', INPUT_PROPERTIES_FILE: '', INPUT_SYNC_FILES: 'true' };
  expect(await administer(fileOnly)).toEqual([]);
  expect(admin.requests).toHaveLength(0);
  const results = await runFiles({ github: files.github, core: files.core, context: files.context, env: fileOnly });
  expect(results[0].status).toBe('updated');
  expect(files.core.setFailed).not.toHaveBeenCalled();
});

test.each(['variables', 'secrets'])('registry-derived administration does not authorize unscoped %s', async kind => {
  document.administration[kind] = [kind === 'variables'
    ? { name: 'ACCOUNT', value: 'shared-account', visibility: 'all' }
    : { name: 'TOKEN', value_env: 'TOKEN', visibility: 'all' }];
  save();
  expect(await administer()).toEqual([]);
  expect(admin.core.setFailed).toHaveBeenCalledWith(expect.stringContaining('requires explicit organizations'));
  expect(admin.writes).toHaveLength(0);
});

test('a non-string source organization is rejected before any API requests', async () => {
  document.administration.source_organization = 7;
  save();
  expect(await administer()).toEqual([]);
  expect(admin.core.setFailed).toHaveBeenCalledWith('Source organization is outside organizations_file');
  expect(admin.requests).toHaveLength(0);
});

test('a combined policy can omit unused sections and preserves explicit legacy administration scopes', async () => {
  delete document.properties;
  document.administration.organizations = ['source'];
  save();
  await administer();
  expect(admin.organizations.get('source').settings.web_commit_signoff_required).toBe(true);
  expect(admin.organizations.get('target').settings.web_commit_signoff_required).toBe(false);
  expect(section({ version: 1, files: document.files }, 'administration')).toEqual({ version: 1 });
  expect(section({ version: 1, administration: {} }, 'files')).toEqual({ version: 1 });
});

test.each([
  { version: 2, files: {} }, { version: 1, files: {}, unknown: true },
  { version: 1, files: null }, { version: 1, administration: [] },
  { version: 1, files: { version: 2 } },
])('invalid combined policies fail before any API operation: %j', invalid => {
  expect(() => section(invalid, 'files')).toThrow();
  expect(admin.requests).toHaveLength(0);
});
