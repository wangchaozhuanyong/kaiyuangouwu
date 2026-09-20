import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    chownSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const operations = require('../../../deploy/production-operations.cjs');
const retention = require('../../../deploy/systemd/vendure-production-release-retention.cjs');
const sourceSha = 'a'.repeat(40);

void test('release preflight reads independent frontend revisions and detects missing bootstrap pointers', t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vendure-frontend-revisions-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const runtime = path.join(root, 'runtime');
    const plan = { markerSha: sourceSha, currentRuntime: runtime };
    assert.equal(
        operations.frontendRevisionEvidence(plan, root),
        'PRODUCTION_FRONTEND_REVISIONS storefront=unknown next-admin=unknown\n',
    );
    for (const component of ['storefront', 'next-admin']) {
        const dist = path.join(runtime, 'packages', component, 'dist');
        mkdirSync(dist, { recursive: true });
        symlinkSync(dist, path.join(root, `kaiyuangouwu-${component}-current`));
    }
    assert.equal(
        operations.frontendRevisionEvidence(plan, root),
        `PRODUCTION_FRONTEND_REVISIONS storefront=${sourceSha} next-admin=${sourceSha}\n`,
    );
    const frontendSha = 'b'.repeat(40);
    writeFileSync(
        path.join(runtime, 'packages/next-admin/dist/frontend-release.json'),
        JSON.stringify({ sourceSha: frontendSha }),
    );
    assert.equal(
        operations.frontendRevisionEvidence(plan, root),
        `PRODUCTION_FRONTEND_REVISIONS storefront=${sourceSha} next-admin=${frontendSha}\n`,
    );
    const source = readFileSync(path.join(repositoryRoot, 'deploy/production-operations.cjs'), 'utf8');
    const preflight = source.slice(
        source.indexOf("if (request.operation === 'preflight-release')"),
        source.indexOf("if (request.operation === 'inspect-storefront-config')"),
    );
    assert.match(preflight, /process\.stdout\.write\(frontendRevisionEvidence\(plan\)\)/u);
});

void test('release workflow ships the fixed live preflight inputs and migration registry', () => {
    const workflow = readFileSync(
        path.join(repositoryRoot, '.github/workflows/production_operations.yml'),
        'utf8',
    );
    assert.match(workflow, /workflow_call:/u);
    assert.match(workflow, /preflight-release/u);
    assert.match(workflow, /OPS_EXPECTED_CHANNEL_CODES/u);
    assert.match(workflow, /deploy\/usdt-migration-guard\.cjs/u);
    assert.match(workflow, /packages\/dev-server\/migrations\/index\.ts/u);
    assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/u);
    assert.match(workflow, /gzip\.compress\(Path\(path\)\.read_bytes\(\), mtime=0\)/u);
    assert.match(workflow, /\| base64 -d \| gzip -d >/u);
    assert.match(workflow, /len\(payload\.encode\('utf-8'\)\) <= 80_000/u);
    assert.match(workflow, /git merge-base --is-ancestor "\$OPS_EXPECTED_RUNTIME_SHA" "\$OPS_SOURCE_SHA"/u);
    assert.doesNotMatch(workflow, /git diff --name-only "\$OPS_EXPECTED_RUNTIME_SHA"/u);

    const commonFiles = [
        'deploy/production-operations.cjs',
        'deploy/systemd/vendure-production-release-retention.cjs',
    ];
    const bundles = [
        [...commonFiles, 'deploy/two-factor-key-backup.py'],
        [...commonFiles, 'deploy/verify-runtime-security-dependencies.cjs'],
        [
            ...commonFiles,
            'deploy/storefront-configuration-guard.mjs',
            'deploy/usdt-migration-guard.cjs',
            'packages/dev-server/migrations/index.ts',
        ],
        [
            ...commonFiles,
            'deploy/usdt-migration-guard.cjs',
            'packages/dev-server/migrations/index.ts',
            'packages/dev-server/scripts/store-autonomy-data-audit.mjs',
            'packages/dev-server/scripts/store-isolation-data-preflight.mjs',
            'packages/dev-server/scripts/store-isolation-ownership-evidence.mjs',
            'packages/dev-server/scripts/store-isolation-customer-dependencies.mjs',
        ],
        [...commonFiles, 'packages/dev-server/scripts/order-sales-ownership-backfill.mjs'],
        [...commonFiles, 'packages/dev-server/scripts/moyao-default-store-migration.mjs'],
    ];
    const encodedBytes = bundles.map(files =>
        files.reduce(
            (total, file) =>
                total +
                gzipSync(readFileSync(path.join(repositoryRoot, file), 'utf8'), { mtime: 0 }).toString(
                    'base64',
                ).length,
            0,
        ),
    );
    assert.ok(
        Math.max(...encodedBytes) < 78_000,
        `Largest compressed production operation bundle uses ${Math.max(...encodedBytes)} bytes`,
    );
});

