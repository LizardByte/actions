const { STATE_PATH, assert, matches, properties } = require('./config.js');
const { buildPlan, leafEntries, readState, regular } = require('./planner.js');

async function optionalRef(github, coordinates, branch) {
  try {
    return (await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { ...coordinates, ref: `heads/${branch}` })).data.object.sha;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function snapshot(github, coordinates, sha, id) {
  const commit = (await github.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
    { ...coordinates, commit_sha: sha })).data;
  const tree = (await github.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
    { ...coordinates, tree_sha: commit.tree.sha, recursive: 'true' })).data;
  const entries = leafEntries(tree);
  const stateEntry = tree.tree.find(entry => entry.path === STATE_PATH);
  regular(stateEntry);
  let stateContent = null;
  if (stateEntry) {
    const blob = (await github.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
      { ...coordinates, file_sha: stateEntry.sha })).data;
    assert(blob.encoding === 'base64', 'Unexpected state blob encoding');
    stateContent = Buffer.from(blob.content, 'base64').toString('utf8');
  }
  return { sha, treeSha: commit.tree.sha, entries, state: readState(stateContent, id), hasState: !!stateEntry };
}

function eligible(repo, policy, source) {
  return (!repo.private || policy.include_private) && (!repo.archived || policy.include_archived)
    && (!repo.fork || policy.include_forks)
    && (policy.include_source || repo.full_name.toLowerCase() !== source.toLowerCase());
}

async function discover(github, policy, settings) {
  const { organization, repository, source } = settings;
  const orgs = policy.organizations.filter(org => !organization || org.toLowerCase() === organization.toLowerCase());
  assert(orgs.length > 0, 'Requested organization is outside the configured list');
  if (repository) {
    assert(orgs.some(org => org.toLowerCase() === repository.split('/')[0].toLowerCase())
      && policy.rules.some(rule => matches(rule, repository)), 'Requested repository is outside the configured policy');
  }
  const candidates = new Map();
  const results = [];
  const add = (repo, values) => {
    try {
      assert(repo.id && typeof repo.full_name === 'string'
        && orgs.some(org => org.toLowerCase() === repo.owner.login.toLowerCase()), 'Unexpected canonical repository owner');
      const selected = properties(values, settings);
      if (selected.included) candidates.set(repo.id, { repo, selected });
      else results.push({ repository: repo.private ? '[private repository]' : repo.full_name, status: 'excluded' });
    } catch (error) {
      results.push({ repository: repo.private ? '[private repository]' : repo.full_name, status: 'failed',
        error: repo.private ? 'Private repository property discovery failed' : error.message });
    }
  };
  const exact = new Set();
  for (const org of orgs) {
    const wide = !repository && policy.rules.some(rule => !rule.repositories
      && rule.organizations.some(owner => owner.toLowerCase() === org.toLowerCase()));
    if (wide) {
      try {
        const repos = await github.paginate('GET /orgs/{org}/repos', { org, type: 'all', per_page: 100 });
        const values = await github.paginate('GET /orgs/{org}/properties/values', { org, per_page: 100 });
        const byId = new Map(values.map(item => [item.repository_id, item]));
        for (const repo of repos) {
          if (eligible(repo, policy, source) && policy.rules.some(rule => matches(rule, repo.full_name))) {
            const metadata = byId.get(repo.id);
            if (metadata?.repository_full_name.toLowerCase() !== repo.full_name.toLowerCase()) {
              results.push({ repository: repo.private ? '[private repository]' : repo.full_name,
                status: 'failed', error: 'Incomplete property inventory' });
            } else add(repo, metadata.properties);
          }
        }
      } catch (error) {
        results.push({ repository: `${org}/*`, status: 'failed', error: error.message });
      }
    } else {
      for (const rule of policy.rules) {
        for (const name of rule.repositories ?? []) {
          if (name.split('/')[0].toLowerCase() === org.toLowerCase()) exact.add(name);
        }
      }
    }
  }
  if (repository) {
    exact.clear();
    exact.add(repository);
  }
  for (const name of exact) {
    const [owner, repo] = name.split('/');
    let metadata;
    try {
      metadata = (await github.request('GET /repos/{owner}/{repo}', { owner, repo })).data;
      assert(metadata.full_name.toLowerCase() === name.toLowerCase(), 'Exact repository target was renamed or transferred');
      if (!eligible(metadata, policy, source)) continue;
      const values = (await github.request('GET /repos/{owner}/{repo}/properties/values', { owner, repo })).data;
      add(metadata, values);
    } catch (error) {
      results.push({ repository: !metadata || metadata.private ? '[unavailable repository]' : name, status: 'failed',
        error: !metadata || metadata.private ? 'Repository lookup failed' : error.message });
    }
  }
  return { candidates: [...candidates.values()], results };
}

