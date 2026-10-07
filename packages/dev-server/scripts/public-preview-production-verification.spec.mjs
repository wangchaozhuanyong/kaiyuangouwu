import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compensationFingerprint } from './public-preview-legacy-compensation.mjs';
import {
    createPinnedReviewVerifier,
    createProductionRuntimeVerifier,
    kernelCommandProvesEntry,
    PROTECTION_MANIFEST_VERSION,
    REQUIRED_PROTECTION_PAIRS,
    runtimeConfigurationFingerprints,
    validateProtectionManifest,
    validateRuntimeObservation,
} from './public-preview-production-verification.mjs';

const root = '/var/www/kaiyuangouwu-releases/reviewed-release';
const sha = 'b'.repeat(40);
const hash = 'c'.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = () => ({
    version: PROTECTION_MANIFEST_VERSION,
    releaseSha: sha,
    files: REQUIRED_PROTECTION_PAIRS.map(pair => ({ ...pair, sourceSha256: hash, compiledSha256: hash })),
});
const observation = () => ({
    metadata: { gitSha: sha, platform: 'linux/x64', sourceDirty: false },
    processes: ['vendure-api', 'vendure-worker'].map((name, i) => ({
        name,
        pid: 100 + i,
        status: 'online',
        cwd: root,
        managedCwd: root,
        entry: `${root}/packages/dev-server/dist/${i ? 'index-worker' : 'index'}.js`,
        kernelEntry: `${root}/packages/dev-server/dist/${i ? 'index-worker' : 'index'}.js`,
        startedAtMs: 2000,
        pidStable: true,
    })),
    protectedFiles: Array.from({ length: REQUIRED_PROTECTION_PAIRS.length * 2 + 2 }, (_, i) => ({
        path: `guard-${i}`,
        hashMatches: true,
        mtimeMs: 1000,
        ctimeMs: 1000,
    })),
});

test('actual truncated PM2 Node titles require full kernel environment and an exact release prefix', () => {
    const installed =
        '/var/www/kaiyuangouwu-releases/a535b99d937858b3907372bad77429aad809d8dd-37430769850-1-linux-x64';
    for (const [file, observedLength] of [
        ['index.js', 117],
        ['index-worker.js', 67],
    ]) {
        const entry = `${installed}/packages/dev-server/dist/${file}`;
        const env = { pm_exec_path: entry, pm_cwd: installed };
        const title = `node ${entry}`;
        const captured = title.slice(0, observedLength);
        assert.equal(kernelCommandProvesEntry([captured, ''], entry, installed, env), true);
        assert.equal(kernelCommandProvesEntry([captured], entry, installed, {}), false);
        assert.equal(
            kernelCommandProvesEntry([captured], entry, installed, { ...env, pm_cwd: '/old' }),
            false,
        );
        assert.equal(
            kernelCommandProvesEntry([captured], entry, installed, { ...env, pm_exec_path: entry + '.old' }),
            false,
        );
        assert.equal(kernelCommandProvesEntry([captured + 'x'], entry, installed, env), false);
        assert.equal(kernelCommandProvesEntry([title.slice(0, 40)], entry, installed, env), false);
        assert.equal(kernelCommandProvesEntry([captured, 'other'], entry, installed, env), false);
        assert.equal(kernelCommandProvesEntry([title], entry, installed, {}), true);
        assert.equal(kernelCommandProvesEntry(['node', entry], entry, installed, {}), true);
        assert.equal(
            kernelCommandProvesEntry(['/opt/pm2/lib/ProcessContainerFork.js'], entry, installed, env),
            true,
        );
        assert.equal(
            kernelCommandProvesEntry(['/opt/pm2/lib/ProcessContainerFork.js'], entry, installed, {}),
            false,
        );
        assert.equal(kernelCommandProvesEntry([title], '/elsewhere/index.js', installed, env), false);
    }
});

