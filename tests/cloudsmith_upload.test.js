import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {setupConsoleMocks} = require('./testUtils.js');
const cloudsmithUpload = require('../actions/cloudsmith_upload/publish.js');
const {
  buildCommand,
  classifyPackage,
  fetchDistributionVersions,
  listPackageFiles,
  main,
  parseBoolean,
  resolveDistributionVersion,
  setOutput,
} = cloudsmithUpload;

let consoleMocks;
let tempDirectory;

beforeEach(() => {
  consoleMocks = setupConsoleMocks();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudsmith-upload-'));
});

afterEach(() => {
  consoleMocks.restore();
  fs.rmSync(tempDirectory, {force: true, recursive: true});
});

function writePackage(filename, directory = tempDirectory) {
  const packagePath = path.join(directory, filename);
  fs.writeFileSync(packagePath, 'fixture');
  return packagePath;
}

function createEnvironment(overrides = {}) {
  return {
    GITHUB_OUTPUT: path.join(tempDirectory, 'github-output'),
    INPUT_DRY_RUN: 'true',
    INPUT_OWNER: 'example-workspace',
    INPUT_PACKAGE_PATH: tempDirectory,
    INPUT_REPOSITORY: 'beta',
    ...overrides,
  };
}

function createFetch(distributions) {
  return jest.fn(async (url) => {
    const distro = url.match(/\/distros\/([^/]+)\/$/)[1];
    const value = distributions[distro];
    if (value instanceof Error) {
      return {ok: false, status: value.message};
    }
    return {
      ok: true,
      json: async () => ({versions: value}),
    };
  });
}

describe('parseBoolean', () => {
  test('parses explicit booleans and empty fallbacks', () => {
    expect(parseBoolean('true', false)).toBe(true);
    expect(parseBoolean('false', true)).toBe(false);
    expect(parseBoolean('', true)).toBe(true);
    expect(parseBoolean(undefined, false)).toBe(false);
  });

  test('rejects other values', () => {
    expect(() => parseBoolean('yes', false)).toThrow('Expected a boolean input, received "yes".');
  });
});

describe('listPackageFiles', () => {
  test('recursively finds, sorts, and deduplicates package files', () => {
    const nested = path.join(tempDirectory, 'nested');
    fs.mkdirSync(nested);
    const rpm = writePackage('z.rpm', nested);
    const deb = writePackage('a.deb');
    writePackage('ignored.txt');

    expect(listPackageFiles([tempDirectory, deb])).toEqual([deb, rpm]);
  });

  test('rejects a missing package path', () => {
    expect(() => listPackageFiles([path.join(tempDirectory, 'missing')])).toThrow(
      'Package path does not exist:',
    );
  });
});

describe('classifyPackage', () => {
  test.each([
    ['helloworld_1.2.3-1+debiantrixie_amd64.deb', 'deb', 'debian', 'trixie'],
    ['helloworld_1.2.3-1+ubuntu22.04_arm64.deb', 'deb', 'ubuntu', '22.04'],
    ['helloworld-ubuntu-24.04-amd64.deb', 'deb', 'ubuntu', '24.04'],
    ['HelloWorld-1.2.3-1.fc44.x86_64.rpm', 'rpm', 'fedora', '44'],
    ['HelloWorld-1.2.3-1.suse.lp156.aarch64.rpm', 'rpm', 'opensuse', '15.6'],
    ['HelloWorld-1.2.3-1.suse.tw.x86_64.rpm', 'rpm', 'opensuse', 'tumbleweed'],
    ['HelloWorld-1.2.3-1.suse.tumbleweed.x86_64.rpm', 'rpm', 'opensuse', 'tumbleweed'],
  ])('classifies %s', (filename, format, distro, releaseHint) => {
    expect(classifyPackage(filename)).toMatchObject({filename, format, distro, releaseHint});
  });

  test.each(['package.deb', 'package.rpm', 'package.zip'])('does not guess a target for %s', (filename) => {
    expect(classifyPackage(filename)).toBeNull();
  });
});

describe('resolveDistributionVersion', () => {
  const versions = [
    {name: '22.04 LTS Jammy Jellyfish', slug: 'jammy'},
    {name: '13 (Trixie)', slug: 'trixie'},
  ];

  test('matches an exact slug or a numeric display version', () => {
    expect(resolveDistributionVersion('TRIXIE', versions)).toBe('trixie');
    expect(resolveDistributionVersion('22.04', versions)).toBe('jammy');
  });

  test('returns null for an unsupported version', () => {
    expect(resolveDistributionVersion('26.10', versions)).toBeNull();
  });
});

describe('fetchDistributionVersions', () => {
  test('uses either a bare API host or an existing v1 base', async () => {
    const fetchImpl = createFetch({ubuntu: [{name: '22.04', slug: 'jammy'}]});

    await expect(fetchDistributionVersions('https://api.example.test/', 'ubuntu', fetchImpl)).resolves.toHaveLength(1);
    await fetchDistributionVersions('https://api.example.test/v1', 'ubuntu', fetchImpl);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://api.example.test/v1/distros/ubuntu/');
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://api.example.test/v1/distros/ubuntu/');
  });

  test('rejects API errors and invalid payloads', async () => {
    const failure = createFetch({ubuntu: new Error('503')});
    const invalid = jest.fn(async () => ({ok: true, json: async () => ({versions: null})}));

    await expect(fetchDistributionVersions('https://api.test', 'ubuntu', failure)).rejects.toThrow('HTTP 503');
    await expect(fetchDistributionVersions('https://api.test', 'ubuntu', invalid)).rejects.toThrow(
      'returned no versions',
    );
  });
});

