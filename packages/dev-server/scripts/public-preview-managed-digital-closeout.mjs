import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { compensationFingerprint } from './public-preview-legacy-compensation.mjs';
import { createNoLifecycleLegacyDigitalCompensationHost } from './public-preview-legacy-digital-compensation-host.mjs';
import {
    LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION,
    LEGACY_DIGITAL_COMPENSATION_VERSION,
} from './public-preview-legacy-digital-compensation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const receiptKey = `${LEGACY_DIGITAL_COMPENSATION_VERSION}:37`;
const finishKey = `${receiptKey}:native-cache-readback-v1`;
const id = value => String(value);
const assertDigest = value => assert.match(value, /^[a-f0-9]{64}$/u, 'Pinned digest required');
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);

async function pinnedJson(file, digest) {
    assertDigest(digest);
    const bytes = await readFile(file);
    assert.equal(hash(bytes), digest, 'Pinned input changed');
    return JSON.parse(bytes);
}

/** No user-id flag grants authority: an unexpired native authenticated session is mandatory. */
export async function authenticatedContext({
    dataSource,
    core,
    configService,
    sessionToken,
    now = new Date(),
}) {
    assert.ok(typeof sessionToken === 'string' && sessionToken.length >= 16, 'Native session required');
    const session = await dataSource.getRepository(core.AuthenticatedSession).findOne({
        where: { token: sessionToken, invalidated: false },
        relations: { user: { roles: { channels: true } } },
    });
    assert.ok(
        session && new Date(session.expires) > now && session.authenticationStrategy,
        'Native session rejected',
    );
    const user = session.user;
    assert.ok(user && !user.deletedAt && user.verified, 'Native authenticated user rejected');
    const administrator = await dataSource.getRepository(core.Administrator).findOne({
        where: { user: { id: user.id } },
    });
    assert.ok(administrator && !administrator.deletedAt, 'Native administrator required');
    const channel = await dataSource.getRepository(core.Channel).findOneByOrFail({ id: '5' });
    const unavailable = new Proxy(
        {},
        {
            get() {
                throw new Error('Unreviewed context provider path');
            },
        },
    );
    const contexts = new core.RequestContextService(unavailable, configService);
    const ctx = await contexts.create({ apiType: 'admin', channelOrToken: channel, user });
    assert.equal(id(ctx.channelId), '5', 'Native Channel mismatch');
    assert.ok(ctx.userHasPermissions([core.Permission.SuperAdmin]), 'Native Channel SuperAdmin required');
    return ctx;
}

/** Pin reviewed configuration callbacks before preBootstrapConfig invokes any of them. */
export function verifyAssemblyCallbacks(config, pluginMetadata, review, releaseSha) {
    assert.equal(review?.version, 'native-no-lifecycle-assembly-review-v1', 'Assembly review required');
    assert.equal(review.releaseSha, releaseSha, 'Assembly review release mismatch');
    assert.ok(
        typeof review.reviewerId === 'string' && review.reviewerId.trim(),
        'Assembly reviewer required',
    );
    const callbacks = (config.plugins ?? []).map(plugin => {
        const callback = pluginMetadata.getConfigurationFunction(plugin);
        return {
            plugin: (plugin.module ?? plugin).name,
            sha256: typeof callback === 'function' ? hash(callback.toString()) : null,
        };
    });
    same(callbacks, review.configurationCallbacks, 'Unreviewed configuration callback');
    same(
        (config.entityOptions?.metadataModifiers ?? []).map(callback => hash(callback.toString())),
        review.initialMetadataModifiers,
        'Unreviewed entity metadata modifier',
    );
}

export async function guardedPreBootstrapConfig(config, pluginMetadata, review, preBootstrapConfig) {
    const restores = [];
    const check = current => {
        const hashes = (current.entityOptions?.metadataModifiers ?? []).map(callback =>
            hash(callback.toString()),
        );
        assert.ok(
            hashes.every(digest => review.metadataModifiers.includes(digest)),
            'Unreviewed metadata modifier added by configuration',
        );
    };
    for (const plugin of config.plugins ?? []) {
        const callback = pluginMetadata.getConfigurationFunction(plugin);
        if (typeof callback !== 'function') continue;
        const target = plugin.module ?? plugin;
        const key = pluginMetadata.PLUGIN_METADATA.CONFIGURATION;
        Reflect.defineMetadata(
            key,
            async current => {
                const result = await callback(current);
                check(result ?? current);
                return result;
            },
            target,
        );
        restores.push(() => Reflect.defineMetadata(key, callback, target));
    }
    try {
        check(config);
        return await preBootstrapConfig(config);
    } finally {
        for (const restore of restores) restore();
    }
}

function scopedRequire(releaseRoot) {
    const require = createRequire(path.join(releaseRoot, 'packages/dev-server/package.json'));
    return specifier => {
        const resolved = realpathSync(require.resolve(specifier));
        const relative = path.relative(releaseRoot, resolved);
        assert.ok(
            relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
            'Runtime dependency escapes release',
        );
        return require(specifier);
    };
}

