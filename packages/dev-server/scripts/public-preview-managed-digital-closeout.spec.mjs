import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compensationFingerprint } from './public-preview-legacy-compensation.mjs';
import {
    assertManagedRuntimeBinding,
    authenticatedContext,
    guardedPreBootstrapConfig,
    independentNetworkReadback,
    nativeCacheConfigurationFingerprint,
    nativeDatabaseConfigurationFingerprint,
    refreshManagedChannelCache,
    refreshSharedChannelCache,
    runManagedCloseout,
    verifyAssemblyCallbacks,
    verifyCommittedCloseout,
} from './public-preview-managed-digital-closeout.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const receiptKey = 'public-preview-legacy-digital-compensation-v1:37';
function nativeConfigurationFixture() {
    const require = createRequire(import.meta.url);
    const { ConfigService } = require(
        fileURLToPath(new URL('../../core/dist/config/config.service.js', import.meta.url)),
    );
    const { RedisCacheStrategy } = require(
        fileURLToPath(
            new URL('../../core/dist/plugin/redis-cache-plugin/redis-cache-strategy.js', import.meta.url),
        ),
    );
    require(
        fileURLToPath(new URL('../../core/dist/config/config-helpers.js', import.meta.url)),
    ).resetConfig();
    const configService = new ConfigService();
    // Actual native getters/strategy without provider lifecycle or any connection.
    configService.activeConfig = {
        ...configService.activeConfig,
        apiOptions: { ...configService.apiOptions, hostname: '127.0.0.1', port: 3000 },
        dbConnectionOptions: {
            type: 'mariadb',
            host: '127.0.0.1',
            port: 3306,
            database: 'owned-db',
            username: 'owned-user',
        },
        systemOptions: {
            ...configService.systemOptions,
            cacheStrategy: new RedisCacheStrategy({
                namespace: 'vendure-storefront-cache-v1',
                redisOptions: { host: 'owned-host', port: 6379, db: 0 },
            }),
        },
    };
    return configService;
}
const proofConfig = nativeConfigurationFixture();
const proof = {
    status: 'VERIFIED',
    runtimeSha: 'b'.repeat(40),
    protectionsFingerprint: 'c'.repeat(64),
    configurationFingerprint: nativeDatabaseConfigurationFingerprint(proofConfig.dbConnectionOptions),
    cacheConfigurationFingerprint: nativeCacheConfigurationFingerprint(
        proofConfig.systemOptions.cacheStrategy,
    ),
    apiPort: proofConfig.apiOptions.port,
    apiHostname: proofConfig.apiOptions.hostname,
};
function fixture() {
    const before = {
        order: { id: '37', salesChannelId: '5', state: 'Modifying' },
        payments: [{ id: '10', state: 'Settled', serverMarkedTest: true }],
        lines: [{ id: '248', productVariantId: '1093', quantity: 1 }],
        fulfillments: [],
        risks: { manual_digital_delivery: [{ id: '1', fingerprint: 'before-task-hash' }] },
        locations: [{ id: '10' }],
        movements: [{ id: '884', type: 'ALLOCATION' }],
        stockLevels: [{ id: 'level', stockOnHand: 100, stockAllocated: 1 }],
        coupons: [{ id: '8', status: 'USED', version: 5, usedAt: 'old-time', usedOrderId: '37' }],
        ledger: [{ id: 'old', eventType: 'REDEEMED' }],
        digital: {
            task: {
                id: '1',
                state: 'MANUAL_REVIEW',
                contentFingerprint: 'content-hash',
                immutableFingerprint: 'native-hash',
                fingerprint: 'before-task-hash',
                hasEncryptedPackages: true,
            },
            events: [],
            receiptAccess: [],
            fulfillmentLines: [],
            incidents: [],
        },
    };
    const after = structuredClone(before);
    after.movements.push({
        id: 'release',
        orderLineId: '248',
        productVariantId: '1093',
        stockLocationId: '10',
        quantity: 1,
        type: 'RELEASE',
    });
    after.stockLevels[0].stockAllocated = 0;
    after.coupons[0].status = 'EXPIRED';
    after.coupons[0].version++;
    after.ledger.push({ id: 'corrected', eventType: 'CORRECTED' }, { id: 'expired', eventType: 'EXPIRED' });
    after.digital.task.state = 'CANCELLED';
    after.digital.task.fingerprint = 'after-task-hash';
    after.risks.manual_digital_delivery[0].fingerprint = 'after-task-hash';
    after.digital.events.push({ id: 'closed', closingReceipt: true });
    const { stockLevels: _levels, ...evidence } = after;
    const receipt = {
        key: receiptKey,
        authorization: 'ORDER_37_TEST_ONLY_20261007',
        orderId: '37',
        salesChannelId: '5',
        deliveryId: '1',
        changedQuantity: 1,
        correctedCoupons: 1,
        before,
        beforeFingerprint: compensationFingerprint(before),
        afterEvidenceFingerprint: compensationFingerprint(evidence),
        releaseIds: ['release'],
        ledgerIds: ['corrected', 'expired'],
        closedIncidentIds: [],
    };
    const fresh = { snapshot: after, fingerprint: compensationFingerprint(after) };
    const manifest = { entry: fresh, sourceSnapshotSha256: compensationFingerprint(fresh) };
    const rows = [{ id: 'history', data: { digitalCompensation: receipt } }];
    let executions = 0;
    let writes = 0;
    const ctx = { channelId: '5' };
    const assembly = {
        configService: nativeConfigurationFixture(),
        context: async () => ctx,
        dataSource: { getMetadata: () => ({ target: 'History' }) },
        host: {
            capture: async () => structuredClone(fresh),
            execute: async (_ctx, input) => {
                executions++;
                return { status: input.apply ? 'APPLIED' : 'PREVIEW_ONLY' };
            },
            connection: { getRepository: () => ({ find: async () => rows }) },
            providers: {
                carts: { lockForOrder: async () => undefined },
                orders: {
                    lockOrderForRefund: async () => undefined,
                    withOrderMutationTransaction: async (_ctx, callback) => callback(ctx),
                },
                history: {
                    createHistoryEntryForOrder: async input => {
                        writes++;
                        const row = { id: 'completion', data: input.data };
                        rows.push(row);
                        return row;
                    },
                },
            },
        },
    };
    return {
        before,
        after,
        receipt,
        fresh,
        manifest,
        assembly,
        rows,
        counters: () => ({ executions, writes }),
    };
}

