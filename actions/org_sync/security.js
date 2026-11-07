const { check, keys, get, list, api, same, pick, operation } = require('./admin-common.js');
const { mapConcurrent } = require('./concurrency.js');

const FEATURES = new Set(['code_security', 'dependency_graph', 'dependency_graph_autosubmit_action', 'dependabot_alerts',
  'dependabot_reachability', 'dependabot_security_updates', 'dependabot_delegated_alert_dismissal',
  'code_scanning_default_setup', 'code_scanning_delegated_alert_dismissal', 'secret_protection', 'secret_scanning',
  'secret_scanning_push_protection', 'secret_scanning_delegated_bypass', 'secret_scanning_validity_checks',
  'secret_scanning_non_provider_patterns', 'secret_scanning_generic_secrets', 'secret_scanning_generic_secrets_push_protection',
  'secret_scanning_delegated_alert_dismissal', 'secret_scanning_extended_metadata', 'private_vulnerability_reporting']);
const OPTIONS = new Set(['dependency_graph_autosubmit_action_options', 'code_scanning_options',
  'code_scanning_default_setup_options', 'secret_scanning_delegated_bypass_options']);
const FIELDS = ['name', 'description', 'advanced_security', 'enforcement', ...FEATURES, ...OPTIONS];
const BASE = '/orgs/{org}/code-security/configurations';
const DEFAULT_SCOPES = new Set(['all', 'none', 'public', 'private_and_internal']);

function validate(values) {
  keys(values, FIELDS, 'code-security values');
  for (const [field, value] of Object.entries(values)) {
    if (FEATURES.has(field)) check(['enabled', 'disabled', 'not_set'].includes(value), `Invalid security feature: ${field}`);
    else if (OPTIONS.has(field)) check(value === null || value && typeof value === 'object' && !Array.isArray(value),
      `Invalid security options: ${field}`);
    else if (field === 'advanced_security') check(['enabled', 'disabled', 'code_security', 'secret_protection'].includes(value),
      'Invalid advanced_security setting');
    else if (field === 'enforcement') check(['enforced', 'unenforced'].includes(value), 'Invalid security enforcement');
    else check(typeof value === 'string', `Invalid security field: ${field}`);
  }
  return values;
}

function defaultConfiguration(value) { return value.configuration?.value ?? value.configuration; }

function defaultScope(defaults, id) {
  if (id === undefined) return 'none';
  const scopes = defaults.filter(value => defaultConfiguration(value)?.id === id).map(value => value.default_for_new_repos);
  check(scopes.every(scope => DEFAULT_SCOPES.has(scope)), 'Unsupported security default response');
  if (scopes.includes('all') || scopes.includes('public') && scopes.includes('private_and_internal')) return 'all';
  return scopes.find(scope => scope !== 'none') ?? 'none';
}

function defaultIdentity(defaults) {
  return defaults.map(value => `${value.default_for_new_repos}:${defaultConfiguration(value)?.id}`)
    .sort((left, right) => left.localeCompare(right));
}

function snapshot(value) {
  if (value === null) return null;
  const result = structuredClone(value);
  const options = result.secret_scanning_delegated_bypass_options;
  if (options?.reviewers) options.reviewers = options.reviewers.map(reviewer => ({ reviewer_type: reviewer.reviewer_type }));
  return result;
}

async function resolveSecurity(github, config) {
  const needsSource = config.security_configurations.some(entry => entry.source_name);
  check(!needsSource || config.source_organization, 'source_organization is required for code-security copying');
  const source = needsSource ? await list(github, BASE, { org: config.source_organization }) : [];
  const needsDefaults = config.security_configurations.some(entry => entry.copy_default);
  const defaults = needsDefaults ? await get(github, `${BASE}/defaults`, { org: config.source_organization }) : [];
  const entries = config.security_configurations.map(entry => {
    validate(entry.values);
    const matches = source.filter(value => value.name === entry.source_name);
    check(!entry.source_name || matches.length === 1, `Source security configuration missing or ambiguous: ${entry.name}`);
    const fromSource = matches[0] ?? {};
    const inherited = Object.fromEntries(FIELDS.filter(field => Object.hasOwn(fromSource, field) && fromSource[field] !== null)
      .map(field => [field, fromSource[field]]));
    const desired = validate({ ...inherited, ...entry.values, name: entry.name });
    const reviewers = desired.secret_scanning_delegated_bypass_options?.reviewers ?? [];
    check(!reviewers.length || Object.hasOwn(entry.values, 'secret_scanning_delegated_bypass_options')
      && entry.organizations.length === 1, 'Security reviewer references require explicit destination-specific values');
    check(!entry.copy_default || entry.source_name, 'copy_default requires source_name');
    return { ...entry, desired, default_for_new_repos: entry.copy_default ? defaultScope(defaults, fromSource.id)
      : entry.default_for_new_repos };
  });
  return { ...config, security_configurations: entries };
}

