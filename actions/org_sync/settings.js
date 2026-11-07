const { check, keys, names, get, list, api, same, pick, sortedIds, operation } = require('./admin-common.js');
const { repositoryIds } = require('./credentials.js');
const { mapConcurrent } = require('./concurrency.js');

const boolean = value => typeof value === 'boolean';
const text = value => typeof value === 'string';
const PROFILE_FIELDS = new Set(['company', 'blog', 'location', 'name', 'description', 'twitter_username']);

// GitHub represents unset profile strings as null, including after clearing them with an empty string.
function profileValues(values) {
  return Object.fromEntries(Object.entries(values).map(([field, value]) =>
    [field, PROFILE_FIELDS.has(field) && value === null ? '' : value]));
}

const choice = options => value => options.includes(value);
const days = value => Number.isInteger(value) && value >= 1 && value <= 400;
const ORGANIZATION = Object.fromEntries([
  'has_organization_projects', 'has_repository_projects', 'members_can_create_repositories',
  'members_can_create_internal_repositories', 'members_can_create_private_repositories', 'members_can_create_public_repositories',
  'members_can_create_pages', 'members_can_create_public_pages', 'members_can_create_private_pages',
  'members_can_fork_private_repositories', 'web_commit_signoff_required', 'deploy_keys_enabled_for_repositories',
].map(field => [field, boolean]));
Object.assign(ORGANIZATION, {
  default_repository_permission: choice(['read', 'write', 'admin', 'none']),
  company: text, blog: text, location: text, name: text, description: text, twitter_username: text,
});
const ACTIONS = {
  permissions: { enabled_repositories: choice(['all', 'none', 'selected']),
    allowed_actions: choice(['all', 'local_only', 'selected']), sha_pinning_required: boolean },
  workflow: { default_workflow_permissions: choice(['read', 'write']), can_approve_pull_request_reviews: boolean },
  selected_actions: { github_owned_allowed: boolean, verified_allowed: boolean,
    patterns_allowed: value => Array.isArray(value) && value.every(pattern => typeof pattern === 'string' && pattern.length > 0) },
  retention: { days },
};
const ROUTES = { permissions: '/orgs/{org}/actions/permissions', workflow: '/orgs/{org}/actions/permissions/workflow',
  selected_actions: '/orgs/{org}/actions/permissions/selected-actions', retention: '/orgs/{org}/actions/permissions/artifact-and-log-retention' };

function validateFields(value, validators, label) {
  keys(value, Object.keys(validators), label);
  for (const [field, setting] of Object.entries(value)) check(validators[field](setting), `Invalid ${label} field: ${field}`);
  return value;
}

function validateSettings(config) {
  const settings = config.settings ?? {};
  keys(settings, ['from_source', 'values'], 'organization settings');
  const sourceFields = names(settings.from_source ?? [], 'source settings');
  check(sourceFields.every(field => Object.hasOwn(ORGANIZATION, field)), 'Unsupported source setting');
  validateFields(settings.values ?? {}, ORGANIZATION, 'organization settings');
  const actions = config.actions ?? {};
  keys(actions, [...Object.keys(ACTIONS), 'from_source', 'repository_names'], 'Actions settings');
  const sourceGroups = names(actions.from_source ?? [], 'source Actions groups');
  check(sourceGroups.every(group => Object.hasOwn(ACTIONS, group)), 'Unsupported source Actions group');
  if (actions.repository_names !== undefined) names(actions.repository_names, 'Actions repository names');
  for (const [group, validators] of Object.entries(ACTIONS)) {
    if (actions[group] !== undefined) validateFields(actions[group], validators, `Actions ${group}`);
  }
  check(!(sourceFields.length || sourceGroups.length) || config.source_organization,
    'source_organization is required for copied settings');
}

async function resolveSettings(github, config) {
  validateSettings(config);
  const fields = config.settings?.from_source ?? [];
  let settings = {};
  if (fields.length) {
    const source = await get(github, '/orgs/{org}', { org: config.source_organization });
    settings = validateFields(profileValues(pick(source, fields)), ORGANIZATION, 'source organization settings');
  }
  Object.assign(settings, config.settings?.values ?? {});
  const actions = {};
  const sourceGroups = config.actions?.from_source ?? [];
  await Promise.all(Object.entries(ACTIONS).map(async ([group, validators]) => {
    if (!sourceGroups.includes(group) && config.actions?.[group] === undefined) return;
    let values = {};
    if (sourceGroups.includes(group)) {
      const source = await get(github, ROUTES[group], { org: config.source_organization });
      values = Object.fromEntries(Object.keys(validators).filter(field => Object.hasOwn(source, field))
        .map(field => [field, source[field]]));
      validateFields(values, validators, `source Actions ${group}`);
    }
    actions[group] = { ...values, ...config.actions?.[group] };
  }));
  check(actions.permissions?.enabled_repositories !== 'selected' || config.actions?.repository_names !== undefined,
    'Selected Actions repositories require explicit repository_names');
  return { ...config, desiredSettings: settings, desiredActions: actions };
}

