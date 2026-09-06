import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    chownSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const operations = require('../../../deploy/production-operations.cjs');
const retention = require('../../../deploy/systemd/vendure-production-release-retention.cjs');
const sourceSha = 'a'.repeat(40);

void test('repository diagnostics distinguish tracked changes, renamed paths and untracked private files', t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vendure-git-diagnosis-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const git = args =>
        execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Diagnostic fixture']);
    git(['config', 'user.email', 'fixture@example.test']);
    writeFileSync(path.join(root, 'source.txt'), 'original\n');
    writeFileSync(path.join(root, 'rename source.txt'), 'unchanged\n');
    git(['add', '.']);
    git(['commit', '-m', 'fixture']);
    const head = git(['rev-parse', 'HEAD']).trim();
    git(['update-ref', 'refs/remotes/origin/main', head]);
    const clean = operations.inspectRepositoryState(head, git);
    assert.equal(clean.clean, true);
    assert.equal(clean.branch, 'main');
    assert.equal(clean.headMatchesOperationsSource, true);
    assert.equal(clean.originMainMatchesOperationsSource, true);
    const sentinel = 'PRIVATE_PATH_MUST_NOT_APPEAR';
    mkdirSync(path.join(root, sentinel));
    writeFileSync(path.join(root, sentinel, '.env'), 'FAKE_CREDENTIAL');
    writeFileSync(path.join(root, sentinel, 'line\nbreak.txt'), 'fixture');
    const untracked = operations.inspectRepositoryState(head, git);
    assert.equal(untracked.clean, false);
    assert.equal(untracked.trackedClean, true);
    assert.equal(untracked.untrackedFiles, 2);
    git(['mv', 'rename source.txt', 'renamed\nfile.txt']);
    writeFileSync(path.join(root, 'source.txt'), 'modified\n');
    const dirty = operations.inspectRepositoryState(sourceSha, git);
    assert.equal(dirty.trackedChanges, 2);
    assert.equal(dirty.stagedChanges, 1);
    assert.equal(dirty.unstagedChanges, 1);
    assert.equal(dirty.untrackedFiles, 2);
    assert.equal(dirty.conflicts, 0);
    assert.equal(dirty.clean, false);
    assert.equal(dirty.trackedClean, false);
    assert.equal(dirty.headMatchesOperationsSource, false);
    assert.equal(JSON.stringify(dirty).includes(sentinel), false);
    assert.equal(JSON.stringify(dirty).includes('FAKE_CREDENTIAL'), false);
    assert.equal(JSON.stringify(dirty).includes('source.txt'), false);
});

void test('failed and truncated Git results stay unavailable, never clean or exposing command errors', () => {
    assert.deepEqual(
        operations.inspectRepositoryState(sourceSha, () => {
            throw new Error('FAKE_SECRET_IN_GIT_STDERR');
        }),
        { status: 'unavailable' },
    );
    const readGit = args => {
        if (args[0] === 'status') return ' M incomplete-path';
        if (args.includes('--abbrev-ref')) return 'main\n';
        return `${sourceSha}\n`;
    };
    assert.deepEqual(operations.inspectRepositoryState(sourceSha, readGit), { status: 'unavailable' });
});

