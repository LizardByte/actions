const { STATE_PATH, assert, blobSha, filePath, matches } = require('./config.js');

function readState(content, id) {
  if (content === null) return { version: 1, id, files: {} };
  const state = JSON.parse(content);
  assert(state && state.version === 1 && state.id === id && state.files && typeof state.files === 'object' && !Array.isArray(state.files),
    'Sync state belongs to another controller or is invalid');
  for (const [name, file] of Object.entries(state.files)) {
    filePath(name);
    assert(name.toLowerCase() !== STATE_PATH && file && ['sync', 'create_if_missing'].includes(file.mode)
      && /^[a-f\d]{40}$/.test(file.sha)
      && (file.permissions === undefined || ['100644', '100755'].includes(file.permissions)), 'Invalid managed file state');
  }
  return state;
}

function leafEntries(tree) {
  assert(!tree.truncated && Array.isArray(tree.tree), 'Incomplete Git tree; refusing to synchronize');
  return new Map(tree.tree.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
}

function sameEntry(left, right) {
  return left?.sha === right?.sha && left?.mode === right?.mode && left?.type === right?.type;
}

function differences(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].sort()
    .filter(name => !sameEntry(before.get(name), after.get(name)))
    .map(name => ({ path: name, before: before.get(name), after: after.get(name) }));
}

function regular(entry) {
  assert(!entry || (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)),
    'A managed destination is a symlink, submodule, or directory');
}

function unchanged(entry, previous) {
  return entry?.sha === previous.sha && (previous.permissions === undefined || entry.mode === previous.permissions);
}

function buildPlan({ policy, fullName, selected, base, pending, baseState, pendingState }) {
  const desired = new Map(base);
  const owned = new Map();
  const claims = new Map();
  const warnings = [];
  const directories = new Set();
  for (const name of new Set([...base.keys(), ...pending.keys()])) {
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'));
  }
  const allowed = new Set([STATE_PATH, ...Object.keys(baseState.files), ...Object.keys(pendingState.files)]);
  for (const rule of policy.rules.filter(rule => matches(rule, fullName))) {
    for (const file of rule.files) {
      allowed.add(file.destination);
      const existing = claims.get(file.destination);
      if (existing) {
        assert(existing.mode === file.mode && existing.sha === file.sha && existing.permissions === file.permissions,
          `Conflicting mappings for ${file.destination}`);
        existing.active ||= !rule.profile || selected.has(rule.profile);
      } else {
        claims.set(file.destination, { ...file, active: !rule.profile || selected.has(rule.profile) });
      }
    }
  }
  for (const [name, claim] of claims) {
    const current = base.get(name);
    const staged = pending.get(name);
    const previous = current ? baseState.files[name] : pendingState.files[name];
    regular(current);
    regular(staged);
    // Build directory membership once rather than scanning every tree for every mapped file.
    assert(!directories.has(name), 'Managed path collides with another entry');
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) {
      const ancestor = parts.slice(0, index).join('/');
      assert(!base.has(ancestor) && !pending.has(ancestor), 'Managed path collides with another entry');
    }
    if (claim.active && claim.mode !== 'remove') {
      if (claim.mode === 'sync' || (!current && !staged)) {
        desired.set(name, { path: name, mode: claim.permissions, type: 'blob', sha: claim.sha, content: claim.content });
        owned.set(name, { mode: claim.mode, sha: claim.sha, permissions: claim.permissions });
      } else {
        const preserved = current ?? staged;
        desired.set(name, preserved);
        if (previous) owned.set(name, previous);
      }
    } else if ((claim.active && claim.mode === 'remove') || claim.mode === 'sync') {
      // A sync mapping explicitly owns its destination, including on the first run.
      desired.delete(name);
    } else if (previous && unchanged(current ?? staged, previous)) {
      desired.delete(name);
    } else if (previous) {
      assert(current, 'Customized file exists only on the sync branch; merge or revert it before cleanup');
      warnings.push(`Preserved modified create-if-missing file: ${name}`);
    }
  }
  for (const [name, previous] of Object.entries({ ...pendingState.files, ...baseState.files })) {
    if (claims.has(name)) continue;
    const existing = base.get(name) ?? pending.get(name);
    regular(existing);
    if (unchanged(existing, previous)) desired.delete(name);
    else if (existing) {
      assert(base.has(name), 'Customized file exists only on the sync branch; merge or revert it before cleanup');
      warnings.push(`Preserved modified file removed from policy: ${name}`);
    }
  }
  if (owned.size > 0 || base.has(STATE_PATH) || differences(base, desired).length > 0) {
    const content = Buffer.from(`${JSON.stringify({ version: 1, id: policy.id,
      files: Object.fromEntries([...owned].sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
    desired.set(STATE_PATH, { path: STATE_PATH, mode: '100644', type: 'blob', sha: blobSha(content), content });
  } else {
    desired.delete(STATE_PATH);
  }
  return { desired, changes: differences(base, desired), pendingChanges: differences(pending, desired), allowed, warnings };
}

module.exports = { buildPlan, differences, leafEntries, readState, regular };
