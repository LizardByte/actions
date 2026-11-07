const { check, keys, get, list, api, same, operation } = require('./admin-common.js');

const FIELDS = ['property_name', 'value_type', 'required', 'default_value', 'description', 'allowed_values',
  'values_editable_by', 'require_explicit_values'];
const TYPES = new Set(['string', 'single_select', 'multi_select', 'true_false', 'url']);

function selection(value, choices, multiple) {
  if (value === null) return true;
  const values = multiple ? value : [value];
  return Array.isArray(values) && new Set(values).size === values.length && values.every(item => choices.includes(item));
}

function validateSelect(result) {
  const choices = result.allowed_values;
  check(Array.isArray(choices) && choices.length > 0 && choices.length <= 200
    && choices.every(choice => typeof choice === 'string' && choice.length > 0)
    && new Set(choices).size === choices.length, `Invalid allowed values: ${result.property_name}`);
  check(selection(result.default_value, choices, result.value_type === 'multi_select'),
    `Invalid default value: ${result.property_name}`);
}

function validateScalar(result) {
  check(result.allowed_values === null, `Allowed values require a select property: ${result.property_name}`);
  check(result.default_value === null || typeof result.default_value === 'string', 'Invalid property default');
  if (result.value_type === 'true_false') {
    check(result.default_value === null || ['true', 'false'].includes(result.default_value), 'Invalid boolean default');
  }
  if (result.value_type === 'url' && result.default_value !== null) {
    check(URL.canParse(result.default_value), 'Invalid URL default');
  }
}

function definition(value, strict = true) {
  if (strict) keys(value, FIELDS, 'property definition');
  check(typeof value.property_name === 'string' && /^[\w-]{1,75}$/.test(value.property_name), 'Invalid property name');
  check(TYPES.has(value.value_type), `Unsupported property type: ${value.property_name}`);
  const result = { property_name: value.property_name, value_type: value.value_type,
    required: value.required ?? false, default_value: value.default_value ?? null,
    description: value.description ?? null, allowed_values: value.allowed_values ?? null,
    values_editable_by: value.values_editable_by ?? 'org_actors',
    require_explicit_values: value.require_explicit_values ?? false };
  check(typeof result.required === 'boolean' && typeof result.require_explicit_values === 'boolean',
    `Invalid property requirements: ${result.property_name}`);
  check(result.description === null || typeof result.description === 'string', 'Invalid property description');
  check(['org_actors', 'org_and_repo_actors'].includes(result.values_editable_by), 'Invalid property editability');
  const select = ['single_select', 'multi_select'].includes(result.value_type);
  if (select) validateSelect(result); else validateScalar(result);
  return result;
}

function definitions(document) {
  keys(document, ['properties'], 'property schema');
  check(Array.isArray(document.properties), 'Expected a properties array');
  const result = document.properties.map(value => definition(value));
  check(new Set(result.map(value => value.property_name.toLowerCase())).size === result.length, 'Duplicate property names');
  return result;
}

async function planSchemas(github, org, desired) {
  if (!desired.length) return [];
  const existing = await get(github, '/orgs/{org}/properties/schema', { org });
  check(Array.isArray(existing), 'Invalid organization property schema response');
  const operations = [];
  const removed = [];
  for (const after of desired) {
    const current = existing.find(value => value.property_name === after.property_name);
    const before = current ? definition(current, false) : null;
    if (same(before, after)) continue;
    check(current?.source_type === undefined || current.source_type === 'organization',
      `Cannot modify inherited property: ${after.property_name}`);
    check(!before || before.value_type === after.value_type, `Property type changes require migration: ${after.property_name}`);
    if (before?.allowed_values?.some(value => !after.allowed_values.includes(value))) removed.push(after);
    const op = operation('schema', after.property_name, before, after, async () => {
      const latest = await get(github, '/orgs/{org}/properties/schema', { org });
      const live = latest.find(value => value.property_name === after.property_name);
      check(live?.source_type === undefined || live.source_type === 'organization',
        `Cannot modify inherited property: ${after.property_name}`);
      check(same(live ? definition(live, false) : null, before), `Property changed during planning: ${after.property_name}`);
      if (removed.includes(after)) await validateValues(github, org, [after]);
      await api(github, 'PATCH /orgs/{org}/properties/schema', { org, properties: [after] });
      const verified = await get(github, '/orgs/{org}/properties/schema', { org });
      const saved = verified.find(value => value.property_name === after.property_name);
      check(saved && same(definition(saved, false), after), `Property verification failed: ${after.property_name}`);
    });
    operations.push(op);
  }
  if (removed.length) await validateValues(github, org, removed);
  return operations;
}

async function validateValues(github, org, desired) {
  const repositories = await list(github, '/orgs/{org}/properties/values', { org });
  for (const repo of repositories) {
    for (const property of desired) {
      const value = repo.properties.find(item => item.property_name === property.property_name)?.value ?? null;
      check(selection(value, property.allowed_values, property.value_type === 'multi_select'),
        `Allowed-value removal would invalidate repository values: ${property.property_name}`);
    }
  }
}

module.exports = { definition, definitions, planSchemas };
