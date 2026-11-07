const sodium = require('../../actions/org_sync/node_modules/libsodium-wrappers');
const fixture = require('./administration-fixture.js');

let f;
let keypair;
const inputs = { INPUT_PROPERTIES_FILE: '', INPUT_ADMIN_CONFIG: 'admin.json', INPUT_ORGANIZATION: 'target' };
const policy = config => f.write('admin.json', { organizations: ['target'], ...config });
const cases = ['all', 'private', 'selected', 'empty'];

beforeAll(async () => { await sodium.ready; keypair = sodium.crypto_box_keypair(); });
beforeEach(() => {
  f = fixture({ key_id: 'key', key: sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL) });
});
afterEach(() => { f.remove(); });

function manualAccess(store, key, choice) {
  const target = f.organizations.get('target');
  const selected = choice === 'selected' ? [f.repo('target', 'manually-selected').id] : [];
  store.get(key).visibility = choice === 'empty' ? 'selected' : choice;
  target.access.set(key, selected);
  return selected;
}

test.each(cases)('organization variable value updates preserve manually configured %s access', async choice => {
  policy({ variables: [{ name: 'SHARED', value: 'initial' }] });
  expect((await f.run(inputs))[0].status).toBe('updated');
  const target = f.organizations.get('target');
  expect(target.variables.get('SHARED').visibility).toBe('all');
  const ids = manualAccess(target.variables, 'SHARED', choice);
  policy({ variables: [{ name: 'SHARED', value: 'rotated' }] });
  const preview = (await f.run({ ...inputs, INPUT_DRY_RUN: 'true' }))[0];
  expect(preview.changes[0]).toMatchObject({ access_changed: false, value_changed: true });
  expect(target.variables.get('SHARED').value).toBe('initial');
  expect((await f.run(inputs))[0].status).toBe('updated');
  expect(target.variables.get('SHARED')).toMatchObject({ value: 'rotated', visibility: choice === 'empty' ? 'selected' : choice });
  expect(target.access.get('SHARED')).toEqual(ids);
  const update = f.writes.at(-1);
  expect(update.route).toBe('PATCH /orgs/{org}/actions/variables/{name}');
  expect(update).not.toHaveProperty('visibility');
  expect(update).not.toHaveProperty('selected_repository_ids');
  expect((await f.run(inputs))[0].status).toBe('unchanged');
});

test.each(['actions', 'dependabot', 'codespaces'].flatMap(kind => cases.map(choice => [kind, choice])))(
  '%s organization secret rotation preserves manually configured %s access', async (kind, choice) => {
    policy({ secrets: [{ name: 'TOKEN', kind, value_env: 'SUPPLIED' }] });
    expect((await f.run({ ...inputs, SUPPLIED: 'initial-secret' }))[0].status).toBe('updated');
    const target = f.organizations.get('target');
    const key = `${kind}/TOKEN`;
    expect(target.secrets.get(key).visibility).toBe('all');
    const ids = manualAccess(target.secrets, key, choice);
    const result = (await f.run({ ...inputs, SUPPLIED: 'rotated-secret' }))[0];
    expect(result.status).toBe('updated');
    expect(result.changes[0].access_changed).toBe(false);
    expect(target.secrets.get(key).visibility).toBe(choice === 'empty' ? 'selected' : choice);
    expect(target.access.get(key)).toEqual(ids);
    expect(sodium.to_string(sodium.crypto_box_seal_open(
      sodium.from_base64(target.ciphertext.get(key), sodium.base64_variants.ORIGINAL), keypair.publicKey, keypair.privateKey,
    ))).toBe('rotated-secret');
    expect(f.writes.every(write => write.route.startsWith('PUT /orgs/{org}/'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('rotated-secret');
  },
);

test('first sync adopts existing organization credentials without widening access', async () => {
  const target = f.organizations.get('target');
  target.variables.set('SHARED', { name: 'SHARED', value: 'old', visibility: 'private' });
  target.secrets.set('actions/TOKEN', { name: 'TOKEN', visibility: 'selected' });
  const ids = [f.repo('target', 'existing').id];
  target.access.set('actions/TOKEN', ids);
  policy({ variables: [{ name: 'SHARED', value: 'updated' }], secrets: [{ name: 'TOKEN', value_env: 'SUPPLIED' }] });
  expect((await f.run({ ...inputs, SUPPLIED: 'updated-secret' }))[0].status).toBe('updated');
  expect(target.variables.get('SHARED')).toMatchObject({ value: 'updated', visibility: 'private' });
  expect(target.secrets.get('actions/TOKEN').visibility).toBe('selected');
  expect(target.access.get('actions/TOKEN')).toEqual(ids);
});

test.each(['variable', 'secret'])('preserving %s access rejects a concurrent selected-repository change', async type => {
  const target = f.organizations.get('target');
  const key = type === 'variable' ? 'SHARED' : 'actions/SHARED';
  const store = type === 'variable' ? target.variables : target.secrets;
  store.set(key, { name: 'SHARED', visibility: 'selected', ...(type === 'variable' ? { value: 'old' } : {}) });
  const first = f.repo('target', 'first');
  const second = f.repo('target', 'second');
  target.access.set(key, [first.id]);
  policy(type === 'variable' ? { variables: [{ name: 'SHARED', value: 'new' }] }
    : { secrets: [{ name: 'SHARED', value_env: 'SUPPLIED' }] });
  let reads = 0;
  f.hook = route => {
    if (route.endsWith('/repositories') && ++reads === 2) target.access.set(key, [second.id]);
  };
  const result = (await f.run({ ...inputs, SUPPLIED: 'new-secret' }))[0];
  expect(result.error).toContain('changed during planning');
  expect(f.writes).toHaveLength(0);
  expect(target.access.get(key)).toEqual([second.id]);
});

test.each([null, 'invalid'])('explicit invalid visibility %j fails before any organization requests', async visibility => {
  policy({ variables: [{ name: 'SHARED', value: 'value', visibility }] });
  expect(await f.run(inputs)).toEqual([]);
  expect(f.requests).toHaveLength(0);
  expect(f.core.setFailed).toHaveBeenCalled();
});
