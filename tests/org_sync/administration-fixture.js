const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const run = require('../../actions/org_sync/admin.js');
const { definition } = require('../../actions/org_sync/schemas.js');

// API fixtures must return JSON-shaped objects in Jest's realm, without retaining references to server state.
function jsonValue(value) {
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, jsonValue(field)]));
  }
  return value;
}

function schemas(state, method, args) {
  if (method === 'PATCH') {
    for (const value of args.properties) {
      const index = state.schema.findIndex(item => item.property_name === value.property_name);
      const saved = { ...definition(value), source_type: 'organization' };
      if (index < 0) state.schema.push(saved); else state.schema[index] = saved;
    }
  }
  return state.schema;
}

function settings(state, method, args) {
  if (method === 'PATCH') Object.assign(state.settings, Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'org')));
  return { login: args.org, ...state.settings };
}

function actions(state, method, group, args) {
  if (group === 'selected_actions' && state.permissions.allowed_actions !== 'selected') {
    throw Object.assign(new Error('Selected-actions policy is inactive'), { status: 409 });
  }
  if (method === 'PUT') Object.assign(state[group], Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'org')));
  return state[group];
}

function actionsRepositories(state, method, args) {
  if (method === 'PUT') state.actionsRepositories = args.selected_repository_ids;
  return state.repositories.filter(repo => state.actionsRepositories.includes(repo.id));
}

function blocks(state, method, args) {
  if (method === 'PUT') state.blocks.push(args.username);
  if (method === 'DELETE') state.blocks = state.blocks.filter(user => user !== args.username);
  return state.blocks.map(login => ({ login }));
}

function credentialMetadata(previous, method, args, updatedAt) {
  return { ...(method === 'PATCH' ? previous : {}), name: args.name ?? args.secret_name,
    ...(args.visibility === undefined ? {} : { visibility: args.visibility }), updated_at: String(updatedAt),
    ...(args.value === undefined ? {} : { value: args.value }) };
}

