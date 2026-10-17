import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { runCatalogOwnershipAudit } = require('./catalog-ownership-audit.cjs');
const { validateRequest } = require('./production-operations.cjs');
const runtimeSha = 'b'.repeat(40);
const request = {
    operation: 'audit-catalog-ownership',
    sourceSha: 'a'.repeat(40),
    expectedRuntimeSha: runtimeSha,
};
const payload = {
    schema: 'vendure-catalog-ownership-production-preflight-v1',
    mode: 'READ_ONLY',
    productionApply: false,
    snapshotHash: 'c'.repeat(64),
    resourceCount: 20,
    unresolvedResourceCount: 2,
    compressedPlan: 'YWJj',
};
function dependencies() {
    const healthCalls = [];
    let reads = 0;
    let persisted = 0;
    return {
        healthCalls,
        get persisted() {
            return persisted;
        },
        inspect: () => {
            reads++;
            return { markerSha: runtimeSha, currentRuntime: '/immutable/runtime' };
        },
        health: stage => healthCalls.push(stage),
        spawn: (command, args, options) => {
            assert.equal(command, '/usr/bin/node');
            assert.ok(args[0].startsWith('--env-file='));
            assert.equal(args.length, 2);
            assert.equal(options.env.STORE_ISOLATION_MODULE_ROOT, '/immutable/runtime');
            assert.equal(options.timeout, 90000);
            return { status: 0, stdout: JSON.stringify(payload) };
        },
        persistPlan: () => {
            persisted++;
            return { sha256: 'd'.repeat(64) };
        },
    };
}
test('fixed catalog operation requires exact runtime, accepts no write approval or arbitrary target', () => {
    const env = {
        OPS_OPERATION: request.operation,
        OPS_SOURCE_SHA: request.sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
    };
    assert.equal(validateRequest(env).operation, request.operation);
    for (const invalid of [
        { OPS_EXPECTED_RUNTIME_SHA: '' },
        { OPS_EXPECTED_PLAN_SHA256: 'a'.repeat(64) },
        { OPS_PRODUCT_ID: '7' },
        { OPS_EXPECTED_CHANNEL_CODES: 'synthetic' },
        { OPS_NOTIFICATION_PUBLIC_KEY: 'secret' },
    ])
        assert.throws(() => validateRequest({ ...env, ...invalid }));
    const workflow = readFileSync(
        new URL('../.github/workflows/production_operations.yml', import.meta.url),
        'utf8',
    );
    assert.match(
        workflow,
        /transport\('deploy\/production-storefronts\.json', 'repository\/deploy\/production-storefronts\.json'\)/u,
    );
    const validation = workflow.match(/case "\$OPS_OPERATION" in[^]*?\besac/u)[0];
    assert.equal(spawnSync('bash', ['-c', validation], { env, encoding: 'utf8' }).status, 0);
    assert.match(workflow, /operation_name == 'audit-catalog-ownership'/u);
    for (const file of [
        'catalog-ownership-audit.cjs',
        'catalog-ownership-evidence.mjs',
        'governance-preflight-transport.cjs',
    ])
        assert.ok(workflow.includes("'" + file + "'"));
});
test('success and failed reads verify unchanged runtime and health; unsafe output is never persisted', () => {
    const ok = dependencies();
    assert.equal(runCatalogOwnershipAudit(request, ok).audit.snapshotHash, payload.snapshotHash);
    assert.deepEqual(ok.healthCalls, ['before', 'after']);
    assert.equal(ok.persisted, 1);
    for (const result of [
        { status: null, stderr: 'PRIVATE_DATABASE_ERROR' },
        { status: 0, stdout: 'PRIVATE_INVALID_JSON' },
        { status: 0, stdout: JSON.stringify({ ...payload, productionApply: true }) },
        { status: 0, stdout: JSON.stringify({ ...payload, secret: 'PRIVATE' }) },
        { status: 0, stdout: JSON.stringify({ ...payload, unresolvedResourceCount: 501 }) },
    ]) {
        const deps = dependencies();
        assert.throws(
            () => runCatalogOwnershipAudit(request, { ...deps, spawn: () => result }),
            error => !error.message.includes('PRIVATE'),
        );
        assert.deepEqual(deps.healthCalls, ['before', 'after']);
        assert.equal(deps.persisted, 0);
    }
    const changed = dependencies();
    let inspections = 0;
    assert.throws(
        () =>
            runCatalogOwnershipAudit(request, {
                ...changed,
                inspect: () => ({
                    markerSha: inspections++ ? 'e'.repeat(40) : runtimeSha,
                    currentRuntime: '/immutable/runtime',
                }),
            }),
        /release state changed/u,
    );
    assert.equal(changed.persisted, 0);
});