void test(
    'Linux root retains the existing foreign-owned lock without changing ownership',
    {
        skip: process.platform !== 'linux' || process.getuid?.() !== 0,
    },
    t => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'vendure-operations-lock-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        chmodSync(root, 0o1777);
        const lock = path.join(root, 'deploy.lock');
        writeFileSync(lock, '');
        chownSync(lock, 1000, 1000);
        chmodSync(lock, 0o644);
        const contender = `const {openSync}=require('node:fs'); const {spawnSync}=require('node:child_process');
        const fd=openSync(${JSON.stringify(lock)},'r');
        process.exit(spawnSync('flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','ignore',fd]}).status);`;
        const contend = () => spawnSync(process.execPath, ['-e', contender]).status;
        operations.withProductionLock(() => assert.equal(contend(), 1), lock);
        assert.equal(contend(), 0);
        assert.equal(statSync(lock).uid, 1000);
        assert.equal(statSync(lock).mode % 0o1000, 0o644);
        assert.throws(
            () =>
                operations.withProductionLock(() => {
                    throw new Error('fixture failure');
                }, lock),
            /fixture failure/u,
        );
        assert.equal(contend(), 0);
        assert.throws(() =>
            operations.withProductionLock(() => assert.fail('must not run'), path.join(root, 'missing')),
        );
        assert.equal(existsSync(path.join(root, 'missing')), false);
    },
);

void test('oversized diagnostic evidence fails before any retention can start', () => {
    assert.throws(() => operations.encodeBeforeReport({ data: 'x'.repeat(18000) }), /evidence limit/u);
});

void test('a failing PM2 command cannot leak its stderr or error message', t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vendure-pm2-redaction-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const sentinel = 'FAKE_SECRET_MUST_NOT_BE_LOGGED';
    writeFileSync(path.join(root, 'pm2'), `#!/bin/sh\nprintf '${sentinel}' >&2\nexit 1\n`, { mode: 0o700 });
    writeFileSync(path.join(root, 'sudo'), `#!/bin/sh\nprintf '${sentinel}' >&2\nexit 1\n`, { mode: 0o700 });
    const modulePath = JSON.stringify(require.resolve('../../../deploy/production-operations.cjs'));
    const script = `try { require(${modulePath}).inspectProductionReleases(); }
        catch (error) { process.stderr.write(error.message); process.exitCode = 1; }`;
    const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, PATH: root },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PM2 snapshot unavailable/u);
    assert.equal(`${result.stdout}${result.stderr}`.includes(sentinel), false);
});

function fixture(t) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vendure-production-operations-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const releasesDir = path.join(root, 'releases');
    mkdirSync(releasesDir);
    const releases = [1, 2, 3, 4, 5].map(index => `${String(index).repeat(40)}-${index * 100}-1-linux-x64`);
    for (const name of releases) {
        mkdirSync(path.join(releasesDir, name));
        writeFileSync(path.join(releasesDir, `${name}.tar.gz`), 'fixture archive');
    }
    const currentRuntime = path.join(releasesDir, releases[3]);
    const currentPointer = path.join(root, 'current');
    symlinkSync(currentRuntime, currentPointer);
    writeFileSync(path.join(releasesDir, 'current-sha'), '4'.repeat(40));
    const inspect = () =>
        retention.inspectReleaseState({
            releasesDir,
            currentPointer,
            pm2Processes: ['vendure-api', 'vendure-worker'].map(name => ({
                name,
                pm2_env: { status: 'online', pm_cwd: currentRuntime },
            })),
        });
    const request = operations.validateRequest({
        OPS_OPERATION: 'retain-reviewed',
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_PLAN_SHA256: operations.planDigest(inspect(), sourceSha),
    });
    return { root, releasesDir, releases, inspect, request };
}

void test('diagnostics are the default; unknown commands and unreviewed retention fail closed', () => {
    assert.equal(operations.validateRequest({ OPS_SOURCE_SHA: sourceSha }).operation, 'diagnose');
    assert.throws(() => operations.validateRequest({ OPS_SOURCE_SHA: sourceSha, OPS_OPERATION: 'shell' }));
    assert.throws(() =>
        operations.validateRequest({ OPS_SOURCE_SHA: sourceSha, OPS_OPERATION: 'retain-reviewed' }),
    );
    assert.throws(() => operations.validateRequest({ OPS_SOURCE_SHA: 'main' }));
    assert.throws(() =>
        operations.validateRequest({ OPS_SOURCE_SHA: sourceSha, OPS_EXPECTED_PLAN_SHA256: 'a'.repeat(64) }),
    );
});

