#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const {
    closeSync,
    constants,
    existsSync,
    fstatSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    statSync,
} = require('node:fs');
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
            'backup-database',
            'retain-reviewed',
            'plan-two-factor-backup',
            'backup-two-factor-reviewed',
            'verify-two-factor-backup',
            'verify-security-dependencies',
            'inspect-storefront-config',
            'audit-store-isolation-data',
            'plan-order-sales-ownership-backfill',
            'apply-order-sales-ownership-backfill-reviewed',
            'plan-moyao-default-store-migration',
            'apply-moyao-default-store-migration-reviewed',
            'verify-moyao-default-store-migration',
            'preflight-release',
            'postflight-release',
        ].includes(operation),
        'Unsupported production operation',
    );
    assert.match(environment.OPS_SOURCE_SHA || '', /^[a-f0-9]{40}$/u, 'Invalid operations source SHA');
    const expectedPlanSha256 = environment.OPS_EXPECTED_PLAN_SHA256 || '';
    const expectedChannelCodes = environment.OPS_EXPECTED_CHANNEL_CODES || '';
    const expectedRuntimeSha = environment.OPS_EXPECTED_RUNTIME_SHA || '';
    if (
        [
            'retain-reviewed',
            'backup-two-factor-reviewed',
            'apply-order-sales-ownership-backfill-reviewed',
            'apply-moyao-default-store-migration-reviewed',
        ].includes(operation)
    ) {
        assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'A reviewed plan SHA-256 is required');
    } else {
        assert.equal(
            expectedPlanSha256,
            '',
            'An operation without reviewed data changes does not accept a write approval',
        );
    }
    assert.ok(
        !expectedChannelCodes ||
            expectedChannelCodes === '美宜佳' ||
            /^[a-z0-9_][a-z0-9_-]*(,[a-z0-9_][a-z0-9_-]*)*$/u.test(expectedChannelCodes),
        'Invalid expected Channel codes',
    );
    if (!['preflight-release', 'postflight-release'].includes(operation)) {
        assert.equal(
            expectedChannelCodes,
            '',
            'Expected Channel codes are only valid for release validation',
        );
    }
    if (
        [
            'backup-database',
            'audit-store-isolation-data',
            'plan-order-sales-ownership-backfill',
            'apply-order-sales-ownership-backfill-reviewed',
            'plan-moyao-default-store-migration',
            'apply-moyao-default-store-migration-reviewed',
            'verify-moyao-default-store-migration',
        ].includes(operation)
    ) {
        assert.match(expectedRuntimeSha, /^[a-f0-9]{40}$/u, 'An exact expected runtime SHA is required');
    } else {
        assert.equal(
            expectedRuntimeSha,
            '',
            'Expected runtime SHA is only valid for a pinned store-data operation',
        );
    }
    return {
        operation,
        sourceSha: environment.OPS_SOURCE_SHA,
        expectedPlanSha256,
        expectedChannelCodes,
        expectedRuntimeSha,
    };
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

function assertStorefrontInspectionRevision(
    deployedSha,
    sourceSha,
    checkAncestry = (before, after) => {
        // Refresh objects only; a diagnostic must never checkout or advance the server working tree.
        for (const args of [
            ['fetch', 'origin', 'main'],
            ['merge-base', '--is-ancestor', before, after],
        ]) {
            execFileSync(
                'sudo',
                ['-n', '-H', '-u', 'ubuntu', 'git', '-C', '/var/www/kaiyuangouwu', ...args],
                { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] },
            );
        }
    },
) {
    assert.match(deployedSha, /^[0-9a-f]{40}$/u);
    assert.match(sourceSha, /^[0-9a-f]{40}$/u);
    try {
        checkAncestry(deployedSha, sourceSha);
    } catch {
        throw new Error('Running storefront revision is not an ancestor of the reviewed inspection source');
    }
}

