'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const path = require('node:path');
const { TARGET_IDS } = require('./historical-asset-cleanup.cjs');

function runHistoricalAssetCleanup(
    request,
    {
        inspect,
        health,
        spawn = spawnSync,
        script = path.join(__dirname, 'historical-asset-cleanup.cjs'),
        persistPlan = compressed =>
            require('./governance-preflight-transport.cjs').persist(__dirname, compressed),
    },
) {
    const phase = {
        'prepare-historical-asset-cleanup': 'prepare',
        'apply-historical-asset-cleanup-pilot-reviewed': 'pilot',
        'apply-historical-asset-cleanup-remaining-reviewed': 'remaining',
    }[request.operation];
    assert.ok(phase, 'Unexpected historical asset operation');
    const before = inspect();
    assert.equal(before.markerSha, request.expectedRuntimeSha, 'Historical asset runtime changed');
    health('before');
    let output, failure;
    try {
        const result = spawn(
            '/usr/bin/node',
            [
                '--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env',
                script,
                phase,
                request.sourceSha,
                request.expectedRuntimeSha,
                ...(phase === 'prepare' ? [] : [request.expectedPlanSha256]),
            ],
            {
                encoding: 'utf8',
                timeout: 720000,
                maxBuffer: 262144,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
            },
        );
        if (result.status !== 0) {
            const safe = String(result.stderr || '')
                .split(/\r?\n/u)
                .find(line =>
                    /^HISTORICAL_ASSET_FAILURE code=ASSET_[A-Z_]+ digest=[a-f0-9]{12}$/u.test(line),
                );
            throw new Error('Historical asset operation failed' + (safe ? ' (' + safe + ')' : ''));
        }
        try {
            output = JSON.parse(String(result.stdout || ''));
        } catch {
            throw new Error('Invalid historical asset receipt');
        }
        assert.equal(output.schema, 'vendure-historical-asset-cleanup-v1');
        assert.match(output.planHash, /^[a-f0-9]{64}$/u);
        if (phase === 'prepare') {
            assert.deepEqual(
                Object.keys(output).sort(),
                [
                    'mode',
                    'productionApply',
                    'schema',
                    'sourceSha',
                    'runtimeSha',
                    'planHash',
                    'candidateCount',
                    'eligibleIds',
                    'pilotIds',
                    'remainingIds',
                    'kept',
                    'referenceCoverage',
                    'backup',
                    'businessDataWrites',
                ].sort(),
            );
            assert.equal(output.mode, 'READ_ONLY');
            assert.equal(output.productionApply, false);
            assert.equal(output.businessDataWrites, 0);
            assert.equal(output.sourceSha, request.sourceSha);
            assert.equal(output.runtimeSha, before.markerSha);
            assert.equal(output.candidateCount, TARGET_IDS.length);
            const partition = [...output.eligibleIds, ...output.kept.map(row => row.id)];
            assert.equal(new Set(partition).size, TARGET_IDS.length);
            assert.ok(partition.every(id => TARGET_IDS.includes(id)));
            assert.deepEqual(output.pilotIds, output.eligibleIds.slice(0, 10));
            assert.deepEqual(output.remainingIds, output.eligibleIds.slice(10));
            assert.equal(output.backup.verified, true);
            assert.equal(
                output.backup.directory,
                '/var/www/kaiyuangouwu/backups/historical-asset-cleanup/' + output.planHash,
            );
            assert.match(output.backup.metadataSha256, /^[a-f0-9]{64}$/u);
            assert.equal(output.backup.files, output.eligibleIds.length * 2);
        } else {
            assert.deepEqual(
                Object.keys(output).sort(),
                [
                    'schema',
                    'planHash',
                    'phase',
                    'ids',
                    'status',
                    'productionApply',
                    'deletedAssetCount',
                    'deletedFileCount',
                    'keptCount',
                    'backupVerified',
                ].sort(),
            );
            assert.equal(output.planHash, request.expectedPlanSha256);
            assert.equal(output.phase, phase);
            assert.equal(output.status, 'COMPLETE');
            assert.equal(output.productionApply, true);
            assert.equal(output.backupVerified, true);
            assert.ok(output.ids.length > 0 && output.ids.every(id => TARGET_IDS.includes(id)));
            assert.equal(new Set(output.ids).size, output.ids.length);
            assert.equal(output.deletedAssetCount, output.ids.length);
            assert.equal(output.deletedFileCount, output.ids.length * 2);
            assert.ok(phase !== 'pilot' || output.ids.length <= 10);
        }
    } catch (error) {
        failure = error;
    }
    assert.deepEqual(inspect(), before, 'Release changed during historical asset operation');
    health('after');
    if (failure) throw failure;
    if (phase !== 'prepare') return { sourceSha: request.sourceSha, runtimeSha: before.markerSha, ...output };
    const bytes = Buffer.from(JSON.stringify(output));
    assert.ok(bytes.length <= 200000, 'Historical asset plan budget exceeded');
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        audit: {
            schema: 'vendure-historical-asset-preparation-v1',
            mode: 'READ_ONLY',
            productionApply: false,
            businessDataWrites: 0,
            snapshotHash: createHash('sha256').update(bytes).digest('hex'),
            candidateCount: output.candidateCount,
            eligibleCount: output.eligibleIds.length,
            keptCount: output.kept.length,
            planHash: output.planHash,
            backupVerified: true,
        },
        planTransport: persistPlan(gzipSync(bytes).toString('base64')),
    };
}
module.exports = { runHistoricalAssetCleanup };
