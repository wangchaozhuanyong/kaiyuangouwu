#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const {
    closeSync,
    constants,
    existsSync,
    fchmodSync,
    fchownSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    unlinkSync,
    writeSync,
} = require('node:fs');
const path = require('node:path');

const retention = require('./systemd/vendure-production-release-retention.cjs');

const DEPLOY_LOCK = '/run/lock/vendure-production-deploy.lock';
const APT_ARCHIVES_DIRECTORY = '/var/cache/apt/archives';
const APT_METADATA_DIRECTORY = '/var/cache/apt';
const APT_METADATA_FILENAMES = Object.freeze(['pkgcache.bin', 'srcpkgcache.bin']);
const APT_LISTS_DIRECTORY = '/var/lib/apt/lists';
const SNAP_DOWNLOAD_CACHE_DIRECTORY = '/var/lib/snapd/cache';
const BACKUP_DIRECTORY = '/var/backups/vendure-mysql';
const FILE_BACKUP_DIRECTORY = '/var/backups/vendure-files';
const FILE_BACKUP_KEEP_COUNT = 3;
const PRODUCTION_ENVIRONMENT_FILE = '/var/www/kaiyuangouwu/packages/dev-server/.env';
const OFFSITE_FILE_BACKUP_URI = 's3://yunqiao-vendure-prod-backup-079740175286-apne1/files';
const OFFSITE_FILE_BACKUP_RETENTION_DAYS = 30;
const OFFSITE_FILE_BACKUP_SETTINGS = Object.freeze({
    VENDURE_REQUIRE_OFFSITE_FILE_BACKUP: 'true',
    VENDURE_FILE_BACKUP_S3_URI: OFFSITE_FILE_BACKUP_URI,
    VENDURE_FILE_BACKUP_S3_RETENTION_DAYS: String(OFFSITE_FILE_BACKUP_RETENTION_DAYS),
});
const DEPLOYMENT_CACHE_DIRECTORIES = Object.freeze([
    { label: 'repository-node-modules', directory: '/var/www/kaiyuangouwu/node_modules' },
    { label: 'ubuntu-bun-install-cache', directory: '/home/ubuntu/.bun/install/cache' },
    { label: 'ubuntu-npm-content-cache', directory: '/home/ubuntu/.npm/_cacache' },
    { label: 'root-bun-install-cache', directory: '/root/.bun/install/cache' },
    { label: 'root-npm-content-cache', directory: '/root/.npm/_cacache' },
]);

function restoreMissingProductionLock(lockPath = DEPLOY_LOCK, owner = 'ubuntu') {
    // /run is cleared on reboot. Let the deployment account create its own lock
    // exclusively, so root never leaves a root-owned inode in the sticky directory.
    const createExclusive = [
        'import os, sys',
        'os.umask(0o027)',
        'try:',
        '    fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)',
        'except FileExistsError:',
        '    pass',
        'else:',
        '    os.close(fd)',
    ].join('\n');
    const created = spawnSync('runuser', ['-u', owner, '--', 'python3', '-c', createExclusive, lockPath], {
        stdio: 'ignore',
        timeout: 10000,
    });
    assert.equal(created.status, 0, 'Could not restore the production deployment lock as its owner');
}

