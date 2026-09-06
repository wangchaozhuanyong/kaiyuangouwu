#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { closeSync, constants, fstatSync, openSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const retention = require('./systemd/vendure-production-release-retention.cjs');

const DEPLOY_LOCK = '/run/lock/vendure-production-deploy.lock';
const BACKUP_DIRECTORY = '/var/backups/vendure-mysql';

function withProductionLock(callback, lockPath = DEPLOY_LOCK) {
    // The existing deployment lock is owned by ubuntu in a sticky directory.
    // Open it without O_CREAT: root must not recreate it or change its owner.
    const lockFd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        assert.ok(fstatSync(lockFd).isFile(), 'The production lock must be a regular file');
        const acquired = spawnSync('flock', ['--exclusive', '--wait', '300', '3'], {
            stdio: ['ignore', 'pipe', 'pipe', lockFd],
            timeout: 310000,
        });
        assert.equal(acquired.status, 0, 'Could not acquire the existing production deployment lock');
        // flock and this process share the open file description. The parent
        // retains the lock until the descriptor is closed in finally.
        return callback();
    } finally {
        closeSync(lockFd);
    }
}

function validateRequest(environment) {
    const operation = environment.OPS_OPERATION || 'diagnose';
    assert.ok(
        [
            'diagnose',
            'retain-reviewed',
            'plan-two-factor-backup',
            'backup-two-factor-reviewed',
            'verify-two-factor-backup',
            'verify-security-dependencies',
            'inspect-storefront-config',
        ].includes(operation),
        'Unsupported production operation',
    );
    assert.match(environment.OPS_SOURCE_SHA || '', /^[a-f0-9]{40}$/u, 'Invalid operations source SHA');
    const expectedPlanSha256 = environment.OPS_EXPECTED_PLAN_SHA256 || '';
    if (['retain-reviewed', 'backup-two-factor-reviewed'].includes(operation)) {
        assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'A reviewed retention plan SHA-256 is required');
    } else {
        assert.equal(expectedPlanSha256, '', 'A read-only diagnosis does not accept a retention approval');
    }
    return { operation, sourceSha: environment.OPS_SOURCE_SHA, expectedPlanSha256 };
}

function planDigest(plan, sourceSha) {
    return createHash('sha256').update(JSON.stringify({ sourceSha, plan })).digest('hex');
}

function inspectProductionReleases() {
    let pm2Processes;
    try {
        const asRoot = process.getuid?.() === 0;
        pm2Processes = JSON.parse(
            execFileSync(
                asRoot ? 'sudo' : 'pm2',
                asRoot ? ['-n', '-H', '-u', 'ubuntu', 'pm2', 'jlist'] : ['jlist'],
                {
                    encoding: 'utf8',
                    timeout: 30000,
                    maxBuffer: 10 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'pipe'],
                },
            ),
        );
    } catch {
        throw new Error('PM2 snapshot unavailable; retention is blocked');
    }
    return retention.inspectReleaseState({ pm2Processes });
}

function encodeBeforeReport(report) {
    const output = `${JSON.stringify({ stage: 'before', ...report }, null, 2)}\n`;
    assert.ok(
        Buffer.byteLength(output) <= 18000,
        'Diagnosis exceeds the SSM evidence limit; retention is blocked',
    );
    return output;
}

function retainReviewedPlan(
    request,
    inspect = inspectProductionReleases,
    apply = retention.applyRetentionPlan,
) {
    assert.equal(request.operation, 'retain-reviewed', 'Retention requires the reviewed operation');
    const plan = inspect();
    assert.equal(
        planDigest(plan, request.sourceSha),
        request.expectedPlanSha256,
        'Retention plan changed; run diagnose and review again',
    );
    const revalidatedPlan = inspect();
    assert.deepEqual(revalidatedPlan, plan, 'Release state changed before retention');
    apply(revalidatedPlan);
    return plan;
}

// Only fixed, non-secret diagnostics are returned. Command stderr and PM2 environment
// objects must never be included in the workflow log.
function readCommand(command, arguments_) {
    try {
        return {
            status: 'ok',
            output: execFileSync(command, arguments_, {
                encoding: 'utf8',
                timeout: 120000,
                maxBuffer: 4 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'pipe'],
            }).trim(),
        };
    } catch (error) {
        return { status: 'unavailable', exitCode: Number.isInteger(error.status) ? error.status : null };
    }
}