function storefrontInspectionFailure(result) {
    const safeFailure = result.stderr?.match(
        /^STOREFRONT_CONFIGURATION_QUERY_FAILED operation=ConfigurationGuard(?:Login|Profiles|Content|Published) reason=(?:TIMEOUT|REQUEST_FAILED|HTTP_ERROR|INVALID_JSON|API_ERROR)$/mu,
    )?.[0];
    return safeFailure || 'Read-only storefront configuration inspection failed';
}

function frontendRevisionEvidence(plan, pointerDirectory = '/var/www') {
    const frontendVersions = ['storefront', 'next-admin'].map(component => {
        const pointer = path.join(pointerDirectory, `kaiyuangouwu-${component}-current`);
        let revision = 'unknown';
        try {
            const marker = ['frontend-release.json', 'storefront-release.json']
                .map(name => path.join(pointer, name))
                .find(file => existsSync(file));
            if (marker) revision = JSON.parse(readFileSync(marker, 'utf8')).sourceSha;
            else if (
                realpathSync(pointer) ===
                realpathSync(path.join(plan.currentRuntime, 'packages', component, 'dist'))
            )
                revision = plan.markerSha;
        } catch {
            /* Missing legacy pointers require a bootstrap full release. */
        }
        return `${component}=${/^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown'}`;
    });
    return `PRODUCTION_FRONTEND_REVISIONS ${frontendVersions.join(' ')}\n`;
}

function validateStoreAutonomyAuditPayload(output) {
    assert.ok(Buffer.byteLength(output) <= 60000, 'Store isolation audit output exceeds the evidence limit');
    let payload;
    try {
        payload = JSON.parse(output);
    } catch {
        throw new Error('Store isolation audit did not return valid JSON');
    }
    assert.equal(payload?.format, 2, 'Unexpected store isolation audit format');
    assert.equal(payload?.schema, 'vendure-store-autonomy-audit', 'Unexpected store isolation audit schema');
    assert.equal(payload?.mode, 'read-only-consistent-snapshot', 'Store isolation audit was not read-only');
    assert.ok(['GO', 'NO_GO', 'INCOMPLETE'].includes(payload?.verdict), 'Invalid store isolation verdict');
    assert.equal(typeof payload?.coverageComplete, 'boolean', 'Missing audit coverage status');
    assert.ok(Array.isArray(payload?.checks), 'Missing store isolation checks');
    assert.ok(Array.isArray(payload?.structure), 'Missing store isolation structure checks');
    const forbiddenKeys =
        /^(?:email|identifier|address|token|password|credential|customerId|orderId|fileName|root)$/iu;
    const visit = value => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            assert.doesNotMatch(
                key,
                forbiddenKeys,
                'Store isolation audit output contains a sensitive field',
            );
            visit(child);
        }
    };
    visit(payload);
    return payload;
}

function validateMigrationAuditOutput(output) {
    assert.ok(Buffer.byteLength(output) <= 60000, 'Migration audit output exceeds the evidence limit');
    const planLine = output.split('\n').find(line => line.startsWith('USDT_MIGRATION_PLAN '));
    assert.ok(planLine, 'Migration audit plan is unavailable');
    assert.ok(
        output.endsWith('USDT_RUNTIME_GUARD_OK operation=plan\n'),
        'Migration audit evidence is incomplete',
    );
    let plan;
    try {
        plan = JSON.parse(planLine.slice('USDT_MIGRATION_PLAN '.length));
    } catch {
        throw new Error('Migration audit plan is not valid JSON');
    }
    assert.match(plan?.databaseVersion || '', /^8\./u, 'Unexpected production database version');
    assert.ok(Array.isArray(plan?.pending), 'Pending migration list is unavailable');
    assert.ok(
        plan.pending.every(name => /^[A-Za-z]+\w*\d{13}$/u.test(name)),
        'Invalid pending migration name',
    );
    assert.ok(plan?.schema && typeof plan.schema === 'object', 'Migration schema state is unavailable');
    return {
        databaseVersion: plan.databaseVersion,
        pendingCount: plan.pending.length,
        pendingDigest: createHash('sha256').update(JSON.stringify(plan.pending)).digest('hex'),
        schema: plan.schema,
    };
}

