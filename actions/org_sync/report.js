const { mkdir, mkdtemp, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/**
 * Save preview or delivery results and publish a summary for any action consumer.
 * Failed sync steps can still provide partial results for the other organizations.
 *
 * @param {object} options Actions core/context, step environment, and optional output directory.
 * @returns {Promise<object>} The report written to the artifact.
 */
async function writeSyncReport({ core, context, env = process.env, outputDirectory }) {
  if (!['true', 'false'].includes(env.SYNC_DRY_RUN)) {
    throw new TypeError('Expected an explicit file sync dry-run mode');
  }
  const results = JSON.parse(env.SYNC_RESULTS || '[]');
  const organizationResults = JSON.parse(env.SYNC_ADMIN_RESULTS || '[]');
  if (!Array.isArray(results)) {
    throw new TypeError('Expected an array of file sync results');
  }
  if (!Array.isArray(organizationResults)) throw new TypeError('Expected an array of organization sync results');
  const report = {
    dry_run: env.SYNC_DRY_RUN === 'true',
    source_commit: context.sha,
    source_ref: context.ref,
    organization: env.SYNC_ORGANIZATION || null,
    repository: env.SYNC_REPOSITORY || null,
    outcome: env.SYNC_OUTCOME,
    changed_repositories: Number(env.SYNC_CHANGED || 0),
    failed_repositories: Number(env.SYNC_FAILED || 0),
    results,
  };
  const administration = env.SYNC_ADMIN_ENABLED === 'true';
  if (administration || env.SYNC_PREPARATION_OUTCOME === 'failure') {
    report.organization_results = organizationResults;
    report.changed_organizations = Number(env.SYNC_ADMIN_CHANGED || 0);
    report.failed_organizations = Number(env.SYNC_ADMIN_FAILED || 0);
    report.outcome = [env.SYNC_OUTCOME, env.SYNC_ADMIN_OUTCOME, env.SYNC_PREPARATION_OUTCOME].includes('failure')
      ? 'failure' : 'success';
  }
  const directory = outputDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'org-sync-report-'));
  await mkdir(directory, { recursive: true });
  const reportFile = path.join(directory, 'results.json');
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const artifactName = `file-sync-${path.basename(directory)}`;
  core.setOutput('report_file', reportFile);
  core.setOutput('artifact_name', artifactName);
  const fileHeading = report.dry_run ? 'File sync preview' : 'File synchronization';
  core.summary.addHeading(administration ? 'Organization synchronization' : fileHeading);
  core.summary.addRaw(report.dry_run
    ? 'Dry run only. No organization or target repository state was written.\n\n'
    : 'Delivery enabled. Organization policies apply directly; file changes are proposed through target pull requests.\n\n');
  core.summary.addRaw(`Sync step outcome: **${report.outcome}**. See the step logs for failures.\n\n`);
  core.summary.addRaw(`Repositories changed or planned: **${report.changed_repositories}**; `
    + `failed targets: **${report.failed_repositories}**.\n\n`);
  core.summary.addTable([
    [
      { data: 'Repository', header: true },
      { data: 'Status', header: true },
      { data: 'File changes', header: true },
    ],
    ...results.map(result => [result.repository, result.status, String(result.changes?.length ?? 0)]),
  ]);
  if (administration) {
    core.summary.addRaw(`\nOrganizations changed or planned: **${report.changed_organizations}**; `
      + `failed organizations: **${report.failed_organizations}**.\n\n`);
    core.summary.addTable([
      [{ data: 'Organization', header: true }, { data: 'Status', header: true }, { data: 'Changes', header: true }],
      ...organizationResults.map(result => [result.organization, result.status, String(result.changes?.length ?? 0)]),
    ]);
  }
  core.summary.addRaw(`\nDownload the ${artifactName} artifact for exact paths, operations, warnings, errors, and PR URLs.\n`);
  await core.summary.write();
  return report;
}

module.exports = writeSyncReport;