test('actual DB and Redis target binding excludes passwords and rejects missing runtime configuration', () => {
    const env = {
        NODE_ENV: 'production',
        DB: 'mysql',
        DB_HOST: '127.0.0.1',
        DB_PORT: '3306',
        DB_NAME: 'fixture',
        DB_USERNAME: 'fixture-user',
        DB_PASSWORD: 'fixture-private-value',
        STOREFRONT_REDIS_URL: 'rediss://fixture-user:fixture-private-value@cache.invalid:6380/2',
    };
    const proof = runtimeConfigurationFingerprints(env);
    assert.deepEqual(Object.keys(proof).sort(), [
        'apiHostname',
        'apiPort',
        'cacheConfigurationFingerprint',
        'configurationFingerprint',
    ]);
    assert.equal(proof.apiPort, 3000);
    assert.equal(proof.apiHostname, '127.0.0.1');
    assert.equal(runtimeConfigurationFingerprints({ ...env, VENDURE_HOSTNAME: '::1' }).apiHostname, '::1');
    assert.throws(() => runtimeConfigurationFingerprints({ ...env, VENDURE_HOSTNAME: 'localhost' }));
    assert.throws(() => runtimeConfigurationFingerprints({ ...env, NODE_ENV: 'development' }));
    assert.equal(runtimeConfigurationFingerprints({ ...env, API_PORT: '3010' }).apiPort, 3010);
    assert.equal(runtimeConfigurationFingerprints({ ...env, API_PORT: '3010', PORT: '3020' }).apiPort, 3020);
    assert.throws(() => runtimeConfigurationFingerprints({ ...env, PORT: '65536' }));
    assert.ok(!JSON.stringify(proof).includes('fixture-private-value'));
    assert.notDeepEqual(runtimeConfigurationFingerprints({ ...env, DB_NAME: 'other-db' }), proof);
    assert.notDeepEqual(
        runtimeConfigurationFingerprints({
            ...env,
            STOREFRONT_REDIS_URL: 'rediss://fixture-user:fixture-private-value@other-cache.invalid:6380/2',
        }),
        proof,
    );
    assert.throws(() => runtimeConfigurationFingerprints({ ...env, DB_NAME: '' }));
    assert.equal(
        runtimeConfigurationFingerprints({ ...env, STOREFRONT_REDIS_URL: '' }).cacheConfigurationFingerprint,
        compensationFingerprint({
            strategy: 'InMemoryCacheStrategy',
            cacheSize: 10_000,
            ttlProvider: 'DefaultCacheTtlProvider',
        }),
    );
    assert.throws(() => runtimeConfigurationFingerprints({ ...env, DB: 'sqlite' }));
});

test('requires exact source and compiled guard coverage, not claimed flags', () => {
    assert.equal(validateProtectionManifest(manifest(), sha).files.length, REQUIRED_PROTECTION_PAIRS.length);
    for (const change of [
        m => {
            m.files.pop();
        },
        m => {
            m.files[0].source = 'fixture.ts';
        },
        m => {
            m.files[0].compiled = 'fake.js';
        },
        m => {
            m.files[0].compiledSha256 = '';
        },
        m => {
            m.files[0].sourceSha256 = '';
        },
        m => {
            m.releaseSha = 'a'.repeat(40);
        },
        m => {
            m.version = 'fake';
        },
    ]) {
        const m = manifest();
        change(m);
        assert.throws(() => validateProtectionManifest(m, sha));
    }
});

test('requires the actual API and worker at the immutable release', () => {
    assert.equal(validateRuntimeObservation(observation(), root, sha).processes.length, 2);
    for (const [label, change] of [
        [
            'stale SHA',
            o => {
                o.metadata.gitSha = 'a'.repeat(40);
            },
        ],
        [
            'dirty artifact',
            o => {
                o.metadata.sourceDirty = true;
            },
        ],
        [
            'host platform',
            o => {
                o.metadata.platform = 'darwin/arm64';
            },
        ],
        [
            'worker missing',
            o => {
                o.processes.pop();
            },
        ],
        [
            'managed cwd only',
            o => {
                o.processes[0].cwd = '/old-runtime';
            },
        ],
        [
            'managed mismatch',
            o => {
                o.processes[0].managedCwd = '/old-runtime';
            },
        ],
        [
            'wrong entry',
            o => {
                o.processes[0].entry = '/old/index.js';
            },
        ],
        [
            'kernel mismatch',
            o => {
                o.processes[0].kernelEntry = '/old/index.js';
            },
        ],
        [
            'process stopped',
            o => {
                o.processes[1].status = 'stopped';
            },
        ],
        [
            'pid missing',
            o => {
                o.processes[0].pid = 0;
            },
        ],
        [
            'duplicate pid',
            o => {
                o.processes[1].pid = 100;
            },
        ],
        [
            'restarted',
            o => {
                o.processes[0].pidStable = false;
            },
        ],
        [
            'start unknown',
            o => {
                o.processes[0].startedAtMs = NaN;
            },
        ],
        [
            'guard changed',
            o => {
                o.protectedFiles[0].hashMatches = false;
            },
        ],
        [
            'guard changed after startup',
            o => {
                o.protectedFiles[0].ctimeMs = 2001;
            },
        ],
        [
            'source changed after startup',
            o => {
                o.protectedFiles[1].mtimeMs = 2001;
            },
        ],
        [
            'incomplete evidence',
            o => {
                o.protectedFiles = [];
            },
        ],
    ]) {
        const o = observation();
        change(o);
        assert.throws(() => validateRuntimeObservation(o, root, sha), undefined, label);
    }
});