function productionHealthSnapshot() {
    return readCommand('systemctl', [
        'show',
        'vendure-production-healthcheck.service',
        '--property=Result,ExecMainStatus,ActiveState',
    ]);
}

function validateOrderSalesOwnershipOutput(output, operation) {
    assert.ok(Buffer.byteLength(output) <= 4096, 'Order ownership evidence exceeds the safe limit');
    const prefix = `ORDER_SALES_OWNERSHIP_${operation.toUpperCase()} `;
    const planLine = output.split('\n').find(line => line.startsWith(prefix));
    assert.ok(planLine, 'Order ownership evidence is unavailable');
    assert.ok(
        output.endsWith(`ORDER_SALES_OWNERSHIP_BACKFILL_OK operation=${operation}\n`),
        'Order ownership completion evidence is missing',
    );
    let plan;
    try {
        plan = JSON.parse(planLine.slice(prefix.length));
    } catch {
        throw new Error('Order ownership evidence is not valid JSON');
    }
    assert.equal(plan?.format, 1, 'Unexpected order ownership plan format');
    assert.equal(
        plan?.schema,
        'vendure-order-sales-ownership-backfill',
        'Unexpected order ownership plan schema',
    );
    assert.equal(plan?.mode, 'deterministic-channel-membership', 'Unexpected ownership mapping mode');
    assert.ok(Number.isSafeInteger(plan?.candidateCount) && plan.candidateCount >= 0);
    assert.match(plan?.operationDigest || '', /^[a-f0-9]{64}$/u);
    assert.ok(plan?.countsByChannel && typeof plan.countsByChannel === 'object');
    for (const [channelCode, count] of Object.entries(plan.countsByChannel)) {
        assert.match(channelCode, /^(?:__default_channel__|[a-z0-9_][a-z0-9_-]*|美宜佳)$/u);
        assert.ok(Number.isSafeInteger(count) && count >= 0);
    }
    assert.equal(
        Object.values(plan.countsByChannel).reduce((total, count) => total + count, 0),
        plan.candidateCount,
    );
    assert.equal('operations' in plan, false, 'Raw order references must not leave the server');
    return plan;
}

function validateMoyaoDefaultStoreMigrationOutput(output, operation) {
    assert.ok(Buffer.byteLength(output) <= 8192, 'MOYAO migration evidence exceeds the safe limit');
    const prefix = `MOYAO_DEFAULT_STORE_${operation.toUpperCase()} `;
    const planLine = output.split('\n').find(line => line.startsWith(prefix));
    assert.ok(planLine, 'MOYAO migration evidence is unavailable');
    assert.ok(
        output.endsWith(`MOYAO_DEFAULT_STORE_MIGRATION_OK operation=${operation}\n`),
        'MOYAO migration completion evidence is missing',
    );
    let plan;
    try {
        plan = JSON.parse(planLine.slice(prefix.length));
    } catch {
        throw new Error('MOYAO migration evidence is not valid JSON');
    }
    assert.equal(plan?.format, 1, 'Unexpected MOYAO migration plan format');
    if (operation === 'verify') {
        assert.equal(plan?.schema, 'vendure-moyao-default-store-migration-verification');
        assert.ok(Number.isSafeInteger(plan?.targetContentBlockCount) && plan.targetContentBlockCount > 0);
        assert.ok(Number.isSafeInteger(plan?.relationTablesVerified) && plan.relationTablesVerified > 0);
        assert.ok(
            Number.isSafeInteger(plan?.movedChannelTablesVerified) && plan.movedChannelTablesVerified > 0,
        );
        assert.equal(plan?.defaultOwnedOrderCount, 0);
        assert.equal(plan?.profileMatches, true);
        assert.equal(plan?.contentSettingsMatch, true);
    } else {
        assert.equal(plan?.schema, 'vendure-moyao-default-store-migration');
        assert.equal(plan?.mode, 'reviewed-default-to-dedicated-channel');
        assert.ok(Number.isSafeInteger(plan?.contentBlockCount) && plan.contentBlockCount > 0);
        assert.ok(Number.isSafeInteger(plan?.orderSalesOwnerCount) && plan.orderSalesOwnerCount >= 0);
        assert.match(plan?.operationDigest || '', /^[a-f0-9]{64}$/u);
        assert.ok(plan?.addedRelations && typeof plan.addedRelations === 'object');
        assert.ok(plan?.movedChannelRows && typeof plan.movedChannelRows === 'object');
        for (const [table, count] of Object.entries({
            ...plan.addedRelations,
            ...plan.movedChannelRows,
        })) {
            assert.match(table, /^[a-z][a-z0-9_]*$/u);
            assert.ok(Number.isSafeInteger(count) && count >= 0);
        }
    }
    assert.equal(plan?.sourceChannelCode, '__default_channel__');
    assert.equal(plan?.targetChannelCode, 'moyao-ai');
    return plan;
}