test('default inspect captures evidence without mutation or claiming review', async () => {
    const f = fixture();
    const result = await runManagedCloseout({ assembly: f.assembly, verifyRuntime: async () => proof });
    assert.equal(result.status, 'INSPECTED_NOT_REVIEWED');
    assert.equal(result.productionCompleted, false);
    assert.equal(result.manifest.entry.fingerprint, f.fresh.fingerprint);
    assert.equal(result.manifest.sourceSnapshotSha256, compensationFingerprint(result.manifest.entry));
    assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
});

for (const [name, tamper] of [
    [
        'forged source hash with unchanged entry',
        manifest => {
            manifest.sourceSnapshotSha256 = 'd'.repeat(64);
        },
    ],
    [
        'changed full snapshot body with stale source hash',
        manifest => {
            manifest.entry.snapshot.order.state = 'Cancelled';
        },
    ],
]) {
    test(`preview and apply reject ${name} before authentication, review or side effects`, async () => {
        for (const mode of ['preview', 'apply']) {
            const f = fixture();
            const manifest = structuredClone(f.manifest);
            tamper(manifest);
            assert.notEqual(manifest.sourceSnapshotSha256, compensationFingerprint(manifest.entry));
            let contexts = 0;
            let runtimeReads = 0;
            let reviews = 0;
            let phases = 0;
            f.assembly.context = async () => {
                contexts++;
            };
            await assert.rejects(
                runManagedCloseout({
                    mode,
                    assembly: f.assembly,
                    manifest,
                    verifyRuntime: async () => {
                        runtimeReads++;
                        return proof;
                    },
                    verifyReview: async () => {
                        reviews++;
                        return true;
                    },
                    onPhase: async () => {
                        phases++;
                    },
                }),
                /Full native source snapshot hash does not match/,
            );
            assert.deepEqual(
                { contexts, runtimeReads, reviews, phases },
                { contexts: 0, runtimeReads: 0, reviews: 0, phases: 0 },
            );
            assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
        }
    });
}

