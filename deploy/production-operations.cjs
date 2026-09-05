#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const retention = require('./systemd/vendure-production-release-retention.cjs');

const DEPLOY_LOCK = '/run/lock/vendure-production-deploy.lock';
const BACKUP_DIRECTORY = '/var/backups/vendure-mysql';

function validateRequest(environment) {
    const operation = environment.OPS_OPERATION || 'diagnose';
    assert.ok(['diagnose', 'retain-reviewed'].includes(operation), 'Unsupported production operation');
    assert.match(environment.OPS_SOURCE_SHA || '', /^[a-f0-9]{40}$/u, 'Invalid operations source SHA');
    const expectedPlanSha256 = environment.OPS_EXPECTED_PLAN_SHA256 || '';
    if (operation === 'retain-reviewed') {
        assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'A reviewed retention plan SHA-256 is required');
    } else {
        assert.equal(expectedPlanSha256, '', 'A read-only diagnosis does not accept a retention approval');
    }
    return { operation, sourceSha: environment.OPS_SOURCE_SHA, expectedPlanSha256 };
}

function planDigest(plan, sourceSha) {
    return createHash('sha256').update(JSON.stringify({ sourceSha, plan })).digest('hex');
}

function retainReviewedPlan(
    request,
    inspect = () => retention.inspectReleaseState({}),
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

function diagnose(request) {
    const result = {
        operation: request.operation,
        sourceSha: request.sourceSha,
        observedAt: new Date().toISOString(),
        disk: readCommand('df', ['-Pk', '/']),
        releaseSize: readCommand('du', ['-skx', '/var/www/kaiyuangouwu-releases']),
        repositorySha: readCommand('git', ['-C', '/var/www/kaiyuangouwu', 'rev-parse', 'HEAD']),
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
        const plan = retention.inspectReleaseState({});
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
    const before = diagnose(request);
    process.stdout.write(`${JSON.stringify({ stage: 'before', ...before }, null, 2)}\n`);
    if (request.operation === 'diagnose') return;
    const appliedPlan = retainReviewedPlan(request);
    process.stdout.write(
        `${JSON.stringify(
            {
                stage: 'retention-applied',
                planSha256: request.expectedPlanSha256,
                deletedDirectories: appliedPlan.deleteDirectories,
                deletedArchives: appliedPlan.deleteArchives,
                preservedDirectories: appliedPlan.keepDirectories,
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
        `${JSON.stringify({ stage: 'after', healthRefresh, ...diagnose(request) }, null, 2)}\n`,
    );
    assert.equal(
        healthRefresh.status,
        'ok',
        'Retention completed, but the production health check still failed',
    );
}

if (require.main === module) {
    try {
        validateRequest(process.env);
        if (process.argv.length === 3 && process.argv[2] === '--locked') {
            runLocked();
        } else {
            assert.equal(process.argv.length, 2, 'Unexpected operations argument');
            const child = spawnSync(
                'flock',
                ['--exclusive', '--wait', '300', DEPLOY_LOCK, process.execPath, __filename, '--locked'],
                { stdio: 'inherit' },
            );
            process.exitCode = child.status ?? 1;
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'Production operation failed'}\n`);
        process.exitCode = 1;
    }
}

module.exports = { planDigest, retainReviewedPlan, validateRequest };