function withProductionLock(callback, lockPath = DEPLOY_LOCK) {
    // The deployment lock is owned by ubuntu in a sticky directory. Root must
    // neither create it nor change its owner when /run/lock is cleared on reboot.
    let lockFd;
    try {
        lockFd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
        if (lockPath !== DEPLOY_LOCK || error.code !== 'ENOENT') throw error;
        restoreMissingProductionLock();
        lockFd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    try {
        const lockInfo = fstatSync(lockFd);
        assert.ok(lockInfo.isFile(), 'The production lock must be a regular file');
        if (lockPath === DEPLOY_LOCK)
            assert.equal(
                lockInfo.uid,
                statSync('/home/ubuntu').uid,
                'The production lock must belong to ubuntu',
            );
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
            'plan-deployment-cache-cleanup',
            'apply-deployment-cache-cleanup-reviewed',
            'plan-apt-archive-cleanup',
            'apply-apt-archive-cleanup-reviewed',
            'plan-apt-metadata-cleanup',
            'apply-apt-metadata-cleanup-reviewed',
            'plan-apt-lists-cleanup',
            'apply-apt-lists-cleanup-reviewed',
            'plan-snap-cache-cleanup',
            'apply-snap-cache-cleanup-reviewed',
            'plan-archived-log-cleanup',
            'apply-archived-log-cleanup-reviewed',
            'plan-file-backup-cleanup',
            'apply-file-backup-cleanup-reviewed',
            'plan-offsite-file-backup-config',
            'apply-offsite-file-backup-config-reviewed',
            'plan-two-factor-backup',
            'backup-two-factor-reviewed',
            'verify-two-factor-backup',
            'verify-security-dependencies',
            'inspect-storefront-config',
            'inspect-icloud-relay',
            'inspect-notification-config',
            'enable-unified-notifications',
            'prepare-notification-secret-transfer',
            'audit-store-isolation-data',
            'plan-platform-store-governance',
            'audit-administrator-product-readiness',
            'plan-order-sales-ownership-backfill',
            'apply-order-sales-ownership-backfill-reviewed',
            'plan-moyao-default-store-migration',
            'apply-moyao-default-store-migration-reviewed',
            'verify-moyao-default-store-migration',
            'plan-asset-webp-migration',
            'apply-asset-webp-migration-reviewed',
            'verify-asset-webp-migration',
            'preflight-release',
            'postflight-release',
        ].includes(operation),
        'Unsupported production operation',
    );
    assert.match(environment.OPS_SOURCE_SHA || '', /^[a-f0-9]{40}$/u, 'Invalid operations source SHA');
    const notificationPublicKey = environment.OPS_NOTIFICATION_PUBLIC_KEY || '';
    if (operation === 'prepare-notification-secret-transfer') {
        assert.match(
            notificationPublicKey,
            /^[A-Za-z0-9+/=]{400,1000}$/u,
            'Invalid notification recipient key',
        );
    } else {
        assert.equal(
            notificationPublicKey,
            '',
            'Only encrypted notification transfer accepts a recipient key',
        );
    }
    const expectedPlanSha256 = environment.OPS_EXPECTED_PLAN_SHA256 || '';
    const expectedChannelCodes = environment.OPS_EXPECTED_CHANNEL_CODES || '';
    const expectedRuntimeSha = environment.OPS_EXPECTED_RUNTIME_SHA || '';
    const productId = environment.OPS_PRODUCT_ID || '';
    if (
        [
            'retain-reviewed',
            'apply-deployment-cache-cleanup-reviewed',
            'apply-apt-archive-cleanup-reviewed',
            'apply-apt-metadata-cleanup-reviewed',
            'apply-apt-lists-cleanup-reviewed',
            'apply-snap-cache-cleanup-reviewed',
            'apply-archived-log-cleanup-reviewed',
            'apply-file-backup-cleanup-reviewed',
            'apply-offsite-file-backup-config-reviewed',
            'backup-two-factor-reviewed',
            'apply-order-sales-ownership-backfill-reviewed',
            'apply-moyao-default-store-migration-reviewed',
            'apply-asset-webp-migration-reviewed',
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
            'inspect-icloud-relay',
            'plan-platform-store-governance',
            'audit-administrator-product-readiness',
            'plan-order-sales-ownership-backfill',
            'apply-order-sales-ownership-backfill-reviewed',
            'plan-moyao-default-store-migration',
            'apply-moyao-default-store-migration-reviewed',
            'verify-moyao-default-store-migration',
            'plan-asset-webp-migration',
            'apply-asset-webp-migration-reviewed',
            'verify-asset-webp-migration',
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
    if (operation === 'audit-administrator-product-readiness') {
        assert.match(productId, /^[1-9][0-9]*$/u, 'A positive product ID is required');
    } else {
        assert.equal(productId, '', 'Product ID is only valid for the administrator and product audit');
    }
    return {
        operation,
        sourceSha: environment.OPS_SOURCE_SHA,
        expectedPlanSha256,
        expectedChannelCodes,
        expectedRuntimeSha,
        ...(productId ? { productId } : {}),
    };
}

function planDigest(plan, sourceSha) {
    return createHash('sha256').update(JSON.stringify({ sourceSha, plan })).digest('hex');
}

function parseEnvironmentAssignment(line) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    return match ? { name: match[1], value: match[2].trim() } : null;
}

function readOffsiteFileBackupSettings(contents) {
    const settings = {};
    for (const line of contents.split(/\r?\n/u)) {
        const assignment = parseEnvironmentAssignment(line);
        if (!assignment || !Object.hasOwn(OFFSITE_FILE_BACKUP_SETTINGS, assignment.name)) continue;
        assert.ok(
            !Object.hasOwn(settings, assignment.name),
            `Duplicate production setting: ${assignment.name}`,
        );
        settings[assignment.name] = assignment.value;
    }
    return settings;
}

function readProtectedEnvironmentFile(environmentFile) {
    const fileDescriptor = openSync(environmentFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const metadata = fstatSync(fileDescriptor);
        assert.ok(metadata.isFile(), 'The production environment must be a regular file');
        assert.ok(
            metadata.size > 0 && metadata.size <= 1024 * 1024,
            'The production environment file size is invalid',
        );
        const contents = readFileSync(fileDescriptor, 'utf8');
        return {
            contents,
            metadata,
            digest: createHash('sha256').update(contents).digest('hex'),
        };
    } finally {
        closeSync(fileDescriptor);
    }
}

function verifyOffsiteFileBackupPolicy(
    uri,
    retentionDays,
    guardPath = path.join(__dirname, 'systemd/vendure-backup-s3-guard.py'),
) {
    const result = spawnSync('/usr/bin/python3', [guardPath, uri, String(retentionDays)], {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 65536,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, 'The fixed S3 file-backup policy verification failed');
    return true;
}

function inspectOffsiteFileBackupConfig(
    sourceSha,
    { environmentFile = PRODUCTION_ENVIRONMENT_FILE, verifyPolicy = verifyOffsiteFileBackupPolicy } = {},
) {
    assert.match(sourceSha, /^[a-f0-9]{40}$/u, 'Invalid operations source SHA');
    const environment = readProtectedEnvironmentFile(environmentFile);
    const current = readOffsiteFileBackupSettings(environment.contents);
    const normalizedCurrent = Object.fromEntries(
        Object.keys(OFFSITE_FILE_BACKUP_SETTINGS).map(name => [name, current[name] ?? null]),
    );
    assert.equal(
        verifyPolicy(OFFSITE_FILE_BACKUP_URI, OFFSITE_FILE_BACKUP_RETENTION_DAYS),
        true,
        'The fixed S3 file-backup policy was not verified',
    );
    return {
        schema: 'vendure-offsite-file-backup-config',
        sourceSha,
        destination: OFFSITE_FILE_BACKUP_URI,
        retentionDays: OFFSITE_FILE_BACKUP_RETENTION_DAYS,
        policyVerified: true,
        currentSettingsSha256: createHash('sha256').update(JSON.stringify(normalizedCurrent)).digest('hex'),
        changes: Object.entries(OFFSITE_FILE_BACKUP_SETTINGS)
            .filter(([name, value]) => current[name] !== value)
            .map(([name]) => name),
    };
}

function renderOffsiteFileBackupSettings(contents, settings = OFFSITE_FILE_BACKUP_SETTINGS) {
    readOffsiteFileBackupSettings(contents);
    const newline = contents.includes('\r\n') ? '\r\n' : '\n';
    const hadTrailingNewline = contents.endsWith('\n');
    const lines = contents.split(/\r?\n/u);
    if (hadTrailingNewline) lines.pop();
    const replaced = new Set();
    const updated = lines.map(line => {
        const assignment = parseEnvironmentAssignment(line);
        if (!assignment || !Object.hasOwn(settings, assignment.name)) return line;
        replaced.add(assignment.name);
        return `${assignment.name}=${settings[assignment.name]}`;
    });
    for (const [name, value] of Object.entries(settings)) {
        if (!replaced.has(name)) updated.push(`${name}=${value}`);
    }
    return `${updated.join(newline)}${hadTrailingNewline ? newline : ''}`;
}

function updateOffsiteFileBackupConfig(environmentFile, settings = OFFSITE_FILE_BACKUP_SETTINGS) {
    const initial = readProtectedEnvironmentFile(environmentFile);
    const updatedContents = renderOffsiteFileBackupSettings(initial.contents, settings);
    if (updatedContents === initial.contents) return false;

    const directory = path.dirname(environmentFile);
    const temporaryFile = path.join(
        directory,
        `.${path.basename(environmentFile)}.offsite-backup-${process.pid}-${randomBytes(8).toString('hex')}`,
    );
    let temporaryDescriptor;
    try {
        temporaryDescriptor = openSync(
            temporaryFile,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            initial.metadata.mode & 0o777,
        );
        const buffer = Buffer.from(updatedContents, 'utf8');
        let offset = 0;
        while (offset < buffer.length) {
            const written = writeSync(temporaryDescriptor, buffer, offset, buffer.length - offset, offset);
            assert.ok(written > 0, 'The production environment update was incomplete');
            offset += written;
        }
        fchownSync(temporaryDescriptor, initial.metadata.uid, initial.metadata.gid);
        fchmodSync(temporaryDescriptor, initial.metadata.mode & 0o777);
        fsyncSync(temporaryDescriptor);
        closeSync(temporaryDescriptor);
        temporaryDescriptor = undefined;

        const current = readProtectedEnvironmentFile(environmentFile);
        assert.equal(current.metadata.dev, initial.metadata.dev, 'Production environment device changed');
        assert.equal(current.metadata.ino, initial.metadata.ino, 'Production environment file changed');
        assert.equal(current.digest, initial.digest, 'Production environment contents changed');
        renameSync(temporaryFile, environmentFile);
        const directoryDescriptor = openSync(directory, constants.O_RDONLY);
        try {
            fsyncSync(directoryDescriptor);
        } finally {
            closeSync(directoryDescriptor);
        }
        return true;
    } finally {
        if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
        rmSync(temporaryFile, { force: true });
    }
}

function applyOffsiteFileBackupConfig(
    request,
    {
        environmentFile = PRODUCTION_ENVIRONMENT_FILE,
        verifyPolicy = verifyOffsiteFileBackupPolicy,
        update = updateOffsiteFileBackupConfig,
    } = {},
) {
    assert.equal(
        request.operation,
        'apply-offsite-file-backup-config-reviewed',
        'The reviewed offsite file-backup configuration operation is required',
    );
    const inspect = () =>
        inspectOffsiteFileBackupConfig(request.sourceSha, { environmentFile, verifyPolicy });
    const plan = inspect();
    assert.equal(
        planDigest(plan, request.sourceSha),
        request.expectedPlanSha256,
        'Offsite file-backup configuration changed; review a new plan',
    );
    assert.deepEqual(inspect(), plan, 'Offsite file-backup configuration changed before apply');
    const changed = update(environmentFile, OFFSITE_FILE_BACKUP_SETTINGS);
    const completed = inspect();
    assert.deepEqual(completed.changes, [], 'Offsite file-backup configuration remains incomplete');
    return {
        changed,
        destination: completed.destination,
        retentionDays: completed.retentionDays,
    };
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

function directorySizeKib(directory) {
    const output = execFileSync('du', ['-skx', '--', directory], {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const match = /^(\d+)\s/u.exec(output);
    assert.ok(match, 'Could not read deployment cache size');
    const sizeKib = Number(match[1]);
    assert.ok(Number.isSafeInteger(sizeKib) && sizeKib >= 0, 'Invalid deployment cache size');
    return sizeKib;
}

function inspectDeploymentCacheCleanup(
    sourceSha,
    {
        directories = DEPLOYMENT_CACHE_DIRECTORIES,
        inspectRepository = inspectRepositoryState,
        inspectRuntime = inspectProductionReleases,
        assertRepositoryRevision = assertStorefrontInspectionRevision,
        sizeDirectory = directorySizeKib,
    } = {},
) {
    const initialRepository = inspectRepository(sourceSha);
    assert.equal(initialRepository.status, 'ok', 'Repository state is unavailable');
    assertRepositoryRevision(initialRepository.head, sourceSha);
    const repository = inspectRepository(sourceSha);
    assert.equal(repository.status, 'ok', 'Repository state is unavailable');
    assert.equal(repository.head, initialRepository.head, 'Repository HEAD changed during cache inspection');
    assert.equal(
        repository.originMainMatchesOperationsSource,
        true,
        'Repository origin/main does not match operations source',
    );
    assert.equal(repository.trackedClean, true, 'Repository has tracked changes; cache cleanup is blocked');
    const runtime = inspectRuntime();
    const candidates = directories.flatMap(candidate => {
        if (!existsSync(candidate.directory)) return [];
        const stat = lstatSync(candidate.directory);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Deployment cache must be a real directory');
        assert.equal(realpathSync(candidate.directory), candidate.directory, 'Deployment cache path changed');
        assert.ok(
            runtime.currentRuntime !== candidate.directory &&
                !runtime.currentRuntime.startsWith(`${candidate.directory}${path.sep}`),
            'Deployment cache contains the current runtime',
        );
        return [
            {
                label: candidate.label,
                directory: candidate.directory,
                sizeKib: sizeDirectory(candidate.directory),
            },
        ];
    });
    return {
        format: 1,
        schema: 'vendure-deployment-cache-cleanup',
        repositorySha: repository.head,
        runtimeSha: runtime.markerSha,
        candidates,
        totalKib: candidates.reduce((total, candidate) => total + candidate.sizeKib, 0),
    };
}

function applyDeploymentCacheCleanup(
    request,
    {
        inspect = sourceSha => inspectDeploymentCacheCleanup(sourceSha),
        remove = directory => rmSync(directory, { recursive: true, force: false }),
    } = {},
) {
    assert.equal(
        request.operation,
        'apply-deployment-cache-cleanup-reviewed',
        'Deployment cache cleanup requires the reviewed operation',
    );
    const plan = inspect(request.sourceSha);
    assert.ok(plan.candidates.length > 0 && plan.totalKib > 0, 'No deployment caches are available to clean');
    assert.equal(
        planDigest(plan, request.sourceSha),
        request.expectedPlanSha256,
        'Deployment cache cleanup plan changed; review a new plan',
    );
    const revalidatedPlan = inspect(request.sourceSha);
    assert.deepEqual(revalidatedPlan, plan, 'Deployment cache state changed before cleanup');
    for (const candidate of revalidatedPlan.candidates) remove(candidate.directory);
    return revalidatedPlan;
}

function inspectAptArchiveCleanup(sourceSha, { cacheDirectory = APT_ARCHIVES_DIRECTORY, ...options } = {}) {
    const plan = inspectDeploymentCacheCleanup(sourceSha, {
        ...options,
        directories: [{ label: 'apt-package-archives', directory: cacheDirectory }],
    });
    return { ...plan, schema: 'vendure-apt-archive-cleanup' };
}

function applyAptArchiveCleanup(
    request,
    {
        inspect = sourceSha => inspectAptArchiveCleanup(sourceSha),
        clean = directory =>
            execFileSync('apt-get', ['-o', `Dir::Cache::archives=${directory}`, 'clean'], {
                timeout: 120000,
                stdio: ['ignore', 'ignore', 'pipe'],
            }),
    } = {},
) {
    assert.equal(request.operation, 'apply-apt-archive-cleanup-reviewed');
    const plan = inspect(request.sourceSha);
    assert.equal(plan.schema, 'vendure-apt-archive-cleanup');
    assert.equal(plan.candidates.length, 1, 'APT archive directory is unavailable');
    assert.ok(plan.totalKib > 0, 'No APT archive cache is available to clean');
    assert.equal(planDigest(plan, request.sourceSha), request.expectedPlanSha256, 'APT cache plan changed');
    const revalidatedPlan = inspect(request.sourceSha);
    assert.deepEqual(revalidatedPlan, plan, 'APT cache changed before cleanup');
    clean(revalidatedPlan.candidates[0].directory);
    return revalidatedPlan;
}

function inspectAptMetadataCleanup(sourceSha, { cacheDirectory = APT_METADATA_DIRECTORY, ...options } = {}) {
    const scope = inspectDeploymentCacheCleanup(sourceSha, {
        ...options,
        directories: [{ label: 'apt-cache', directory: cacheDirectory }],
    });
    assert.equal(scope.candidates.length, 1, 'APT cache directory is unavailable');
    const candidates = APT_METADATA_FILENAMES.flatMap(filename => {
        const file = path.join(cacheDirectory, filename);
        if (!existsSync(file)) return [];
        const stat = lstatSync(file);
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'APT metadata cache must be a regular file');
        assert.equal(realpathSync(file), file, 'APT metadata cache path changed');
        return [{ file, sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs }];
    });
    return {
        format: 1,
        schema: 'vendure-apt-metadata-cleanup',
        repositorySha: scope.repositorySha,
        runtimeSha: scope.runtimeSha,
        candidates,
        totalKib: candidates.reduce((total, candidate) => total + Math.ceil(candidate.sizeBytes / 1024), 0),
    };
}

function applyAptMetadataCleanup(
    request,
    { inspect = sourceSha => inspectAptMetadataCleanup(sourceSha), remove = file => unlinkSync(file) } = {},
) {
    assert.equal(request.operation, 'apply-apt-metadata-cleanup-reviewed');
    const plan = inspect(request.sourceSha);
    assert.equal(plan.schema, 'vendure-apt-metadata-cleanup');
    assert.ok(plan.candidates.length > 0 && plan.totalKib > 0, 'No APT metadata cache is available');
    assert.equal(
        planDigest(plan, request.sourceSha),
        request.expectedPlanSha256,
        'APT metadata plan changed',
    );
    const revalidatedPlan = inspect(request.sourceSha);
    assert.deepEqual(revalidatedPlan, plan, 'APT metadata changed before cleanup');
    for (const candidate of revalidatedPlan.candidates) remove(candidate.file);
    return revalidatedPlan;
}

function inspectAptListsCleanup(sourceSha, { listsDirectory = APT_LISTS_DIRECTORY, ...options } = {}) {
    const scope = inspectDeploymentCacheCleanup(sourceSha, {
        ...options,
        directories: [{ label: 'apt-package-lists', directory: listsDirectory }],
    });
    assert.equal(scope.candidates.length, 1, 'APT package lists are unavailable');
    const candidates = [];
    const protectedFiles = [];
    for (const entry of readdirSync(listsDirectory, { withFileTypes: true })) {
        const file = path.join(listsDirectory, entry.name);
        if (entry.isDirectory()) {
            assert.ok(['partial', 'auxfiles'].includes(entry.name), 'Unexpected APT lists directory');
            assert.equal(readdirSync(file).length, 0, 'APT list transfer is in progress');
            continue;
        }
        const stat = lstatSync(file);
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'APT list entry must be a regular file');
        assert.equal(realpathSync(file), file, 'APT list entry path changed');
        const item = {
            file,
            sizeBytes: stat.size,
            allocatedKib: Math.ceil(stat.blocks / 2),
            modifiedAtMs: stat.mtimeMs,
            changedAtMs: stat.ctimeMs,
            device: stat.dev,
            inode: stat.ino,
        };
        if (entry.name === 'lock' || /(?:^|_)(?:InRelease|Release(?:\.gpg)?)$/u.test(entry.name)) {
            protectedFiles.push(item);
        } else {
            candidates.push(item);
        }
    }
    candidates.sort((a, b) => a.file.localeCompare(b.file));
    protectedFiles.sort((a, b) => a.file.localeCompare(b.file));
    return {
        format: 1,
        schema: 'vendure-apt-lists-cleanup',
        repositorySha: scope.repositorySha,
        runtimeSha: scope.runtimeSha,
        candidates,
        protectedFiles,
        totalKib: candidates.reduce((total, candidate) => total + candidate.allocatedKib, 0),
    };
}

function applyAptListsCleanup(
    request,
    {
        inspect = sourceSha => inspectAptListsCleanup(sourceSha),
        clean = () =>
            execFileSync('apt-get', ['-o', `Dir::State::lists=${APT_LISTS_DIRECTORY}`, 'distclean'], {
                timeout: 120000,
                stdio: ['ignore', 'ignore', 'pipe'],
            }),
    } = {},
) {
    assert.equal(request.operation, 'apply-apt-lists-cleanup-reviewed');
    const plan = inspect(request.sourceSha);
    assert.equal(plan.schema, 'vendure-apt-lists-cleanup');
    assert.ok(plan.candidates.length > 0 && plan.totalKib > 0, 'No APT list indexes are available');
    assert.equal(planDigest(plan, request.sourceSha), request.expectedPlanSha256, 'APT lists plan changed');
    assert.deepEqual(inspect(request.sourceSha), plan, 'APT lists changed before cleanup');
    clean();
    return plan;
}

function inspectSnapCacheCleanup(
    sourceSha,
    { cacheDirectory = SNAP_DOWNLOAD_CACHE_DIRECTORY, ...options } = {},
) {
    const scope = inspectDeploymentCacheCleanup(sourceSha, {
        ...options,
        directories: [{ label: 'snap-download-cache', directory: cacheDirectory }],
    });
    assert.equal(scope.candidates.length, 1, 'Snap download cache is unavailable');
    const candidates = readdirSync(cacheDirectory)
        .sort()
        .flatMap(name => {
            const file = path.join(cacheDirectory, name);
            const stat = lstatSync(file);
            assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Snap cache entry must be a regular file');
            assert.equal(realpathSync(file), file, 'Snap cache entry path changed');
            // snapd hard-links installed revisions into its cache. Only an unlinked
            // download cache entry can return disk blocks to this filesystem.
            if (stat.nlink !== 1) return [];
            return [
                {
                    file,
                    sizeBytes: stat.size,
                    allocatedKib: Math.ceil(stat.blocks / 2),
                    modifiedAtMs: stat.mtimeMs,
                    changedAtMs: stat.ctimeMs,
                    device: stat.dev,
                    inode: stat.ino,
                },
            ];
        });
    return {
        format: 1,
        schema: 'vendure-snap-download-cache-cleanup',
        repositorySha: scope.repositorySha,
        runtimeSha: scope.runtimeSha,
        candidates,
        totalKib: candidates.reduce((total, candidate) => total + candidate.allocatedKib, 0),
    };
}

function applySnapCacheCleanup(
    request,
    { inspect = sourceSha => inspectSnapCacheCleanup(sourceSha), remove = file => unlinkSync(file) } = {},
) {
    assert.equal(request.operation, 'apply-snap-cache-cleanup-reviewed');
    const plan = inspect(request.sourceSha);
    assert.equal(plan.schema, 'vendure-snap-download-cache-cleanup');
    assert.ok(
        plan.candidates.length > 0 && plan.totalKib > 0,
        'No unlinked Snap cache entries are available',
    );
    assert.equal(planDigest(plan, request.sourceSha), request.expectedPlanSha256, 'Snap cache plan changed');
    const revalidatedPlan = inspect(request.sourceSha);
    assert.deepEqual(revalidatedPlan, plan, 'Snap cache changed before cleanup');
    for (const candidate of revalidatedPlan.candidates) remove(candidate.file);
    return revalidatedPlan;
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

function inspectFixedLogInventory() {
    const journalRoot = '/var/log/journal';
    const ssmRoot = '/var/log/amazon/ssm';
    const journalFiles = existsSync(journalRoot)
        ? readdirSync(journalRoot, { withFileTypes: true }).flatMap(entry => {
              if (!entry.isDirectory()) return [];
              const directory = path.join(journalRoot, entry.name);
              return readdirSync(directory, { withFileTypes: true }).flatMap(file => {
                  if (!file.isFile() || !/\.journal~?$/u.test(file.name)) return [];
                  const stat = lstatSync(path.join(directory, file.name));
                  return [{ archived: file.name.includes('@'), allocatedKib: Math.ceil(stat.blocks / 2) }];
              });
          })
        : [];
    const ssmFiles = existsSync(ssmRoot)
        ? readdirSync(ssmRoot, { withFileTypes: true })
              .filter(entry => entry.isFile())
              .map(entry => {
                  const stat = lstatSync(path.join(ssmRoot, entry.name));
                  return {
                      name: entry.name,
                      allocatedKib: Math.ceil(stat.blocks / 2),
                      modifiedAt: new Date(stat.mtimeMs).toISOString(),
                  };
              })
              .sort((a, b) => b.allocatedKib - a.allocatedKib)
              .slice(0, 15)
        : [];
    return {
        journal: {
            activeKib: journalFiles
                .filter(file => !file.archived)
                .reduce((sum, file) => sum + file.allocatedKib, 0),
            archivedKib: journalFiles
                .filter(file => file.archived)
                .reduce((sum, file) => sum + file.allocatedKib, 0),
            archivedFileCount: journalFiles.filter(file => file.archived).length,
        },
        ssmFiles,
    };
}

function hasOpenFileDescriptor(file, procRoot = '/proc') {
    // Numbered SSM logs can still be the writer's active inode after rotation.
    // Read descriptor metadata only; never inspect process environment or log contents.
    assert.ok(existsSync(procRoot), 'Cannot verify active log descriptors');
    const target = statSync(file);
    for (const processEntry of readdirSync(procRoot, { withFileTypes: true })) {
        if (!processEntry.isDirectory() || !/^[0-9]+$/u.test(processEntry.name)) continue;
        const descriptorRoot = path.join(procRoot, processEntry.name, 'fd');
        let descriptors;
        try {
            descriptors = readdirSync(descriptorRoot);
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
            throw error;
        }
        for (const descriptor of descriptors) {
            if (!/^[0-9]+$/u.test(descriptor)) continue;
            try {
                const opened = statSync(path.join(descriptorRoot, descriptor));
                if (opened.dev === target.dev && opened.ino === target.ino) return true;
            } catch (error) {
                if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
            }
        }
    }
    return false;
}

function inspectArchivedLogCleanup(
    sourceSha,
    {
        journalRoot = '/var/log/journal',
        ssmRoot = '/var/log/amazon/ssm',
        hasOpenDescriptor = file => hasOpenFileDescriptor(file),
        inspectScope = revision => inspectDeploymentCacheCleanup(revision, { directories: [] }),
    } = {},
) {
    const scope = inspectScope(sourceSha);
    // The server checkout can still be the verified ancestor while a new operations-only commit awaits deployment.
    // inspectDeploymentCacheCleanup already proves that relationship and pins the plan to both revisions.
    const candidates = [];
    const journalCandidates = [];
    if (existsSync(journalRoot)) {
        for (const machine of readdirSync(journalRoot, { withFileTypes: true })) {
            assert.ok(machine.isDirectory() && !machine.isSymbolicLink(), 'Unexpected journal entry');
            assert.match(machine.name, /^[a-f0-9]{32}$/u, 'Unexpected journal directory');
            const directory = path.join(journalRoot, machine.name);
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                if (!entry.name.includes('@')) continue;
                assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Archived journal must be a file');
                assert.match(entry.name, /^[^/@]+@[^/@]+\.journal~?$/u, 'Unexpected archived journal');
                journalCandidates.push({
                    kind: 'journal',
                    ...archivedLogFile(path.join(directory, entry.name)),
                });
            }
        }
    }
    // journalctl vacuums the archive as a group. Preserve the whole group if any archive is open.
    if (journalCandidates.every(item => !hasOpenDescriptor(item.file))) {
        candidates.push(...journalCandidates);
    }
    if (existsSync(ssmRoot)) {
        for (const entry of readdirSync(ssmRoot, { withFileTypes: true })) {
            if (!/^amazon-ssm-agent\.log\.[1-9][0-9]*$/u.test(entry.name)) continue;
            assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Rotated SSM log must be a file');
            const file = path.join(ssmRoot, entry.name);
            const metadata = archivedLogFile(file);
            if (!hasOpenDescriptor(file)) candidates.push({ kind: 'ssm-rotated', ...metadata });
        }
    }
    candidates.sort((a, b) => a.file.localeCompare(b.file));
    return {
        format: 1,
        schema: 'vendure-archived-log-cleanup',
        repositorySha: scope.repositorySha,
        runtimeSha: scope.runtimeSha,
        candidates,
        totalKib: candidates.reduce((sum, item) => sum + item.allocatedKib, 0),
    };
}

function archivedLogFile(file) {
    const stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Archived log must be a regular file');
    assert.equal(realpathSync(file), file, 'Archived log path changed');
    return {
        file,
        allocatedKib: Math.ceil(stat.blocks / 2),
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
        changedAtMs: stat.ctimeMs,
        device: stat.dev,
        inode: stat.ino,
    };
}

function applyArchivedLogCleanup(
    request,
    {
        inspect = revision => inspectArchivedLogCleanup(revision),
        vacuum = () => execFileSync('journalctl', ['--vacuum-size=1M'], { stdio: 'ignore', timeout: 120000 }),
        remove = file => unlinkSync(file),
    } = {},
) {
    assert.equal(request.operation, 'apply-archived-log-cleanup-reviewed');
    const plan = inspect(request.sourceSha);
    assert.equal(plan.schema, 'vendure-archived-log-cleanup');
    assert.ok(plan.candidates.length > 0 && plan.totalKib > 0, 'No archived logs are available');
    assert.equal(planDigest(plan, request.sourceSha), request.expectedPlanSha256, 'Archived logs changed');
    assert.deepEqual(inspect(request.sourceSha), plan, 'Archived logs changed before cleanup');
    // journalctl only vacuums archived journal files. Active journals and the current SSM log are excluded.
    if (plan.candidates.some(item => item.kind === 'journal')) vacuum();
    for (const item of plan.candidates.filter(candidate => candidate.kind === 'ssm-rotated'))
        remove(item.file);
    return plan;
}

function withFileBackupLock(callback, lockFile = path.join(FILE_BACKUP_DIRECTORY, '.backup.lock')) {
    const descriptor = openSync(lockFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        assert.ok(fstatSync(descriptor).isFile(), 'File backup lock must be a regular file');
        const acquired = spawnSync('flock', ['--exclusive', '--wait', '300', '3'], {
            stdio: ['ignore', 'pipe', 'pipe', descriptor],
            timeout: 310000,
        });
        assert.equal(acquired.status, 0, 'Could not acquire the file backup lock');
        return callback();
    } finally {
        closeSync(descriptor);
    }
}

function fileBackupMetadata(file) {
    const stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Backup must be a regular file');
    assert.equal(realpathSync(file), file, 'Backup path changed');
    return {
        file,
        sizeBytes: stat.size,
        allocatedKib: Math.ceil(stat.blocks / 2),
        modifiedAtMs: stat.mtimeMs,
        changedAtMs: stat.ctimeMs,
        device: stat.dev,
        inode: stat.ino,
    };
}

function fileBackupHash(file) {
    const output = execFileSync('sha256sum', [file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 300000,
        maxBuffer: 1024,
    });
    const match = /^([a-f0-9]{64})  /u.exec(output);
    assert.ok(match, 'Could not verify local backup checksum');
    return match[1];
}

function fileBackupRemoteObject(
    file,
    {
        head = (bucket, key) => {
            const output = execFileSync(
                'aws',
                ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--output', 'json'],
                {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                    timeout: 30000,
                    maxBuffer: 8192,
                },
            );
            return JSON.parse(output);
        },
    } = {},
) {
    const bucket = 'yunqiao-vendure-prod-backup-079740175286-apne1';
    const key = `files/${path.basename(file.file)}`;
    const metadata = head(bucket, key);
    assert.equal(metadata.ContentLength, file.sizeBytes, 'Offsite backup size differs');
    assert.equal(metadata.ServerSideEncryption, 'AES256', 'Offsite backup encryption differs');
    assert.ok(
        typeof metadata.VersionId === 'string' && metadata.VersionId,
        'Offsite backup version is missing',
    );
    return { versionId: metadata.VersionId, sizeBytes: metadata.ContentLength };
}

function inspectFileBackupCleanup(
    sourceSha,
    {
        directory = FILE_BACKUP_DIRECTORY,
        environmentFile = PRODUCTION_ENVIRONMENT_FILE,
        keepCount = FILE_BACKUP_KEEP_COUNT,
        inspectScope = revision => inspectDeploymentCacheCleanup(revision, { directories: [] }),
        verifyPolicy = verifyOffsiteFileBackupPolicy,
        hash = fileBackupHash,
        remote = fileBackupRemoteObject,
        readRemoteChecksum = name =>
            execFileSync(
                'aws',
                ['s3', 'cp', `${OFFSITE_FILE_BACKUP_URI}/${name}`, '-', '--only-show-errors'],
                {
                    stdio: ['ignore', 'pipe', 'ignore'],
                    timeout: 30000,
                    maxBuffer: 8192,
                },
            ),
    } = {},
) {
    assert.ok(Number.isInteger(keepCount) && keepCount >= 3, 'At least three local backups are required');
    const scope = inspectScope(sourceSha);
    const root = realpathSync(directory);
    assert.equal(root, directory, 'File backup directory changed');
    assert.ok(lstatSync(root).isDirectory(), 'File backup directory must be real');
    const settings = readOffsiteFileBackupSettings(readProtectedEnvironmentFile(environmentFile).contents);
    assert.equal(settings.VENDURE_REQUIRE_OFFSITE_FILE_BACKUP, 'true', 'Offsite backup is not required');
    assert.equal(settings.VENDURE_FILE_BACKUP_S3_URI, OFFSITE_FILE_BACKUP_URI, 'Offsite destination changed');
    assert.equal(verifyPolicy(OFFSITE_FILE_BACKUP_URI, OFFSITE_FILE_BACKUP_RETENTION_DAYS), true);
    const archiveNames = readdirSync(root)
        .filter(name => /^vendure-files-[0-9]{8}T[0-9]{6}Z\.tar\.gz$/u.test(name))
        .sort()
        .reverse();
    const protectedNames = archiveNames.slice(0, keepCount);
    const candidates = [];
    const blocked = [];
    for (const name of archiveNames.slice(keepCount)) {
        const paths = [name, `${name}.manifest.json`, `${name}.sha256`].map(filename =>
            path.join(root, filename),
        );
        if (paths.some(file => !existsSync(file))) {
            blocked.push({ name, reason: 'incomplete-local-set' });
            continue;
        }
        const files = paths.map(fileBackupMetadata);
        const checksum = readFileSync(paths[2], 'utf8');
        assert.ok(Buffer.byteLength(checksum) < 8192, 'Backup checksum is too large');
        const checksumLines = checksum.trimEnd().split('\n');
        assert.equal(checksumLines.length, 2, 'Backup checksum must have exactly two entries');
        const expected = new Map(
            checksumLines.map(line => {
                const match =
                    /^([a-f0-9]{64})  (vendure-files-[0-9]{8}T[0-9]{6}Z\.tar\.gz(?:\.manifest\.json)?)$/u.exec(
                        line,
                    );
                assert.ok(match, 'Backup checksum has an unexpected entry');
                return [match[2], match[1]];
            }),
        );
        assert.equal(expected.size, 2, 'Backup checksum must cover archive and manifest');
        assert.equal(hash(paths[0]), expected.get(name), 'Local backup archive checksum differs');
        assert.equal(
            hash(paths[1]),
            expected.get(`${name}.manifest.json`),
            'Local backup manifest checksum differs',
        );
        try {
            const offsite = files.map(file => remote(file));
            const remoteChecksum = readRemoteChecksum(`${name}.sha256`);
            assert.ok(Buffer.from(checksum).equals(Buffer.from(remoteChecksum)), 'Offsite checksum differs');
            candidates.push({ name, files, offsite });
        } catch {
            blocked.push({ name, reason: 'offsite-verification-failed' });
        }
    }
    return {
        format: 1,
        schema: 'vendure-file-backup-cleanup',
        repositorySha: scope.repositorySha,
        runtimeSha: scope.runtimeSha,
        keepCount,
        protectedNames,
        candidates,
        blocked,
        totalKib: candidates.reduce(
            (sum, item) => sum + item.files.reduce((bytes, file) => bytes + file.allocatedKib, 0),
            0,
        ),
    };
}

function applyFileBackupCleanup(
    request,
    { inspect = revision => inspectFileBackupCleanup(revision), remove = unlinkSync } = {},
) {
    assert.equal(request.operation, 'apply-file-backup-cleanup-reviewed');
    const plan = inspect(request.sourceSha);
    assert.equal(plan.schema, 'vendure-file-backup-cleanup');
    assert.ok(plan.candidates.length > 0 && plan.totalKib > 0, 'No verified file backups are available');
    assert.equal(planDigest(plan, request.sourceSha), request.expectedPlanSha256, 'File backup plan changed');
    for (const candidate of plan.candidates) {
        for (const file of candidate.files) {
            assert.deepEqual(fileBackupMetadata(file.file), file, 'Backup file changed before cleanup');
            remove(file.file);
        }
    }
    return plan;
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

function inspectImageServices(
    run = readCommand,
    socketExists = file => {
        try {
            return lstatSync(file).isSocket();
        } catch {
            return false;
        }
    },
) {
    const units = ['vendure-clamd.service', 'vendure-image-worker.service'];
    const services = Object.fromEntries(
        units.map(unit => [
            unit,
            run('systemctl', [
                'show',
                unit,
                '--property=Id,LoadState,ActiveState,SubState,Result,ExecMainStatus,NRestarts,StartLimitBurst,StartLimitIntervalUSec,Requires,Wants',
            ]),
        ]),
    );
    const sockets = {
        antivirus: socketExists('/run/clamav/clamd.ctl'),
        processor: socketExists('/run/vendure-image-worker/processor.sock'),
    };
    const ready =
        Object.values(services).every(
            service =>
                service.status === 'ok' &&
                /^LoadState=loaded$/mu.test(service.output) &&
                /^ActiveState=active$/mu.test(service.output) &&
                /^SubState=running$/mu.test(service.output),
        ) &&
        sockets.antivirus &&
        sockets.processor;
    return { ready, services, sockets };
}

function inspectRecoveryReadiness() {
    const releases = '/var/www/kaiyuangouwu-releases';
    const marker = readCommand('cat', [path.join(releases, 'current-sha')]);
    const pointer = readCommand('readlink', ['-f', '/var/www/kaiyuangouwu-current']);
    const units = ['vendure-file-backup.service', 'vendure-mysql-backup.service', 'mysql.service'];
    const services = Object.fromEntries(
        units.map(unit => [
            unit,
            readCommand('systemctl', [
                'show',
                unit,
                '--property=Id,LoadState,ActiveState,SubState,Result,ExecMainStatus,ExecMainExitTimestamp,InvocationID,StartLimitBurst,StartLimitIntervalUSec',
            ]),
        ]),
    );
    const candidates = [];
    if (pointer.status === 'ok' && pointer.output.startsWith(releases + '/')) {
        candidates.push({ role: 'current-pointer', directory: pointer.output });
    }
    if (marker.status === 'ok' && /^[a-f0-9]{40}$/u.test(marker.output)) {
        for (const name of readdirSync(releases)) {
            if (!name.startsWith(marker.output + '-') || !/^[a-f0-9]{40}-[A-Za-z0-9-]+$/u.test(name))
                continue;
            const directory = path.join(releases, name);
            if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) continue;
            candidates.push({ role: 'version-marker-match', directory });
        }
    }
    const guardSource =
        readFileSync(path.join(__dirname, 'usdt-migration-guard.cjs'), 'utf8') +
        '\nrun(...process.argv.slice(2)).catch(error => { ' +
        "process.stderr.write('USDT_RUNTIME_GUARD_FAILED operation failed error_code=' + safeFailureCode(error) + '\\n'); " +
        'process.exitCode = 1; });\n';
    const runtimes = candidates.map(candidate => {
        const metadataFile = path.join(candidate.directory, 'RUNTIME-METADATA.json');
        let metadataSha = null;
        try {
            const sha = JSON.parse(readFileSync(metadataFile, 'utf8')).gitSha;
            if (/^[a-f0-9]{40}$/u.test(sha)) metadataSha = sha;
        } catch {
            /* Report missing/invalid metadata without exposing its contents. */
        }
        // Only the existing read-only compatibility operation runs, under the deployment user.
        // stdin avoids granting that user access to the root-owned operations scratch directory.
        const guard = spawnSync(
            'runuser',
            ['-u', 'ubuntu', '--', process.execPath, '-', 'check-runtime', candidate.directory],
            {
                input: guardSource,
                encoding: 'utf8',
                timeout: 25000,
                maxBuffer: 64 * 1024,
            },
        );
        const failed = guard.stderr?.match(/USDT_RUNTIME_GUARD_FAILED [^\n]* error_code=([A-Z_]+)\n/u);
        const compatible =
            guard.status === 0 && guard.stdout?.endsWith('USDT_RUNTIME_GUARD_OK operation=check-runtime\n');
        return {
            ...candidate,
            metadataSha,
            apiEntryPresent: existsSync(path.join(candidate.directory, 'packages/dev-server/dist/index.js')),
            workerEntryPresent: existsSync(
                path.join(candidate.directory, 'packages/dev-server/dist/index-worker.js'),
            ),
            compatibility: compatible ? 'passed' : 'blocked',
            errorCode: compatible
                ? null
                : (failed?.[1] ?? (guard.error?.code === 'ETIMEDOUT' ? 'ETIMEDOUT' : 'UNKNOWN')),
        };
    });
    // Classify only recent messages. Old AccessDenied entries must not explain a new failure.
    const journal = spawnSync(
        'journalctl',
        ['-u', 'vendure-file-backup.service', '--since=-60min', '-n', '200', '--no-pager', '-o', 'json'],
        { encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024 },
    );
    const signals = {
        dnsFailure: 0,
        accessDenied: 0,
        noSpace: 0,
        startLimit: 0,
        dependency: 0,
        concurrentBackup: 0,
    };
    if (journal.status === 0)
        for (const line of journal.stdout.split('\n').filter(Boolean)) {
            let message;
            try {
                message = String(JSON.parse(line).MESSAGE ?? '');
            } catch {
                continue;
            }
            for (const [key, pattern] of Object.entries({
                dnsFailure: /EAI_AGAIN|Name or service not known|Temporary failure in name resolution/iu,
                accessDenied: /AccessDenied|not authorized to perform/iu,
                noSpace: /No space left on device/iu,
                startLimit: /start-limit|Start request repeated too quickly/iu,
                dependency: /Dependency failed/iu,
                concurrentBackup: /Another persistent file backup is already running/iu,
            }))
                if (pattern.test(message)) signals[key]++;
        }
    return {
        services,
        runtimes,
        recentFileBackupSignals: { available: journal.status === 0, windowMinutes: 60, ...signals },
    };
}

function diagnose(request) {
    // Fixed paths only: report sizes without enumerating customer files or
    // treating an untracked production path as safe to delete.
    const diskFootprintPaths = {
        repository: '/var/www/kaiyuangouwu',
        repositoryGit: '/var/www/kaiyuangouwu/.git',
        repositoryPackages: '/var/www/kaiyuangouwu/packages',
        repositoryDevServerDist: '/var/www/kaiyuangouwu/packages/dev-server/dist',
        repositoryStorefrontDist: '/var/www/kaiyuangouwu/packages/storefront/dist',
        repositoryAdminDist: '/var/www/kaiyuangouwu/packages/next-admin/dist',
        repositoryAdminUiDist: '/var/www/kaiyuangouwu/admin-ui/dist',
        repositoryWorkspaceCache: '/var/www/kaiyuangouwu/.cache',
        releases: '/var/www/kaiyuangouwu-releases',
        logs: '/var/log',
        temporaryFiles: '/tmp',
        variableTemporaryFiles: '/var/tmp',
        rootUserCache: '/root/.cache',
        ubuntuUserCache: '/home/ubuntu/.cache',
        aptLists: '/var/lib/apt/lists',
        snapdState: '/var/lib/snapd',
        journalLogs: '/var/log/journal',
        nginxLogs: '/var/log/nginx',
        mysqlLogs: '/var/log/mysql',
        amazonSsmLogs: '/var/log/amazon/ssm',
        aptLogs: '/var/log/apt',
        syslog: '/var/log/syslog',
        authLog: '/var/log/auth.log',
        kernelLog: '/var/log/kern.log',
        cloudInitLog: '/var/log/cloud-init.log',
        ubuntuPm2Logs: '/home/ubuntu/.pm2/logs',
        backups: '/var/backups',
        databaseBackups: '/var/backups/vendure-mysql',
        fileBackups: '/var/backups/vendure-files',
        systemCache: '/var/cache',
        aptArchives: APT_ARCHIVES_DIRECTORY,
        aptMetadata: '/var/cache/apt',
        manCache: '/var/cache/man',
        fontconfigCache: '/var/cache/fontconfig',
        snapCache: '/var/lib/snapd/cache',
        ubuntuHome: '/home/ubuntu',
    };
    const result = {
        operation: request.operation,
        sourceSha: request.sourceSha,
        observedAt: new Date().toISOString(),
        disk: readCommand('df', ['-Pk', '/']),
        rootFilesystem: readCommand('findmnt', ['-no', 'SOURCE,FSTYPE', '/']),
        rootBlockDevices: readCommand('lsblk', ['-b', '-n', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE']),
        journalDiskUsage: readCommand('journalctl', ['--disk-usage']),
        fixedLogInventory: inspectFixedLogInventory(),
        releaseSize: readCommand('du', ['-skx', '/var/www/kaiyuangouwu-releases']),
        diskFootprintKib: Object.fromEntries(
            Object.entries(diskFootprintPaths).map(([label, directory]) => [
                label,
                existsSync(directory) ? readCommand('du', ['-skx', directory]) : { status: 'absent' },
            ]),
        ),
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
        imageServices: inspectImageServices(),
        latestBackups: backupMetadata(),
        recoveryReadiness: inspectRecoveryReadiness(),
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
        /^STOREFRONT_CONFIGURATION_QUERY_FAILED operation=ConfigurationGuard(?:Login|Profiles|Content|Published) reason=(?:TIMEOUT|REQUEST_FAILED|HTTP_ERROR|INVALID_JSON|API_ERROR)(?: (?:host=[a-z0-9.-]{1,100} locale=(?:zh_Hans|en|unknown) )?code=[A-Z_]{1,40} path=[A-Za-z0-9_.]{1,200})?$/mu,
    )?.[0];
    if (safeFailure) return safeFailure;
    const assertionCodes = new Map([
        ['Configuration guard login failed', 'LOGIN_INVALID'],
        ['Storefront operational state is missing', 'OPERATIONAL_STATE_MISSING'],
        ['Configuration guard requires a verified primary domain for each Channel', 'PRIMARY_DOMAIN_MISSING'],
        ['Configuration guard Channel mismatch', 'ADMIN_CHANNEL_MISMATCH'],
        ['Shop API Channel mismatch', 'SHOP_CHANNEL_MISMATCH'],
        ['Configuration summary exceeds the SSM evidence limit', 'SUMMARY_TOO_LARGE'],
    ]);
    const firstLine = result.stderr?.trimStart().split('\n', 1)[0];
    const code = assertionCodes.get(firstLine);
    return code
        ? `STOREFRONT_CONFIGURATION_CHECK_FAILED reason=${code}`
        : 'Read-only storefront configuration inspection failed';
}

function inspectIcloudRelay(
    request,
    {
        inspect = inspectProductionReleases,
        checkAncestry = assertStorefrontInspectionRevision,
        spawn = spawnSync,
    } = {},
) {
    const plan = inspect();
    assert.equal(plan.markerSha, request.expectedRuntimeSha, 'Production runtime SHA changed');
    checkAncestry(plan.markerSha, request.sourceSha);
    const result = spawn(
        '/usr/bin/node',
        [`--env-file=${PRODUCTION_ENVIRONMENT_FILE}`, path.join(__dirname, 'icloud-relay-diagnostic.mjs')],
        { encoding: 'utf8', timeout: 70000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // A completed diagnostic may report a failed dependency. Never forward stderr,
    // partial output, returned mailbox rows, credentials or an arbitrary child payload.
    assert.ok([0, 1].includes(result.status) && !result.error, 'Mailbox diagnostic did not complete');
    return require('./icloud-relay-receipt.cjs')(result, request.sourceSha, plan.markerSha);
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

function productionHealthSnapshot(
    read = readCommand,
    wait = () => spawnSync('/bin/sleep', ['1'], { stdio: 'ignore', timeout: 2000 }),
) {
    let snapshot;
    for (let attempt = 0; attempt < 10; attempt++) {
        snapshot = read('systemctl', [
            'show',
            'vendure-production-healthcheck.service',
            '--property=Result,ExecMainStatus,ActiveState',
        ]);
        const transient =
            snapshot.status === 'ok' && /^ActiveState=(?:activating|deactivating)$/mu.test(snapshot.output);
        if (!transient) return snapshot;
        if (attempt < 9) wait();
    }
    return snapshot;
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
        assert.equal(plan?.copiedChannelTablesVerified, 1);
        assert.equal(plan?.defaultOwnedOrderCount, 0);
        assert.equal(plan?.defaultOrderMembershipCount, 0);
        assert.equal(plan?.defaultRelationCount, 0);
        assert.equal(plan?.defaultCustomerStoreEntryCount, 0);
        assert.equal(plan?.profileMatches, true);
        assert.equal(plan?.contentSettingsMatch, true);
        assert.equal(plan?.sellerSeparated, true);
        assert.equal(plan?.targetRequiredRoleCount, 2);
    } else {
        assert.equal(plan?.schema, 'vendure-moyao-default-store-migration');
        assert.equal(plan?.mode, 'reviewed-default-to-dedicated-channel');
        assert.ok(Number.isSafeInteger(plan?.contentBlockCount) && plan.contentBlockCount > 0);
        assert.ok(Number.isSafeInteger(plan?.orderSalesOwnerCount) && plan.orderSalesOwnerCount >= 0);
        assert.equal(typeof plan?.sellerWillChange, 'boolean');
        assert.ok(
            ['NONE', 'SWAP_EXISTING_SELLERS', 'CREATE_PLATFORM_SELLER'].includes(
                plan?.sellerSeparationAction,
            ),
        );
        assert.ok(
            Number.isSafeInteger(plan?.sellerIsolationConflictCount) &&
                plan.sellerIsolationConflictCount >= 0,
            'Invalid MOYAO Seller isolation conflict count',
        );
        assert.ok(
            Number.isSafeInteger(plan?.addedRequiredRoleAssignments) &&
                plan.addedRequiredRoleAssignments >= 0 &&
                plan.addedRequiredRoleAssignments <= 2,
        );
        assert.match(plan?.operationDigest || '', /^[a-f0-9]{64}$/u);
        assert.ok(plan?.addedRelations && typeof plan.addedRelations === 'object');
        assert.ok(plan?.removedDefaultRelations && typeof plan.removedDefaultRelations === 'object');
        assert.ok(plan?.crossStoreRelationConflicts && typeof plan.crossStoreRelationConflicts === 'object');
        assert.ok(plan?.copiedChannelRows && typeof plan.copiedChannelRows === 'object');
        assert.ok(plan?.movedChannelRows && typeof plan.movedChannelRows === 'object');
        assert.ok(
            Number.isSafeInteger(plan?.removedDefaultCustomerStoreEntries) &&
                plan.removedDefaultCustomerStoreEntries >= 0,
        );
        assert.ok(
            Number.isSafeInteger(plan?.removedDefaultOrderMemberships) &&
                plan.removedDefaultOrderMemberships >= 0,
        );
        for (const [table, count] of Object.entries({
            ...plan.addedRelations,
            ...plan.removedDefaultRelations,
            ...plan.crossStoreRelationConflicts,
            ...plan.copiedChannelRows,
            ...plan.movedChannelRows,
        })) {
            assert.match(table, /^[a-z][a-z0-9_]*$/u);
            assert.ok(Number.isSafeInteger(count) && count >= 0);
        }
        if (operation === 'apply') {
            assert.equal(
                Object.values(plan.crossStoreRelationConflicts).reduce((sum, count) => sum + count, 0),
                0,
                'Cross-store resource conflicts must be cloned before applying the MOYAO migration',
            );
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
        /^Created verified MySQL backup: (\/var\/backups\/vendure-mysql\/vendure-[0-9]{8}T[0-9]{6}Z\.sql\.gz) offsite=yes encrypted=yes$/mu,
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
                plan.sellerIsolationConflictCount,
                0,
                'A migration Seller is already used by another operating store; review Seller ownership before applying the MOYAO migration',
            );
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

function runAssetWebpMigration(
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
            'asset-webp-migration.mjs',
        ),
    } = {},
) {
    const apply = request.operation === 'apply-asset-webp-migration-reviewed';
    const verify = request.operation === 'verify-asset-webp-migration';
    assert.ok(apply || verify || request.operation === 'plan-asset-webp-migration');
    const before = inspect();
    assert.equal(before.markerSha, request.expectedRuntimeSha, 'Production runtime SHA changed');
    const healthBefore = health();
    assertProductionHealthSnapshot(healthBefore, 'before');
    const run = (operation, expectedDigest = '') => {
        const result = spawn(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                script,
                operation,
                ...(expectedDigest ? [expectedDigest] : []),
            ],
            {
                encoding: 'utf8',
                timeout: 540000,
                maxBuffer: 65536,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
            },
        );
        assert.equal(result.status, 0, `Asset WebP ${operation} failed`);
        const output = JSON.parse(String(result.stdout || '').trim());
        assert.ok(Number.isSafeInteger(output.remaining) && output.remaining >= 0);
        if (operation !== 'verify') {
            assert.equal(output.schema, 'vendure-asset-webp-migration-v1');
            assert.match(output.operationDigest, /^[a-f0-9]{64}$/u);
            assert.ok(
                Number.isSafeInteger(output.selected) && output.selected >= 0 && output.selected <= 100,
            );
        }
        return output;
    };
    let plan;
    let backupEvidence;
    let verification;
    if (verify) {
        verification = run('verify');
    } else {
        plan = run('plan');
        if (apply) {
            assert.ok(plan.selected > 0, 'Asset WebP migration has no remaining candidates');
            assert.equal(plan.operationDigest, request.expectedPlanSha256, 'Asset WebP plan changed');
            backupEvidence = backup();
            assert.deepEqual(
                run('apply', request.expectedPlanSha256),
                plan,
                'Applied batch differs from reviewed plan',
            );
            verification = run('verify');
            assert.ok(
                verification.metadataRemaining < plan.metadataRemaining ||
                    verification.databaseRemaining < plan.remaining,
                'Asset WebP migration did not make progress',
            );
        }
    }
    const after = inspect();
    assert.deepEqual(after, before, 'Production release changed during asset migration');
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
        if (result.status !== 0) {
            const safeFailure = String(result.stderr || '')
                .split(/\r?\n/u)
                .find(line =>
                    /^READ_ONLY_AUDIT_FAILURE code=[A-Z][A-Z0-9_]{1,63} digest=[a-f0-9]{12}$/u.test(line),
                );
            throw new Error(
                `The fixed read-only store isolation audit failed${safeFailure ? ` (${safeFailure})` : ''}`,
            );
        }
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

function runPlatformGovernanceDataPreflight(
    request,
    {
        inspect = inspectProductionReleases,
        spawn = spawnSync,
        health = productionHealthSnapshot,
        script = path.join(
            __dirname,
            'repository',
            'packages',
            'dev-server',
            'scripts',
            'platform-governance-data-preflight.mjs',
        ),
        persistPlan = compressed =>
            require('./governance-preflight-transport.cjs').persist(__dirname, compressed),
    } = {},
) {
    assert.equal(request.operation, 'plan-platform-store-governance');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    assertProductionHealthSnapshot(health(), 'before');
    let payload;
    let auditError;
    try {
        const result = spawn('/usr/bin/node', ['--env-file=' + PRODUCTION_ENVIRONMENT_FILE, script], {
            encoding: 'utf8',
            timeout: 540000,
            maxBuffer: 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
        });
        if (result.status !== 0) {
            const safeFailure = String(result.stderr || '')
                .split(/\r?\n/u)
                .find(line =>
                    /^READ_ONLY_AUDIT_FAILURE code=[A-Z][A-Z0-9_]{1,63} digest=[a-f0-9]{12}$/u.test(line),
                );
            throw new Error(
                `The fixed platform governance data preflight failed${safeFailure ? ` (${safeFailure})` : ''}`,
            );
        }
        try {
            payload = JSON.parse(String(result.stdout || ''));
        } catch {
            throw new Error('Platform governance preflight returned invalid JSON');
        }
        assert.equal(payload.schema, 'vendure-platform-governance-production-preflight-v1');
        assert.equal(payload.mode, 'READ_ONLY');
        assert.equal(payload.productionApply, false);
        assert.match(payload.snapshotHash, /^[a-f0-9]{64}$/u);
        assert.ok(
            [
                'resourceCount',
                'unresolvedResourceCount',
                'paymentMethodCount',
                'enabledStoreSwitchCount',
            ].every(key => Number.isSafeInteger(payload[key]) && payload[key] >= 0),
        );
        assert.ok(typeof payload.compressedPlan === 'string' && payload.compressedPlan.length <= 512000);
        assert.match(payload.compressedPlan, /^[A-Za-z0-9+/]+={0,2}$/u);
        assert.deepEqual(
            Object.keys(payload).sort(),
            [
                'schema',
                'mode',
                'productionApply',
                'snapshotHash',
                'resourceCount',
                'unresolvedResourceCount',
                'paymentMethodCount',
                'enabledStoreSwitchCount',
                'compressedPlan',
            ].sort(),
        );
    } catch (error) {
        auditError = error;
    }
    // Always verify the runtime and health after a failed read as well.
    assert.deepEqual(inspect(), before, 'Production release state changed during the governance preflight');
    assertProductionHealthSnapshot(health(), 'after');
    if (auditError) throw auditError;
    const { compressedPlan, ...audit } = payload;
    const planTransport = persistPlan(compressedPlan);
    return { sourceSha: request.sourceSha, runtimeSha: before.markerSha, audit, planTransport };
}

function runAdministratorProductReadinessAudit(
    request,
    {
        inspect = inspectProductionReleases,
        spawn = spawnSync,
        health = productionHealthSnapshot,
        administratorScript = path.join(
            __dirname,
            'repository',
            'packages',
            'dev-server',
            'scripts',
            'administrator-access-preflight.mjs',
        ),
        productScript = path.join(
            __dirname,
            'repository',
            'packages',
            'dev-server',
            'scripts',
            'product-ownership-preflight.mjs',
        ),
    } = {},
) {
    assert.equal(request.operation, 'audit-administrator-product-readiness');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    const healthBefore = health();
    assertProductionHealthSnapshot(healthBefore, 'before');
    let reports;
    let auditError;
    try {
        const runReport = (script, args, label) => {
            const result = spawn(
                '/usr/bin/node',
                ['--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env', script, ...args],
                {
                    encoding: 'utf8',
                    timeout: 120000,
                    maxBuffer: 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
                },
            );
            if (result.status !== 0) {
                const safeFailure = String(result.stderr || '')
                    .split(/\r?\n/u)
                    .find(line =>
                        /^READ_ONLY_AUDIT_FAILURE code=[A-Z][A-Z0-9_]{1,63} digest=[a-f0-9]{12}$/u.test(line),
                    );
                throw new Error(
                    `The fixed read-only ${label} audit failed${safeFailure ? ` (${safeFailure})` : ''}`,
                );
            }
            let report;
            try {
                report = JSON.parse(String(result.stdout || ''));
            } catch {
                throw new Error(`The fixed read-only ${label} audit returned invalid JSON`);
            }
            assert.equal(report.mode, 'read-only', `The ${label} audit did not confirm read-only mode`);
            return report;
        };
        const administrator = runReport(administratorScript, [], 'administrator');
        assert.equal(typeof administrator.readyForStagedMigration, 'boolean');
        assert.ok(Number.isSafeInteger(administrator.activeAdministratorCount));
        assert.ok(Array.isArray(administrator.ownerAdministratorIds));
        assert.ok(Number.isSafeInteger(administrator.existingProfileCount));
        assert.ok(Array.isArray(administrator.blockers));
        assert.ok(Array.isArray(administrator.unmapped));
        assert.ok(Array.isArray(administrator.legacyPrimaries));
        const product = runReport(productScript, [`--product-id=${request.productId}`], 'product');
        assert.equal(product.productId, request.productId);
        assert.equal(typeof product.editableAsExclusiveStoreProduct, 'boolean');
        assert.ok(Array.isArray(product.product?.channels));
        assert.ok(product.related && typeof product.related === 'object' && !Array.isArray(product.related));
        assert.ok(Object.values(product.related).every(items => Array.isArray(items)));
        assert.ok(Array.isArray(product.blockers));
        const stockOwnership = require('./product-stock-ownership-receipt.cjs')(product);
        const history = product.historicalSales;
        assert.ok(history && typeof history === 'object' && !Array.isArray(history));
        assert.ok(Number.isSafeInteger(history.orderCount) && history.orderCount >= 0);
        assert.ok(Number.isSafeInteger(history.orderLineCount) && history.orderLineCount >= 0);
        assert.ok(Array.isArray(history.bySalesChannel));
        for (const group of history.bySalesChannel) {
            assert.ok(group.channelCode === null || typeof group.channelCode === 'string');
            assert.ok(Number.isSafeInteger(group.orderCount) && group.orderCount >= 0);
            assert.ok(Number.isSafeInteger(group.orderLineCount) && group.orderLineCount >= 0);
        }
        assert.equal(
            history.bySalesChannel.reduce((count, group) => count + group.orderCount, 0),
            history.orderCount,
        );
        assert.equal(
            history.bySalesChannel.reduce((count, group) => count + group.orderLineCount, 0),
            history.orderLineCount,
        );
        reports = { administrator, product, stockOwnership };
    } catch (error) {
        auditError = error;
    }
    let healthAfter;
    let stateError;
    try {
        assert.deepEqual(inspect(), before, 'Production release state changed during the readiness audit');
        healthAfter = health();
        assertProductionHealthSnapshot(healthAfter, 'after');
    } catch (error) {
        stateError = error;
    }
    if (stateError) throw stateError;
    if (auditError) throw auditError;

    const { administrator, product, stockOwnership } = reports;
    const relatedCounts = Object.fromEntries(
        Object.entries(product.related || {}).map(([type, items]) => [type, items.length]),
    );
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        productId: request.productId,
        healthBefore,
        healthAfter,
        administrator: {
            readyForStagedMigration: administrator.readyForStagedMigration,
            activeAdministratorCount: administrator.activeAdministratorCount,
            ownerAdministratorIds: administrator.ownerAdministratorIds,
            existingProfileCount: administrator.existingProfileCount,
            legacyPrimaryCount: administrator.legacyPrimaries.length,
            legacyPrimaries: administrator.legacyPrimaries.slice(0, 25),
            unmappedCount: administrator.unmapped.length,
            unmapped: administrator.unmapped.slice(0, 25),
            blockerCount: administrator.blockers.length,
            blockers: administrator.blockers.slice(0, 50),
            detailsTruncated:
                administrator.legacyPrimaries.length > 25 ||
                administrator.unmapped.length > 25 ||
                administrator.blockers.length > 50,
        },
        product: {
            editableAsExclusiveStoreProduct: product.editableAsExclusiveStoreProduct,
            channels: product.product.channels,
            relatedCounts,
            stockOwnership,
            historicalSales: {
                orderCount: product.historicalSales.orderCount,
                orderLineCount: product.historicalSales.orderLineCount,
                bySalesChannel: product.historicalSales.bySalesChannel.map(group => ({
                    channelCode: group.channelCode,
                    orderCount: group.orderCount,
                    orderLineCount: group.orderLineCount,
                })),
            },
            blockerCount: product.blockers.length,
            blockers: product.blockers.slice(0, 50),
            detailsTruncated: product.blockers.length > 50 || stockOwnership.detailsTruncated,
        },
    };
}

function runLocked(environment = process.env) {
    const request = validateRequest(environment);
    if (request.operation === 'inspect-icloud-relay') {
        process.stdout.write(`${JSON.stringify(inspectIcloudRelay(request))}\n`);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=inspect-icloud-relay\n');
        return;
    }
    if (request.operation === 'plan-offsite-file-backup-config') {
        const plan = inspectOffsiteFileBackupConfig(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-offsite-file-backup-config\n');
        return;
    }
    if (request.operation === 'apply-offsite-file-backup-config-reviewed') {
        const result = applyOffsiteFileBackupConfig(request);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, ...result })}\n`,
        );
        process.stdout.write(
            'PRODUCTION_OPERATIONS_COMPLETE operation=apply-offsite-file-backup-config-reviewed\n',
        );
        return;
    }
    if (request.operation === 'plan-deployment-cache-cleanup') {
        const plan = inspectDeploymentCacheCleanup(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-deployment-cache-cleanup\n');
        return;
    }
    if (request.operation === 'apply-deployment-cache-cleanup-reviewed') {
        const plan = applyDeploymentCacheCleanup(request);
        const healthRefresh = readCommand('sudo', [
            '-n',
            'systemctl',
            'start',
            'vendure-production-healthcheck.service',
        ]);
        const result = {
            sourceSha: request.sourceSha,
            planSha256: request.expectedPlanSha256,
            removedDirectoryCount: plan.candidates.length,
            removedKib: plan.totalKib,
            disk: readCommand('df', ['-Pk', '/']),
            healthRefresh,
            healthService: readCommand('systemctl', [
                'show',
                'vendure-production-healthcheck.service',
                '--property=Result,ExecMainStatus,ExecMainExitTimestamp,ActiveState',
            ]),
        };
        process.stdout.write(`${JSON.stringify(result)}\n`);
        assert.equal(healthRefresh.status, 'ok', 'Deployment caches were removed, but health still failed');
        process.stdout.write(
            'PRODUCTION_OPERATIONS_COMPLETE operation=apply-deployment-cache-cleanup-reviewed\n',
        );
        return;
    }
    if (request.operation === 'plan-apt-archive-cleanup') {
        const plan = inspectAptArchiveCleanup(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-apt-archive-cleanup\n');
        return;
    }
    if (request.operation === 'apply-apt-archive-cleanup-reviewed') {
        const plan = applyAptArchiveCleanup(request);
        const disk = readCommand('df', ['-Pk', '/']);
        const healthRefresh = readCommand('systemctl', ['start', 'vendure-production-healthcheck.service']);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, reviewedKib: plan.totalKib, disk, healthRefresh })}\n`,
        );
        assert.equal(healthRefresh.status, 'ok', 'APT cleanup completed, but health refresh failed');
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=apply-apt-archive-cleanup-reviewed\n');
        return;
    }
    if (request.operation === 'plan-apt-metadata-cleanup') {
        const plan = inspectAptMetadataCleanup(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-apt-metadata-cleanup\n');
        return;
    }
    if (request.operation === 'apply-apt-metadata-cleanup-reviewed') {
        const plan = applyAptMetadataCleanup(request);
        const disk = readCommand('df', ['-Pk', '/']);
        const healthRefresh = readCommand('systemctl', ['start', 'vendure-production-healthcheck.service']);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, removedFileCount: plan.candidates.length, reviewedKib: plan.totalKib, disk, healthRefresh })}\n`,
        );
        assert.equal(healthRefresh.status, 'ok', 'APT metadata cleanup completed, but health refresh failed');
        process.stdout.write(
            'PRODUCTION_OPERATIONS_COMPLETE operation=apply-apt-metadata-cleanup-reviewed\n',
        );
        return;
    }
    if (request.operation === 'plan-apt-lists-cleanup') {
        const plan = inspectAptListsCleanup(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-apt-lists-cleanup\n');
        return;
    }
    if (request.operation === 'apply-apt-lists-cleanup-reviewed') {
        const plan = applyAptListsCleanup(request);
        const disk = readCommand('df', ['-Pk', '/']);
        const healthRefresh = readCommand('systemctl', ['start', 'vendure-production-healthcheck.service']);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, reviewedKib: plan.totalKib, reviewedFileCount: plan.candidates.length, disk, healthRefresh })}\n`,
        );
        assert.equal(healthRefresh.status, 'ok', 'APT lists cleanup completed, but health refresh failed');
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=apply-apt-lists-cleanup-reviewed\n');
        return;
    }
    if (request.operation === 'plan-snap-cache-cleanup') {
        const plan = inspectSnapCacheCleanup(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-snap-cache-cleanup\n');
        return;
    }
    if (request.operation === 'apply-snap-cache-cleanup-reviewed') {
        const plan = applySnapCacheCleanup(request);
        const disk = readCommand('df', ['-Pk', '/']);
        const healthRefresh = readCommand('systemctl', ['start', 'vendure-production-healthcheck.service']);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, removedFileCount: plan.candidates.length, reviewedKib: plan.totalKib, disk, healthRefresh })}\n`,
        );
        assert.equal(healthRefresh.status, 'ok', 'Snap cache cleanup completed, but health refresh failed');
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=apply-snap-cache-cleanup-reviewed\n');
        return;
    }
    if (request.operation === 'plan-archived-log-cleanup') {
        const plan = inspectArchivedLogCleanup(request.sourceSha);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-archived-log-cleanup\n');
        return;
    }
    if (request.operation === 'apply-archived-log-cleanup-reviewed') {
        const plan = applyArchivedLogCleanup(request);
        const disk = readCommand('df', ['-Pk', '/']);
        const healthRefresh = readCommand('systemctl', ['start', 'vendure-production-healthcheck.service']);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, reviewedKib: plan.totalKib, reviewedFileCount: plan.candidates.length, disk, healthRefresh })}\n`,
        );
        assert.equal(healthRefresh.status, 'ok', 'Archived log cleanup completed, but health refresh failed');
        process.stdout.write(
            'PRODUCTION_OPERATIONS_COMPLETE operation=apply-archived-log-cleanup-reviewed\n',
        );
        return;
    }
    if (request.operation === 'plan-file-backup-cleanup') {
        const plan = withFileBackupLock(() => inspectFileBackupCleanup(request.sourceSha));
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: planDigest(plan, request.sourceSha), plan })}\n`,
        );
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-file-backup-cleanup\n');
        return;
    }
    if (request.operation === 'apply-file-backup-cleanup-reviewed') {
        const plan = withFileBackupLock(() => applyFileBackupCleanup(request));
        const disk = readCommand('df', ['-Pk', '/']);
        const healthRefresh = readCommand('systemctl', ['start', 'vendure-production-healthcheck.service']);
        process.stdout.write(
            `${JSON.stringify({ sourceSha: request.sourceSha, planSha256: request.expectedPlanSha256, removedSetCount: plan.candidates.length, reviewedKib: plan.totalKib, disk, healthRefresh })}\n`,
        );
        assert.equal(healthRefresh.status, 'ok', 'File backup cleanup completed, but health refresh failed');
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=apply-file-backup-cleanup-reviewed\n');
        return;
    }
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
        [
            'plan-asset-webp-migration',
            'apply-asset-webp-migration-reviewed',
            'verify-asset-webp-migration',
        ].includes(request.operation)
    ) {
        const result = runAssetWebpMigration(request);
        process.stdout.write(
            `PRODUCTION_ASSET_WEBP_REVISIONS source=${request.sourceSha} runtime=${result.runtimeSha}\n`,
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
    if (request.operation === 'plan-platform-store-governance') {
        const result = runPlatformGovernanceDataPreflight(request);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.stdout.write('PRODUCTION_OPERATIONS_COMPLETE operation=plan-platform-store-governance\n');
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
    if (request.operation === 'audit-administrator-product-readiness') {
        const result = runAdministratorProductReadinessAudit(request);
        process.stdout.write(
            `PRODUCTION_ADMINISTRATOR_PRODUCT_REVISIONS source=${request.sourceSha} runtime=${result.runtimeSha} product=${request.productId}\n`,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.stdout.write(
            'PRODUCTION_OPERATIONS_COMPLETE operation=audit-administrator-product-readiness\n',
        );
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
        if (existsSync(path.join(plan.currentRuntime, 'deploy/image-worker/server.cjs'))) {
            const imageServices = inspectImageServices();
            process.stdout.write(`PRODUCTION_IMAGE_SERVICES ${JSON.stringify(imageServices)}\n`);
            assert.ok(
                imageServices.ready,
                'Image processing dependency is unavailable; run Production Operations diagnose before releasing',
            );
        }
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
    if (
        [
            'inspect-notification-config',
            'enable-unified-notifications',
            'prepare-notification-secret-transfer',
        ].includes(request.operation)
    ) {
        const plan = inspectProductionReleases();
        assert.equal(
            plan.markerSha,
            request.sourceSha,
            'Notification operations require the deployed source SHA',
        );
        const result = spawnSync(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                path.join(__dirname, 'notification-configuration-guard.mjs'),
                request.operation === 'enable-unified-notifications'
                    ? 'enable'
                    : request.operation === 'prepare-notification-secret-transfer'
                      ? 'transfer'
                      : 'inspect',
            ],
            {
                encoding: 'utf8',
                timeout: 180000,
                maxBuffer: 16384,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, OPS_SOURCE_SHA: request.sourceSha },
            },
        );
        assert.equal(
            result.status,
            0,
            /^NOTIFICATION_[A-Z_:]+\n$/.test(result.stderr || '')
                ? result.stderr.trim()
                : 'Notification configuration failed',
        );
        assert.ok(
            result.stdout.endsWith('NOTIFICATION_CONFIGURATION_OK\n'),
            'Notification receipt is incomplete',
        );
        process.stdout.write(result.stdout);
        process.stdout.write(`PRODUCTION_OPERATIONS_COMPLETE operation=${request.operation}\n`);
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
    inspectIcloudRelay,
    inspectImageServices,
    applyAptListsCleanup,
    applySnapCacheCleanup,
    applyAptMetadataCleanup,
    applyAptArchiveCleanup,
    applyDeploymentCacheCleanup,
    applyOffsiteFileBackupConfig,
    frontendRevisionEvidence,
    assertStorefrontInspectionRevision,
    encodeBeforeReport,
    inspectProductionReleases,
    inspectDeploymentCacheCleanup,
    inspectAptArchiveCleanup,
    inspectAptMetadataCleanup,
    inspectAptListsCleanup,
    inspectSnapCacheCleanup,
    hasOpenFileDescriptor,
    inspectArchivedLogCleanup,
    applyArchivedLogCleanup,
    inspectFileBackupCleanup,
    applyFileBackupCleanup,
    inspectOffsiteFileBackupConfig,
    inspectRepositoryState,
    planDigest,
    productionHealthSnapshot,
    retainReviewedPlan,
    storefrontInspectionFailure,
    runStoreIsolationAudit,
    runPlatformGovernanceDataPreflight,
    runAdministratorProductReadinessAudit,
    runDatabaseBackup,
    runOrderSalesOwnershipBackfill,
    runMoyaoDefaultStoreMigration,
    runAssetWebpMigration,
    readOffsiteFileBackupSettings,
    startVerifiedMysqlBackup,
    validateMigrationAuditOutput,
    validateOrderSalesOwnershipOutput,
    validateMoyaoDefaultStoreMigrationOutput,
    validateStoreAutonomyAuditPayload,
    validateRequest,
    verifyOffsiteFileBackupPolicy,
    withProductionLock,
    restoreMissingProductionLock,
};
