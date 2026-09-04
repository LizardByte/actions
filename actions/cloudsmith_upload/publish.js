const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_EXTENSION = /\.(deb|rpm)$/i;

/**
 * Parse a GitHub Action boolean input.
 *
 * @param {string|undefined} value Input value.
 * @param {boolean} fallback Value used for an empty input.
 * @returns {boolean} Parsed boolean.
 */
function parseBoolean(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`Expected a boolean input, received "${value}".`);
}

/**
 * Recursively find DEB and RPM files below the requested paths.
 *
 * @param {string[]} entries Files or directories to inspect.
 * @param {object} fsApi File-system implementation.
 * @returns {string[]} Sorted, unique absolute package paths.
 */
function listPackageFiles(entries, fsApi = fs) {
  const discovered = new Set();

  function visit(entry) {
    const absolute = path.resolve(entry);
    if (!fsApi.existsSync(absolute)) {
      throw new Error(`Package path does not exist: ${entry}`);
    }

    const stats = fsApi.statSync(absolute);
    if (stats.isDirectory()) {
      for (const child of fsApi.readdirSync(absolute)) {
        visit(path.join(absolute, child));
      }
    } else if (PACKAGE_EXTENSION.test(absolute)) {
      discovered.add(absolute);
    }
  }

  for (const entry of entries) {
    visit(entry);
  }
  return [...discovered].sort((left, right) => (left < right ? -1 : 1));
}

/**
 * Infer the Cloudsmith package format and distribution hint from a filename.
 *
 * @param {string} packagePath Package path.
 * @returns {object|null} Inferred target, or null when the name is unknown.
 */
function classifyPackage(packagePath) {
  const filename = path.basename(packagePath);
  const normalized = filename.toLowerCase();

  if (normalized.endsWith('.deb')) {
    const conventional = normalized.match(/\+(debian|ubuntu)([a-z0-9.]+)_[^_]+\.deb$/);
    const legacy = normalized.match(/-(debian|ubuntu)-([a-z0-9.]+)-[^-]+\.deb$/);
    const match = conventional || legacy;
    if (match) {
      return {
        distro: match[1],
        file: packagePath,
        filename,
        format: 'deb',
        releaseHint: match[2],
      };
    }
  }

  if (normalized.endsWith('.rpm')) {
    const fedora = normalized.match(/\.fc(\d+)\.[^.]+\.rpm$/);
    if (fedora) {
      return {
        distro: 'fedora',
        file: packagePath,
        filename,
        format: 'rpm',
        releaseHint: fedora[1],
      };
    }

    const leap = normalized.match(/\.suse\.lp(\d+)\.[^.]+\.rpm$/);
    if (leap) {
      const digits = leap[1];
      return {
        distro: 'opensuse',
        file: packagePath,
        filename,
        format: 'rpm',
        releaseHint: `${digits.slice(0, -1)}.${digits.slice(-1)}`,
      };
    }

    if (/\.suse\.(?:tw|tumbleweed)\.[^.]+\.rpm$/.test(normalized)) {
      return {
        distro: 'opensuse',
        file: packagePath,
        filename,
        format: 'rpm',
        releaseHint: 'tumbleweed',
      };
    }
  }

  return null;
}

/**
 * Match a filename release hint to a Cloudsmith distribution version.
 *
 * @param {string} releaseHint Release slug, codename, or numeric version.
 * @param {object[]} versions Cloudsmith distribution versions.
 * @returns {string|null} Cloudsmith version slug.
 */
function resolveDistributionVersion(releaseHint, versions) {
  const normalized = releaseHint.toLowerCase();
  const direct = versions.find((version) => String(version.slug).toLowerCase() === normalized);
  if (direct) {
    return direct.slug;
  }

  const byDisplayVersion = versions.find((version) => {
    const firstToken = String(version.name).trim().split(/\s+/)[0].toLowerCase();
    return firstToken === normalized;
  });
  return byDisplayVersion ? byDisplayVersion.slug : null;
}

/**
 * Read supported versions for one distribution from Cloudsmith.
 *
 * @param {string} apiHost Cloudsmith API host.
 * @param {string} distro Distribution slug.
 * @param {Function} fetchImpl Fetch implementation.
 * @returns {Promise<object[]>} Supported versions.
 */