async function fieldOperation(github, org, kind, name, route, desired, validators) {
  const fields = Object.keys(desired);
  if (!fields.length) return null;
  const snapshot = value => kind === 'organization_settings' ? profileValues(pick(value, fields)) : pick(value, fields);
  const current = await get(github, route, { org });
  const before = snapshot(current);
  validateFields(before, validators, `${name} readback`);
  if (same(before, desired)) return null;
  return operation(kind, name, before, desired, async () => {
    const live = await get(github, route, { org });
    check(same(snapshot(live), before), `Settings changed during planning: ${name}`);
    // PUT endpoints can reset omitted fields: retain all supported fields read immediately before writing.
    const retained = Object.fromEntries(Object.keys(validators).filter(field => Object.hasOwn(live, field))
      .map(field => [field, live[field]]));
    const body = kind === 'organization_settings' ? desired : { ...retained, ...desired };
    await api(github, `${kind === 'organization_settings' ? 'PATCH' : 'PUT'} ${route}`, { org, ...body });
    const saved = await get(github, route, { org });
    check(same(snapshot(saved), desired), `Settings verification failed: ${name}`);
  });
}

async function actionsRepositoryOperation(github, org, names) {
  const route = '/orgs/{org}/actions/permissions/repositories';
  const ids = await repositoryIds(github, org, names);
  const policy = await get(github, ROUTES.permissions, { org });
  const before = policy.enabled_repositories === 'selected' ? (await list(github, route, { org })).map(repo => repo.id) : [];
  if (policy.enabled_repositories === 'selected' && same(sortedIds(before), sortedIds(ids))) return null;
  return operation('actions_settings', 'selected_repositories', { selected_repository_count: before.length },
    { selected_repository_count: ids.length }, async () => {
    check(same(await repositoryIds(github, org, names), ids), 'Selected repository identity changed');
    if (policy.enabled_repositories === 'selected') {
      const current = (await list(github, route, { org })).map(repo => repo.id);
      check(same(sortedIds(current), sortedIds(before)), 'Actions repository policy changed during planning');
    }
    await api(github, `PUT ${route}`, { org, selected_repository_ids: ids });
    const saved = (await list(github, route, { org })).map(repo => repo.id);
    check(same(sortedIds(saved), sortedIds(ids)), 'Actions repository policy verification failed');
  });
}

async function selectedActionsOperation(github, org, groups) {
  const current = await get(github, ROUTES.permissions, { org });
  check((groups.permissions?.allowed_actions ?? current.allowed_actions) === 'selected',
    'selected_actions requires allowed_actions: selected');
  if (current.allowed_actions === 'selected') {
    return fieldOperation(github, org, 'actions_settings', 'selected_actions', ROUTES.selected_actions,
      groups.selected_actions, ACTIONS.selected_actions);
  }
  // GitHub cannot read this policy until selected mode is active. Initialize it only from a complete policy.
  check(Object.keys(ACTIONS.selected_actions).every(field => Object.hasOwn(groups.selected_actions, field)),
    'Enabling selected actions requires all selected_actions fields');
  const desired = groups.selected_actions;
  return operation('actions_settings', 'selected_actions', null, desired, async () => {
    const live = await get(github, ROUTES.permissions, { org });
    check(live.allowed_actions === 'selected', 'Actions permission policy changed before selected-actions delivery');
    await api(github, `PUT ${ROUTES.selected_actions}`, { org, ...desired });
    const saved = await get(github, ROUTES.selected_actions, { org });
    check(same(pick(saved, Object.keys(desired)), desired), 'Selected-actions verification failed');
  });
}

async function planSettings(github, org, config) {
  const operations = [];
  const organization = await fieldOperation(github, org, 'organization_settings', 'organization', '/orgs/{org}',
    config.desiredSettings, ORGANIZATION);
  if (organization) operations.push(organization);
  const groups = config.desiredActions;
  const actions = await mapConcurrent(['permissions', 'workflow', 'selected_actions', 'retention'], 3, async group => {
    if (!groups[group]) return null;
    return group === 'selected_actions' ? selectedActionsOperation(github, org, groups)
      : fieldOperation(github, org, 'actions_settings', group, ROUTES[group], groups[group], ACTIONS[group]);
  });
  operations.push(...actions.filter(Boolean));
  if (groups.permissions?.enabled_repositories === 'selected') {
    const selected = await actionsRepositoryOperation(github, org, config.actions.repository_names);
    if (selected) operations.push(selected);
  } else check(config.actions?.repository_names === undefined, 'Actions repository_names require enabled_repositories: selected');
  return operations;
}

module.exports = { ORGANIZATION, ACTIONS, ROUTES, validateSettings, resolveSettings, planSettings };
