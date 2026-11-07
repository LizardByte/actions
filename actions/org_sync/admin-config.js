const fs = require('node:fs');
const { loadOrganizations, localPath } = require('./config.js');
const { check, keys, names, object, AdminError } = require('./admin-common.js');
const { definitions } = require('./schemas.js');
const { resourcePolicies } = require('./resource-config.js');
const { section } = require('./policy.js');

function secretValues(value, core) {
  if (!value) return {};
  core.setSecret(value);
  let result;
  try { result = JSON.parse(value); } catch { throw new AdminError('secret_values must be a JSON object of strings'); }
  object(result, 'secret_values');
  check(Object.values(result).every(secret => typeof secret === 'string' && secret.length > 0),
    'secret_values must contain nonempty strings');
  for (const secret of Object.values(result)) if (secret) core.setSecret(secret);
  return result;
}

function scope(value, organizations) {
  const selected = value === undefined ? organizations : names(value, 'target organizations', /^[a-z\d][a-z\d-]*$/i);
  check(selected.length > 0 && selected.every(org => organizations.some(name => name.toLowerCase() === org.toLowerCase())),
    'Target organization is outside organizations_file');
  return selected;
}

function secretSource(entry) {
  check(entry.value === undefined && entry.from_source === undefined, 'Secret values must be supplied through inputs or environment');
  const fromKey = entry.value_key !== undefined;
  check(fromKey !== (entry.value_env !== undefined), 'Secrets require exactly one value_key or value_env');
  const valid = fromKey ? typeof entry.value_key === 'string' && entry.value_key.length > 0
    : typeof entry.value_env === 'string' && /^[a-z_][a-z\d_]*$/i.test(entry.value_env);
  check(valid, 'Invalid secret value_key or value_env');
  check(['actions', 'dependabot', 'codespaces'].includes(entry.kind ?? 'actions'), 'Invalid secret kind');
}

function variableSource(entry) {
  check(entry.value_key === undefined && entry.value_env === undefined && entry.kind === undefined, 'Invalid variable fields');
  check((typeof entry.value === 'string') !== (typeof entry.from_source === 'string'),
    'Variables require exactly one value or from_source name');
  check(entry.from_source === undefined || /^[a-z_][a-z\d_]*$/i.test(entry.from_source), 'Invalid source variable name');
}

function credential(entry, kind, organizations, defaultTargets) {
  keys(entry, ['name', 'value', 'value_key', 'value_env', 'from_source', 'visibility', 'repository_names', 'organizations', 'mode', 'kind',
    'missing_repositories'], kind);
  check(typeof entry.name === 'string' && /^[a-z_][a-z\d_]*$/i.test(entry.name)
    && !entry.name.toUpperCase().startsWith('GITHUB_'), `Invalid ${kind} name`);
  const visibility = entry.visibility === undefined ? 'all' : entry.visibility;
  check(['all', 'private', 'selected'].includes(visibility), `Invalid visibility for ${entry.name}`);
  const repositoryNames = entry.repository_names === undefined ? [] : names(entry.repository_names, 'repository names');
  check(visibility === 'selected' || repositoryNames.length === 0, 'Repository names require selected visibility');
  check(['error', 'defer'].includes(entry.missing_repositories ?? 'error'), 'Invalid missing_repositories mode');
  check(entry.missing_repositories === undefined || visibility === 'selected', 'missing_repositories requires selected visibility');
  const mode = entry.mode ?? 'sync';
  check(['sync', 'create_if_missing'].includes(mode), 'Invalid credential sync mode');
  if (kind === 'secret') secretSource(entry); else variableSource(entry);
  const targets = entry.organizations ?? defaultTargets;
  check(targets !== undefined, 'Secret and variable distribution requires explicit organizations in the policy');
  return { ...entry, name: entry.name.toUpperCase(), mode, visibility, manage_access: entry.visibility !== undefined,
    repository_names: repositoryNames,
    organizations: scope(targets, organizations), ...(kind === 'secret' ? { kind: entry.kind ?? 'actions' } : {}) };
}

function credentials(entries, kind, organizations, defaultTargets) {
  check(Array.isArray(entries), `Expected a ${kind} array`);
  const result = entries.map(entry => credential(entry, kind, organizations, defaultTargets));
  const identities = result.flatMap(entry => entry.organizations.map(org => `${entry.kind ?? 'variable'}/${entry.name}/${org.toLowerCase()}`));
  check(new Set(identities).size === identities.length, `Duplicate ${kind} names for a target organization`);
  return result;
}

function read(root, relative) {
  try { return JSON.parse(fs.readFileSync(localPath(root, relative), 'utf8')); }
  catch { throw new AdminError(`Cannot read administration configuration: ${relative}`); }
}

function environmentSecrets(entries, env, core, values) {
  for (const entry of entries) {
    if (!entry.value_env) continue;
    entry.value_key = `env:${entry.value_env}`;
    delete values[entry.value_key];
    if (env[entry.value_env]) {
      check(typeof env[entry.value_env] === 'string', 'Secret environment values must be strings');
      values[entry.value_key] = env[entry.value_env];
      core.setSecret(env[entry.value_env]);
    }
  }
}

function administrationTargets(config, organizations) {
  if (config.source_organization !== undefined) {
    check(typeof config.source_organization === 'string' &&
      organizations.some(org => org.toLowerCase() === config.source_organization.toLowerCase()),
    'Source organization is outside organizations_file');
  }
  const source = config.source_organization === undefined ? '' : config.source_organization.toLowerCase();
  return config.organizations === undefined
    ? organizations.filter(org => org.toLowerCase() !== source)
    : scope(config.organizations, organizations);
}

function loadAdministration(env, core) {
  const values = secretValues(env.INPUT_SECRET_VALUES, core);
  const root = fs.realpathSync(env.INPUT_SOURCE_DIRECTORY || env.GITHUB_WORKSPACE || '.');
  const organizations = loadOrganizations(root, env.INPUT_ORGANIZATIONS_FILE || 'organizations.json');
  check(!env.INPUT_REPOSITORY, 'Organization administration cannot be narrowed with repository; use organization');
  const targets = organizations.filter(org => !env.INPUT_ORGANIZATION || org.toLowerCase() === env.INPUT_ORGANIZATION.toLowerCase());
  check(targets.length > 0, 'Requested organization is outside the configured list');
  const schema = env.INPUT_PROPERTIES_FILE ? definitions(section(read(root, env.INPUT_PROPERTIES_FILE), 'properties')) : [];
  const config = env.INPUT_ADMIN_CONFIG ? section(read(root, env.INPUT_ADMIN_CONFIG), 'administration') : {};
  keys(config, ['version', 'source_organization', 'organizations', 'settings', 'actions', 'variables', 'secrets',
    'blocked_users', 'webhooks', 'security_configurations'], 'administration policy');
  check(config.version === undefined || config.version === 1, 'Unsupported administration policy version');
  const scoped = administrationTargets(config, organizations);
  const result = { organizations: targets, schema, config: { ...config,
    ...resourcePolicies({ ...config, organizations: scoped }, organizations, scope), organizations: scoped,
    variables: credentials(config.variables ?? [], 'variable', organizations, config.organizations),
    secrets: credentials(config.secrets ?? [], 'secret', organizations, config.organizations) }, secretValues: values };
  environmentSecrets([...result.config.secrets, ...result.config.webhooks], env, core, result.secretValues);
  return result;
}

module.exports = { secretValues, scope, credential, credentials, loadAdministration };
