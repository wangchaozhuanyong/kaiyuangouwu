'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runCatalogOwnershipAudit(
    request,
    {
        inspect,
        health,
        spawn = spawnSync,
        script = path.join(
            __dirname,
            'repository/packages/dev-server/scripts/catalog-ownership-evidence.mjs',
        ),
        persistPlan = compressed =>
            require('./governance-preflight-transport.cjs').persist(__dirname, compressed),
    },
) {
    assert.equal(request.operation, 'audit-catalog-ownership');
    const before = inspect();
    assert.equal(
        before.markerSha,
        request.expectedRuntimeSha,
        'Production runtime SHA changed or was not reviewed',
    );
    health('before');
    let payload;
    let failure;
    try {
        const result = spawn(
            '/usr/bin/node',
            ['--env-file=/var/www/kaiyuangouwu/packages/dev-server/.env', script],
            {
                encoding: 'utf8',
                timeout: 90000,
                maxBuffer: 1024 * 1024,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, STORE_ISOLATION_MODULE_ROOT: before.currentRuntime },
            },
        );
        if (result.status !== 0) {
            const safe = String(result.stderr || '')
                .split(/\r?\n/u)
                .find(line =>
                    /^READ_ONLY_AUDIT_FAILURE code=[A-Z][A-Z0-9_]{1,63} digest=[a-f0-9]{12}$/u.test(line),
                );
            throw new Error('Fixed read-only catalog audit failed' + (safe ? ' (' + safe + ')' : ''));
        }
        try {
            payload = JSON.parse(String(result.stdout || ''));
        } catch {
            throw new Error('Fixed catalog audit returned invalid JSON');
        }
        assert.deepEqual(
            Object.keys(payload).sort(),
            [
                'schema',
                'mode',
                'productionApply',
                'snapshotHash',
                'resourceCount',
                'unresolvedResourceCount',
                'compressedPlan',
            ].sort(),
        );
        assert.equal(payload.schema, 'vendure-catalog-ownership-production-preflight-v1');
        assert.equal(payload.mode, 'READ_ONLY');
        assert.equal(payload.productionApply, false);
        assert.match(payload.snapshotHash, /^[a-f0-9]{64}$/u);
        for (const key of ['resourceCount', 'unresolvedResourceCount'])
            assert.ok(Number.isSafeInteger(payload[key]) && payload[key] >= 0);
        assert.ok(
            payload.unresolvedResourceCount <= 500 &&
                payload.unresolvedResourceCount <= payload.resourceCount,
        );
        assert.ok(
            typeof payload.compressedPlan === 'string' &&
                payload.compressedPlan.length > 0 &&
                payload.compressedPlan.length <= 512000,
        );
        assert.match(payload.compressedPlan, /^[A-Za-z0-9+/]+={0,2}$/u);
    } catch (error) {
        failure = error;
    }
    // These checks run on success, rejection and timeout. No database writes or release changes are made.
    assert.deepEqual(inspect(), before, 'Production release state changed during the catalog audit');
    health('after');
    if (failure) throw failure;
    const { compressedPlan, ...audit } = payload;
    return {
        sourceSha: request.sourceSha,
        runtimeSha: before.markerSha,
        audit,
        planTransport: persistPlan(compressedPlan),
    };
}

module.exports = { runCatalogOwnershipAudit };
