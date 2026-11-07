const { check, keys, object } = require('./admin-common.js');

function section(document, name) {
  const combined = document && (Object.hasOwn(document, 'files') || Object.hasOwn(document, 'administration'));
  if (!combined) return document;
  keys(document, ['version', 'files', 'properties', 'administration'], 'combined synchronization policy');
  check(document.version === 1, 'Expected a version 1 combined synchronization policy');
  for (const field of ['files', 'administration']) {
    if (document[field] !== undefined) object(document[field], field);
  }
  if (name === 'properties') return { properties: document.properties ?? [] };
  const value = document[name] ?? {};
  check(value.version === undefined || value.version === document.version, 'Conflicting synchronization policy versions');
  return { ...value, version: document.version };
}

module.exports = { section };