test('preview requires a pinned independent reviewer and never enables apply', async () => {
    const f = fixture();
    await assert.rejects(
        runManagedCloseout({
            mode: 'preview',
            assembly: f.assembly,
            manifest: f.manifest,
            verifyRuntime: async () => proof,
        }),
        /review verifier/,
    );
    const result = await runManagedCloseout({
        mode: 'preview',
        assembly: f.assembly,
        verifyRuntime: async () => proof,
        verifyReview: async () => true,
        manifest: f.manifest,
        reviewArtifact: {},
    });
    assert.equal(result.status, 'PREVIEW_ONLY');
    assert.deepEqual(f.counters(), { executions: 1, writes: 0 });
});

test('apply reports the committed phase before a local evidence write can fail', async () => {
    const f = fixture();
    f.assembly.host.execute = async () => ({
        status: 'APPLIED',
        historyEntryId: 'durable-history',
        beforeFingerprint: f.fresh.fingerprint,
    });
    const phases = [];
    await assert.rejects(
        runManagedCloseout({
            mode: 'apply',
            assembly: f.assembly,
            manifest: f.manifest,
            reviewArtifact: {},
            verifyRuntime: async () => proof,
            verifyReview: async () => true,
            onPhase: async value => {
                phases.push(value);
                if (value.status === 'COMMITTED_READBACK_REQUIRED')
                    throw new Error('owned output unavailable after commit');
            },
        }),
        /output unavailable after commit/,
    );
    assert.deepEqual(
        phases.map(row => row.status),
        ['APPLY_ATTEMPTED', 'COMMITTED_READBACK_REQUIRED'],
    );
    assert.equal(phases[1].historyEntryId, 'durable-history');
});

test('native DB attestation detects a changed database or account without returning credentials', () => {
    const options = {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        database: 'owned-db',
        username: 'owned-user',
        password: 'memory-only-value',
    };
    const expected = compensationFingerprint({
        DB_CONNECTION_TYPE: 'mysql',
        DB_HOST: 'localhost',
        DB_PORT: '3306',
        DB_NAME: 'owned-db',
        DB_USERNAME: 'owned-user',
    });
    assert.equal(nativeDatabaseConfigurationFingerprint(options), expected);
    assert.notEqual(
        nativeDatabaseConfigurationFingerprint({ ...options, database: 'different-db' }),
        expected,
    );
    assert.notEqual(
        nativeDatabaseConfigurationFingerprint({ ...options, username: 'different-user' }),
        expected,
    );
    assert.equal(
        nativeDatabaseConfigurationFingerprint({ ...options, password: 'updated-memory-only-value' }),
        expected,
    );
});

test('native cache attestation detects the wrong Redis database or namespace without exposing its secret', () => {
    class RedisCacheStrategy {
        options = {
            namespace: 'vendure-storefront-cache-v1',
            redisOptions: { host: 'owned-host', port: 6379, db: 0, password: 'memory-only-value' },
        };
    }
    const strategy = new RedisCacheStrategy();
    const expected = compensationFingerprint({
        namespace: 'vendure-storefront-cache-v1',
        host: 'owned-host',
        port: 6379,
        db: 0,
        username: null,
        tls: false,
    });
    assert.equal(nativeCacheConfigurationFingerprint(strategy), expected);
    strategy.options.redisOptions.db = 1;
    assert.notEqual(nativeCacheConfigurationFingerprint(strategy), expected);
    strategy.options.redisOptions.db = 0;
    strategy.options.namespace = 'another-cache';
    assert.notEqual(nativeCacheConfigurationFingerprint(strategy), expected);
});

function inProcessCacheFixture() {
    const configService = nativeConfigurationFixture();
    const { InMemoryCacheStrategy } = createRequire(import.meta.url)(
        fileURLToPath(new URL('../../core/dist/config/system/in-memory-cache-strategy.js', import.meta.url)),
    );
    configService.activeConfig.systemOptions.cacheStrategy = new InMemoryCacheStrategy();
    return configService;
}