describe('buildCommand', () => {
  const target = {
    distro: 'ubuntu',
    file: '/tmp/package.deb',
    format: 'deb',
    release: 'jammy',
  };

  test('includes requested Debian upload options', () => {
    expect(buildCommand(target, {
      component: 'main',
      owner: 'example-workspace',
      republish: true,
      repository: 'beta',
      tags: 'helloworld,beta',
      waitForSync: false,
    })).toEqual([
      'push',
      'deb',
      'example-workspace/beta/ubuntu/jammy',
      '/tmp/package.deb',
      '--component',
      'main',
      '--tags',
      'helloworld,beta',
      '--republish',
      '--no-wait-for-sync',
    ]);
  });

  test('omits empty options and Debian components for RPMs', () => {
    expect(buildCommand({...target, format: 'rpm'}, {
      component: 'main',
      owner: 'example-workspace',
      republish: false,
      repository: 'stable',
      tags: '',
      waitForSync: true,
    })).toEqual(['push', 'rpm', 'example-workspace/stable/ubuntu/jammy', '/tmp/package.deb']);
  });
});

describe('setOutput', () => {
  test('appends a GitHub output', () => {
    const output = path.join(tempDirectory, 'output');
    setOutput(output, 'count', 2);
    expect(fs.readFileSync(output, 'utf8')).toBe('count=2\n');
  });
});

describe('main', () => {
  const distributions = {
    fedora: [
      {name: '44 (forty four)', slug: '44'},
    ],
    opensuse: [
      {name: '15.6', slug: '15.6'},
    ],
    ubuntu: [
      {name: '22.04 LTS Jammy Jellyfish', slug: 'jammy'},
    ],
  };

  test('builds a dry-run plan, skips unsupported packages, and writes outputs', async () => {
    writePackage('helloworld_1.2.3-1+ubuntu22.04_amd64.deb');
    writePackage('HelloWorld-1.2.3-1.fc44.x86_64.rpm');
    writePackage('HelloWorld-1.2.3-1.fc45.aarch64.rpm');
    writePackage('mystery.rpm');
    const env = createEnvironment({INPUT_FAIL_ON_UNMATCHED: 'false'});
    const execFileSyncImpl = jest.fn();

    const result = await main({
      env,
      execFileSyncImpl,
      fetchImpl: createFetch(distributions),
    });

    expect(result).toMatchObject({plannedCount: 2, publishedCount: 0, skippedCount: 2});
    expect(result.packagePlan).toEqual([
      {distro: 'fedora', filename: 'HelloWorld-1.2.3-1.fc44.x86_64.rpm', format: 'rpm', release: '44'},
      {distro: 'ubuntu', filename: 'helloworld_1.2.3-1+ubuntu22.04_amd64.deb', format: 'deb', release: 'jammy'},
    ]);
    expect(execFileSyncImpl).not.toHaveBeenCalled();
    expect(consoleMocks.consoleOutput).toContain(
      '::warning::Skipping package with an unrecognized filename: mystery.rpm',
    );
    expect(consoleMocks.consoleOutput).toContain(
      '::warning::Skipping HelloWorld-1.2.3-1.fc45.aarch64.rpm; Cloudsmith does not yet support fedora/45.',
    );
    expect(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')).toContain('planned_count=2\n');
  });

  test('publishes resolved packages with default upload options', async () => {
    const packagePath = writePackage('helloworld-ubuntu-22.04-amd64.deb');
    const env = createEnvironment({
      GITHUB_OUTPUT: '',
      INPUT_DRY_RUN: 'false',
      INPUT_PACKAGE_PATH: `${packagePath}\n${packagePath}`,
    });
    const execFileSyncImpl = jest.fn();

    const result = await main({env, execFileSyncImpl, fetchImpl: createFetch(distributions)});

    expect(result).toMatchObject({plannedCount: 1, publishedCount: 1, skippedCount: 0});
    expect(execFileSyncImpl).toHaveBeenCalledWith(
      'cloudsmith',
      ['push', 'deb', 'example-workspace/beta/ubuntu/jammy', packagePath],
      {stdio: 'inherit'},
    );
  });

  test('rejects unmatched filenames in strict mode', async () => {
    writePackage('mystery.deb');
    await expect(main({env: createEnvironment(), fetchImpl: createFetch(distributions)})).rejects.toThrow(
      'Unable to infer a distribution from: mystery.deb.',
    );
  });

  test('rejects unsupported releases in strict mode', async () => {
    writePackage('HelloWorld-1.2.3-1.fc45.x86_64.rpm');
    const env = createEnvironment({INPUT_SKIP_UNSUPPORTED: 'false'});
    await expect(main({env, fetchImpl: createFetch(distributions)})).rejects.toThrow(
      'Cloudsmith does not support the requested releases:',
    );
  });

  test('rejects an empty plan by default and can explicitly allow it', async () => {
    await expect(main({env: createEnvironment(), fetchImpl: createFetch(distributions)})).rejects.toThrow(
      'No supported DEB or RPM packages were resolved for upload.',
    );

    const result = await main({
      env: createEnvironment({GITHUB_OUTPUT: '', INPUT_FAIL_ON_NO_PACKAGES: 'false'}),
      fetchImpl: createFetch(distributions),
    });
    expect(result).toMatchObject({plannedCount: 0, publishedCount: 0, skippedCount: 0});
  });

  test('requires owner, package path, and repository inputs', async () => {
    const previousOwner = process.env.INPUT_OWNER;
    delete process.env.INPUT_OWNER;
    await expect(main()).rejects.toThrow('Missing required input: owner.');
    if (previousOwner !== undefined) {
      process.env.INPUT_OWNER = previousOwner;
    }

    await expect(main({env: {}})).rejects.toThrow('Missing required input: owner.');
  });
});