function startVerifiedMysqlBackup() {
    execFileSync('sudo', ['-n', 'systemctl', 'start', 'vendure-mysql-backup.service'], {
        encoding: 'utf8',
        timeout: 540000,
        maxBuffer: 65536,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state = execFileSync(
        'systemctl',
        ['show', 'vendure-mysql-backup.service', '--property=Result,ExecMainStatus,ActiveState,InvocationID'],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert.match(state, /^Result=success$/mu, 'Database backup did not succeed');
    assert.match(state, /^ExecMainStatus=0$/mu, 'Database backup command failed');
    assert.match(state, /^ActiveState=inactive$/mu, 'Database backup service did not finish');
    const invocationId = state.match(/^InvocationID=([a-f0-9]{32})$/mu)?.[1];
    assert.ok(invocationId, 'Database backup invocation evidence is unavailable');
    const journal = execFileSync(
        'sudo',
        ['-n', 'journalctl', `_SYSTEMD_INVOCATION_ID=${invocationId}`, '--no-pager', '-o', 'cat'],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const evidence = journal.match(
        /^Created verified MySQL backup: (\/var\/backups\/vendure-mysql\/vendure-[0-9]{8}T[0-9]{6}Z\.sql\.gz) offsite=yes$/mu,
    );
    assert.ok(evidence, 'Database backup is missing verified offsite evidence');
    const file = evidence[1];
    for (const candidate of [file, `${file}.sha256`, `${file}.manifest.json`]) {
        assert.ok(
            existsSync(candidate) && statSync(candidate).isFile(),
            'Database backup file is unavailable',
        );
    }
    return { file, invocationId, offsite: true };
}

function runDatabaseBackup(
    request,
    {
        inspect = inspectProductionReleases,
        health = productionHealthSnapshot,
        backup = startVerifiedMysqlBackup,
    } = {},
) {
    assert.equal(request.operation, 'backup-database');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    const healthBefore = health();
    assertProductionHealthSnapshot(healthBefore, 'before');
    const backupEvidence = backup();
    const after = inspect();
    assert.deepEqual(after, before, 'Production release state changed during the database backup');
    const healthAfter = health();
    assertProductionHealthSnapshot(healthAfter, 'after');
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        healthBefore,
        healthAfter,
        backup: backupEvidence,
    };
}

function runOrderSalesOwnershipBackfill(
    request,
    {
        inspect = inspectProductionReleases,
        health = productionHealthSnapshot,
        spawn = spawnSync,
        backup = startVerifiedMysqlBackup,
        script = path.join(
            __dirname,
            'repository',
            'packages',
            'dev-server',
            'scripts',
            'order-sales-ownership-backfill.mjs',
        ),
    } = {},
) {
    const apply = request.operation === 'apply-order-sales-ownership-backfill-reviewed';
    assert.ok(apply || request.operation === 'plan-order-sales-ownership-backfill');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    const healthBefore = health();
    assertProductionHealthSnapshot(healthBefore, 'before');
    const run = (operation, digest = '') => {
        const result = spawn(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                script,
                operation,
                ...(digest ? [digest] : []),
            ],
            {
                encoding: 'utf8',
                timeout: 540000,
                maxBuffer: 65536,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
            },
        );
        assert.equal(result.status, 0, `The fixed order ownership ${operation} failed`);
        return validateOrderSalesOwnershipOutput(String(result.stdout || ''), operation);
    };
    const reviewedPlan = run('plan');
    let backupEvidence = null;
    let appliedPlan = null;
    if (apply) {
        assert.equal(
            reviewedPlan.operationDigest,
            request.expectedPlanSha256,
            'Order ownership plan changed; rerun the read-only plan and review it again',
        );
        assert.ok(reviewedPlan.candidateCount > 0, 'No historical orders require ownership backfill');
        backupEvidence = backup();
        appliedPlan = run('apply', request.expectedPlanSha256);
        assert.deepEqual(
            appliedPlan,
            reviewedPlan,
            'Applied ownership evidence differs from the reviewed plan',
        );
    }
    const after = inspect();
    assert.deepEqual(after, before, 'Production release state changed during order ownership backfill');
    const healthAfter = health();
    assertProductionHealthSnapshot(healthAfter, 'after');
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        healthBefore,
        healthAfter,
        plan: reviewedPlan,
        ...(backupEvidence ? { backup: backupEvidence } : {}),
        applied: Boolean(appliedPlan),
    };
}

function runMoyaoDefaultStoreMigration(
    request,
    {
        inspect = inspectProductionReleases,
        health = productionHealthSnapshot,
        spawn = spawnSync,
        backup = startVerifiedMysqlBackup,
        script = path.join(
            __dirname,
            'repository',
            'packages',
            'dev-server',
            'scripts',
            'moyao-default-store-migration.mjs',
        ),
    } = {},
) {
    const apply = request.operation === 'apply-moyao-default-store-migration-reviewed';
    const verify = request.operation === 'verify-moyao-default-store-migration';
    assert.ok(apply || verify || request.operation === 'plan-moyao-default-store-migration');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    const healthBefore = health();
    assertProductionHealthSnapshot(healthBefore, 'before');
    const run = (operation, digest = '') => {
        const result = spawn(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                script,
                operation,
                ...(digest ? [digest] : []),
            ],
            {
                encoding: 'utf8',
                timeout: 540000,
                maxBuffer: 65536,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
            },
        );
        assert.equal(result.status, 0, `The fixed MOYAO migration ${operation} failed`);
        return validateMoyaoDefaultStoreMigrationOutput(String(result.stdout || ''), operation);
    };
    let plan = null;
    let backupEvidence = null;
    let verification = null;
    if (verify) {
        verification = run('verify');
    } else {
        plan = run('plan');
        if (apply) {
            assert.equal(
                plan.operationDigest,
                request.expectedPlanSha256,
                'MOYAO migration plan changed; rerun the read-only plan and review it again',
            );
            backupEvidence = backup();
            const applied = run('apply', request.expectedPlanSha256);
            assert.deepEqual(
                applied,
                plan,
                'Applied MOYAO migration evidence differs from the reviewed plan',
            );
            verification = run('verify');
        }
    }
    const after = inspect();
    assert.deepEqual(after, before, 'Production release state changed during MOYAO migration');
    const healthAfter = health();
    assertProductionHealthSnapshot(healthAfter, 'after');
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        healthBefore,
        healthAfter,
        ...(plan ? { plan } : {}),
        ...(backupEvidence ? { backup: backupEvidence } : {}),
        ...(verification ? { verification } : {}),
        applied: apply,
    };
}