test('production collector cannot accept injected VERIFIED data on the development host', async () => {
    if (process.platform === 'linux') return;
    await assert.rejects(
        createProductionRuntimeVerifier({
            releaseRoot: root,
            expectedReleaseSha: sha,
            protectionManifestPath: root + '/PUBLIC-PREVIEW-PROTECTIONS.json',
            protectionManifestSha256: hash,
            proof: { status: 'VERIFIED' },
        })(),
        /Actual Linux/u,
    );
});

test('pinned independent review rejects replacement, self review and unproven external outcome', async () => {
    const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const parent = path.join(project, 'docs/public-preview-standalone-20261007/verification-fixtures');
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, 'review-'));
    try {
        const entry = {
            fingerprint: hash,
            snapshot: {
                digital: {
                    task: {
                        id: '1',
                        contentFingerprint: 'd'.repeat(64),
                    },
                },
            },
        };
        const artifact = {
            version: 'historical-test-digital-review-v1',
            orderId: '37',
            channelId: '5',
            deliveryId: '1',
            beforeFingerprint: hash,
            contentFingerprint: 'd'.repeat(64),
            contentClassification: 'TEST_ONLY',
            realResourceDisposition: 'NO_REAL_RESOURCE',
            attestationSource: 'HUMAN_USER_20261007',
            attestationDigest: hash,
            externalDeliveryOutcome: 'NOT_VERIFIED',
            reviewedAt: new Date().toISOString(),
        };
        const envelope = {
            version: 'public-preview-independent-review-envelope-v1',
            sourceSnapshotSha256: hash,
            reviewerId: 'independent-reviewer',
            executorId: 'operator',
            decision: 'APPROVED',
            reviewArtifact: artifact,
        };
        const reviewPath = path.join(directory, 'review.json');
        async function verifier(value) {
            const bytes = JSON.stringify(value);
            await writeFile(reviewPath, bytes, { mode: 0o600 });
            return createPinnedReviewVerifier({
                reviewPath,
                reviewSha256: digest(bytes),
                expectedSourceSnapshotSha256: hash,
                expectedReviewerId: 'independent-reviewer',
            });
        }
        const verify = await verifier(envelope);
        assert.equal(await verify(artifact, entry), true);
        await writeFile(reviewPath, '{}');
        await assert.rejects(verify(artifact, entry), /Pinned evidence changed/u);
        for (const change of [
            e => {
                e.executorId = e.reviewerId;
            },
            e => {
                e.reviewerId = 'other';
            },
            e => {
                e.sourceSnapshotSha256 = 'a'.repeat(64);
            },
            e => {
                e.decision = 'WAIT';
            },
            e => {
                e.reviewArtifact.externalDeliveryOutcome = 'VERIFIED_TEST_ONLY';
            },
            e => {
                e.reviewArtifact.beforeFingerprint = 'a'.repeat(64);
            },
        ]) {
            const e = structuredClone(envelope);
            change(e);
            await assert.rejects((await verifier(e))(e.reviewArtifact, entry));
        }
        const final = await verifier(envelope);
        await assert.rejects(final({ ...artifact, contentFingerprint: hash }, entry));
    } finally {
        await rm(directory, { recursive: true });
    }
});
