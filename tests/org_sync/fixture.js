const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
import { jest } from '@jest/globals';
const { blobSha, STATE_PATH } = require('../../actions/org_sync/config.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'org-sync-'));
  const repos = new Map();
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  let serial = 0;
  const hash = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
  const makeBlob = content => {
    const buffer = Buffer.from(content);
    const sha = blobSha(buffer);
    blobs.set(sha, buffer);
    return sha;
  };
  const makeCommit = (entries, parents = []) => {
    const treeSha = hash([...entries].sort());
    trees.set(treeSha, new Map(entries));
    const sha = hash({ treeSha, parents, serial: serial++ });
    commits.set(sha, { sha, tree: { sha: treeSha }, parents });
    return sha;
  };
  const fileEntries = files => new Map(Object.entries(files).map(([name, value]) => {
    const content = typeof value === 'object' && !Buffer.isBuffer(value) ? value.content : value;
    return [name, { path: name, mode: value.mode || '100644', type: 'blob', sha: makeBlob(content) }];
  }));
  const add = (fullName = 'org/app', files = {}, profiles = [], flags = {}) => {
    const [owner, name] = fullName.split('/');
    const repo = { id: repos.size + 1, name, full_name: fullName, owner: { login: owner }, default_branch: 'main',
      private: false, archived: false, fork: false, ...flags };
    repo.refs = new Map([['main', makeCommit(fileEntries(files))]]);
    repo.profiles = profiles;
    repo.syncMode = 'included';
    repo.pulls = [];
    repos.set(fullName.toLowerCase(), repo);
    return repo;
  };
  const entries = (repo, branch = 'main') => new Map(trees.get(commits.get(repo.refs.get(branch)).tree.sha));
  const advance = (repo, changes, branch = 'main') => {
    const current = entries(repo, branch);
    for (const [name, content] of Object.entries(changes)) {
      if (content === null) current.delete(name);
      else current.set(name, fileEntries({ [name]: content }).get(name));
    }
    const sha = makeCommit(current, [repo.refs.get(branch)]);
    repo.refs.set(branch, sha);
    return sha;
  };
  const ancestors = sha => {
    const found = new Map();
    const queue = [[sha, 0]];
    for (let index = 0; index < queue.length; index++) {
      const [current, depth] = queue[index];
      if (found.has(current)) continue;
      found.set(current, depth);
      for (const parent of commits.get(current).parents) queue.push([parent, depth + 1]);
    }
    return found;
  };
  const propertyValues = repo => repo.values ?? [
    { property_name: 'sync_mode', value: repo.syncMode },
    { property_name: 'workflow_profiles', value: repo.profiles },
  ];
  const api = {
    root, repos, blobs, trees, commits, add, advance, entries, hook: null,
    write(name, content) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), content);
    },
    policy(policy = { version: 1, rules: [{ id: 'docs', profile: 'docs', files: [{ source: 'workflow.yml', destination: '.github/workflows/docs.yml' }] }] }) {
      api.write('organizations.json', JSON.stringify(['org', 'other']));
      api.write('policy.json', JSON.stringify(policy));
      api.write('workflow.yml', 'shared workflow\n');
      return policy;
    },
    content(repo, name, branch = 'bot/org-sync-files') {
      const entry = entries(repo, branch).get(name);
      return entry ? blobs.get(entry.sha).toString('utf8') : null;
    },
    merge(repo) {
      repo.refs.set('main', repo.refs.get('bot/org-sync-files'));
      for (const pr of repo.pulls) pr.state = 'closed';
    },
    state(repo, files, branch = 'main') {
      return advance(repo, { [STATE_PATH]: JSON.stringify({ version: 1, id: 'org-sync', files }) }, branch);
    },
    env(extra = {}) {
      return { INPUT_SOURCE_DIRECTORY: root, INPUT_CONFIG: 'policy.json', ...extra };
    },
    core: { setFailed: jest.fn(), setOutput: jest.fn(), info: jest.fn(), warning: jest.fn(), error: jest.fn() },
    context: { repo: { owner: 'org', repo: 'source' } },
  };
  const notFound = () => Object.assign(new Error('Not found'), { status: 404 });
  const coordinates = args => {
    const repo = repos.get(`${args.owner}/${args.repo}`.toLowerCase());
    if (!repo) throw notFound();
    return repo;
  };
  api.github = {
    paginate: jest.fn(async (route, args) => {
      if (route === 'GET /orgs/{org}/repos') return [...repos.values()].filter(repo => repo.owner.login === args.org);
      if (route === 'GET /orgs/{org}/properties/values') return [...repos.values()].filter(repo => repo.owner.login === args.org)
        .map(repo => ({ repository_id: repo.id, repository_full_name: repo.full_name, properties: propertyValues(repo) }));
      if (route === 'GET /repos/{owner}/{repo}/pulls') return coordinates(args).pulls.filter(pr => pr.state === 'open');
      throw new Error(`Unexpected pagination: ${route}`);
    }),
    request: jest.fn(async (route, args) => {
      if (api.hook) await api.hook(route, args);
      const repo = coordinates(args);
      const get = data => ({ data });
      switch (route) {
        case 'GET /repos/{owner}/{repo}': return get(repo);
        case 'GET /repos/{owner}/{repo}/properties/values': return get(propertyValues(repo));
        case 'GET /repos/{owner}/{repo}/git/ref/{ref}': {
          const sha = repo.refs.get(args.ref.replace(/^heads\//, ''));
          if (!sha) throw notFound();
          return get({ object: { sha } });
        }
        case 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}': return get(commits.get(args.commit_sha));
        case 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}':
          return get({ tree: [...trees.get(args.tree_sha).values()], truncated: repo.truncated || false });
        case 'GET /repos/{owner}/{repo}/git/blobs/{file_sha}': return get({ content: blobs.get(args.file_sha).toString('base64'), encoding: 'base64' });
        case 'GET /repos/{owner}/{repo}/compare/{basehead}': {
          const [base, head] = args.basehead.split('...');
          const baseAncestors = ancestors(base);
          const common = [...ancestors(head)].filter(([sha]) => baseAncestors.has(sha))
            .sort(([a, ad], [b, bd]) => ad + baseAncestors.get(a) - bd - baseAncestors.get(b))[0][0];
          const before = trees.get(commits.get(common).tree.sha);
          const after = trees.get(commits.get(head).tree.sha);
          return get({ files: [...new Set([...before.keys(), ...after.keys()])]
            .filter(name => before.get(name)?.sha !== after.get(name)?.sha || before.get(name)?.mode !== after.get(name)?.mode)
            .map(filename => ({ filename })) });
        }
        case 'POST /repos/{owner}/{repo}/git/blobs': return get({ sha: makeBlob(Buffer.from(args.content, args.encoding)) });
        case 'POST /repos/{owner}/{repo}/git/trees': {
          const tree = new Map(trees.get(args.base_tree));
          for (const entry of args.tree) {
            if (entry.sha === null) tree.delete(entry.path);
            else tree.set(entry.path, entry);
          }
          const sha = hash([...tree].sort());
          trees.set(sha, tree);
          return get({ sha });
        }
        case 'POST /repos/{owner}/{repo}/git/commits': return get({ sha: makeCommit(trees.get(args.tree), args.parents) });
        case 'POST /repos/{owner}/{repo}/git/refs': {
          const branch = args.ref.replace(/^refs\/heads\//, '');
          if (repo.refs.has(branch)) throw Object.assign(new Error('Reference exists'), { status: 422 });
          repo.refs.set(branch, args.sha);
          return get({});
        }
        case 'PATCH /repos/{owner}/{repo}/git/refs/{ref}': {
          const branch = args.ref.replace(/^heads\//, '');
          if (args.force || !ancestors(args.sha).has(repo.refs.get(branch))) throw Object.assign(new Error('Not a fast-forward'), { status: 409 });
          repo.refs.set(branch, args.sha);
          return get({});
        }
        case 'POST /repos/{owner}/{repo}/pulls': {
          const pr = { ...args, number: repo.pulls.length + 1, state: 'open', html_url: `https://github.com/${repo.full_name}/pull/${repo.pulls.length + 1}` };
          repo.pulls.push(pr);
          return get(pr);
        }
        case 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}': {
          const pr = repo.pulls.find(item => item.number === args.pull_number);
          Object.assign(pr, args);
          return get(pr);
        }
        default: throw new Error(`Unexpected request: ${route}`);
      }
    }),
  };
  api.run = async (extra = {}) => require('../../actions/org_sync/org_sync.js')({
    github: api.github, context: api.context, core: api.core, env: api.env(extra),
  });
  api.writes = () => api.github.request.mock.calls.filter(([route]) => !route.startsWith('GET '));
  api.cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return api;
}

module.exports = { fixture };