function assertProductionHealthSnapshot(snapshot, stage) {
    assert.equal(snapshot.status, 'ok', `Production health state is unavailable ${stage} the audit`);
    assert.match(
        snapshot.output,
        /^Result=success$/mu,
        `Production health check is not successful ${stage} the audit`,
    );
    assert.match(
        snapshot.output,
        /^ExecMainStatus=0$/mu,
        `Production health command failed ${stage} the audit`,
    );
    assert.match(
        snapshot.output,
        /^ActiveState=(?:active|inactive)$/mu,
        `Production health state is invalid ${stage} the audit`,
    );
}

function runStoreIsolationAudit(
    request,
    {
        inspect = inspectProductionReleases,
        spawn = spawnSync,
        health = productionHealthSnapshot,
        auditScript = path.join(
            __dirname,
            'repository',
            'packages',
            'dev-server',
            'scripts',
            'store-autonomy-data-audit.mjs',
        ),
        migrationGuard = path.join(__dirname, 'usdt-migration-guard.cjs'),
    } = {},
) {
    assert.equal(request.operation, 'audit-store-isolation-data');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    const healthBefore = health();
    assertProductionHealthSnapshot(healthBefore, 'before');
    let migrationState;
    let payload;
    let auditError;
    try {
        const migrationResult = spawn(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                migrationGuard,
                'plan',
                before.currentRuntime,
                '',
                path.join(__dirname, 'repository'),
            ],
            {
                encoding: 'utf8',
                timeout: 120000,
                maxBuffer: 65536,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        assert.equal(migrationResult.status, 0, 'The fixed read-only migration audit failed');
        migrationState = validateMigrationAuditOutput(String(migrationResult.stdout || ''));
        assert.equal(migrationState.pendingCount, 0, 'Production database has pending migrations');
        const result = spawn(
            '/usr/bin/node',
            ['--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env', auditScript],
            {
                encoding: 'utf8',
                timeout: 540000,
                maxBuffer: 65536,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    STORE_ISOLATION_AUDIT_KEY: randomBytes(32).toString('hex'),
                    STORE_ISOLATION_MODULE_ROOT: before.currentRuntime,
                    // Baseline evidence must be collectible before the expand-only
                    // ownership migrations run. Missing structure remains NO_GO in
                    // the report; it is never treated as a successful audit.
                    STORE_ISOLATION_REQUIRE_EXPECTED_SCHEMA: '0',
                },
            },
        );
        assert.equal(result.status, 0, 'The fixed read-only store isolation audit failed');
        payload = validateStoreAutonomyAuditPayload(String(result.stdout || '').trim());
    } catch (error) {
        auditError = error;
    }
    let after;
    let stateError;
    try {
        after = inspect();
        assert.deepEqual(after, before, 'Production release state changed during the store isolation audit');
    } catch (error) {
        stateError = error;
    }
    let healthAfter;
    try {
        healthAfter = health();
        assertProductionHealthSnapshot(healthAfter, 'after');
    } catch (error) {
        stateError ||= error;
    }
    if (stateError) throw stateError;
    if (auditError) throw auditError;
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        healthBefore,
        healthAfter,
        migrationState,
        audit: payload,
    };
}