function fixture(publicKey) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'org-sync-admin-')));
  const organizations = new Map();
  let nextId = 1;
  const api = { root, organizations, hook: null, writes: [], requests: [],
    core: { setOutput: jest.fn(), setFailed: jest.fn(), setSecret: jest.fn(), info: jest.fn(), error: jest.fn() },
    write(file, value) { fs.writeFileSync(path.join(root, file), JSON.stringify(value)); },
    add(org) {
      const state = { schema: [], values: [], repositories: [], settings: { web_commit_signoff_required: false,
        default_repository_permission: 'read', members_can_create_public_repositories: false },
      permissions: { enabled_repositories: 'all', allowed_actions: 'all', sha_pinning_required: false },
      workflow: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
      selected_actions: { github_owned_allowed: true, verified_allowed: false, patterns_allowed: [] },
      retention: { days: 90 }, actionsRepositories: [],
      variables: new Map(), secrets: new Map(), access: new Map(), ciphertext: new Map(),
      blocks: [], hooks: [], hookSecrets: new Map(), security: [], defaults: [] };
      organizations.set(org, state);
      return state;
    },
    repo(org, name) {
      const repo = { id: nextId++, name, full_name: `${org}/${name}`, owner: { login: org } };
      organizations.get(org).repositories.push(repo);
      return repo;
    },
    async run(inputs = {}) {
      return run({ github: api.github, core: api.core, env: { INPUT_SOURCE_DIRECTORY: root,
        INPUT_ORGANIZATIONS_FILE: 'organizations.json', INPUT_PROPERTIES_FILE: 'properties.json',
        INPUT_SYNC_FILES: 'false', ...inputs } });
    },
    remove() { fs.rmSync(root, { recursive: true, force: true }); },
  };
  function hooks(state, method, url, args) {
    let hook = state.hooks.find(value => value.id === args.hook_id);
    if (method === 'POST') { hook = { id: nextId++ }; state.hooks.push(hook); }
    if (method === 'POST' || method === 'PATCH') {
      const { secret, ...config } = args.config;
      state.hookSecrets.set(hook.id, secret);
      Object.assign(hook, { name: args.name, active: args.active, events: args.events,
        config: { ...config, ...(secret ? { secret: '********' } : {}) } });
    }
    return url.endsWith('/{hook_id}') || method === 'POST' ? hook : state.hooks;
  }
  function security(state, method, url, args) {
    let configuration = state.security.find(value => value.id === args.configuration_id);
    if (url.endsWith('/defaults')) {
      if (method === 'PUT') {
        state.defaults = state.defaults.filter(value => value.configuration.id !== args.configuration_id);
        if (args.default_for_new_repos !== 'none') state.defaults.push({ default_for_new_repos: args.default_for_new_repos,
          configuration: { id: args.configuration_id } });
      }
      return state.defaults;
    }
    if (method === 'POST') {
      configuration = { id: nextId++, target_type: 'organization' };
      state.security.push(configuration);
    }
    if (method === 'POST' || method === 'PATCH') {
      Object.assign(configuration, Object.fromEntries(Object.entries(args).filter(([key]) => !['org', 'configuration_id'].includes(key))));
    }
    return args.configuration_id !== undefined || method === 'POST' ? configuration : state.security;
  }
  function credentials(state, method, match, args) {
    const [, kind, type, suffix] = match;
    const name = args.name ?? args.secret_name;
    const key = type === 'secrets' ? `${kind}/${name}` : name;
    const store = type === 'secrets' ? state.secrets : state.variables;
    if (suffix.endsWith('/repositories')) {
      return state.repositories.filter(repo => (state.access.get(key) ?? []).includes(repo.id));
    }
    if (method !== 'GET') {
      store.set(key, credentialMetadata(store.get(key), method, args, api.writes.length));
      if (method !== 'PATCH' || args.visibility !== undefined || args.selected_repository_ids !== undefined) {
        state.access.set(key, args.selected_repository_ids ?? []);
      }
      if (type === 'secrets') state.ciphertext.set(key, args.encrypted_value);
    }
    if (!suffix) return [...store.values()].filter(value => type !== 'secrets' || state.secrets.get(`${kind}/${value.name}`) === value);
    const found = store.get(key);
    if (!found) throw Object.assign(new Error('Missing credential'), { status: 404 });
    return found;
  }
  function dispatch(route, args) {
    api.requests.push({ route, ...args });
    if (api.hook) api.hook(route, args);
    const state = organizations.get(args.org);
    if (!state) throw Object.assign(new Error('Unknown organization'), { status: 404 });
    const [method, url] = route.split(' ');
    if (method !== 'GET') api.writes.push({ route, ...args });
    const routes = {
      '/orgs/{org}/properties/schema': () => schemas(state, method, args),
      '/orgs/{org}/properties/values': () => state.values,
      '/orgs/{org}/repos': () => state.repositories,
      '/orgs/{org}': () => settings(state, method, args),
      '/orgs/{org}/actions/permissions/repositories': () => actionsRepositories(state, method, args),
    };
    if (Object.hasOwn(routes, url)) return routes[url]();
    if (url.startsWith('/orgs/{org}/blocks')) return blocks(state, method, args);
    if (url.startsWith('/orgs/{org}/hooks')) return hooks(state, method, url, args);
    if (url.startsWith('/orgs/{org}/code-security/configurations')) return security(state, method, url, args);
    const groups = { '/orgs/{org}/actions/permissions': 'permissions',
      '/orgs/{org}/actions/permissions/workflow': 'workflow',
      '/orgs/{org}/actions/permissions/selected-actions': 'selected_actions',
      '/orgs/{org}/actions/permissions/artifact-and-log-retention': 'retention' };
    if (groups[url]) return actions(state, method, groups[url], args);
    if (url.endsWith('/secrets/public-key')) return publicKey;
    const match = /^\/orgs\/\{org\}\/(actions|dependabot|codespaces)\/(variables|secrets)(.*)$/.exec(url);
    if (match) return credentials(state, method, match, args);
    throw new Error(`Unexpected route ${route}`);
  }
  api.github = {
    request: jest.fn(async (route, args) => ({ data: jsonValue(dispatch(route, args)) })),
    paginate: jest.fn(async (route, args) => jsonValue(dispatch(route, args))),
  };
  api.add('source'); api.add('target');
  api.write('organizations.json', ['source', 'target']);
  api.write('properties.json', { properties: [{ property_name: 'sync_mode', value_type: 'single_select',
    allowed_values: ['included', 'excluded'], required: true, default_value: 'included' }] });
  api.write('admin.json', {});
  return api;
}

module.exports = fixture;