test('actual default native in-process cache is bound and custom capacity or clock is rejected', () => {
    const config = inProcessCacheFixture();
    const strategy = config.systemOptions.cacheStrategy;
    const fingerprint = nativeCacheConfigurationFingerprint(strategy);
    assert.equal(
        fingerprint,
        compensationFingerprint({
            strategy: 'InMemoryCacheStrategy',
            cacheSize: 10_000,
            ttlProvider: 'DefaultCacheTtlProvider',
        }),
    );
    assertManagedRuntimeBinding(config, { ...proof, cacheConfigurationFingerprint: fingerprint });
    strategy.cacheSize = 20_000;
    assert.throws(() => nativeCacheConfigurationFingerprint(strategy), /capacity/);
    strategy.cacheSize = 10_000;
    strategy.ttlProvider = { getTime: () => 0 };
    assert.throws(() => nativeCacheConfigurationFingerprint(strategy), /clock/);
    class InMemoryCacheStrategy {
        cacheSize = 10_000;
        ttlProvider = { constructor: { name: 'DefaultCacheTtlProvider' }, getTime: () => 0 };
    }
    assert.throws(() => nativeCacheConfigurationFingerprint(new InMemoryCacheStrategy()), /class/);
    const clockFixture = inProcessCacheFixture().systemOptions.cacheStrategy;
    class DefaultCacheTtlProvider {
        getTime() {
            return 0;
        }
    }
    clockFixture.ttlProvider = new DefaultCacheTtlProvider();
    assert.throws(() => nativeCacheConfigurationFingerprint(clockFixture), /clock/);
    const changed = inProcessCacheFixture().systemOptions.cacheStrategy;
    changed.get = async () => undefined;
    assert.throws(() => nativeCacheConfigurationFingerprint(changed), /behavior/);
});

test('in-process cache refresh uses only the attested native API PID and exact managed Channel', async () => {
    const configService = inProcessCacheFixture();
    const runtimeProof = {
        ...proof,
        cacheConfigurationFingerprint: nativeCacheConfigurationFingerprint(
            configService.systemOptions.cacheStrategy,
        ),
        processes: [{ name: 'vendure-api', pid: 123 }],
    };
    const assembly = { configService, sessionToken: 'private-fixture-session' };
    const ctx = { channelId: '5', channel: { id: '5', token: 'native-channel' } };
    const row = { channelId: '5', processId: 123, shared: false, revisionFingerprint: 'd'.repeat(64) };
    let requests = 0;
    const input = {
        assembly,
        ctx,
        proof: runtimeProof,
        fetchImpl: async (url, options) => {
            requests++;
            assert.equal(url.origin, 'http://127.0.0.1:3000');
            assert.equal(url.pathname, '/admin-api');
            assert.equal(options.headers['vendure-token'], ctx.channel.token);
            assert.equal(options.headers.authorization, `Bearer ${assembly.sessionToken}`);
            assert.equal(JSON.parse(options.body).query.includes('refreshStorefrontPublicCache'), true);
            return { ok: true, json: async () => ({ data: { refreshStorefrontPublicCache: row } }) };
        },
    };
    const result = await refreshManagedChannelCache(input);
    assert.equal(result.topology, 'IN_PROCESS');
    assert.ok(!JSON.stringify(result).includes(assembly.sessionToken));
    for (const change of [
        { channelId: '4' },
        { processId: 124 },
        { shared: true },
        { revisionFingerprint: 'bad' },
    ]) {
        const original = { ...row };
        Object.assign(row, change);
        await assert.rejects(refreshManagedChannelCache(input));
        Object.assign(row, original);
    }
    const before = requests;
    await assert.rejects(refreshManagedChannelCache({ ...input, ctx: { ...ctx, channelId: '4' } }), /scope/);
    await assert.rejects(
        refreshManagedChannelCache({ ...input, ctx: { ...ctx, channel: { ...ctx.channel, id: '4' } } }),
        /identity/,
    );
    await assert.rejects(
        refreshManagedChannelCache({ ...input, ctx: { ...ctx, channel: { ...ctx.channel, token: '' } } }),
        /token/,
    );
    await assert.rejects(
        refreshManagedChannelCache({ ...input, proof: { ...runtimeProof, processes: [] } }),
        /PID/,
    );
    assert.equal(requests, before);
    let redisLoads = 0;
    await assert.rejects(
        refreshManagedChannelCache({
            ...input,
            assembly: { ...assembly, configService: proofConfig },
            proof,
            ctx: { ...ctx, channelId: '4' },
            loadRedis: async () => {
                redisLoads++;
            },
        }),
        /scope/,
    );
    assert.equal(redisLoads, 0);
});