export function nativeDatabaseConfigurationFingerprint(options) {
    return compensationFingerprint({
        DB_CONNECTION_TYPE: options.type,
        DB_HOST: options.host,
        DB_PORT: String(options.port || 3306),
        DB_NAME: String(options.database),
        DB_USERNAME: String(options.username),
    });
}

export function nativeCacheConfigurationFingerprint(strategy) {
    assert.equal(strategy.constructor.name, 'RedisCacheStrategy', 'Shared native cache strategy required');
    const options = strategy.options;
    assert.ok(options?.redisOptions && options.namespace, 'Reviewed Redis configuration required');
    return compensationFingerprint({
        namespace: options.namespace,
        host: options.redisOptions.host,
        port: Number(options.redisOptions.port || 6379),
        db: Number(options.redisOptions.db || 0),
        username: options.redisOptions.username ?? null,
        tls: Boolean(options.redisOptions.tls),
    });
}

export function assertManagedRuntimeBinding(configService, proof) {
    assert.equal(proof.status, 'VERIFIED', 'Installed runtime proof required');
    assert.ok(configService, 'Native managed configuration required');
    assert.equal(
        nativeDatabaseConfigurationFingerprint(configService.dbConnectionOptions),
        proof.configurationFingerprint,
        'Managed database differs from actual API configuration',
    );
    assert.equal(
        nativeCacheConfigurationFingerprint(configService.systemOptions.cacheStrategy),
        proof.cacheConfigurationFingerprint,
        'Managed cache differs from actual API configuration',
    );
    assert.equal(
        configService.apiOptions.port,
        proof.apiPort,
        'Managed API port differs from actual API process',
    );
    assert.ok(['127.0.0.1', '::1'].includes(proof.apiHostname), 'Actual concrete API loopback required');
    assert.equal(
        configService.apiOptions.hostname,
        proof.apiHostname,
        'Managed API hostname differs from actual API process',
    );
}

export const REQUIRED_ASSEMBLY_IMPORT_FILES = Object.freeze([
    'packages/dev-server/scripts/public-preview-managed-digital-closeout.mjs',
    'packages/dev-server/scripts/public-preview-legacy-compensation.mjs',
    'packages/dev-server/scripts/public-preview-legacy-compensation-host.mjs',
    'packages/dev-server/scripts/public-preview-legacy-digital-compensation.mjs',
    'packages/dev-server/scripts/public-preview-legacy-digital-compensation-host.mjs',
    'packages/dev-server/dist/dev-config.js',
    'packages/core/dist/index.js',
    'packages/core/dist/bootstrap.js',
    'packages/core/dist/plugin/plugin-metadata.js',
    'packages/core/dist/connection/transaction-wrapper.js',
    'packages/storefront-cart-plugin/dist/index.js',
    'packages/store-management-plugin/dist/index.js',
    'packages/store-management-plugin/dist/promotion/store-coupon-lifecycle.service.js',
    'packages/commerce-fulfillment-plugin/dist/index.js',
    'packages/operations-dashboard-plugin/dist/index.js',
]);

