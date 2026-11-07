const { check, get, list, api, same, sortedIds, operation } = require('./admin-common.js');
const { mapConcurrent } = require('./concurrency.js');

async function repositoryIds(github, org, repositoryNames, { defer = false } = {}) {
  if (!repositoryNames.length) return [];
  const repositories = await list(github, '/orgs/{org}/repos', { org, type: 'all' });
  const selected = repositoryNames.map(name => {
    const repo = repositories.find(repo => repo.name.toLowerCase() === name.toLowerCase());
    if (!repo && defer) return null;
    check(repo && repo.owner.login.toLowerCase() === org.toLowerCase()
      && repo.full_name.toLowerCase() === `${org}/${name}`.toLowerCase()
      && Number.isSafeInteger(repo.id) && repo.id > 0, `Selected repository is missing or inaccessible in organization: ${org}`);
    return repo.id;
  });
  return selected.filter(id => id !== null).sort((left, right) => left - right);
}

async function credentialRepositories(github, org, entry, warnings) {
  if (entry.visibility !== 'selected') return [];
  const defer = entry.missing_repositories === 'defer';
  const ids = await repositoryIds(github, org, entry.repository_names, { defer });
  if (defer && ids.length < entry.repository_names.length && warnings) {
    warnings.push(`Deferred ${entry.repository_names.length - ids.length} unavailable repository targets for ${entry.name}`);
  }
  return defer && entry.repository_names.length > 0 && ids.length === 0 ? null : ids;
}

async function selectedIds(github, base, parameters, value) {
  if (value?.visibility !== 'selected') return [];
  return (await list(github, `${base}/repositories`, parameters)).map(repo => repo.id);
}

function access(value, ids) {
  return value ? { visibility: value.visibility, repository_ids: sortedIds(ids) } : null;
}

const reportedAccess = (value, ids) => value ? { visibility: value.visibility, selected_repository_count: ids.length } : null;

async function credentialAccess(github, org, entry, existing, base, coordinates, warnings) {
  const oldIds = await selectedIds(github, base, coordinates, existing);
  if (existing && !entry.manage_access) return { desired: existing, ids: oldIds, oldIds };
  const ids = await credentialRepositories(github, org, entry, warnings);
  return ids === null ? null : { desired: entry, ids, oldIds };
}

function accessBody(value, ids) {
  return { visibility: value.visibility,
    ...(value.visibility === 'selected' ? { selected_repository_ids: ids } : {}) };
}

async function encrypt(value, publicKey) {
  // GitHub requires a libsodium sealed box, using the recipient organization's public key.
  const sodium = require('libsodium-wrappers');
  await sodium.ready;
  check(typeof publicKey.key_id === 'string' && typeof publicKey.key === 'string', 'Invalid secret public key');
  let key;
  try { key = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL); }
  catch { check(false, 'Invalid secret public key'); }
  check(key.length === sodium.crypto_box_PUBLICKEYBYTES, 'Invalid secret public key length');
  const ciphertext = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL);
}

async function variableValues(sourceGithub, config) {
  const cache = new Map();
  const entries = await mapConcurrent(config.variables, 3, async entry => {
    if (!entry.from_source) return entry;
    check(config.source_organization, 'source_organization is required for copied variables');
    if (!cache.has(entry.from_source)) cache.set(entry.from_source,
      get(sourceGithub, '/orgs/{org}/actions/variables/{name}', { org: config.source_organization, name: entry.from_source }));
    const source = await cache.get(entry.from_source);
    check(typeof source.value === 'string', 'Source variable value is unavailable');
    return { ...entry, value: source.value };
  });
  return { ...config, variables: entries };
}