function backupMetadata() {
    try {
        return readdirSync(BACKUP_DIRECTORY)
            .filter(name => /^vendure-[0-9]{8}T[0-9]{6}Z\.sql\.gz$/u.test(name))
            .sort()
            .slice(-3)
            .map(name => {
                const stat = statSync(path.join(BACKUP_DIRECTORY, name));
                return { name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
            });
    } catch {
        return { status: 'unavailable' };
    }
}

function readRepositoryGit(arguments_) {
    return execFileSync(
        'sudo',
        [
            '-n',
            '-H',
            '-u',
            'ubuntu',
            'git',
            '--no-optional-locks',
            '-C',
            '/var/www/kaiyuangouwu',
            ...arguments_,
        ],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
}

function inspectRepositoryState(sourceSha, readGit = readRepositoryGit) {
    try {
        const head = readGit(['rev-parse', '--verify', 'HEAD']).trim();
        const originMain = readGit(['rev-parse', '--verify', 'refs/remotes/origin/main']).trim();
        const branch = readGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
        assert.match(head, /^[a-f0-9]{40}$/u);
        assert.match(originMain, /^[a-f0-9]{40}$/u);
        assert.ok(branch.length > 0 && branch.length <= 255);
        const records = readGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
        assert.equal(records.pop(), '', 'Incomplete repository status');
        let trackedChanges = 0;
        let untrackedFiles = 0;
        let stagedChanges = 0;
        let unstagedChanges = 0;
        let conflicts = 0;
        for (let index = 0; index < records.length; index++) {
            const record = records[index];
            assert.ok(record.length > 3 && record[2] === ' ', 'Invalid repository status');
            const status = record.slice(0, 2);
            if (status === '??') {
                untrackedFiles++;
                continue;
            }
            assert.match(status, /^[ MTADRCU?!]{2}$/u);
            trackedChanges++;
            if (status[0] !== ' ') stagedChanges++;
            if (status[1] !== ' ') unstagedChanges++;
            if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status)) conflicts++;
            // Porcelain -z emits the original path as a separate record for renames/copies.
            if (/[RC]/u.test(status)) assert.ok(records[++index], 'Missing original path');
        }
        return {
            status: 'ok',
            head,
            originMain,
            branch,
            headMatchesOperationsSource: head === sourceSha,
            originMainMatchesOperationsSource: originMain === sourceSha,
            trackedChanges,
            untrackedFiles,
            stagedChanges,
            unstagedChanges,
            conflicts,
            trackedClean: trackedChanges === 0,
            clean: trackedChanges === 0 && untrackedFiles === 0,
        };
    } catch {
        // Even file names or Git stderr can contain private configuration. Return no raw paths/content.
        return { status: 'unavailable' };
    }
}

function diagnose(request) {
    const result = {
        operation: request.operation,
        sourceSha: request.sourceSha,
        observedAt: new Date().toISOString(),
        disk: readCommand('df', ['-Pk', '/']),
        releaseSize: readCommand('du', ['-skx', '/var/www/kaiyuangouwu-releases']),
        repositorySha: readCommand('sudo', [
            '-n',
            '-H',
            '-u',
            'ubuntu',
            'git',
            '-C',
            '/var/www/kaiyuangouwu',
            'rev-parse',
            'HEAD',
        ]),
        repositoryState: inspectRepositoryState(request.sourceSha),
        currentRuntime: readCommand('readlink', ['-f', '/var/www/kaiyuangouwu-current']),
        currentSha: readCommand('cat', ['/var/www/kaiyuangouwu-releases/current-sha']),
        healthService: readCommand('systemctl', [
            'show',
            'vendure-production-healthcheck.service',
            '--property=Result,ExecMainStatus,ExecMainExitTimestamp,ActiveState',
        ]),
        latestBackups: backupMetadata(),
    };
    try {
        const plan = inspectProductionReleases();
        result.retention = { status: 'ready', planSha256: planDigest(plan, request.sourceSha), plan };
    } catch {
        result.retention = {
            status: 'blocked',
            reason: 'Current pointer, version marker, PM2 processes or release inventory did not pass retention validation',
        };
    }
    return result;
}