async function fetchDistributionVersions(apiHost, distro, fetchImpl) {
  let host = apiHost;
  while (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  const apiBase = host.endsWith('/v1') ? host : `${host}/v1`;
  const response = await fetchImpl(`${apiBase}/distros/${distro}/`);
  if (!response.ok) {
    throw new Error(`Cloudsmith distribution lookup failed for ${distro}: HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.versions)) {
    throw new TypeError(`Cloudsmith distribution lookup returned no versions for ${distro}.`);
  }
  return payload.versions;
}

/**
 * Build Cloudsmith CLI arguments for one package.
 *
 * @param {object} target Resolved upload target.
 * @param {object} options Upload options.
 * @returns {string[]} Cloudsmith CLI arguments.
 */
function buildCommand(target, options) {
  const destination = `${options.owner}/${options.repository}/${target.distro}/${target.release}`;
  const command = ['push', target.format, destination, target.file];
  if (options.component && target.format === 'deb') {
    command.push('--component', options.component);
  }
  if (options.tags) {
    command.push('--tags', options.tags);
  }
  if (options.republish) {
    command.push('--republish');
  }
  if (!options.waitForSync) {
    command.push('--no-wait-for-sync');
  }
  return command;
}

/**
 * Write a GitHub Action output.
 *
 * @param {string} outputFile GitHub output file.
 * @param {string} name Output name.
 * @param {string|number} value Output value.
 * @param {object} fsApi File-system implementation.
 */
function setOutput(outputFile, name, value, fsApi = fs) {
  fsApi.appendFileSync(outputFile, `${name}=${value}\n`);
}

/**
 * Validate required action inputs.
 *
 * @param {object} env Action environment.
 */
function validateRequiredInputs(env) {
  const required = ['INPUT_OWNER', 'INPUT_PACKAGE_PATH', 'INPUT_REPOSITORY'];
  for (const name of required) {
    if (!env[name]) {
      throw new Error(`Missing required input: ${name.slice(6).toLowerCase()}.`);
    }
  }
}

/**
 * Parse upload options from the action environment.
 *
 * @param {object} env Action environment.
 * @returns {object} Parsed upload options.
 */
function readOptions(env) {
  return {
    apiHost: env.INPUT_API_HOST || 'https://api.cloudsmith.io',
    component: env.INPUT_COMPONENT || '',
    dryRun: parseBoolean(env.INPUT_DRY_RUN, false),
    failOnNoPackages: parseBoolean(env.INPUT_FAIL_ON_NO_PACKAGES, true),
    failOnUnmatched: parseBoolean(env.INPUT_FAIL_ON_UNMATCHED, true),
    owner: env.INPUT_OWNER,
    republish: parseBoolean(env.INPUT_REPUBLISH, false),
    repository: env.INPUT_REPOSITORY,
    skipUnsupported: parseBoolean(env.INPUT_SKIP_UNSUPPORTED, true),
    tags: env.INPUT_TAGS || '',
    waitForSync: parseBoolean(env.INPUT_WAIT_FOR_SYNC, true),
  };
}

/**
 * Enforce unmatched-package handling and report any skipped filenames.
 *
 * @param {string[]} unmatched Unmatched package paths.
 * @param {boolean} failOnUnmatched Whether unmatched packages are fatal.
 */
function handleUnmatchedPackages(unmatched, failOnUnmatched) {
  if (unmatched.length > 0 && failOnUnmatched) {
    throw new Error(`Unable to infer a distribution from: ${unmatched.map((file) => path.basename(file)).join(', ')}.`);
  }
  for (const file of unmatched) {
    console.log(`::warning::Skipping package with an unrecognized filename: ${path.basename(file)}`);
  }
}

/**
 * Load Cloudsmith versions for every distribution represented by the targets.
 *
 * @param {object[]} targets Classified package targets.
 * @param {object} options Upload options.
 * @param {Function} fetchImpl Fetch implementation.
 * @returns {Promise<Map<string, object[]>>} Versions grouped by distribution.
 */
async function fetchVersionsByDistro(targets, options, fetchImpl) {
  const versionsByDistro = new Map();
  for (const distro of new Set(targets.map((target) => target.distro))) {
    versionsByDistro.set(
      distro,
      await fetchDistributionVersions(options.apiHost, distro, fetchImpl),
    );
  }
  return versionsByDistro;
}

/**
 * Partition package targets by Cloudsmith distribution support.
 *
 * @param {object[]} targets Classified package targets.
 * @param {Map<string, object[]>} versionsByDistro Versions grouped by distribution.
 * @returns {{plan: object[], unsupported: object[]}} Resolved and unsupported targets.
 */
function partitionTargets(targets, versionsByDistro) {
  const plan = [];
  const unsupported = [];
  for (const target of targets) {
    const release = resolveDistributionVersion(target.releaseHint, versionsByDistro.get(target.distro));
    if (release) {
      plan.push({...target, release});
    } else {
      unsupported.push(target);
    }
  }
  return {plan, unsupported};
}

/**
 * Enforce unsupported-release handling and report skipped packages.
 *
 * @param {object[]} unsupported Unsupported package targets.
 * @param {boolean} skipUnsupported Whether unsupported releases may be skipped.
 */
function handleUnsupportedPackages(unsupported, skipUnsupported) {
  if (unsupported.length > 0 && !skipUnsupported) {
    const names = unsupported.map((target) => `${target.filename} (${target.distro}/${target.releaseHint})`);
    throw new Error(`Cloudsmith does not support the requested releases: ${names.join(', ')}.`);
  }
  for (const target of unsupported) {
    console.log(
      `::warning::Skipping ${target.filename}; Cloudsmith does not yet support `
      + `${target.distro}/${target.releaseHint}.`,
    );
  }
}

/**
 * Publish or report every resolved package upload.
 *
 * @param {object[]} plan Resolved package targets.
 * @param {object} options Upload options.
 * @param {Function} execFileSyncImpl Command implementation.
 */
function publishPackages(plan, options, execFileSyncImpl) {
  for (const target of plan) {
    const destination = `${options.owner}/${options.repository}/${target.distro}/${target.release}`;
    console.log(`${options.dryRun ? 'Would upload' : 'Uploading'} ${target.filename} to ${destination}.`);
    if (!options.dryRun) {
      execFileSyncImpl('cloudsmith', buildCommand(target, options), {stdio: 'inherit'});
    }
  }
}

/**
 * Resolve packages and publish them to Cloudsmith.
 *
 * @param {object} dependencies Injectable runtime dependencies.
 * @returns {Promise<object>} Upload result.
 */
async function main(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const execFileSyncImpl = dependencies.execFileSyncImpl || childProcess.execFileSync;
  const fsApi = dependencies.fsApi || fs;
  validateRequiredInputs(env);

  const options = readOptions(env);
  const entries = env.INPUT_PACKAGE_PATH.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  const files = listPackageFiles(entries, fsApi);
  const classified = files.map((file) => classifyPackage(file));
  const unmatched = files.filter((file, index) => classified[index] === null);
  handleUnmatchedPackages(unmatched, options.failOnUnmatched);

  const targets = classified.filter(Boolean);
  const versionsByDistro = await fetchVersionsByDistro(targets, options, fetchImpl);
  const {plan, unsupported} = partitionTargets(targets, versionsByDistro);
  handleUnsupportedPackages(unsupported, options.skipUnsupported);

  if (plan.length === 0 && options.failOnNoPackages) {
    throw new Error('No supported DEB or RPM packages were resolved for upload.');
  }

  publishPackages(plan, options, execFileSyncImpl);

  const packagePlan = plan.map((target) => ({
    distro: target.distro,
    filename: target.filename,
    format: target.format,
    release: target.release,
  }));
  const result = {
    packagePlan,
    plannedCount: plan.length,
    publishedCount: options.dryRun ? 0 : plan.length,
    skippedCount: files.length - plan.length,
  };
  if (env.GITHUB_OUTPUT) {
    setOutput(env.GITHUB_OUTPUT, 'package_plan', JSON.stringify(result.packagePlan), fsApi);
    setOutput(env.GITHUB_OUTPUT, 'planned_count', result.plannedCount, fsApi);
    setOutput(env.GITHUB_OUTPUT, 'published_count', result.publishedCount, fsApi);
    setOutput(env.GITHUB_OUTPUT, 'skipped_count', result.skippedCount, fsApi);
  }
  return result;
}

module.exports = {
  buildCommand,
  classifyPackage,
  fetchDistributionVersions,
  listPackageFiles,
  main,
  parseBoolean,
  resolveDistributionVersion,
  setOutput,
};