async function syncRepository(github, policy, candidate, settings) {
  const { dryRun, branch, title } = settings;
  const { repo, selected } = candidate;
  const coordinates = { owner: repo.owner.login, repo: repo.name };
  assert(branch !== repo.default_branch, 'The sync branch cannot be the default branch');
  const baseSha = await optionalRef(github, coordinates, repo.default_branch);
  assert(baseSha, 'Initialize the target default branch before synchronization');
  const base = await snapshot(github, coordinates, baseSha, policy.id);
  const pendingSha = await optionalRef(github, coordinates, branch);
  const pending = pendingSha && pendingSha !== baseSha ? await snapshot(github, coordinates, pendingSha, policy.id) : base;
  if (pendingSha) assert(pending.hasState, 'Existing sync branch is not owned by this action');
  const plan = buildPlan({ policy, fullName: repo.full_name, selected: selected.profiles,
    base: base.entries, pending: pending.entries, baseState: base.state, pendingState: pending.state });
  if (pendingSha && pendingSha !== baseSha) {
    const comparison = (await github.request('GET /repos/{owner}/{repo}/compare/{basehead}',
      { ...coordinates, basehead: `${baseSha}...${pendingSha}`, per_page: 1 })).data;
    assert(Array.isArray(comparison.files) && comparison.files.length < 300, 'Incomplete sync branch comparison');
    assert(comparison.files.every(file => plan.allowed.has(file.filename)
      && (!file.previous_filename || plan.allowed.has(file.previous_filename))), 'Sync branch contains unrelated edits');
  }
  const changes = plan.changes.map(change => ({ path: change.path,
    operation: !change.after ? 'remove' : change.before ? 'update' : 'create' }));
  const result = { repository: repo.full_name, status: 'unchanged', changes, warnings: plan.warnings };
  if (dryRun) return { ...result, status: plan.pendingChanges.length || changes.length ? 'planned' : 'unchanged' };

  // Re-read property values before writes so a queued run cannot ignore a new opt-out/profile change.
  const identity = (await github.request('GET /repos/{owner}/{repo}', coordinates)).data;
  assert(identity.id === repo.id && identity.full_name.toLowerCase() === repo.full_name.toLowerCase()
    && identity.default_branch === repo.default_branch && identity.private === repo.private
    && identity.archived === repo.archived && identity.fork === repo.fork,
  'Repository identity or eligibility changed; rerun synchronization');
  const fresh = properties((await github.request('GET /repos/{owner}/{repo}/properties/values', coordinates)).data, settings);
  assert(fresh.included === selected.included
    && JSON.stringify([...fresh.profiles].sort()) === JSON.stringify([...selected.profiles].sort()), 'Properties changed; rerun synchronization');
  const marker = `<!-- org-sync:${policy.id} -->`;
  const pullRequests = await github.paginate('GET /repos/{owner}/{repo}/pulls',
    { ...coordinates, state: 'open', head: `${coordinates.owner}:${branch}`, base: repo.default_branch, per_page: 100 });
  assert(pullRequests.length <= 1, 'Multiple open sync pull requests');
  const existing = pullRequests[0];
  assert(!existing || existing.body?.includes(marker), 'Existing pull request is not owned by this action');
  if (changes.length === 0) {
    if (existing) {
      await github.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
        { ...coordinates, pull_number: existing.number, state: 'closed' });
      result.status = 'closed';
    }
    return result;
  }
  let branchChanged = false;
  if (plan.pendingChanges.length > 0) {
    const knownBlobs = new Set([...base.entries.values(), ...pending.entries.values()].map(entry => entry.sha));
    const treeEntries = [];
    for (const change of plan.changes) {
      if (change.after && !knownBlobs.has(change.after.sha)) {
        assert(Buffer.isBuffer(change.after.content), 'Missing source bytes for a new blob');
        const blob = (await github.request('POST /repos/{owner}/{repo}/git/blobs',
          { ...coordinates, content: change.after.content.toString('base64'), encoding: 'base64' })).data;
        assert(blob.sha === change.after.sha, 'GitHub blob hash differs from source bytes');
        knownBlobs.add(blob.sha);
      }
      treeEntries.push({ path: change.path, mode: (change.after ?? change.before).mode,
        type: 'blob', sha: change.after?.sha ?? null });
    }
    const tree = (await github.request('POST /repos/{owner}/{repo}/git/trees',
      { ...coordinates, base_tree: base.treeSha, tree: treeEntries })).data;
    const parents = [...new Set([pendingSha, baseSha].filter(Boolean))];
    const commit = (await github.request('POST /repos/{owner}/{repo}/git/commits',
      { ...coordinates, message: `${title}\n\n${marker}`, tree: tree.sha, parents })).data;
    assert(await optionalRef(github, coordinates, repo.default_branch) === baseSha, 'Default branch advanced; rerun synchronization');
    if (pendingSha) {
      // This is a fast-forward from the observed bot head, never a force push.
      await github.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}',
        { ...coordinates, ref: `heads/${branch}`, sha: commit.sha, force: false });
    } else {
      await github.request('POST /repos/{owner}/{repo}/git/refs',
        { ...coordinates, ref: `refs/heads/${branch}`, sha: commit.sha });
    }
    branchChanged = true;
  }
  const body = `${marker}\nSynchronize the configured shared files and workflow profiles.\n\n`
    + changes.map(change => `- ${change.operation}: \`${change.path}\``).join('\n');
  if (!existing) {
    const created = (await github.request('POST /repos/{owner}/{repo}/pulls',
      { ...coordinates, base: repo.default_branch, head: branch, title, body })).data;
    result.pull_request = created.html_url;
    result.status = 'updated';
  } else {
    result.pull_request = existing.html_url;
    if (existing.body !== body || existing.title !== title) {
      await github.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
        { ...coordinates, pull_number: existing.number, title, body });
      result.status = 'updated';
    }
  }
  if (branchChanged) result.status = 'updated';
  return result;
}

module.exports = { discover, eligible, optionalRef, snapshot, syncRepository };