test('native API port attestation rejects another local process before database connection', async () => {
    const configService = nativeConfigurationFixture();
    let connections = 0;
    const connectAfterVerification = async runtimeProof => {
        assertManagedRuntimeBinding(configService, runtimeProof);
        connections++;
    };
    await assert.rejects(connectAfterVerification({ ...proof, apiPort: 3001 }), /actual API process/);
    await assert.rejects(connectAfterVerification({ ...proof, apiPort: '3000' }), /actual API process/);
    await assert.rejects(connectAfterVerification({ ...proof, apiPort: undefined }), /actual API process/);
    await assert.rejects(connectAfterVerification({ ...proof, apiHostname: '::1' }), /actual API process/);
    assert.equal(connections, 0);
    await connectAfterVerification(proof);
    assert.equal(connections, 1);
});

for (const [field, value, pattern] of [
    ['configurationFingerprint', 'd'.repeat(64), /Managed database/],
    ['cacheConfigurationFingerprint', 'd'.repeat(64), /Managed cache/],
    ['apiHostname', '::1', /Managed API hostname/],
]) {
    test(`managed runtime binding rejects ${field} drift before native apply`, async () => {
        const f = fixture();
        await assert.rejects(
            runManagedCloseout({
                mode: 'apply',
                assembly: f.assembly,
                verifyRuntime: async () => ({ ...proof, [field]: value }),
                verifyReview: async () => true,
                manifest: f.manifest,
            }),
            pattern,
        );
        assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
        let reads = 0;
        await assert.rejects(
            runManagedCloseout({
                mode: 'finish',
                assembly: f.assembly,
                verifyRuntime: async () => (reads++ ? { ...proof, [field]: value } : proof),
                refreshCache: async () => ({ channelId: '5' }),
                readNetwork: async () => ({ status: 'VERIFIED' }),
            }),
            pattern,
        );
        assert.equal(reads, 2);
        assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
    });
}

test('apply rechecks runtime and review before the native executor; rejected checks never mutate', async () => {
    const f = fixture();
    for (const mode of ['apply', 'finish'])
        await assert.rejects(
            runManagedCloseout({
                mode,
                assembly: f.assembly,
                manifest: f.manifest,
                verifyRuntime: async () => ({ status: 'UNKNOWN' }),
            }),
            /runtime proof/,
        );
    await assert.rejects(
        runManagedCloseout({
            mode: 'apply',
            assembly: f.assembly,
            manifest: f.manifest,
            verifyRuntime: async () => proof,
            verifyReview: async () => false,
        }),
        /review rejected/,
    );
    assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
});

test('finish verifies native compensation, records completion once and never calls apply', async () => {
    const f = fixture();
    let runtimeReads = 0;
    const input = {
        mode: 'finish',
        assembly: f.assembly,
        verifyRuntime: async () => {
            runtimeReads++;
            return proof;
        },
        refreshCache: async () => ({ channelId: '5', revisionFingerprint: 'cache-hash' }),
        readNetwork: async () => ({ status: 'VERIFIED' }),
    };
    const result = await runManagedCloseout(input);
    assert.equal(result.productionCompleted, true);
    assert.equal(result.status, 'COMPLETE_READ_BACK');
    const replay = await runManagedCloseout(input);
    assert.equal(replay.alreadyRecorded, true);
    assert.deepEqual(f.counters(), { executions: 0, writes: 1 });
    assert.equal(runtimeReads, 4);
});