void test('read-only storefront inspection accepts an older running ancestor but rejects unrelated revisions', () => {
    const deployedSha = 'b'.repeat(40);
    const calls = [];
    operations.assertStorefrontInspectionRevision(deployedSha, sourceSha, (...args) => calls.push(args));
    assert.deepEqual(calls, [[deployedSha, sourceSha]]);
    assert.throws(
        () =>
            operations.assertStorefrontInspectionRevision(deployedSha, sourceSha, () => {
                throw new Error('PRIVATE_GIT_ERROR');
            }),
        /not an ancestor/u,
    );
    assert.throws(() =>
        operations.assertStorefrontInspectionRevision('invalid', sourceSha, () =>
            assert.fail('must not run'),
        ),
    );
});

void test('inspection forwards only fixed query failure codes and never raw stderr', () => {
    const failure =
        'STOREFRONT_CONFIGURATION_QUERY_FAILED operation=ConfigurationGuardContent reason=TIMEOUT';
    assert.equal(operations.storefrontInspectionFailure({ stderr: `PRIVATE_ERROR\n${failure}\n` }), failure);
    for (const stderr of [
        'PRIVATE_ERROR',
        `${failure} PRIVATE_SECRET`,
        'STOREFRONT_CONFIGURATION_QUERY_FAILED operation=PRIVATE_SECRET reason=TIMEOUT',
    ]) {
        assert.equal(
            operations.storefrontInspectionFailure({ stderr }),
            'Read-only storefront configuration inspection failed',
        );
    }
});

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

void test('release preflight and postflight accept only a reviewed Channel scope', () => {
    assert.deepEqual(
        operations.validateRequest({
            OPS_OPERATION: 'preflight-release',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_CHANNEL_CODES: '__default_channel__,my-malaysia',
        }),
        {
            operation: 'preflight-release',
            sourceSha,
            expectedPlanSha256: '',
            expectedChannelCodes: '__default_channel__,my-malaysia',
            expectedRuntimeSha: '',
        },
    );
    assert.equal(
        operations.validateRequest({
            OPS_OPERATION: 'postflight-release',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_CHANNEL_CODES: 'my-malaysia',
        }).operation,
        'postflight-release',
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'diagnose',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_CHANNEL_CODES: 'my-malaysia',
        }),
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'preflight-release',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_CHANNEL_CODES: 'my-malaysia;id',
        }),
    );
});

void test('key backup plans and verification are read-only; key writes require a reviewed hash', () => {
    for (const operation of [
        'plan-two-factor-backup',
        'verify-two-factor-backup',
        'verify-security-dependencies',
        'inspect-storefront-config',
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

void test('store isolation audit requires one exact runtime SHA and rejects it for every other operation', () => {
    const runtimeSha = 'b'.repeat(40);
    assert.deepEqual(
        operations.validateRequest({
            OPS_OPERATION: 'audit-store-isolation-data',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }),
        {
            operation: 'audit-store-isolation-data',
            sourceSha,
            expectedPlanSha256: '',
            expectedChannelCodes: '',
            expectedRuntimeSha: runtimeSha,
        },
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'audit-store-isolation-data',
            OPS_SOURCE_SHA: sourceSha,
        }),
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'diagnose',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }),
    );
});