function runLocked(environment = process.env) {
    const request = validateRequest(environment);
    if (request.operation === 'inspect-storefront-config') {
        const plan = inspectProductionReleases();
        assert.equal(
            plan.markerSha,
            request.sourceSha,
            'Storefront inspection requires the deployed source SHA',
        );
        const result = spawnSync(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                path.join(__dirname, 'storefront-configuration-guard.mjs'),
                'inspect',
            ],
            { encoding: 'utf8', timeout: 240000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        // Forward only the allowlisted completed summary, never raw authentication/query errors.
        assert.equal(result.status, 0, 'Read-only storefront configuration inspection failed');
        assert.ok(
            result.stdout.endsWith('STOREFRONT_CONFIGURATION_INSPECT_OK\n'),
            'Storefront evidence is incomplete',
        );
        process.stdout.write(result.stdout);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=inspect-storefront-config\n');
        return;
    }
    if (request.operation === 'verify-security-dependencies') {
        const plan = inspectProductionReleases();
        assert.equal(
            plan.markerSha,
            request.sourceSha,
            'Security verification requires the deployed source SHA',
        );
        const { verifyRuntimeSecurityDependencies } = require('./verify-runtime-security-dependencies.cjs');
        const result = verifyRuntimeSecurityDependencies(plan.currentRuntime);
        process.stdout.write(`${JSON.stringify({ sourceSha: request.sourceSha, ...result })}\n`);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=verify-security-dependencies\n');
        return;
    }
    if (request.operation.includes('two-factor')) {
        // Validate the existing current pointer/marker and online API/Worker
        // before reading keys. This synchronous child keeps the parent lock.
        inspectProductionReleases();
        const result = spawnSync(
            '/usr/bin/python3',
            [
                path.join(__dirname, 'two-factor-key-backup.py'),
                request.operation,
                request.sourceSha,
                request.expectedPlanSha256,
            ],
            { encoding: 'utf8', timeout: 540000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        // The Python entrypoint emits only its allowlisted report, including on
        // failures. Its stderr is never forwarded (it can contain raw errors).
        process.stdout.write(result.stdout || '');
        assert.equal(result.status, 0, 'The fixed two-factor key backup operation failed');
        assert.ok(
            result.stdout.endsWith(`TWO_FACTOR_KEY_BACKUP_COMPLETE operation=${request.operation}\n`),
            'The two-factor key backup completion evidence is missing',
        );
        process.stdout.write(`PRODUCTION_OPERATIONS_COMPLETE operation=${request.operation}\n`);
        return;
    }
    const before = diagnose(request);
    process.stdout.write(encodeBeforeReport(before));
    if (request.operation === 'diagnose') {
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=diagnose\n');
        return;
    }
    const appliedPlan = retainReviewedPlan(request);
    process.stdout.write(
        `${JSON.stringify(
            {
                stage: 'retention-applied',
                planSha256: request.expectedPlanSha256,
                deletedDirectoryCount: appliedPlan.deleteDirectories.length,
                deletedArchiveCount: appliedPlan.deleteArchives.length,
                preservedDirectoryCount: appliedPlan.keepDirectories.length,
            },
            null,
            2,
        )}\n`,
    );
    const healthRefresh = readCommand('sudo', [
        '-n',
        'systemctl',
        'start',
        'vendure-production-healthcheck.service',
    ]);
    process.stdout.write(
        `${JSON.stringify(
            {
                stage: 'after',
                healthRefresh,
                disk: readCommand('df', ['-Pk', '/']),
                healthService: readCommand('systemctl', [
                    'show',
                    'vendure-production-healthcheck.service',
                    '--property=Result,ExecMainStatus,ExecMainExitTimestamp,ActiveState',
                ]),
            },
            null,
            2,
        )}\n`,
    );
    assert.equal(
        healthRefresh.status,
        'ok',
        'Retention completed, but the production health check still failed',
    );
    process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=retain-reviewed\n');
}

if (require.main === module) {
    try {
        validateRequest(process.env);
        assert.equal(process.argv.length, 2, 'Unexpected operations argument');
        withProductionLock(() => runLocked());
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'Production operation failed'}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    encodeBeforeReport,
    inspectProductionReleases,
    inspectRepositoryState,
    planDigest,
    retainReviewedPlan,
    validateRequest,
    withProductionLock,
};
