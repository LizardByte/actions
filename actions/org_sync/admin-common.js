const { isDeepStrictEqual } = require('node:util');

class AdminError extends Error {
  constructor(message) { super(message); this.name = 'OrgSyncAdministrationError'; }
}

function check(condition, message) {
  if (!condition) throw new AdminError(message);
}

function object(value, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `Expected an object for ${label}`);
  return value;
}

function keys(value, allowed, label) {
  object(value, label);
  check(Object.keys(value).every(key => allowed.includes(key)), `Unsupported field in ${label}`);
}

function names(value, label, pattern = /^[\w.-]+$/i) {
  check(Array.isArray(value) && value.every(name => typeof name === 'string' && pattern.test(name)
    && !['.', '..'].includes(name)), `Invalid ${label}`);
  check(new Set(value.map(name => name.toLowerCase())).size === value.length, `Duplicate ${label}`);
  return value;
}

async function api(github, route, parameters, paginate = false) {
  try {
    return paginate ? await github.paginate(route, parameters) : (await github.request(route, parameters)).data;
  } catch (error) {
    const status = Number.isInteger(error.status) ? ` (HTTP ${error.status})` : '';
    throw new AdminError(`GitHub ${route} failed${status}`);
  }
}

const get = (github, route, parameters) => api(github, `GET ${route}`, parameters);
const list = (github, route, parameters) => api(github, `GET ${route}`, { per_page: 100, ...parameters }, true);
const same = (left, right) => isDeepStrictEqual(left, right);
const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));
const sortedIds = ids => ids.map(String).sort((left, right) => left.localeCompare(right));

function operation(kind, name, before, after, apply) {
  return { change: { kind, name, operation: before === null ? 'create' : 'update', before, after }, apply };
}

async function applyOperations(operations, changes, dryRun, index = 0) {
  if (index >= operations.length) return;
  const { change, apply } = operations[index];
  const record = { ...change, status: dryRun ? 'planned' : 'pending' };
  changes.push(record);
  if (!dryRun) {
    await apply();
    record.status = 'updated';
  }
  return applyOperations(operations, changes, dryRun, index + 1);
}

module.exports = { AdminError, check, object, keys, names, api, get, list, same, pick, sortedIds, operation, applyOperations };