void test('database backup pins the reviewed runtime and preserves release and health state', () => {
    const runtimeSha = 'b'.repeat(40);
    const request = operations.validateRequest({
        OPS_OPERATION: 'backup-database',
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
    });
    assert.deepEqual(request, {
        operation: 'backup-database',
        sourceSha,
        expectedPlanSha256: '',
        expectedChannelCodes: '',
        expectedRuntimeSha: runtimeSha,
    });
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'backup-database',
            OPS_SOURCE_SHA: sourceSha,
        }),
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'backup-database',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
            OPS_EXPECTED_PLAN_SHA256: 'd'.repeat(64),
        }),
    );

    const release = { markerSha: runtimeSha, currentRuntime: '/runtime/current' };
    const health = { status: 'ok', output: 'Result=success\nExecMainStatus=0\nActiveState=inactive\n' };
    let backupCalls = 0;
    const result = operations.runDatabaseBackup(request, {
        inspect: () => ({ ...release }),
        health: () => ({ ...health }),
        backup: () => {
            backupCalls += 1;
            return {
                file: '/var/backups/vendure-mysql/vendure-20260920T080000Z.sql.gz',
                invocationId: 'a'.repeat(32),
                offsite: true,
            };
        },
    });

    assert.equal(backupCalls, 1);
    assert.equal(result.sourceSha, sourceSha);
    assert.equal(result.runtimeSha, runtimeSha);
    assert.equal(result.backup.offsite, true);
    assert.deepEqual(result.healthBefore, health);
    assert.deepEqual(result.healthAfter, health);
});

void test('order ownership backfill separates read-only planning from reviewed writes', () => {
    const runtimeSha = 'b'.repeat(40);
    assert.deepEqual(
        operations.validateRequest({
            OPS_OPERATION: 'plan-order-sales-ownership-backfill',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }),
        {
            operation: 'plan-order-sales-ownership-backfill',
            sourceSha,
            expectedPlanSha256: '',
            expectedChannelCodes: '',
            expectedRuntimeSha: runtimeSha,
        },
    );
    assert.equal(
        operations.validateRequest({
            OPS_OPERATION: 'apply-order-sales-ownership-backfill-reviewed',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
            OPS_EXPECTED_PLAN_SHA256: 'c'.repeat(64),
        }).expectedPlanSha256,
        'c'.repeat(64),
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'apply-order-sales-ownership-backfill-reviewed',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }),
    );
});

void test('MOYAO migration separates reviewed planning, apply and verification', () => {
    const runtimeSha = 'b'.repeat(40);
    assert.equal(
        operations.validateRequest({
            OPS_OPERATION: 'plan-moyao-default-store-migration',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }).operation,
        'plan-moyao-default-store-migration',
    );
    assert.equal(
        operations.validateRequest({
            OPS_OPERATION: 'verify-moyao-default-store-migration',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }).operation,
        'verify-moyao-default-store-migration',
    );
    assert.equal(
        operations.validateRequest({
            OPS_OPERATION: 'apply-moyao-default-store-migration-reviewed',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
            OPS_EXPECTED_PLAN_SHA256: 'c'.repeat(64),
        }).expectedPlanSha256,
        'c'.repeat(64),
    );
    assert.throws(() =>
        operations.validateRequest({
            OPS_OPERATION: 'apply-moyao-default-store-migration-reviewed',
            OPS_SOURCE_SHA: sourceSha,
            OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        }),
    );
});

