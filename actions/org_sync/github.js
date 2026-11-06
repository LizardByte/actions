const { STATE_PATH, assert, matches, properties } = require('./config.js');
const { buildPlan, leafEntries, readState, regular } = require('./planner.js');
const { mapConcurrent } = require('./concurrency.js');

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

function discoveryTargets(policy, orgs, repository) {
  if (repository) return { wide: [], exact: [repository] };
  const wide = orgs.filter(org => policy.rules.some(rule => !rule.repositories
    && rule.organizations.some(owner => owner.toLowerCase() === org.toLowerCase())));
  const orgNames = new Set(orgs.map(org => org.toLowerCase()));
  const wideNames = new Set(wide.map(org => org.toLowerCase()));
  const exact = new Set();
  for (const rule of policy.rules) {
    for (const name of rule.repositories ?? []) {
      const owner = name.split('/')[0].toLowerCase();
      if (orgNames.has(owner) && !wideNames.has(owner)) exact.add(name);
    }
  }
  return { wide, exact: [...exact] };
}

function addCandidate(discovery, repo, values) {
  const { orgs, settings, candidates, results } = discovery;
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
}

async function discoverOrganization(discovery, org) {
  const { github, policy, settings, results } = discovery;
  try {
    const [repos, values] = await Promise.all([
      github.paginate('GET /orgs/{org}/repos', { org, type: 'all', per_page: 100 }),
      github.paginate('GET /orgs/{org}/properties/values', { org, per_page: 100 }),
    ]);
    const byId = new Map(values.map(item => [item.repository_id, item]));
    for (const repo of repos) {
      if (!eligible(repo, policy, settings.source) || !policy.rules.some(rule => matches(rule, repo.full_name))) continue;
      const metadata = byId.get(repo.id);
      if (metadata?.repository_full_name.toLowerCase() !== repo.full_name.toLowerCase()) {
        results.push({ repository: repo.private ? '[private repository]' : repo.full_name,
          status: 'failed', error: 'Incomplete property inventory' });
      } else addCandidate(discovery, repo, metadata.properties);
    }
  } catch (error) {
    results.push({ repository: `${org}/*`, status: 'failed', error: error.message });
  }
}

async function discoverRepository(discovery, name) {
  const { github, policy, settings, results } = discovery;
  const [owner, repo] = name.split('/');
  let metadata;
  try {
    metadata = (await github.request('GET /repos/{owner}/{repo}', { owner, repo })).data;
    assert(metadata.full_name.toLowerCase() === name.toLowerCase(), 'Exact repository target was renamed or transferred');
    if (!eligible(metadata, policy, settings.source)) return;
    const values = (await github.request('GET /repos/{owner}/{repo}/properties/values', { owner, repo })).data;
    addCandidate(discovery, metadata, values);
  } catch (error) {
    results.push({ repository: !metadata || metadata.private ? '[unavailable repository]' : name, status: 'failed',
      error: !metadata || metadata.private ? 'Repository lookup failed' : error.message });
  }
}

async function discover(github, policy, settings) {
  const { organization, repository } = settings;
  const orgs = policy.organizations.filter(org => !organization || org.toLowerCase() === organization.toLowerCase());
  assert(orgs.length > 0, 'Requested organization is outside the configured list');
  if (repository) {
    assert(orgs.some(org => org.toLowerCase() === repository.split('/')[0].toLowerCase())
      && policy.rules.some(rule => matches(rule, repository)), 'Requested repository is outside the configured policy');
  }
  const discovery = { github, policy, settings, orgs, candidates: new Map(), results: [] };
  const targets = discoveryTargets(policy, orgs, repository);
  const concurrency = settings.concurrency ?? 3;
  await mapConcurrent(targets.wide, concurrency, org => discoverOrganization(discovery, org));
  await mapConcurrent(targets.exact, concurrency, name => discoverRepository(discovery, name));
  return { candidates: [...discovery.candidates.values()], results: discovery.results };
}

async function prepareRepository(github, policy, candidate, branch) {
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
  return { coordinates, baseSha, pendingSha, base, pending, plan };
}