/** This is configuration/entity assembly only; neither Nest nor any provider lifecycle starts. */
export async function assembleProductionHost(options) {
    const {
        releaseRoot,
        expectedReleaseSha,
        sessionToken,
        verifyProductionRuntimeProtections,
        verifyReviewedArtifact,
    } = options;
    const proof = await verifyProductionRuntimeProtections();
    assert.equal(proof.status, 'VERIFIED', 'Installed runtime proof required');
    assert.equal(proof.runtimeSha, expectedReleaseSha, 'Installed runtime release changed');
    assert.ok(
        Number.isSafeInteger(proof.filesVerified) && proof.filesVerified > 0,
        'Installed complete payload verification required',
    );
    assertDigest(proof.artifactChecksumsFingerprint);
    const review = await pinnedJson(options.assemblyReviewPath, options.assemblyReviewSha256);
    const root = await realpath(releaseRoot);
    assert.equal(
        await realpath(fileURLToPath(import.meta.url)),
        path.join(root, 'packages/dev-server/scripts/public-preview-managed-digital-closeout.mjs'),
        'Managed host must execute from the attested installed release',
    );
    assert.ok(
        Array.isArray(review.importFiles) && review.importFiles.length > 0,
        'Reviewed native import files required',
    );
    for (const required of REQUIRED_ASSEMBLY_IMPORT_FILES)
        assert.ok(
            review.importFiles.some(file => file.path === required),
            'Assembly review omits direct native import',
        );
    for (const file of review.importFiles) {
        const absolute = path.resolve(root, file.path);
        const relative = path.relative(root, await realpath(absolute));
        assert.ok(
            relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
            'Assembly import path escapes release',
        );
        assert.equal(hash(await readFile(absolute)), file.sha256, 'Reviewed native import changed');
    }
    const load = scopedRequire(root);
    // The reviewed release config is imported, never its index.js or index-worker.js entry point.
    const { devConfig } = load(path.join(root, 'packages/dev-server/dist/dev-config.js'));
    const core = load('@vendure/core');
    const coreRoot = path.join(root, 'packages/core/dist');
    const pluginMetadata = load(path.join(coreRoot, 'plugin/plugin-metadata.js'));
    verifyAssemblyCallbacks(devConfig, pluginMetadata, review, expectedReleaseSha);
    const { preBootstrapConfig } = load(path.join(coreRoot, 'bootstrap.js'));
    const config = await guardedPreBootstrapConfig(devConfig, pluginMetadata, review, preBootstrapConfig);
    same(
        (config.entityOptions?.metadataModifiers ?? []).map(callback => hash(callback.toString())),
        review.metadataModifiers,
        'Configuration added unreviewed metadata modifier',
    );
    assert.equal(config.dbConnectionOptions.synchronize, false, 'Production synchronization forbidden');
    assert.ok(
        !config.dbConnectionOptions.dropSchema && !config.dbConnectionOptions.migrationsRun,
        'Schema lifecycle forbidden',
    );
    assert.ok(['mysql', 'mariadb'].includes(config.dbConnectionOptions.type), 'Native MySQL required');
    const configService = new core.ConfigService();
    assertManagedRuntimeBinding(configService, proof);
    const verifyBoundRuntime = async () => {
        const currentProof = await verifyProductionRuntimeProtections();
        assertManagedRuntimeBinding(configService, currentProof);
        return currentProof;
    };
    const { DataSource } = load('typeorm');
    const dataSource = new DataSource({
        ...config.dbConnectionOptions,
        synchronize: false,
        dropSchema: false,
        migrationsRun: false,
        logging: false,
    });
    let host;
    try {
        await dataSource.initialize();
        const runtime = {
            core,
            TransactionWrapper: load(path.join(coreRoot, 'connection/transaction-wrapper.js'))
                .TransactionWrapper,
            TransactionSubscriber: core.TransactionSubscriber,
            BaseStockLocationStrategy: core.BaseStockLocationStrategy,
            StorefrontCartService: load('@vendure/storefront-cart-plugin').StorefrontCartService,
            StoreCouponLifecycleService: load(
                path.join(
                    root,
                    'packages/store-management-plugin/dist/promotion/store-coupon-lifecycle.service.js',
                ),
            ).StoreCouponLifecycleService,
            DigitalProductService: load('@vendure/commerce-fulfillment-plugin').DigitalProductService,
            ManualDigitalDeliveryService: load('@vendure/commerce-fulfillment-plugin')
                .ManualDigitalDeliveryService,
            IncidentResponseService: load('@vendure/operations-dashboard-plugin').IncidentResponseService,
        };
        const entities = Object.fromEntries(
            dataSource.entityMetadatas.map(metadata => [metadata.name, metadata.target]),
        );
        host = createNoLifecycleLegacyDigitalCompensationHost({
            dataSource,
            configService,
            runtime,
            entities,
            isolatedTest: false,
            verifyProductionRuntimeProtections: verifyBoundRuntime,
            verifyReviewedArtifact,
        });
        const context = () => authenticatedContext({ dataSource, core, configService, sessionToken });
        return {
            host,
            dataSource,
            core,
            configService,
            context,
            sessionToken,
            async close() {
                host.close();
                await dataSource.destroy();
            },
        };
    } catch (error) {
        host?.close();
        if (dataSource.isInitialized) await dataSource.destroy();
        throw error;
    }
}

function replayEvidence(snapshot) {
    const { stockLevels: _levels, ...owned } = snapshot;
    return owned;
}