for (const step of ['cache', 'network'])
    test(`finish ${step} failure leaves a committed apply intact and completion pending`, async () => {
        const f = fixture();
        const result = await runManagedCloseout({
            mode: 'finish',
            assembly: f.assembly,
            verifyRuntime: async () => proof,
            refreshCache: async () => {
                if (step === 'cache') throw new Error('unavailable');
                return { channelId: '5' };
            },
            readNetwork: async () => {
                throw new Error('readback unavailable');
            },
        });
        assert.equal(result.status, 'NATIVE_CACHE_REFRESH_AND_READBACK_REQUIRED');
        assert.equal(result.productionCompleted, false);
        assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
    });

test('native change during network readback prevents completion and no resource mutation is replayed', async () => {
    const f = fixture();
    await assert.rejects(
        runManagedCloseout({
            mode: 'finish',
            assembly: f.assembly,
            verifyRuntime: async () => proof,
            refreshCache: async () => ({}),
            readNetwork: async () => {
                f.fresh.snapshot.stockLevels[0].stockAllocated++;
                f.fresh.fingerprint = compensationFingerprint(f.fresh.snapshot);
                return { status: 'VERIFIED' };
            },
        }),
        /Allocated stock changed/,
    );
    assert.deepEqual(f.counters(), { executions: 0, writes: 0 });
});

for (const mutation of ['funds', 'content', 'late', 'stock', 'coupon', 'duplicate-release'])
    test(`independent native finish rejects new ${mutation} evidence`, () => {
        const f = fixture();
        if (mutation === 'funds')
            f.after.payments.push({ id: '11', state: 'Settled', serverMarkedTest: false });
        if (mutation === 'content') f.after.digital.task.contentFingerprint = 'changed';
        if (mutation === 'late') f.after.digital.events.push({ id: 'late', lateEvidence: true });
        if (mutation === 'stock') f.after.stockLevels[0].stockOnHand--;
        if (mutation === 'coupon') f.after.coupons[0].version++;
        if (mutation === 'duplicate-release') f.after.movements.push({ id: 'other', type: 'RELEASE' });
        const fresh = { snapshot: f.after, fingerprint: compensationFingerprint(f.after) };
        assert.throws(() => verifyCommittedCloseout(f.receipt, fresh));
    });

test('configuration and metadata callbacks must be reviewed before invocation', async () => {
    class Plugin {}
    const callback = currentConfig => currentConfig;
    const metadata = {
        getConfigurationFunction: () => callback,
        PLUGIN_METADATA: { CONFIGURATION: 'configuration' },
    };
    const config = { plugins: [Plugin], entityOptions: { metadataModifiers: [] } };
    const review = {
        version: 'native-no-lifecycle-assembly-review-v1',
        releaseSha: 'b'.repeat(40),
        reviewerId: 'independent-reviewer',
        configurationCallbacks: [{ plugin: 'Plugin', sha256: digest(callback.toString()) }],
        initialMetadataModifiers: [],
        metadataModifiers: [],
    };
    verifyAssemblyCallbacks(config, metadata, review, 'b'.repeat(40));
    assert.throws(
        () =>
            verifyAssemblyCallbacks(
                config,
                metadata,
                { ...review, configurationCallbacks: [] },
                'b'.repeat(40),
            ),
        /Unreviewed configuration/,
    );
    assert.throws(
        () => verifyAssemblyCallbacks(config, metadata, review, 'c'.repeat(40)),
        /release mismatch/,
    );
    // Real Reflect metadata is supplied by the installed native runtime; this isolated harness
    // observes only the guard refusing an added modifier before preBootstrap invokes it.
    const originalDefine = Reflect.defineMetadata;
    let wrapped;
    Reflect.defineMetadata = (_key, value) => {
        wrapped = value;
    };
    let invoked = false;
    const adding = current => {
        current.entityOptions.metadataModifiers.push(() => {
            invoked = true;
        });
        return current;
    };
    try {
        await assert.rejects(
            guardedPreBootstrapConfig(
                config,
                { ...metadata, getConfigurationFunction: () => adding },
                review,
                async current => {
                    await wrapped(current);
                    for (const modifier of current.entityOptions.metadataModifiers) modifier();
                    return current;
                },
            ),
            /Unreviewed metadata/,
        );
        assert.equal(invoked, false);
    } finally {
        Reflect.defineMetadata = originalDefine;
    }
});

