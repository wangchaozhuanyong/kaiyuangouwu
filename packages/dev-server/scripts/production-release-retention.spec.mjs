import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const retention = require(
    path.join(repositoryRoot, 'deploy/systemd/vendure-production-release-retention.cjs'),
);

const releases = {
    oldest: '1111111111111111111111111111111111111111-100-1-linux-x64',
    previous: '2222222222222222222222222222222222222222-200-1-linux-x64',
    rollback: '3333333333333333333333333333333333333333-300-1-linux-x64',
    current: '4444444444444444444444444444444444444444-400-1-linux-x64',
    future: '5555555555555555555555555555555555555555-500-1-linux-x64',
};

function pm2Processes(currentRuntime, status = 'online') {
    return ['vendure-api', 'vendure-worker'].map(name => ({
        name,
        pm2_env: { status, pm_cwd: currentRuntime },
    }));
}

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vendure-release-retention-'));
    const releasesDir = path.join(root, 'releases');
    const currentPointer = path.join(root, 'current');
    await mkdir(releasesDir);
    for (const release of Object.values(releases)) {
        await mkdir(path.join(releasesDir, release));
        await writeFile(path.join(releasesDir, `${release}.tar.gz`), release);
    }
    await symlink(path.join(releasesDir, releases.current), currentPointer);
    await writeFile(path.join(releasesDir, 'current-sha'), `${releases.current.slice(0, 40)}\n`);
    return { root, releasesDir, currentPointer };
}

void test('recognizes only immutable Linux runtime names', () => {
    assert.equal(retention.parseReleaseName(releases.current)?.sha, releases.current.slice(0, 40));
    assert.equal(retention.parseReleaseName(`${releases.current}.tar.gz`), null);
    assert.equal(retention.parseReleaseName('current-sha'), null);
    assert.equal(retention.parseReleaseName('../../etc'), null);
});

void test('keeps the current release and the two immediately older releases', async () => {
    const current = await fixture();
    const currentRuntime = path.join(current.releasesDir, releases.current);
    const plan = retention.inspectReleaseState({
        releasesDir: current.releasesDir,
        currentPointer: current.currentPointer,
        keepCount: 3,
        pm2Processes: pm2Processes(currentRuntime),
    });

    assert.deepEqual(
        plan.keepDirectories.map(item => path.basename(item)),
        [releases.current, releases.rollback, releases.previous],
    );
    assert.deepEqual(
        plan.deleteDirectories.map(item => path.basename(item)),
        [releases.oldest, releases.future],
    );
    assert.deepEqual(
        plan.deleteArchives.map(item => path.basename(item)),
        [`${releases.oldest}.tar.gz`, `${releases.future}.tar.gz`],
    );
});

void test('refuses cleanup when the marker or PM2 state does not match the current pointer', async () => {
    const current = await fixture();
    const currentRuntime = path.join(current.releasesDir, releases.current);
    await writeFile(path.join(current.releasesDir, 'current-sha'), `${releases.rollback.slice(0, 40)}\n`);

    assert.throws(
        () =>
            retention.inspectReleaseState({
                releasesDir: current.releasesDir,
                currentPointer: current.currentPointer,
                pm2Processes: pm2Processes(currentRuntime),
            }),
        /marker does not match/u,
    );

    await writeFile(path.join(current.releasesDir, 'current-sha'), `${releases.current.slice(0, 40)}\n`);
    assert.throws(
        () =>
            retention.inspectReleaseState({
                releasesDir: current.releasesDir,
                currentPointer: current.currentPointer,
                pm2Processes: pm2Processes(currentRuntime, 'stopped'),
            }),
        /is not online/u,
    );
});

void test('requires an explicit production guard before applying deletions', async () => {
    const current = await fixture();
    const currentRuntime = path.join(current.releasesDir, releases.current);
    const environment = {
        VENDURE_RELEASES_DIR: current.releasesDir,
        VENDURE_CURRENT_RUNTIME_POINTER: current.currentPointer,
        VENDURE_RELEASE_RETENTION_COUNT: '3',
    };

    assert.throws(
        () =>
            retention.run({
                arguments_: ['--apply'],
                environment,
                pm2Processes: pm2Processes(currentRuntime),
            }),
        /requires VENDURE_ALLOW_PRODUCTION_RELEASE_PRUNE=1/u,
    );

    const result = retention.run({
        arguments_: ['--apply'],
        environment: { ...environment, VENDURE_ALLOW_PRODUCTION_RELEASE_PRUNE: '1' },
        pm2Processes: pm2Processes(currentRuntime),
    });
    assert.equal(result.mode, 'apply');
    await access(path.join(current.releasesDir, releases.current));
    await access(path.join(current.releasesDir, releases.rollback));
    await access(path.join(current.releasesDir, releases.previous));
    await assert.rejects(access(path.join(current.releasesDir, releases.oldest)), /ENOENT/u);
    await assert.rejects(access(path.join(current.releasesDir, releases.future)), /ENOENT/u);
});