/** Verify committed history against a separately captured current native state. No decrypt/reveal. */
export function verifyCommittedCloseout(receipt, fresh) {
    assert.equal(receipt?.key, receiptKey, 'Named committed receipt required');
    assert.equal(
        receipt.authorization,
        LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION,
        'Receipt authorization changed',
    );
    assert.equal(receipt.orderId, '37', 'Receipt order changed');
    assert.equal(receipt.salesChannelId, '5', 'Receipt Channel changed');
    assert.equal(receipt.changedQuantity, 1, 'Receipt release count changed');
    assert.equal(receipt.correctedCoupons, 1, 'Receipt correction count changed');
    assert.equal(
        receipt.beforeFingerprint,
        compensationFingerprint(receipt.before),
        'Receipt before hash changed',
    );
    assert.equal(fresh.fingerprint, compensationFingerprint(fresh.snapshot), 'Native capture hash changed');
    assert.equal(
        receipt.afterEvidenceFingerprint,
        compensationFingerprint(replayEvidence(fresh.snapshot)),
        'Post-commit native evidence changed; review required',
    );
    const before = receipt.before;
    const after = fresh.snapshot;
    for (const key of ['order', 'payments', 'lines', 'fulfillments', 'locations'])
        same(after[key], before[key], `Preserved ${key} changed`);
    same(Object.keys(after.risks).sort(), Object.keys(before.risks).sort(), 'Native risk table set changed');
    for (const [table, evidence] of Object.entries(before.risks)) {
        if (table !== 'manual_digital_delivery')
            same(after.risks[table], evidence, `Preserved risk ${table} changed`);
    }
    same(
        after.risks.manual_digital_delivery,
        [{ id: after.digital.task.id, fingerprint: after.digital.task.fingerprint }],
        'Closed manual task risk fingerprint differs from exact native task',
    );
    assert.equal(after.digital.task.state, 'CANCELLED', 'Native task remains open');
    assert.equal(
        after.digital.task.contentFingerprint,
        before.digital.task.contentFingerprint,
        'Original encrypted content changed',
    );
    assert.equal(
        after.digital.task.immutableFingerprint,
        before.digital.task.immutableFingerprint,
        'Original task evidence changed',
    );
    assert.ok(
        after.digital.events.some(event => event.closingReceipt),
        'Native task closing event missing',
    );
    assert.ok(
        !after.digital.events.some(event => event.lateEvidence),
        'Late delivery evidence requires review',
    );
    assert.deepEqual(after.digital.receiptAccess, [], 'Receipt access appeared');
    assert.deepEqual(after.digital.fulfillmentLines, [], 'Fulfillment appeared');
    same(
        after.digital.incidents.map(row => row.id).sort(),
        [...receipt.closedIncidentIds].sort(),
        'Closed incident set changed',
    );
    assert.ok(
        after.digital.incidents.every(
            row => row.incidentStatus === 'CLOSED' && !row.claimedAt && !row.claimedBy,
        ),
        'Incident remains open or claimed',
    );
    same(
        after.movements.filter(row => !receipt.releaseIds.includes(row.id)),
        before.movements,
        'Original stock movements changed',
    );
    const releases = after.movements.filter(row => receipt.releaseIds.includes(row.id));
    assert.equal(releases.length, 1, 'One durable stock release required');
    const release = releases[0];
    same(
        [
            release.orderLineId,
            release.productVariantId,
            release.stockLocationId,
            release.quantity,
            release.type,
        ],
        ['248', '1093', '10', 1, 'RELEASE'],
        'Native release identity changed',
    );
    assert.equal(after.stockLevels.length, 1, 'Native stock level set changed');
    assert.equal(
        after.stockLevels[0].stockOnHand,
        before.stockLevels[0].stockOnHand,
        'Real on-hand stock changed',
    );
    assert.equal(
        after.stockLevels[0].stockAllocated,
        before.stockLevels[0].stockAllocated - 1,
        'Allocated stock changed after compensation; review required',
    );
    assert.equal(after.coupons[0].id, '8', 'Coupon scope changed');
    assert.equal(after.coupons[0].status, 'EXPIRED', 'Coupon remains usable');
    assert.equal(after.coupons[0].version, before.coupons[0].version + 1, 'Coupon CAS version changed');
    for (const field of ['usedAt', 'usedOrderId'])
        same(after.coupons[0][field], before.coupons[0][field], 'Original coupon usage changed');
    for (const row of before.ledger)
        same(
            after.ledger.find(item => item.id === row.id),
            row,
            'Original coupon ledger changed',
        );
    const corrective = after.ledger.filter(row => receipt.ledgerIds.includes(row.id));
    same(
        corrective.map(row => row.eventType).sort(),
        ['CORRECTED', 'EXPIRED'],
        'Corrective coupon ledger missing',
    );
    return { receiptFingerprint: compensationFingerprint(receipt), afterFingerprint: fresh.fingerprint };
}

async function nativeReceipt(assembly, ctx) {
    const rows = await assembly.host.connection
        .getRepository(ctx, assembly.dataSource.getMetadata('OrderHistoryEntry').target)
        .find({ where: { order: { id: '37' } } });
    const found = rows.filter(row => row.data?.digitalCompensation?.key === receiptKey);
    assert.equal(found.length, 1, 'One persisted native compensation receipt required');
    return { receipt: found[0].data.digitalCompensation, historyEntryId: id(found[0].id), rows };
}

/** Update only the existing, reviewed shared Channel generation; never FLUSHDB or restart. */
export async function refreshSharedChannelCache({ configService, loadRedis, now = () => new Date() }) {
    const strategy = configService.systemOptions.cacheStrategy;
    assert.equal(strategy.constructor.name, 'RedisCacheStrategy', 'Shared native cache strategy required');
    assert.ok(typeof strategy.rotateVersion === 'function', 'Shared generation contract required');
    // This native TS private field is configuration, not a lifecycle call. Credentials never leave memory.
    const options = strategy.options;
    assert.ok(
        options?.redisOptions && typeof options.namespace === 'string' && options.namespace,
        'Reviewed Redis namespace required',
    );
    const Redis = await loadRedis();
    const redis = new Redis({
        ...options.redisOptions,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: null,
    });
    redis.on('error', () => undefined);
    try {
        await redis.connect();
        const key = `${options.namespace}:storefront-public:v1:revision:5`;
        const previous = await redis.get(key);
        const revision = randomUUID();
        assert.equal(
            await redis.set(key, revision, 'EX', 86_400),
            'OK',
            'Native cache generation update failed',
        );
        assert.equal(await redis.get(key), revision, 'Native cache generation readback failed');
        return {
            channelId: '5',
            previousRevisionFingerprint: previous == null ? null : hash(previous),
            revisionFingerprint: hash(revision),
            updatedAt: now().toISOString(),
        };
    } finally {
        redis.disconnect();
    }
}

