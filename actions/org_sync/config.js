const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { section } = require('./policy.js');

const STATE_PATH = '.github/org-sync-state.json';
const NAME = /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i;
const REPOSITORY = /^[a-z\d][a-z\d-]*\/[\w.-]+$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filePath(value) {
  assert(typeof value === 'string' && value.length > 0, 'File paths must be non-empty strings');
  assert(!/[\\:]/.test(value) && [...value].every(character => character.codePointAt(0) >= 32
    && character.codePointAt(0) !== 127) && value === value.trim(), 'Invalid file path');
  assert(value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'),
    'Paths must stay inside the repository');
  return value;
}

function blobSha(content) {
  const hash = createHash('sha1'); // NOSONAR(javascript:S4790): Git blob IDs require SHA-1 for protocol compatibility.
  return hash.update(`blob ${content.length}\0`).update(content).digest('hex');
}

function localPath(root, relative) {
  const resolved = fs.realpathSync(path.join(root, filePath(relative)));
  const fromRoot = path.relative(root, resolved);
  assert(fromRoot && !fromRoot.startsWith(`..${path.sep}`) && fromRoot !== '..' && !path.isAbsolute(fromRoot),
    'Source path escapes the source directory');
  assert(!fs.lstatSync(path.join(root, relative)).isSymbolicLink() && fs.statSync(resolved).isFile(),
    'Sources must be regular files');
  return resolved;
}

function stringList(value, label, validator) {
  assert(Array.isArray(value) && value.every(item => typeof item === 'string' && validator(item)),
    `Invalid ${label}`);
  assert(new Set(value.map(item => item.toLowerCase())).size === value.length, `Duplicate ${label}`);
  return value;
}

function loadOrganizations(root, organizationsFile) {
  const organizations = stringList(JSON.parse(fs.readFileSync(localPath(root, organizationsFile), 'utf8')),
    'organizations', item => NAME.test(item));
  assert(organizations.length > 0, 'At least one organization is required');
  return organizations;
}

function loadConfig({ sourceDirectory, configFile, organizationsFile }) {
  const root = fs.realpathSync(sourceDirectory);
  const organizations = loadOrganizations(root, organizationsFile);
  const policy = section(JSON.parse(fs.readFileSync(localPath(root, configFile), 'utf8')), 'files');
  assert(policy?.version === 1 && Array.isArray(policy.rules) && policy.rules.length > 0,
    'Expected a version 1 policy with at least one rule');
  const id = policy.id ?? 'org-sync';
  assert(typeof id === 'string' && /^[a-z\d][a-z\d_-]{0,63}$/i.test(id), 'Invalid policy id');
  const filters = { include_archived: false, include_forks: true, include_private: false, include_source: false };
  for (const key of Object.keys(filters)) {
    if (policy[key] !== undefined) {
      assert(typeof policy[key] === 'boolean', `Invalid ${key}`);
      filters[key] = policy[key];
    }
  }
  const orgNames = new Set(organizations.map(org => org.toLowerCase()));
  const sources = new Map();
  const ruleIds = new Set();
  const rules = policy.rules.map(rule => {
    assert(rule && typeof rule.id === 'string' && /^[\w-]+$/.test(rule.id) && !ruleIds.has(rule.id),
      'Each rule needs a unique id');
    ruleIds.add(rule.id);
    assert(rule.profile === undefined || (typeof rule.profile === 'string' && /^[\w-]+$/.test(rule.profile)),
      'Invalid workflow profile');
    assert(!(rule.organizations && rule.repositories), 'A rule cannot specify both organizations and repositories');
    assert(!(rule.repositories && rule.repository_names), 'A rule cannot specify both repositories and repository_names');
    const orgs = rule.organizations === undefined ? organizations : stringList(rule.organizations,
      'rule organizations', item => NAME.test(item) && orgNames.has(item.toLowerCase()));
    const repos = rule.repositories === undefined ? null : stringList(rule.repositories, 'rule repositories',
      item => REPOSITORY.test(item) && orgNames.has(item.split('/')[0].toLowerCase()));
    const names = rule.repository_names === undefined ? null : stringList(rule.repository_names, 'repository names',
      item => /^[\w.-]+$/.test(item) && !['.', '..'].includes(item));
    assert(orgs.length > 0 && (repos === null || repos.length > 0), 'Rules must have targets');
    assert(names === null || names.length > 0, 'Repository names must have targets');
    assert(Array.isArray(rule.files) && rule.files.length > 0, 'Each rule needs files');
    const files = rule.files.map(file => {
      assert(file && typeof file === 'object' && !Array.isArray(file), 'Invalid file mapping');
      const mode = file.mode ?? 'sync';
      assert(['sync', 'create_if_missing', 'remove'].includes(mode), 'Invalid file mode');
      const destination = filePath(file.destination ?? file.source);
      assert(destination.toLowerCase() !== STATE_PATH, 'The sync state path is reserved');
      if (mode === 'remove') {
        assert(file.source === undefined && file.permissions === undefined, 'Remove mappings only specify destination');
        return { destination, mode };
      }
      const source = filePath(file.source);
      assert(file.permissions === undefined || ['100644', '100755'].includes(file.permissions), 'Invalid permissions');
      if (!sources.has(source)) {
        const resolved = localPath(root, source);
        const content = fs.readFileSync(resolved);
        sources.set(source, { content, sha: blobSha(content), permissions: fs.statSync(resolved).mode & 0o111 ? '100755' : '100644' });
      }
      return { destination, mode, source, ...sources.get(source), permissions: file.permissions ?? sources.get(source).permissions };
    });
    return { id: rule.id, profile: rule.profile, organizations: orgs, repositories: repos, repository_names: names, files };
  });
  return { id, organizations, rules, ...filters };
}

function matches(rule, fullName) {
  const normalized = fullName.toLowerCase();
  const [owner, name] = normalized.split('/');
  const inScope = rule.repositories ? rule.repositories.some(repo => repo.toLowerCase() === normalized)
    : rule.organizations.some(org => org.toLowerCase() === owner);
  return inScope && (!rule.repository_names || rule.repository_names.some(repo => repo.toLowerCase() === name));
}

function properties(values, { syncModeProperty = 'sync_mode', workflowProfilesProperty = 'workflow_profiles' } = {}) {
  assert(Array.isArray(values), 'Missing repository custom properties');
  const sync = values.filter(item => item.property_name === syncModeProperty);
  const profiles = values.filter(item => item.property_name === workflowProfilesProperty);
  assert(sync.length === 1 && ['included', 'excluded'].includes(sync[0].value), `Missing or invalid ${syncModeProperty}`);
  assert(profiles.length <= 1, `Duplicate ${workflowProfilesProperty}`);
  const selected = profiles[0]?.value ?? [];
  assert(Array.isArray(selected) && selected.every(value => typeof value === 'string'), `Invalid ${workflowProfilesProperty}`);
  return { included: sync[0].value === 'included', profiles: new Set(selected) };
}

module.exports = { STATE_PATH, assert, blobSha, filePath, loadConfig, loadOrganizations, localPath, matches, properties };
