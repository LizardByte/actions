const path = require('node:path');
const { assert, loadConfig } = require('./config.js');
const { discover, syncRepository } = require('./github.js');
const { mapConcurrent } = require('./concurrency.js');

function booleanInput(value, defaultValue) {
  if (value === undefined || value === '') return defaultValue;
  assert(value === 'true' || value === 'false', 'Boolean inputs must be true or false');
  return value === 'true';
}

function options(env) {
  const branch = env.INPUT_BRANCH || 'bot/org-sync-files';
  assert(/^[\w/-]+$/.test(branch) && !branch.startsWith('/') && !branch.endsWith('/') && !branch.includes('//'), 'Invalid sync branch');
  const concurrency = Number(env.INPUT_CONCURRENCY || 3);
  assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10, 'Concurrency must be between 1 and 10');
  const title = env.INPUT_PR_TITLE || 'chore: sync shared files';
  assert(title.trim() && !/[\r\n]/.test(title), 'Invalid pull request title');
  const repository = env.INPUT_REPOSITORY || '';
  assert(!repository || (/^[a-z\d][a-z\d-]*\/[\w.-]+$/i.test(repository)
    && !['.', '..'].includes(repository.split('/')[1])), 'Invalid repository input');
  const propertyNames = { syncModeProperty: env.INPUT_SYNC_MODE_PROPERTY || 'sync_mode',
    workflowProfilesProperty: env.INPUT_WORKFLOW_PROFILES_PROPERTY || 'workflow_profiles' };
  assert(Object.values(propertyNames).every(name => typeof name === 'string' && name.length > 0 && !/\s/.test(name)),
    'Custom property names must be nonempty strings without whitespace');
  assert(propertyNames.syncModeProperty !== propertyNames.workflowProfilesProperty, 'Custom property names must differ');
  return { branch, concurrency, title, dryRun: booleanInput(env.INPUT_DRY_RUN, false),
    organization: env.INPUT_ORGANIZATION || '', repository, ...propertyNames };
}

async function run({ github, context, core, env = process.env }) {
  try {
    const settings = options(env);
    const policy = loadConfig({ sourceDirectory: path.resolve(env.INPUT_SOURCE_DIRECTORY || env.GITHUB_WORKSPACE || '.'),
      configFile: env.INPUT_CONFIG || '.github/file-sync.json', organizationsFile: env.INPUT_ORGANIZATIONS_FILE || 'organizations.json' });
    const found = await discover(github, policy, { ...settings, source: `${context.repo.owner}/${context.repo.repo}` });
    const results = found.results;
    results.push(...await mapConcurrent(found.candidates, settings.concurrency, async candidate => {
      let result;
      try {
        result = await syncRepository(github, policy, candidate, settings);
      } catch (error) {
        result = { repository: candidate.repo.full_name, status: 'failed', error: error.message };
      }
      if (candidate.repo.private) {
        result = { repository: '[private repository]', status: result.status };
      }
      return result;
    }));
    results.sort((left, right) => left.repository.localeCompare(right.repository));
    core.setOutput('results', JSON.stringify(results));
    core.setOutput('changed_repositories', results.filter(result => ['updated', 'closed', 'planned'].includes(result.status)).length);
    const failures = results.filter(result => result.status === 'failed');
    core.setOutput('failed_repositories', failures.length);
    for (const result of results) {
      core.info(`${result.repository}: ${result.status}`);
      if (result.error) core.error(`${result.repository}: ${result.error}`);
      for (const warning of result.warnings ?? []) core.warning(`${result.repository}: ${warning}`);
    }
    if (failures.length) core.setFailed(`${failures.length} repositories failed synchronization; inspect the results output`);
    return results;
  } catch (error) {
    core.setFailed(error.message);
    return [];
  }
}

module.exports = run;
Object.assign(module.exports, { booleanInput, options });