function verifiedUrl(value, label) {
    const url = new URL(value);
    assert.ok(!url.username && !url.password && !url.search && !url.hash, `${label} origin required`);
    assert.ok(
        url.protocol === 'https:' ||
            (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
        `${label} secure or loopback origin required`,
    );
    return url;
}

/** Read existing native resolvers and the same public cached assembly, requesting no secret fields. */
export async function independentNetworkReadback({
    assembly,
    ctx,
    receipt,
    fresh,
    adminOrigin,
    storefrontOrigin,
    fetchImpl = fetch,
}) {
    const { port, hostname } = assembly.configService.apiOptions;
    assert.ok(['127.0.0.1', '::1'].includes(hostname), 'Actual concrete API loopback required');
    const urlHostname = hostname === '::1' ? '[::1]' : hostname;
    const admin = verifiedUrl(adminOrigin ?? `http://${urlHostname}:${port}`, 'Admin');
    assert.ok(
        admin.hostname === urlHostname &&
            Number(admin.port || (admin.protocol === 'https:' ? 443 : 80)) === port,
        'Authenticated readback must use actual loopback API',
    );
    const storefront = verifiedUrl(storefrontOrigin, 'Storefront');
    const domain = await assembly.dataSource
        .getRepository(assembly.dataSource.getMetadata('StoreDomain').target)
        .findOne({
            where: { channelId: '5', domain: storefront.hostname, isPrimary: true, status: 'ACTIVE' },
        });
    assert.ok(domain?.verifiedAt, 'Public readback requires the native verified primary domain');
    const query = async (document, variables) => {
        const adminResponse = await fetchImpl(
            new URL(`/${assembly.configService.apiOptions.adminApiPath}`, admin),
            {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(15_000),
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${assembly.sessionToken}`,
                    'vendure-token': ctx.channel.token,
                },
                body: JSON.stringify({ query: document, variables }),
            },
        );
        assert.ok(adminResponse.ok, 'Native Admin readback failed');
        const adminResult = await adminResponse.json();
        assert.ok(!adminResult.errors?.length && adminResult.data, 'Native Admin readback rejected');
        return adminResult.data;
    };
    const result = await query(
        `query HistoricalTestCloseoutReadback($deliveryId: ID!) {
        order(id: "37") { id state payments { id state } manualDigitalDeliveries { id state } storeCouponAllocations { id customerCouponId status } }
        productVariant(id: "1093") { id stockLevels { id stockLocationId stockOnHand stockAllocated } }
        manualDigitalDelivery(id: $deliveryId) { id state attemptCount hasContent eligibleQuantity sentAt fulfillmentId }
        storeCouponLedger(options: {orderId: "37", take: 200}) { items { id customerCouponId eventType } }
    }`,
        { deliveryId: receipt.deliveryId },
    );
    assert.equal(result.order?.id, '37', 'Native network order scope changed');
    assert.equal(result.order.state, fresh.snapshot.order.state, 'Native network order state differs');
    same(
        result.order.payments.map(row => [row.id, row.state]).sort(),
        fresh.snapshot.payments.map(row => [row.id, row.state]).sort(),
        'Native network payments differ',
    );
    const level = result.productVariant?.stockLevels.find(row => row.stockLocationId === '10');
    assert.ok(level, 'Native network original warehouse missing');
    same(
        [level.stockOnHand, level.stockAllocated],
        [fresh.snapshot.stockLevels[0].stockOnHand, fresh.snapshot.stockLevels[0].stockAllocated],
        'Native network stock differs',
    );
    assert.equal(result.manualDigitalDelivery?.state, 'CANCELLED', 'Native network task remains open');
    assert.equal(result.manualDigitalDelivery.eligibleQuantity, 0, 'Test task acquired delivery entitlement');
    assert.equal(
        result.manualDigitalDelivery.hasContent,
        fresh.snapshot.digital.task.hasEncryptedPackages,
        'Native network encrypted content presence differs',
    );
    for (const ledgerId of receipt.ledgerIds)
        assert.ok(
            result.storeCouponLedger.items.some(row => row.id === ledgerId && row.customerCouponId === '8'),
            'Native network corrective ledger missing',
        );
    for (const incidentId of receipt.closedIncidentIds) {
        const data = await query(
            'query HistoricalTestIncidentReadback($id: ID!) { adminIncident(id: $id) { id incidentStatus eventState closedAt } }',
            { id: incidentId },
        );
        assert.equal(data.adminIncident.id, incidentId, 'Native network incident scope changed');
        assert.equal(data.adminIncident.incidentStatus, 'CLOSED', 'Native network incident remains open');
    }
    const variant = await assembly.dataSource
        .getRepository(assembly.core.ProductVariant)
        .findOneByOrFail({ id: '1093' });
    const publicUrl = new URL('/storefront/page-data', storefront);
    publicUrl.searchParams.set('kind', 'catalog');
    publicUrl.searchParams.set('input', JSON.stringify({ term: variant.sku, take: 48 }));
    const response = await fetchImpl(publicUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { 'cache-control': 'no-cache' },
    });
    assert.ok(response.ok, 'Public cached readback unavailable');
    const page = await response.json();
    assert.equal(page.scope?.channelCode, ctx.channel.code, 'Public cache Channel mismatch');
    assert.equal(page.scope?.host, storefront.hostname, 'Public cache host mismatch');
    assert.ok(['PREVIEW', 'LIVE'].includes(page.config?.accessMode), 'Public access mode unavailable');
    assert.ok(!page.failures?.length, 'Public cache assembly incomplete');
    const publicVariant = page.catalog?.items
        ?.flatMap(product => product.variants ?? [])
        .find(row => row.id === '1093');
    assert.ok(publicVariant, 'Reviewed variant absent from public cache');
    // Compare the cached DTO with the running native Shop resolver, not a locally guessed stock policy.
    const shopResponse = await fetchImpl(
        new URL(`/${assembly.configService.apiOptions.shopApiPath}`, storefront),
        {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(15_000),
            headers: { 'content-type': 'application/json', 'vendure-token': ctx.channel.token },
            body: JSON.stringify({
                query: 'query HistoricalTestPublicStockReadback($id: ID!) { product(id: $id) { id variants { id saleableStockLevel } } }',
                variables: { id: id(variant.productId) },
            }),
        },
    );
    assert.ok(shopResponse.ok, 'Native Shop stock readback unavailable');
    const shop = await shopResponse.json();
    assert.ok(!shop.errors?.length, 'Native Shop stock readback rejected');
    const nativeVariant = shop.data?.product?.variants.find(row => row.id === '1093');
    assert.ok(nativeVariant, 'Native Shop reviewed variant missing');
    assert.equal(
        publicVariant.saleableStockLevel,
        nativeVariant.saleableStockLevel,
        'Public cache stock differs from native Shop stock',
    );
    return {
        status: 'VERIFIED',
        adminReadbackFingerprint: compensationFingerprint(result),
        publicReadbackFingerprint: compensationFingerprint(page),
        checkedAt: new Date().toISOString(),
    };
}

/** Orchestration stays injectable for isolated tests; production CLI supplies only reviewed native deps. */
export async function runManagedCloseout({
    mode = 'inspect',
    assembly,
    manifest,
    reviewArtifact,
    verifyRuntime,
    verifyReview,
    refreshCache,
    readNetwork,
    now = () => new Date(),
    onPhase = async () => undefined,
}) {
    assert.ok(['inspect', 'preview', 'apply', 'finish'].includes(mode), 'Unknown managed mode');
    const ctx = await assembly.context();
    const proof = await verifyRuntime();
    assertManagedRuntimeBinding(assembly.configService, proof);
    if (mode === 'inspect') {
        const entry = await assembly.host.capture(ctx);
        return {
            mode,
            status: 'INSPECTED_NOT_REVIEWED',
            productionCompleted: false,
            manifest: {
                version: LEGACY_DIGITAL_COMPENSATION_VERSION,
                authorization: LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION,
                capturedAt: now().toISOString(),
                sourceSnapshotSha256: compensationFingerprint(entry),
                entry,
            },
        };
    }
    if (mode === 'preview' || mode === 'apply') {
        assert.equal(typeof verifyReview, 'function', 'Pinned independent review verifier required');
        assert.equal(
            await verifyReview(reviewArtifact, manifest?.entry),
            true,
            'Pinned independent review rejected',
        );
        if (mode === 'apply')
            await onPhase({
                status: 'APPLY_ATTEMPTED',
                orderId: '37',
                beforeFingerprint: manifest.entry.fingerprint,
                productionCompleted: false,
            });
        // The underlying production executor verifies actual runtime and independent review again before mutation.
        const result = await assembly.host.execute(ctx, {
            manifest,
            reviewArtifact,
            apply: mode === 'apply',
        });
        if (mode === 'apply')
            await onPhase({
                status: 'COMMITTED_READBACK_REQUIRED',
                orderId: '37',
                historyEntryId: result.historyEntryId,
                beforeFingerprint: result.beforeFingerprint,
                productionCompleted: false,
            });
        return { mode, ...result, productionCompleted: false };
    }
    const { receipt, historyEntryId } = await nativeReceipt(assembly, ctx);
    const fresh = await assembly.host.capture(ctx);
    const verified = verifyCommittedCloseout(receipt, fresh);
    let cache;
    let network;
    try {
        assert.equal(typeof refreshCache, 'function', 'Managed cache updater required');
        assert.equal(typeof readNetwork, 'function', 'Independent network reader required');
        cache = await refreshCache();
        network = await readNetwork({ ctx, receipt, fresh });
        assert.equal(network.status, 'VERIFIED', 'Independent network readback rejected');
    } catch {
        return {
            mode,
            status: 'NATIVE_CACHE_REFRESH_AND_READBACK_REQUIRED',
            productionCompleted: false,
            orderId: '37',
            historyEntryId,
            nativeReadbackFingerprint: verified.afterFingerprint,
            cacheUpdated: Boolean(cache),
            readbackFailed: true,
        };
    }
    // Serialize only completion evidence. This path never calls execute/apply or resource services.
    const currentProof = await verifyRuntime();
    assertManagedRuntimeBinding(assembly.configService, currentProof);
    assert.equal(currentProof.runtimeSha, proof.runtimeSha, 'Runtime changed during completion');
    return assembly.host.providers.orders.withOrderMutationTransaction(ctx, async txCtx => {
        await assembly.host.providers.carts.lockForOrder(txCtx, '37');
        await assembly.host.providers.orders.lockOrderForRefund(txCtx, '37');
        const current = await nativeReceipt(assembly, txCtx);
        assert.equal(
            compensationFingerprint(current.receipt),
            verified.receiptFingerprint,
            'Persisted receipt changed during finish',
        );
        const currentState = await assembly.host.capture(txCtx);
        verifyCommittedCloseout(current.receipt, currentState);
        assert.equal(
            currentState.fingerprint,
            fresh.fingerprint,
            'Native state changed during cache readback',
        );
        const prior = current.rows.filter(row => row.data?.digitalCompensationFinish?.key === finishKey);
        assert.ok(prior.length <= 1, 'Duplicate completion receipts require review');
        if (prior.length) {
            assert.equal(
                prior[0].data.digitalCompensationFinish.receiptFingerprint,
                verified.receiptFingerprint,
                'Previous completion belongs to another receipt',
            );
            return {
                mode,
                status: 'COMPLETE_READ_BACK',
                productionCompleted: true,
                orderId: '37',
                completionHistoryEntryId: id(prior[0].id),
                nativeReadbackFingerprint: currentState.fingerprint,
                alreadyRecorded: true,
            };
        }
        const completion = {
            key: finishKey,
            orderId: '37',
            channelId: '5',
            originalHistoryEntryId: historyEntryId,
            ...verified,
            runtimeSha: proof.runtimeSha,
            protectionsFingerprint: proof.protectionsFingerprint,
            cache,
            network,
            completedAt: now().toISOString(),
            productionCompleted: true,
        };
        const record = await assembly.host.providers.history.createHistoryEntryForOrder(
            {
                ctx: txCtx,
                orderId: '37',
                type: 'ORDER_NOTE',
                data: { note: '历史测试补偿原生及缓存独立回读完成', digitalCompensationFinish: completion },
            },
            false,
        );
        return {
            mode,
            status: 'COMPLETE_READ_BACK',
            productionCompleted: true,
            orderId: '37',
            completionHistoryEntryId: id(record.id),
            nativeReadbackFingerprint: currentState.fingerprint,
        };
    });
}

async function main() {
    const { values } = parseArgs({
        options: Object.fromEntries(
            [
                'mode',
                'release-root',
                'release-sha',
                'protection-manifest',
                'protection-manifest-sha256',
                'artifact-checksum-sha256',
                'assembly-review',
                'assembly-review-sha256',
                'review',
                'review-sha256',
                'reviewer-id',
                'manifest',
                'manifest-sha256',
                'session-token-fd',
                'admin-origin',
                'storefront-origin',
                'output',
                'evidence-root',
            ].map(name => [name, { type: 'string' }]),
        ),
        strict: true,
    });
    const mode = values.mode ?? 'inspect';
    assert.ok(['inspect', 'preview', 'apply', 'finish'].includes(mode), 'Unknown managed mode');
    assert.ok(values.output && path.isAbsolute(values.output), 'Explicit absolute owned output required');
    assert.ok(
        values['evidence-root'] && path.isAbsolute(values['evidence-root']),
        'Explicit owned evidence root required',
    );
    const evidenceRoot = await realpath(values['evidence-root']);
    const parent = await realpath(path.dirname(values.output));
    assert.ok(
        parent === evidenceRoot || parent.startsWith(evidenceRoot + path.sep),
        'Output parent is outside owned evidence root',
    );
    assert.equal(parent, path.resolve(path.dirname(values.output)), 'Output parent symlink is forbidden');
    // Reserve the unique durable evidence path before configuration imports, connections or writes.
    const output = await open(values.output, 'wx', 0o600);
    let assembly;
    let phase = { mode, status: 'STARTED', productionCompleted: false };
    const persist = async value => {
        phase = { mode, ...value };
        await output.truncate(0);
        await output.write(`${JSON.stringify(phase, null, 2)}\n`, 0, 'utf8');
        await output.sync();
    };
    try {
        await persist(phase);
        const { createProductionRuntimeVerifier, createPinnedReviewVerifier } =
            await import('./public-preview-production-verification.mjs');
        const verifyRuntime = createProductionRuntimeVerifier({
            releaseRoot: values['release-root'],
            expectedReleaseSha: values['release-sha'],
            protectionManifestPath: values['protection-manifest'],
            protectionManifestSha256: values['protection-manifest-sha256'],
            artifactChecksumSha256: values['artifact-checksum-sha256'],
        });
        const manifest = values.manifest
            ? await pinnedJson(values.manifest, values['manifest-sha256'])
            : undefined;
        const reviewEnvelope = values.review
            ? await pinnedJson(values.review, values['review-sha256'])
            : undefined;
        const reviewArtifact = reviewEnvelope?.reviewArtifact;
        const verifyReview = reviewArtifact
            ? createPinnedReviewVerifier({
                  reviewPath: values.review,
                  reviewSha256: values['review-sha256'],
                  expectedSourceSnapshotSha256: manifest?.sourceSnapshotSha256,
                  expectedReviewerId: values['reviewer-id'],
              })
            : undefined;
        const fd = Number(values['session-token-fd']);
        assert.ok(Number.isInteger(fd) && fd >= 3, 'Native session must arrive via private inherited FD');
        const sessionToken = readFileSync(fd, 'utf8').trim();
        assembly = await assembleProductionHost({
            releaseRoot: values['release-root'],
            expectedReleaseSha: values['release-sha'],
            sessionToken,
            assemblyReviewPath: values['assembly-review'],
            assemblyReviewSha256: values['assembly-review-sha256'],
            verifyProductionRuntimeProtections: verifyRuntime,
            verifyReviewedArtifact: verifyReview,
        });
        const result = await runManagedCloseout({
            mode,
            assembly,
            manifest,
            reviewArtifact,
            verifyRuntime,
            verifyReview,
            onPhase: persist,
            refreshCache: () =>
                refreshSharedChannelCache({
                    configService: assembly.configService,
                    loadRedis: async () => scopedRequire(values['release-root'])('ioredis'),
                }),
            readNetwork: input =>
                independentNetworkReadback({
                    assembly,
                    ...input,
                    adminOrigin: values['admin-origin'],
                    storefrontOrigin: values['storefront-origin'],
                }),
        });
        // Evidence only. No session, identifiers, recipient, provider config or encrypted content is serialized.
        await persist(result);
        process.stdout.write(
            `${JSON.stringify({ mode, status: result.status, productionCompleted: result.productionCompleted, output: values.output })}\n`,
        );
    } catch {
        if (mode === 'apply' && phase.status === 'APPLY_ATTEMPTED') {
            // A lost response does not authorize another apply. Consult the native durable receipt.
            try {
                const ctx = await assembly.context();
                const committed = await nativeReceipt(assembly, ctx);
                assert.equal(
                    committed.receipt.beforeFingerprint,
                    phase.beforeFingerprint,
                    'Existing receipt belongs to a different reviewed snapshot',
                );
                phase = {
                    mode,
                    status: 'COMMITTED_READBACK_REQUIRED',
                    orderId: '37',
                    historyEntryId: committed.historyEntryId,
                    beforeFingerprint: committed.receipt.beforeFingerprint,
                    productionCompleted: false,
                };
            } catch {
                phase = {
                    mode,
                    status: 'WRITE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED',
                    orderId: '37',
                    productionCompleted: false,
                };
            }
        } else if (
            !['COMMITTED_READBACK_REQUIRED', 'APPLIED', 'ALREADY_APPLIED', 'COMPLETE_READ_BACK'].includes(
                phase.status,
            )
        ) {
            phase = {
                mode,
                status:
                    mode === 'finish'
                        ? 'NATIVE_CACHE_REFRESH_AND_READBACK_REQUIRED'
                        : 'REJECTED_BEFORE_WRITE',
                productionCompleted: false,
            };
        }
        try {
            await persist(phase);
        } catch {
            /* Preserve the in-memory commit status even if storage failed. */
        }
        const safeFailure = {
            mode,
            status: phase.status,
            orderId: phase.orderId,
            historyEntryId: phase.historyEntryId,
            completionHistoryEntryId: phase.completionHistoryEntryId,
            productionCompleted: phase.productionCompleted,
            output: values.output,
            automaticWriteRetryAllowed: false,
        };
        process.stderr.write(`${JSON.stringify(safeFailure)}\n`);
        process.exitCode = 1;
    } finally {
        try {
            await assembly?.close();
        } catch {
            process.stderr.write(
                'MANAGED_SESSION_CLOSE_FAILED: preserved execution evidence remains authoritative\n',
            );
            process.exitCode = 1;
        }
        try {
            await output.close();
        } catch {
            process.stderr.write(
                'MANAGED_EVIDENCE_CLOSE_FAILED: consult the preserved phase and native durable receipt\n',
            );
            process.exitCode = 1;
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(() => {
        process.stderr.write('MANAGED_DIGITAL_CLOSEOUT_PREFLIGHT_REJECTED: no execution began\n');
        process.exitCode = 1;
    });
}