async function configurationOperation(github, org, entry, existing, identity) {
  const fields = Object.keys(entry.desired);
  const before = existing ? pick(existing, fields) : null;
  if (same(before, entry.desired)) return null;
  check(!existing || existing.target_type === 'organization', 'Inherited code-security configurations cannot be edited');
  return operation('code_security', entry.name, snapshot(before), snapshot(entry.desired), async () => {
    if (existing) {
      const current = await get(github, `${BASE}/{configuration_id}`, { org, configuration_id: identity.id });
      check(current.target_type === 'organization' && same(pick(current, fields), before), 'Security configuration changed during planning');
      await api(github, `PATCH ${BASE}/{configuration_id}`, { org, configuration_id: identity.id, ...entry.desired });
    } else {
      const current = await list(github, BASE, { org });
      check(!current.some(value => value.name === entry.name), 'Security configuration appeared during planning');
      const created = await api(github, `POST ${BASE}`, { org, ...entry.desired });
      check(Number.isSafeInteger(created.id), 'Invalid created security configuration id');
      identity.id = created.id;
    }
    const saved = await get(github, `${BASE}/{configuration_id}`, { org, configuration_id: identity.id });
    check(same(pick(saved, fields), entry.desired), 'Security configuration verification failed');
  });
}

async function planOne(github, org, entry, existing, defaults) {
  const identity = { id: existing?.id };
  const operations = [];
  const config = await configurationOperation(github, org, entry, existing, identity);
  if (config) operations.push(config);
  if (entry.default_for_new_repos === undefined) return operations;
  const before = defaultScope(defaults.current, identity.id);
  if (before === entry.default_for_new_repos) return operations;
  operations.push(operation('security_default', entry.name, before, entry.default_for_new_repos, async () => {
    const current = await get(github, `${BASE}/defaults`, { org });
    check(same(defaultIdentity(current), defaultIdentity(defaults.current)), 'Security defaults changed during planning');
    await api(github, `PUT ${BASE}/{configuration_id}/defaults`, { org, configuration_id: identity.id,
      default_for_new_repos: entry.default_for_new_repos });
    const saved = await get(github, `${BASE}/defaults`, { org });
    check(defaultScope(saved, identity.id) === entry.default_for_new_repos, 'Security default verification failed');
    defaults.current = saved;
  }));
  return operations;
}

async function planSecurity(github, org, entries) {
  if (!entries.length) return [];
  const scopes = entries.filter(entry => entry.default_for_new_repos && entry.default_for_new_repos !== 'none')
    .flatMap(entry => entry.default_for_new_repos === 'all' ? ['public', 'private_and_internal'] : [entry.default_for_new_repos]);
  check(new Set(scopes).size === scopes.length, 'Overlapping code-security default scopes');
  const existing = await list(github, BASE, { org });
  const defaults = { current: entries.some(entry => entry.default_for_new_repos !== undefined)
    ? await get(github, `${BASE}/defaults`, { org }) : [] };
  const plans = await mapConcurrent(entries, 3, async entry => {
    const matches = existing.filter(value => value.name === entry.name);
    check(matches.length <= 1, `Ambiguous code-security configuration: ${entry.name}`);
    return planOne(github, org, entry, matches[0], defaults);
  });
  return plans.flat();
}

module.exports = { validate, defaultScope, resolveSecurity, planSecurity };