void test('MOYAO migration logs only aggregate evidence and verifies after backup', () => {
    const runtimeSha = 'b'.repeat(40);
    const operationDigest = 'c'.repeat(64);
    const request = operations.validateRequest({
        OPS_OPERATION: 'apply-moyao-default-store-migration-reviewed',
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        OPS_EXPECTED_PLAN_SHA256: operationDigest,
    });
    const runtime = { markerSha: runtimeSha, currentRuntime: '/immutable/runtime' };
    const plan = {
        format: 1,
        schema: 'vendure-moyao-default-store-migration',
        mode: 'reviewed-default-to-dedicated-channel',
        sourceChannelCode: '__default_channel__',
        targetChannelCode: 'moyao-ai',
        contentBlockCount: 24,
        movedChannelRows: { storefront_promotion_page: 1 },
        addedRelations: { customer_channels_channel: 3 },
        profileWillChange: true,
        contentSettingsWillChange: false,
        orderSalesOwnerCount: 7,
        operationDigest,
    };
    const verification = {
        format: 1,
        schema: 'vendure-moyao-default-store-migration-verification',
        sourceChannelCode: '__default_channel__',
        targetChannelCode: 'moyao-ai',
        targetContentBlockCount: 24,
        relationTablesVerified: 11,
        movedChannelTablesVerified: 52,
        defaultOwnedOrderCount: 0,
        profileMatches: true,
        contentSettingsMatch: true,
    };
    let backupCount = 0;
    const result = operations.runMoyaoDefaultStoreMigration(request, {
        inspect: () => structuredClone(runtime),
        health: () => ({
            status: 'ok',
            output: 'Result=success\nExecMainStatus=0\nActiveState=inactive',
        }),
        backup: () => {
            backupCount++;
            return { file: '/safe/backup.sql.gz', invocationId: 'd'.repeat(32), offsite: true };
        },
        spawn: (_command, arguments_, options) => {
            assert.equal(options.env.STORE_ISOLATION_MODULE_ROOT, runtime.currentRuntime);
            const operation = arguments_.includes('verify')
                ? 'verify'
                : arguments_.at(-1) === operationDigest
                  ? 'apply'
                  : 'plan';
            const payload = operation === 'verify' ? verification : plan;
            return {
                status: 0,
                stdout:
                    `MOYAO_DEFAULT_STORE_${operation.toUpperCase()} ${JSON.stringify(payload)}\n` +
                    `MOYAO_DEFAULT_STORE_MIGRATION_OK operation=${operation}\n`,
                stderr: 'PRIVATE_ERROR_NOT_FORWARDED',
            };
        },
        script: '/fixed/migration.mjs',
    });
    assert.equal(backupCount, 1);
    assert.equal(result.applied, true);
    assert.equal(result.verification.targetContentBlockCount, 24);
});

void test('order ownership operation logs only aggregate evidence and preserves the runtime', () => {
    const runtimeSha = 'b'.repeat(40);
    const operationDigest = 'c'.repeat(64);
    const request = operations.validateRequest({
        OPS_OPERATION: 'apply-order-sales-ownership-backfill-reviewed',
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        OPS_EXPECTED_PLAN_SHA256: operationDigest,
    });
    const runtime = { markerSha: runtimeSha, currentRuntime: '/immutable/runtime' };
    const aggregate = {
        format: 1,
        schema: 'vendure-order-sales-ownership-backfill',
        mode: 'deterministic-channel-membership',
        candidateCount: 10,
        countsByChannel: { __default_channel__: 7, 'moyao-ai': 3 },
        operationDigest,
    };
    let backupCount = 0;
    const result = operations.runOrderSalesOwnershipBackfill(request, {
        inspect: () => structuredClone(runtime),
        health: () => ({
            status: 'ok',
            output: 'Result=success\nExecMainStatus=0\nActiveState=inactive',
        }),
        backup: () => {
            backupCount++;
            return { file: '/safe/backup.sql.gz', invocationId: 'd'.repeat(32), offsite: true };
        },
        spawn: (_command, arguments_, options) => {
            const operation = arguments_.at(-1) === operationDigest ? 'apply' : 'plan';
            assert.equal(options.env.STORE_ISOLATION_MODULE_ROOT, runtime.currentRuntime);
            return {
                status: 0,
                stdout:
                    `ORDER_SALES_OWNERSHIP_${operation.toUpperCase()} ${JSON.stringify(aggregate)}\n` +
                    `ORDER_SALES_OWNERSHIP_BACKFILL_OK operation=${operation}\n`,
                stderr: 'PRIVATE_ERROR_NOT_FORWARDED',
            };
        },
        script: '/fixed/backfill.mjs',
    });
    assert.equal(backupCount, 1);
    assert.equal(result.applied, true);
    assert.equal(result.plan.candidateCount, 10);
});