async function validateTarget(github, candidate, coordinates, settings) {
  const { repo, selected } = candidate;
  const identity = (await github.request('GET /repos/{owner}/{repo}', coordinates)).data;
  assert(identity.id === repo.id && identity.full_name.toLowerCase() === repo.full_name.toLowerCase()
    && identity.default_branch === repo.default_branch && identity.private === repo.private
    && identity.archived === repo.archived && identity.fork === repo.fork,
  'Repository identity or eligibility changed; rerun synchronization');
  const fresh = properties((await github.request('GET /repos/{owner}/{repo}/properties/values', coordinates)).data, settings);
  assert(fresh.included === selected.included && fresh.profiles.size === selected.profiles.size
    && [...fresh.profiles].every(profile => selected.profiles.has(profile)), 'Properties changed; rerun synchronization');
}

async function ownedPullRequest(github, coordinates, branch, base, marker) {
  const pullRequests = await github.paginate('GET /repos/{owner}/{repo}/pulls',
    { ...coordinates, state: 'open', head: `${coordinates.owner}:${branch}`, base, per_page: 100 });
  assert(pullRequests.length <= 1, 'Multiple open sync pull requests');
  const existing = pullRequests[0];
  assert(!existing || existing.body?.includes(marker), 'Existing pull request is not owned by this action');
  return existing;
}

function describeChange(change) {
  let operation = 'create';
  if (!change.after) operation = 'remove';
  else if (change.before) operation = 'update';
  return { path: change.path, operation };
}

async function uploadBlobs(github, prepared) {
  const { coordinates, base, pending, plan } = prepared;
  const knownBlobs = new Set([...base.entries.values(), ...pending.entries.values()].map(entry => entry.sha));
  const newBlobs = new Map();
  for (const change of plan.changes) {
    if (change.after && !knownBlobs.has(change.after.sha)) newBlobs.set(change.after.sha, change.after);
  }
  // Deduplicate by hash before starting independent uploads, capped per repository.
  await mapConcurrent([...newBlobs.values()], 3, async entry => {
    assert(Buffer.isBuffer(entry.content), 'Missing source bytes for a new blob');
    const blob = (await github.request('POST /repos/{owner}/{repo}/git/blobs',
      { ...coordinates, content: entry.content.toString('base64'), encoding: 'base64' })).data;
    assert(blob.sha === entry.sha, 'GitHub blob hash differs from source bytes');
  });
}

async function publishBranch(github, prepared, repo, { branch, title }, marker) {
  const { coordinates, base, baseSha, pendingSha, plan } = prepared;
  await uploadBlobs(github, prepared);
  const treeEntries = plan.changes.map(change => ({ path: change.path, mode: (change.after ?? change.before).mode,
    type: 'blob', sha: change.after?.sha ?? null }));
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
}

async function deliverPullRequest(github, coordinates, repo, settings, marker, existing, result) {
  const { branch, title } = settings;
  const body = `${marker}\nSynchronize the configured shared files and workflow profiles.\n\n`
    + result.changes.map(change => `- ${change.operation}: \`${change.path}\``).join('\n');
  if (!existing) {
    const created = (await github.request('POST /repos/{owner}/{repo}/pulls',
      { ...coordinates, base: repo.default_branch, head: branch, title, body })).data;
    result.pull_request = created.html_url;
    result.status = 'updated';
    return;
  }
  result.pull_request = existing.html_url;
  if (existing.body !== body || existing.title !== title) {
    await github.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
      { ...coordinates, pull_number: existing.number, title, body });
    result.status = 'updated';
  }
}

async function syncRepository(github, policy, candidate, settings) {
  const { dryRun, branch } = settings;
  const { repo } = candidate;
  const prepared = await prepareRepository(github, policy, candidate, branch);
  const { coordinates, plan } = prepared;
  const changes = plan.changes.map(describeChange);
  const result = { repository: repo.full_name, status: 'unchanged', changes, warnings: plan.warnings };
  if (dryRun) return { ...result, status: plan.pendingChanges.length || changes.length ? 'planned' : 'unchanged' };
  // Queued work must still honor the current repository identity and properties.
  await validateTarget(github, candidate, coordinates, settings);
  const marker = `<!-- org-sync:${policy.id} -->`;
  const existing = await ownedPullRequest(github, coordinates, branch, repo.default_branch, marker);
  if (changes.length === 0) {
    if (existing) {
      await github.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
        { ...coordinates, pull_number: existing.number, state: 'closed' });
      result.status = 'closed';
    }
    return result;
  }
  const branchChanged = plan.pendingChanges.length > 0;
  if (branchChanged) await publishBranch(github, prepared, repo, settings, marker);
  await deliverPullRequest(github, coordinates, repo, settings, marker, existing, result);
  if (branchChanged) result.status = 'updated';
  return result;
}

module.exports = { discover, eligible, optionalRef, snapshot, syncRepository };