async function planVariable(github, org, entry, existing, warnings) {
  const base = '/orgs/{org}/actions/variables/{name}';
  const coordinates = { org, name: entry.name };
  const planned = await credentialAccess(github, org, entry, existing, base, coordinates, warnings);
  if (!planned) return null;
  const { desired, ids, oldIds } = planned;
  if (existing?.value === entry.value && same(access(existing, oldIds), access(desired, ids))) return null;
  const op = operation('variable', entry.name, reportedAccess(existing, oldIds), reportedAccess(desired, ids), async () => {
    const latest = await list(github, '/orgs/{org}/actions/variables', { org, per_page: 30 });
    const current = latest.find(value => value.name.toUpperCase() === entry.name);
    check(same(current, existing), `Variable changed during planning: ${entry.name}`);
    const currentIds = await selectedIds(github, base, coordinates, current);
    check(same(sortedIds(currentIds), sortedIds(oldIds)), `Variable access changed during planning: ${entry.name}`);
    if (entry.manage_access && entry.visibility === 'selected') {
      check(same(await credentialRepositories(github, org, entry), ids), 'Selected repository identity changed');
    }
    const body = { name: entry.name, value: entry.value,
      ...(!existing || entry.manage_access ? accessBody(desired, ids) : {}) };
    const route = existing ? `PATCH ${base}` : 'POST /orgs/{org}/actions/variables';
    await api(github, route, { ...coordinates, ...body });
    const saved = await get(github, base, coordinates);
    const savedIds = await selectedIds(github, base, coordinates, saved);
    check(saved.value === entry.value && same(access(saved, savedIds), access(desired, ids)),
      `Variable verification failed: ${entry.name}`);
  });
  op.change.value_changed = !existing || existing.value !== entry.value;
  op.change.access_changed = !same(access(existing, oldIds), access(desired, ids));
  return op;
}

async function planSecret(github, org, entry, existing, values, dryRun, warnings) {
  const base = `/orgs/{org}/${entry.kind}/secrets/{secret_name}`;
  const coordinates = { org, secret_name: entry.name };
  const planned = await credentialAccess(github, org, entry, existing, base, coordinates, warnings);
  if (!planned) return null;
  const { desired, ids, oldIds } = planned;
  const supplied = Object.hasOwn(values, entry.value_key);
  check(dryRun || supplied, `Missing supplied secret value: ${entry.value_env ?? entry.value_key}`);
  if (!supplied) warnings.push(`Secret value required for delivery: ${entry.kind}/${entry.name}`);
  const op = operation('secret', `${entry.kind}/${entry.name}`, reportedAccess(existing, oldIds), reportedAccess(desired, ids), async () => {
    const latest = await list(github, `/orgs/{org}/${entry.kind}/secrets`, { org });
    const current = latest.find(value => value.name.toUpperCase() === entry.name);
    const currentIds = await selectedIds(github, base, coordinates, current);
    check(same(current, existing) && same(sortedIds(currentIds), sortedIds(oldIds)),
      `Secret or access changed during planning: ${entry.kind}/${entry.name}`);
    if (entry.manage_access && entry.visibility === 'selected') {
      check(same(await credentialRepositories(github, org, entry), ids), 'Selected repository identity changed');
    }
    const publicKey = await get(github, `/orgs/{org}/${entry.kind}/secrets/public-key`, { org });
    const encrypted = await encrypt(values[entry.value_key], publicKey);
    await api(github, `PUT ${base}`, { ...coordinates, key_id: publicKey.key_id, encrypted_value: encrypted,
      ...accessBody(desired, ids) });
    const saved = await get(github, base, coordinates);
    const savedIds = await selectedIds(github, base, coordinates, saved);
    check(same(access(saved, savedIds), access(desired, ids)), `Secret access verification failed: ${entry.name}`);
  });
  op.change.value_comparison = 'unavailable; supplied again on every sync';
  op.change.access_changed = !same(access(existing, oldIds), access(desired, ids));
  return op;
}

async function planCredentials(github, org, config, values, dryRun, warnings) {
  const scoped = entry => entry.organizations.some(name => name.toLowerCase() === org.toLowerCase());
  const variables = config.variables.filter(scoped);
  const secrets = config.secrets.filter(scoped);
  const existingVariables = variables.length ? await list(github, '/orgs/{org}/actions/variables', { org, per_page: 30 }) : [];
  const existingSecrets = new Map(await Promise.all([...new Set(secrets.map(entry => entry.kind))].map(async kind =>
    [kind, await list(github, `/orgs/{org}/${kind}/secrets`, { org })])));
  const entries = [...variables.map(entry => ({ entry, secret: false })), ...secrets.map(entry => ({ entry, secret: true }))];
  const operations = await mapConcurrent(entries, 3, async ({ entry, secret }) => {
    if (!secret) {
      const existing = existingVariables.find(value => value.name.toUpperCase() === entry.name);
      return existing && entry.mode === 'create_if_missing' ? null : planVariable(github, org, entry, existing, warnings);
    }
    const existing = existingSecrets.get(entry.kind).find(value => value.name.toUpperCase() === entry.name);
    return existing && entry.mode === 'create_if_missing' ? null
      : planSecret(github, org, entry, existing, values, dryRun, warnings);
  });
  return operations.filter(Boolean);
}

module.exports = { repositoryIds, selectedIds, encrypt, variableValues, planCredentials };