void test('store isolation audit validates sanitized output and stable runtime evidence', () => {
    const runtimeSha = 'b'.repeat(40);
    const request = operations.validateRequest({
        OPS_OPERATION: 'audit-store-isolation-data',
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
    });
    const plan = { markerSha: runtimeSha, currentRuntime: '/immutable/runtime', keepDirectories: [] };
    const payload = {
        format: 2,
        schema: 'vendure-store-autonomy-audit',
        mode: 'read-only-consistent-snapshot',
        verdict: 'NO_GO',
        coverageComplete: true,
        checks: [],
        structure: [],
    };
    const result = operations.runStoreIsolationAudit(request, {
        inspect: () => structuredClone(plan),
        health: () => ({
            status: 'ok',
            output: 'Result=success\nExecMainStatus=0\nActiveState=inactive',
        }),
        spawn: (_command, arguments_, options) => {
            if (arguments_.includes('plan')) {
                return {
                    status: 0,
                    stdout: `USDT_MIGRATION_PLAN ${JSON.stringify({
                        databaseVersion: '8.4.0',
                        pending: [],
                        schema: { activeColumn: true },
                    })}\nUSDT_RUNTIME_GUARD_OK operation=plan\n`,
                    stderr: '',
                };
            }
            assert.equal(options.env.STORE_ISOLATION_MODULE_ROOT, plan.currentRuntime);
            assert.match(options.env.STORE_ISOLATION_AUDIT_KEY, /^[a-f0-9]{64}$/u);
            assert.equal(options.env.STORE_ISOLATION_REQUIRE_EXPECTED_SCHEMA, '0');
            return { status: 0, stdout: JSON.stringify(payload), stderr: 'PRIVATE_ERROR_NOT_FORWARDED' };
        },
        auditScript: '/fixed/audit.mjs',
    });
    assert.equal(result.runtimeSha, runtimeSha);
    assert.equal(result.migrationState.pendingCount, 0);
    assert.equal(result.audit.verdict, 'NO_GO');
    assert.throws(() => operations.validateMigrationAuditOutput('invalid'));
    assert.throws(() => operations.validateStoreAutonomyAuditPayload('{'));
    let pendingHealthChecks = 0;
    assert.throws(
        () =>
            operations.runStoreIsolationAudit(request, {
                inspect: () => structuredClone(plan),
                health: () => {
                    pendingHealthChecks++;
                    return {
                        status: 'ok',
                        output: 'Result=success\nExecMainStatus=0\nActiveState=inactive',
                    };
                },
                spawn: (_command, arguments_) => {
                    assert.ok(arguments_.includes('plan'));
                    return {
                        status: 0,
                        stdout: `USDT_MIGRATION_PLAN ${JSON.stringify({
                            databaseVersion: '8.4.0',
                            pending: ['PendingMigration1789300800000'],
                            schema: { activeColumn: true },
                        })}\nUSDT_RUNTIME_GUARD_OK operation=plan\n`,
                        stderr: '',
                    };
                },
            }),
        /pending migrations/u,
    );
    assert.equal(pendingHealthChecks, 2);
    assert.throws(() =>
        operations.validateStoreAutonomyAuditPayload(JSON.stringify({ ...payload, customerId: 123 })),
    );
    assert.throws(
        () =>
            operations.runStoreIsolationAudit(request, {
                inspect: () => ({ ...plan, markerSha: 'c'.repeat(40) }),
                health: () => ({
                    status: 'ok',
                    output: 'Result=success\nExecMainStatus=0\nActiveState=inactive',
                }),
                spawn: () => assert.fail('must not run'),
            }),
        /runtime SHA/u,
    );
    assert.throws(
        () =>
            operations.runStoreIsolationAudit(request, {
                inspect: () => structuredClone(plan),
                health: () => ({
                    status: 'ok',
                    output: 'Result=failed\nExecMainStatus=1\nActiveState=failed',
                }),
                spawn: () => assert.fail('must not run'),
            }),
        /not successful/u,
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
