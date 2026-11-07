const sodium = require('../../actions/org_sync/node_modules/libsodium-wrappers');
const fixture = require('./administration-fixture.js');

let f;
let keypair;
const env = { INPUT_PROPERTIES_FILE: '', INPUT_ADMIN_CONFIG: 'admin.json' };
const variable = overrides => ({ name: 'SHARED', value: 'managed', visibility: 'selected', repository_names: ['future'],
  missing_repositories: 'defer', ...overrides });
const policy = value => f.write('admin.json', { organizations: ['target'], ...value });
const runTarget = overrides => f.run({ ...env, INPUT_ORGANIZATION: 'target', ...overrides });

beforeAll(async () => { await sodium.ready; keypair = sodium.crypto_box_keypair(); });
beforeEach(() => { f = fixture({ key_id: 'key', key: sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL) }); });
afterEach(() => { f.remove(); });

test('same-name secrets can use different supplied values and repository allowlists in disjoint organizations', async () => {
  const first = f.repo('source', 'first');
  const second = f.repo('target', 'second');
  policy({ organizations: ['source', 'target'], secrets: [
    { name: 'SERVICE_TOKEN', value_env: 'FIRST_TOKEN', visibility: 'selected', repository_names: ['first'], organizations: ['source'] },
    { name: 'SERVICE_TOKEN', value_env: 'SECOND_TOKEN', visibility: 'selected', repository_names: ['second'], organizations: ['target'] },
  ] });
  const results = await f.run({ ...env, FIRST_TOKEN: 'first-private-value', SECOND_TOKEN: 'second-private-value' });
  expect(results.map(value => value.status)).toEqual(['updated', 'updated']);
  expect(f.organizations.get('source').access.get('actions/SERVICE_TOKEN')).toEqual([first.id]);
  expect(f.organizations.get('target').access.get('actions/SERVICE_TOKEN')).toEqual([second.id]);
  for (const [org, plaintext] of [['source', 'first-private-value'], ['target', 'second-private-value']]) {
    const ciphertext = f.organizations.get(org).ciphertext.get('actions/SERVICE_TOKEN');
    expect(sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL),
      keypair.publicKey, keypair.privateKey))).toBe(plaintext);
  }
  expect(JSON.stringify(results)).not.toContain('private-value');
});

test('reusing a source variable across destination-specific policies reads its value once', async () => {
  f.organizations.get('source').variables.set('UPSTREAM', { name: 'UPSTREAM', value: 'shared-source-value', visibility: 'all' });
  f.repo('source', 'first'); f.repo('target', 'second');
  policy({ organizations: ['source', 'target'], source_organization: 'source', variables: [
    variable({ value: undefined, from_source: 'UPSTREAM', repository_names: ['first'], organizations: ['source'] }),
    variable({ value: undefined, from_source: 'UPSTREAM', repository_names: ['second'], organizations: ['target'] }),
  ] });
  expect((await f.run(env)).every(value => value.status === 'updated')).toBe(true);
  expect(f.requests.filter(request => request.route === 'GET /orgs/{org}/actions/variables/{name}' && request.name === 'UPSTREAM')).toHaveLength(1);
});

test('future secret recipients defer before requiring plaintext and become eligible after repository creation', async () => {
  policy({ secrets: [{ ...variable(), value: undefined, value_env: 'TOKEN_VALUE' }] });
  let result = (await runTarget())[0];
  expect(result.status).toBe('unchanged'); expect(result.warnings[0]).toContain('Deferred 1'); expect(f.writes).toHaveLength(0);
  const repo = f.repo('target', 'future');
  result = (await runTarget({ TOKEN_VALUE: 'supplied-after-transfer' }))[0];
  expect(result.status).toBe('updated');
  expect(f.organizations.get('target').access.get('actions/SHARED')).toEqual([repo.id]);
});

test('deferred variables grant only existing named recipients and follow later repository creation', async () => {
  const first = f.repo('target', 'first');
  f.repo('target', 'unrelated');
  policy({ variables: [variable({ repository_names: ['first', 'future'] })] });
  expect((await runTarget())[0].status).toBe('updated');
  expect(f.organizations.get('target').access.get('SHARED')).toEqual([first.id]);
  const second = f.repo('target', 'future');
  expect((await runTarget())[0].status).toBe('updated');
  expect(f.organizations.get('target').access.get('SHARED')).toEqual([first.id, second.id]);
  expect((await runTarget())[0].status).toBe('unchanged');
});

test('all-missing variables defer, but an explicit empty allowlist still manages access to no repositories', async () => {
  policy({ variables: [variable()] });
  expect((await runTarget())[0].status).toBe('unchanged'); expect(f.writes).toHaveLength(0);
  policy({ variables: [variable({ repository_names: [] })] });
  expect((await runTarget())[0].status).toBe('updated');
  expect(f.organizations.get('target').access.get('SHARED')).toEqual([]);
});

test('a deferred recipient appearing between planning and writing fails the identity guard', async () => {
  f.repo('target', 'first');
  policy({ variables: [variable({ repository_names: ['first', 'future'] })] });
  let reads = 0;
  f.hook = route => { if (route === 'GET /orgs/{org}/repos' && ++reads === 2) f.repo('target', 'future'); };
  expect((await runTarget())[0].error).toContain('identity changed'); expect(f.writes).toHaveLength(0);
});

test.each([
  { variables: [variable({ missing_repositories: 'ignore' })] },
  { variables: [variable({ visibility: 'all', repository_names: [], missing_repositories: 'defer' })] },
  { variables: [variable(), variable()] },
])('invalid modes and overlapping same-name policies fail before writes: %j', async value => {
  policy(value); expect(await runTarget()).toEqual([]); expect(f.core.setFailed).toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
});
