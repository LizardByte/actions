const { check, get, list, api, same, operation } = require('./admin-common.js');
const { resolveSecurity, planSecurity } = require('./security.js');
const { mapConcurrent } = require('./concurrency.js');

const sorted = values => [...values].sort((a, b) => a.localeCompare(b));
const scoped = (entry, org) => entry.organizations.some(name => name.toLowerCase() === org.toLowerCase());

function hookMetadata(hook) {
  return { events: sorted(hook.events), active: hook.active,
    content_type: hook.config.content_type, insecure_ssl: String(hook.config.insecure_ssl ?? '0') };
}

async function resolveResources(github, config) {
  let blocked = config.blocked_users;
  if (blocked?.from_source) {
    check(config.source_organization, 'source_organization is required for blocked-user copying');
    const source = await list(github, '/orgs/{org}/blocks', { org: config.source_organization });
    blocked = { ...blocked, users: [...new Set([...blocked.users, ...source.map(user => user.login.toLowerCase())])] };
  }
  const needsHooks = config.webhooks.some(entry => entry.source_url);
  check(!needsHooks || config.source_organization, 'source_organization is required for webhook copying');
  const sourceHooks = needsHooks ? await list(github, '/orgs/{org}/hooks', { org: config.source_organization }) : [];
  const hooks = config.webhooks.map(entry => {
    const matches = sourceHooks.filter(hook => hook.config.url === entry.source_url && hook.name === 'web');
    check(!entry.source_url || matches.length === 1, `Source webhook is missing or ambiguous: ${entry.id}`);
    const source = matches[0];
    const configValues = { url: entry.url ?? source?.config.url, content_type: entry.content_type ?? source?.config.content_type ?? 'json',
      insecure_ssl: String(entry.insecure_ssl ?? source?.config.insecure_ssl ?? '0') };
    const resolved = { ...entry, desired: { name: 'web', events: entry.events ?? source?.events ?? ['push'],
      active: entry.active ?? source?.active ?? true, config: configValues } };
    return resolved;
  });
  return resolveSecurity(github, { ...config, blocked_users: blocked, webhooks: hooks });
}

async function planBlocks(github, org, config) {
  const policy = config.blocked_users;
  if (!policy) return [];
  const existing = (await list(github, '/orgs/{org}/blocks', { org })).map(user => user.login.toLowerCase());
  const desired = policy.users.map(user => user.toLowerCase());
  const changes = desired.filter(user => !existing.includes(user)).map(user => ({ user, block: true }));
  if (policy.remove_extra) changes.push(...existing.filter(user => !desired.includes(user)).map(user => ({ user, block: false })));
  return changes.map(({ user, block }) => operation('blocked_user', user, !block, block, async () => {
    const current = (await list(github, '/orgs/{org}/blocks', { org })).some(value => value.login.toLowerCase() === user);
    check(current === !block, 'Blocked-user list changed during planning');
    await api(github, `${block ? 'PUT' : 'DELETE'} /orgs/{org}/blocks/{username}`, { org, username: user });
    const saved = (await list(github, '/orgs/{org}/blocks', { org })).some(value => value.login.toLowerCase() === user);
    check(saved === block, 'Blocked-user verification failed');
  }));
}

async function planHook(github, org, entry, existing, values, dryRun, warnings) {
  if (existing && entry.mode === 'create_if_missing') return null;
  const supplied = entry.unsigned || Object.hasOwn(values, entry.value_key);
  check(dryRun || supplied, `Missing signing secret for webhook: ${entry.id}`);
  if (!supplied) warnings.push(`Signing secret required for webhook delivery: ${entry.id}`);
  const before = existing ? hookMetadata(existing) : null;
  const after = hookMetadata(entry.desired);
  // GitHub can omit signing-secret metadata, so signed and explicitly unsigned policies are reapplied.
  const op = operation('webhook', entry.id, before, after, async () => {
    const currentHooks = await list(github, '/orgs/{org}/hooks', { org });
    const matches = currentHooks.filter(hook => hook.name === 'web' && hook.config.url === entry.desired.config.url);
    check(matches.length === (existing ? 1 : 0), 'Webhook identity changed during planning');
    const current = matches[0];
    check(!existing || current.id === existing.id && same(hookMetadata(current), before), 'Webhook changed during planning');
    const body = { ...entry.desired, config: { ...entry.desired.config, secret: entry.unsigned ? '' : values[entry.value_key] } };
    let id = existing?.id;
    if (existing) await api(github, 'PATCH /orgs/{org}/hooks/{hook_id}', { org, hook_id: id, ...body });
    else {
      const created = await api(github, 'POST /orgs/{org}/hooks', { org, ...body });
      check(Number.isSafeInteger(created.id), 'Invalid created webhook id');
      id = created.id;
    }
    const saved = await get(github, '/orgs/{org}/hooks/{hook_id}', { org, hook_id: id });
    check(saved.config.url === entry.desired.config.url && same(hookMetadata(saved), after), 'Webhook verification failed');
  });
  op.change.signing_secret = entry.unsigned ? 'explicitly unsigned' : 'supplied again; never exported';
  return op;
}

async function planResources(github, org, config, values, dryRun, warnings) {
  const operations = await planBlocks(github, org, config);
  const hooks = config.webhooks.filter(entry => scoped(entry, org));
  const existing = hooks.length ? await list(github, '/orgs/{org}/hooks', { org }) : [];
  const hookPlans = await mapConcurrent(hooks, 3, async entry => {
    const matches = existing.filter(hook => hook.name === 'web' && hook.config.url === entry.desired.config.url);
    check(matches.length <= 1, `Ambiguous target webhook: ${entry.id}`);
    return planHook(github, org, entry, matches[0], values, dryRun, warnings);
  });
  operations.push(...hookPlans.filter(Boolean));
  operations.push(...await planSecurity(github, org, config.security_configurations.filter(entry => scoped(entry, org))));
  return operations;
}

module.exports = { hookMetadata, resolveResources, planResources };
