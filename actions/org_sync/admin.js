const { loadAdministration } = require('./admin-config.js');
const { AdminError, check, applyOperations } = require('./admin-common.js');
const { planSchemas } = require('./schemas.js');
const { validateSettings, resolveSettings, planSettings } = require('./settings.js');
const { variableValues, planCredentials } = require('./credentials.js');
const { mapConcurrent } = require('./concurrency.js');
const { resolveResources, planResources } = require('./resources.js');

function inputs(env) {
  check(['true', 'false', undefined, ''].includes(env.INPUT_DRY_RUN), 'dry_run must be true or false');
  check(['true', 'false', undefined, ''].includes(env.INPUT_SYNC_FILES), 'sync_files must be true or false');
  check(env.INPUT_SYNC_FILES !== 'false' || env.INPUT_PROPERTIES_FILE || env.INPUT_ADMIN_CONFIG,
    'Select file synchronization or an administration configuration');
  check(!env.INPUT_SECRET_VALUES || env.INPUT_ADMIN_CONFIG, 'secret_values requires admin_config');
  const concurrency = Number(env.INPUT_CONCURRENCY || 3);
  check(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10, 'Concurrency must be between 1 and 10');
  return { dryRun: env.INPUT_DRY_RUN === 'true', concurrency };
}

async function prepare(github, loaded, env) {
  const active = loaded.organizations.filter(org => loaded.config.organizations.some(name => name.toLowerCase() === org.toLowerCase()));
  const config = { ...loaded.config, variables: loaded.config.variables.filter(entry =>
    entry.organizations.some(org => active.some(target => target.toLowerCase() === org.toLowerCase()))) };
  validateSettings(config);
  if (!active.length) return config;
  const source = env.INPUT_SOURCE_TOKEN ? new github.constructor({ auth: env.INPUT_SOURCE_TOKEN,
    baseUrl: env.GITHUB_API_URL || 'https://api.github.com' }) : github;
  return variableValues(source, await resolveResources(source, await resolveSettings(source, config)));
}

async function planOrganization(github, org, loaded, config, dryRun) {
  const result = { organization: org, status: 'unchanged', changes: [], warnings: [] };
  try {
    const schema = await planSchemas(github, org, loaded.schema);
    let administration = [];
    if (config.organizations.some(name => name.toLowerCase() === org.toLowerCase())) {
      administration = [...await planSettings(github, org, config),
        ...await planCredentials(github, org, config, loaded.secretValues, dryRun, result.warnings),
        ...await planResources(github, org, config, loaded.secretValues, dryRun, result.warnings)];
    }
    return { result, operations: [...schema, ...administration] };
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof AdminError ? error.message : 'Organization administration planning failed';
    return { result, operations: [] };
  }
}

async function execute(plan, dryRun) {
  if (plan.result.status === 'failed') return plan.result;
  try {
    await applyOperations(plan.operations, plan.result.changes, dryRun);
    if (plan.operations.length) plan.result.status = dryRun ? 'planned' : 'updated';
  } catch (error) {
    plan.result.status = 'failed';
    plan.result.error = error instanceof AdminError ? error.message : 'Organization administration delivery failed';
  }
  return plan.result;
}

async function run({ github, core, env = process.env }) {
  try {
    const settings = inputs(env);
    if (!env.INPUT_PROPERTIES_FILE && !env.INPUT_ADMIN_CONFIG) return [];
    const loaded = loadAdministration(env, core);
    const config = await prepare(github, loaded, env);
    // Plan every organization first so configuration/source errors cannot appear after delivery starts.
    const plans = await mapConcurrent(loaded.organizations, settings.concurrency,
      org => planOrganization(github, org, loaded, config, settings.dryRun));
    const results = await mapConcurrent(plans, settings.concurrency, plan => execute(plan, settings.dryRun));
    core.setOutput('organization_results', JSON.stringify(results));
    core.setOutput('changed_organizations', results.filter(result => ['planned', 'updated'].includes(result.status)).length);
    const failures = results.filter(result => result.status === 'failed');
    core.setOutput('failed_organizations', failures.length);
    for (const result of results) {
      core.info(`${result.organization}: administration ${result.status}`);
      if (result.error) core.error(`${result.organization}: ${result.error}`);
    }
    if (failures.length) core.setFailed(`${failures.length} organizations failed administration; inspect organization_results`);
    return results;
  } catch (error) {
    // Never expose raw API/JSON/crypto errors: their messages can contain credential values.
    core.setFailed(error instanceof AdminError ? error.message : 'Organization administration configuration failed');
    return [];
  }
}

module.exports = run;
Object.assign(module.exports, { inputs });