test('authenticated native context rejects expiry, revocation and store-scoped read-only roles', async () => {
    // Actual compiled Vendure context and role calculation; database results are isolated fixtures.
    const core = createRequire(import.meta.url)(
        fileURLToPath(new URL('../../core/dist/index.js', import.meta.url)),
    );
    const channel = new core.Channel({
        id: '5',
        code: 'owned-store',
        token: 'owned-channel',
        defaultCurrencyCode: 'CNY',
        defaultLanguageCode: 'en',
    });
    const user = new core.User({
        id: 'native-user',
        verified: true,
        identifier: 'owned-admin',
        roles: [new core.Role({ permissions: [core.Permission.SuperAdmin], channels: [channel] })],
    });
    const session = new core.AuthenticatedSession({
        user,
        authenticationStrategy: 'native',
        expires: new Date('2026-10-08Z'),
        invalidated: false,
    });
    const dataSource = {
        getRepository: target =>
            target === core.AuthenticatedSession
                ? {
                      findOne: async ({ where }) =>
                          where.invalidated === false && !session.invalidated ? session : null,
                  }
                : target === core.Administrator
                  ? { findOne: async () => ({ id: 'administrator' }) }
                  : { findOneByOrFail: async () => channel },
    };
    const input = {
        dataSource,
        core,
        configService: {},
        sessionToken: 'opaque-native-session-token',
        now: new Date('2026-10-07Z'),
    };
    assert.equal((await authenticatedContext(input)).channelId, '5');
    user.roles[0].permissions = ['ReadOrder'];
    await assert.rejects(authenticatedContext(input), /SuperAdmin/);
    user.roles[0].permissions = ['SuperAdmin'];
    session.invalidated = true;
    await assert.rejects(authenticatedContext(input), /session rejected/);
    session.invalidated = false;
    session.expires = new Date('2026-10-06Z');
    await assert.rejects(authenticatedContext(input), /session rejected/);
    await assert.rejects(authenticatedContext({ ...input, sessionToken: '' }), /session required/);
});

test('cache generation targets native namespace and Channel 5 only; no global purge', async () => {
    const commands = [];
    let revision = 'old-generation';
    class RedisCacheStrategy {
        options = { namespace: 'native-cache', redisOptions: { host: 'owned-host' } };
        rotateVersion() {
            return undefined;
        }
    }
    class Redis {
        on() {
            return this;
        }
        connect() {
            return Promise.resolve();
        }
        disconnect() {
            commands.push(['disconnect']);
        }
        async get(key) {
            commands.push(['get', key]);
            return revision;
        }
        async set(key, value, ...ttl) {
            commands.push(['set', key, ...ttl]);
            revision = value;
            return 'OK';
        }
    }
    const result = await refreshSharedChannelCache({
        configService: { systemOptions: { cacheStrategy: new RedisCacheStrategy() } },
        loadRedis: async () => Redis,
    });
    assert.equal(result.channelId, '5');
    assert.equal(result.revisionFingerprint, digest(revision));
    assert.ok(
        commands
            .filter(row => row[0] !== 'disconnect')
            .every(row => row[1] === 'native-cache:storefront-public:v1:revision:5'),
    );
    assert.deepEqual(commands.find(row => row[0] === 'set').slice(2), ['EX', 86_400]);
    await assert.rejects(
        refreshSharedChannelCache({
            configService: { systemOptions: { cacheStrategy: {} } },
            loadRedis: async () => Redis,
        }),
        /Shared native cache/,
    );
});

test('authenticated network reader refuses another Admin host before transmitting a token', async () => {
    let sent = false;
    for (const [hostname, adminOrigin] of [
        ['127.0.0.1', 'https://unexpected.example'],
        ['127.0.0.1', 'http://[::1]:3000'],
        ['127.0.0.1', 'http://localhost:3000'],
        ['::1', 'http://127.0.0.1:3000'],
    ])
        await assert.rejects(
            independentNetworkReadback({
                assembly: { configService: { apiOptions: { hostname, port: 3000 } } },
                adminOrigin,
                storefrontOrigin: 'https://owned.example',
                fetchImpl: async () => {
                    sent = true;
                },
            }),
            /loopback API/,
        );
    assert.equal(sent, false);
});

