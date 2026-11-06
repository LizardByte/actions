const { check, keys, names, object } = require('./admin-common.js');

const DEFAULTS = ['all', 'none', 'public', 'private_and_internal'];
const validUrl = value => typeof value === 'string' && URL.canParse(value) && ['https:', 'http:'].includes(new URL(value).protocol);

function webhook(entry, organizations, scope, defaults) {
  keys(entry, ['id', 'source_url', 'url', 'events', 'active', 'content_type', 'insecure_ssl', 'secret_env',
    'secret_value_key', 'unsigned', 'mode', 'organizations'], 'webhook');
  check(typeof entry.id === 'string' && /^[\w-]+$/.test(entry.id), 'Webhook id is required');
  check(validUrl(entry.url ?? entry.source_url), 'Webhook URL must be an HTTP(S) URL');
  check(entry.source_url === undefined || validUrl(entry.source_url), 'Invalid source webhook URL');
  check(entry.active === undefined || typeof entry.active === 'boolean', 'Invalid webhook active flag');
  check(entry.content_type === undefined || ['json', 'form'].includes(entry.content_type), 'Invalid webhook content_type');
  check(entry.insecure_ssl === undefined || ['0', '1'].includes(entry.insecure_ssl), 'Invalid webhook insecure_ssl');
  if (entry.events !== undefined) names(entry.events, 'webhook events', /^(?:\*|[a-z_]+)$/);
  const unsigned = entry.unsigned ?? false;
  check(typeof unsigned === 'boolean', 'Invalid webhook unsigned flag');
  const env = entry.secret_env !== undefined;
  const key = entry.secret_value_key !== undefined;
  check(unsigned ? !env && !key : env !== key, 'Choose a webhook signing secret or explicit unsigned mode');
  check(!env || typeof entry.secret_env === 'string' && /^[a-z_][a-z\d_]*$/i.test(entry.secret_env), 'Invalid webhook secret_env');
  check(!key || typeof entry.secret_value_key === 'string' && entry.secret_value_key.length > 0, 'Invalid webhook secret_value_key');
  const targets = entry.organizations ?? defaults;
  check(targets !== undefined, 'Webhook distribution requires explicit organizations in the policy');
  const mode = entry.mode ?? 'sync';
  check(['sync', 'create_if_missing'].includes(mode), 'Invalid webhook sync mode');
  return { ...entry, mode, unsigned, organizations: scope(targets, organizations),
    value_env: entry.secret_env, value_key: entry.secret_value_key };
}

function resourcePolicies(config, organizations, scope) {
  let blocked = null;
  if (config.blocked_users !== undefined) {
    keys(config.blocked_users, ['from_source', 'users', 'remove_extra'], 'blocked_users');
    blocked = { from_source: config.blocked_users.from_source ?? false,
      users: names(config.blocked_users.users ?? [], 'blocked users', /^[a-z\d][a-z\d-]*$/i),
      remove_extra: config.blocked_users.remove_extra ?? false };
    check(typeof blocked.from_source === 'boolean' && typeof blocked.remove_extra === 'boolean', 'Invalid blocked-user mode');
  }
  check(Array.isArray(config.webhooks ?? []), 'Expected a webhooks array');
  const hooks = (config.webhooks ?? []).map(entry => webhook(entry, organizations, scope, config.organizations));
  check(new Set(hooks.map(entry => entry.id)).size === hooks.length, 'Duplicate webhook ids');
  check(new Set(hooks.map(entry => entry.url ?? entry.source_url)).size === hooks.length, 'Duplicate webhook URLs');
  check(Array.isArray(config.security_configurations ?? []), 'Expected a security_configurations array');
  const security = (config.security_configurations ?? []).map(entry => {
    keys(entry, ['name', 'source_name', 'values', 'default_for_new_repos', 'copy_default', 'organizations'], 'security configuration');
    const name = entry.name ?? entry.source_name;
    check(typeof name === 'string' && name.trim().length > 0, 'Security configuration name is required');
    check(entry.source_name === undefined || typeof entry.source_name === 'string' && entry.source_name.length > 0,
      'Invalid source security configuration name');
    object(entry.values ?? {}, 'security configuration values');
    check(entry.default_for_new_repos === undefined || DEFAULTS.includes(entry.default_for_new_repos), 'Invalid security default scope');
    check(entry.copy_default === undefined || typeof entry.copy_default === 'boolean', 'Invalid copy_default');
    check(!entry.copy_default || entry.source_name, 'copy_default requires source_name');
    check(!entry.copy_default || entry.default_for_new_repos === undefined, 'Choose copy_default or an explicit security default');
    return { ...entry, name, values: entry.values ?? {}, organizations: scope(entry.organizations, organizations) };
  });
  check(new Set(security.map(entry => entry.name)).size === security.length, 'Duplicate security configuration names');
  return { blocked_users: blocked, webhooks: hooks, security_configurations: security };
}

module.exports = { resourcePolicies, validUrl };