function runLocked(environment = process.env) {
    const request = validateRequest(environment);
    if (request.operation === 'backup-database') {
        const result = runDatabaseBackup(request);
        process.stdout.write(
            `PRODUCTION_DATABASE_BACKUP_REVISIONS source=${request.sourceSha} runtime=${result.runtimeSha}\n`,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=backup-database\n');
        return;
    }
    if (
        [
            'plan-moyao-default-store-migration',
            'apply-moyao-default-store-migration-reviewed',
            'verify-moyao-default-store-migration',
        ].includes(request.operation)
    ) {
        const result = runMoyaoDefaultStoreMigration(request);
        process.stdout.write(
            `PRODUCTION_MOYAO_DEFAULT_STORE_REVISIONS source=${request.sourceSha} runtime=${result.runtimeSha}\n`,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.stdout.write(`PRODUCTION_OPERATIONS_COMPLETE operation=${request.operation}\n`);
        return;
    }
    if (
        ['plan-order-sales-ownership-backfill', 'apply-order-sales-ownership-backfill-reviewed'].includes(
            request.operation,
        )
    ) {
        const result = runOrderSalesOwnershipBackfill(request);
        process.stdout.write(
            `PRODUCTION_ORDER_SALES_OWNERSHIP_REVISIONS source=${request.sourceSha} runtime=${result.runtimeSha}\n`,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.stdout.write(`PRODUCTION_OPERATIONS_COMPLETE operation=${request.operation}\n`);
        return;
    }
    if (request.operation === 'audit-store-isolation-data') {
        const result = runStoreIsolationAudit(request);
        process.stdout.write(
            `PRODUCTION_STORE_ISOLATION_REVISIONS source=${request.sourceSha} runtime=${result.runtimeSha}\n`,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=audit-store-isolation-data\n');
        return;
    }
    if (request.operation === 'postflight-release') {
        const plan = inspectProductionReleases();
        assert.equal(
            plan.markerSha,
            request.sourceSha,
            'Post-deploy acceptance requires the exact running SHA',
        );
        const storefront = spawnSync(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                path.join(__dirname, 'storefront-configuration-guard.mjs'),
                'preflight',
                request.expectedChannelCodes,
            ],
            { encoding: 'utf8', timeout: 240000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        assert.equal(storefront.status, 0, storefrontInspectionFailure(storefront));
        assert.ok(
            storefront.stdout.endsWith('STOREFRONT_CONFIGURATION_PREFLIGHT_OK\n'),
            'Post-deploy storefront evidence is incomplete',
        );
        process.stdout.write(`PRODUCTION_POSTFLIGHT_REVISION runtime=${plan.markerSha}\n`);
        process.stdout.write(frontendRevisionEvidence(plan));
        process.stdout.write(storefront.stdout);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=postflight-release\n');
        return;
    }
    if (request.operation === 'preflight-release') {
        const plan = inspectProductionReleases();
        assertStorefrontInspectionRevision(plan.markerSha, request.sourceSha);
        const storefront = spawnSync(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                path.join(__dirname, 'storefront-configuration-guard.mjs'),
                'preflight',
                request.expectedChannelCodes,
            ],
            { encoding: 'utf8', timeout: 240000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        assert.equal(storefront.status, 0, storefrontInspectionFailure(storefront));
        assert.ok(
            storefront.stdout.endsWith('STOREFRONT_CONFIGURATION_PREFLIGHT_OK\n'),
            'Storefront preflight evidence is incomplete',
        );
        const migrations = spawnSync(
            '/usr/bin/node',
            [
                path.join(__dirname, 'usdt-migration-guard.cjs'),
                'plan',
                plan.currentRuntime,
                '',
                path.join(__dirname, 'repository'),
            ],
            { encoding: 'utf8', timeout: 120000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        assert.equal(migrations.status, 0, 'Production migration preflight failed');
        assert.ok(
            migrations.stdout.endsWith('USDT_RUNTIME_GUARD_OK operation=plan\n'),
            'Migration preflight evidence is incomplete',
        );
        process.stdout.write(
            `PRODUCTION_PREFLIGHT_REVISIONS source=${request.sourceSha} runtime=${plan.markerSha}\n`,
        );
        process.stdout.write(frontendRevisionEvidence(plan));
        process.stdout.write(storefront.stdout);
        process.stdout.write(migrations.stdout);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=preflight-release\n');
        return;
    }
    if (request.operation === 'inspect-storefront-config') {
        const plan = inspectProductionReleases();
        // A failed deployment can leave the previous immutable runtime active. Inspect it without promoting it.
        assertStorefrontInspectionRevision(plan.markerSha, request.sourceSha);
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
        assert.equal(result.status, 0, storefrontInspectionFailure(result));
        assert.ok(
            result.stdout.endsWith('STOREFRONT_CONFIGURATION_INSPECT_OK\n'),
            'Storefront evidence is incomplete',
        );
        process.stdout.write(
            `STOREFRONT_CONFIGURATION_REVISIONS source=${request.sourceSha} runtime=${plan.markerSha}\n`,
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
    frontendRevisionEvidence,
    assertStorefrontInspectionRevision,
    encodeBeforeReport,
    inspectProductionReleases,
    inspectRepositoryState,
    planDigest,
    retainReviewedPlan,
    storefrontInspectionFailure,
    runStoreIsolationAudit,
    runDatabaseBackup,
    runOrderSalesOwnershipBackfill,
    runMoyaoDefaultStoreMigration,
    startVerifiedMysqlBackup,
    validateMigrationAuditOutput,
    validateOrderSalesOwnershipOutput,
    validateMoyaoDefaultStoreMigrationOutput,
    validateStoreAutonomyAuditPayload,
    validateRequest,
    withProductionLock,
};