function networkFixture({ publicStock = 100, domainExists = true, hostname = '127.0.0.1' } = {}) {
    const f = fixture();
    const requested = [];
    const ctx = { channel: { token: 'owned-channel-routing-value', code: 'owned-store' } };
    const assembly = {
        sessionToken: 'opaque-existing-native-session',
        core: { ProductVariant: 'Variant' },
        configService: {
            apiOptions: { hostname, port: 3000, adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
        },
        dataSource: {
            getMetadata: () => ({ target: 'Domain' }),
            getRepository: target =>
                target === 'Domain'
                    ? {
                          findOne: async ({ where }) => {
                              assert.deepEqual(where, {
                                  channelId: '5',
                                  domain: 'owned.example',
                                  isPrimary: true,
                                  status: 'ACTIVE',
                              });
                              return domainExists ? { verifiedAt: new Date() } : null;
                          },
                      }
                    : { findOneByOrFail: async () => ({ sku: 'owned-variant', productId: '5907' }) },
        },
    };
    const fetchImpl = async (url, options = {}) => {
        requested.push({
            path: url.pathname,
            hostname: url.hostname,
            authorizationSent: Boolean(options.headers?.authorization),
        });
        let body;
        if (url.pathname === '/admin-api') {
            const request = JSON.parse(options.body);
            assert.ok(request.query.startsWith('query '), 'No native mutation is permitted in finish');
            assert.ok(!/recipientEmail|packages|note|customerEmail|payload|reveal/u.test(request.query));
            body = {
                data: {
                    order: { id: '37', state: 'Modifying', payments: [{ id: '10', state: 'Settled' }] },
                    productVariant: {
                        id: '1093',
                        stockLevels: [
                            { id: 'level', stockLocationId: '10', stockOnHand: 100, stockAllocated: 0 },
                        ],
                    },
                    manualDigitalDelivery: {
                        id: '1',
                        state: 'CANCELLED',
                        eligibleQuantity: 0,
                        hasContent: true,
                    },
                    storeCouponLedger: {
                        items: [
                            { id: 'corrected', customerCouponId: '8' },
                            { id: 'expired', customerCouponId: '8' },
                        ],
                    },
                },
            };
        } else if (url.pathname === '/storefront/page-data') {
            body = {
                scope: { host: 'owned.example', channelCode: 'owned-store' },
                config: { accessMode: 'PREVIEW' },
                failures: [],
                catalog: { items: [{ variants: [{ id: '1093', saleableStockLevel: publicStock }] }] },
            };
        } else if (url.pathname === '/shop-api') {
            body = { data: { product: { id: '5907', variants: [{ id: '1093', saleableStockLevel: 100 }] } } };
        } else throw new Error('Unexpected network path');
        return { ok: true, json: async () => body };
    };
    return {
        input: {
            assembly,
            ctx,
            receipt: f.receipt,
            fresh: f.fresh,
            storefrontOrigin: 'https://owned.example',
            fetchImpl,
        },
        requested,
    };
}

test('finish reads exact native GraphQL metadata and compares the public cached stock with native Shop', async () => {
    for (const hostname of ['127.0.0.1', '::1']) {
        const f = networkFixture({ hostname });
        const result = await independentNetworkReadback(f.input);
        assert.equal(result.status, 'VERIFIED');
        assert.deepEqual(f.requested, [
            {
                path: '/admin-api',
                hostname: hostname === '::1' ? '[::1]' : hostname,
                authorizationSent: true,
            },
            { path: '/storefront/page-data', hostname: 'owned.example', authorizationSent: false },
            { path: '/shop-api', hostname: 'owned.example', authorizationSent: false },
        ]);
        assert.ok(!JSON.stringify(result).includes(f.input.assembly.sessionToken));
    }
});

test('a HTTP200 cached stock mismatch does not complete native finish', async () => {
    const f = networkFixture({ publicStock: 99 });
    await assert.rejects(independentNetworkReadback(f.input), /cache stock differs/);
});

test('an unverified or wrong primary storefront cannot receive any authenticated readback', async () => {
    const f = networkFixture({ domainExists: false });
    await assert.rejects(independentNetworkReadback(f.input), /verified primary domain/);
    assert.deepEqual(f.requested, []);
});