void test('key backup plans and verification are read-only; key writes require a reviewed hash', () => {
    for (const operation of [
        'plan-two-factor-backup',
        'verify-two-factor-backup',
        'verify-security-dependencies',
    ]) {
        assert.equal(
            operations.validateRequest({ OPS_SOURCE_SHA: sourceSha, OPS_OPERATION: operation }).operation,
            operation,
        );
        assert.throws(() =>
            operations.validateRequest({
                OPS_SOURCE_SHA: sourceSha,
                OPS_OPERATION: operation,
                OPS_EXPECTED_PLAN_SHA256: 'b'.repeat(64),
            }),
        );
    }
    assert.throws(() =>
        operations.validateRequest({
            OPS_SOURCE_SHA: sourceSha,
            OPS_OPERATION: 'backup-two-factor-reviewed',
        }),
    );
    assert.equal(
        operations.validateRequest({
            OPS_SOURCE_SHA: sourceSha,
            OPS_OPERATION: 'backup-two-factor-reviewed',
            OPS_EXPECTED_PLAN_SHA256: 'b'.repeat(64),
        }).expectedPlanSha256,
        'b'.repeat(64),
    );
});

void test('reviewed retention preserves current, two rollback releases, backup and unrelated files', t => {
    const f = fixture(t);
    const backup = path.join(f.releasesDir, 'vendure-backup.sql.gz');
    const checksum = path.join(f.releasesDir, `${f.releases[0]}.tar.gz.sha256`);
    writeFileSync(backup, 'fixture backup');
    writeFileSync(checksum, 'fixture checksum');
    operations.retainReviewedPlan(f.request, f.inspect);
    for (const index of [1, 2, 3]) {
        assert.ok(existsSync(path.join(f.releasesDir, f.releases[index])));
        assert.ok(existsSync(path.join(f.releasesDir, `${f.releases[index]}.tar.gz`)));
    }
    for (const index of [0, 4]) assert.equal(existsSync(path.join(f.releasesDir, f.releases[index])), false);
    assert.ok(existsSync(backup));
    assert.ok(existsSync(checksum));
});

void test('a stale candidate inventory or operations revision cannot reuse a reviewed plan', t => {
    const f = fixture(t);
    assert.throws(
        () => operations.retainReviewedPlan({ ...f.request, sourceSha: 'b'.repeat(40) }, f.inspect),
        /plan changed/u,
    );
    mkdirSync(path.join(f.releasesDir, `${'6'.repeat(40)}-600-1-linux-x64`));
    assert.throws(() => operations.retainReviewedPlan(f.request, f.inspect), /plan changed/u);
    assert.ok(existsSync(path.join(f.releasesDir, f.releases[0])));
});

void test('an inventory change between validation and apply prevents every deletion', t => {
    const f = fixture(t);
    let reads = 0;
    const inspect = () => {
        if (++reads === 2) mkdirSync(path.join(f.releasesDir, `${'6'.repeat(40)}-600-1-linux-x64`));
        return f.inspect();
    };
    assert.throws(() => operations.retainReviewedPlan(f.request, inspect), /Release state changed/u);
    assert.ok(existsSync(path.join(f.releasesDir, f.releases[0])));
});

void test('a symlink substituted for a reviewed directory cannot delete its destination', t => {
    const f = fixture(t);
    const outside = path.join(f.root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'keep'), 'fixture');
    const target = path.join(f.releasesDir, f.releases[0]);
    const apply = plan => {
        rmSync(target, { recursive: true });
        symlinkSync(outside, target);
        retention.applyRetentionPlan(plan);
    };
    assert.throws(() => operations.retainReviewedPlan(f.request, f.inspect, apply), /symbolic link/u);
    assert.ok(existsSync(path.join(outside, 'keep')));
    assert.ok(existsSync(path.join(f.releasesDir, f.releases[4])));
});
