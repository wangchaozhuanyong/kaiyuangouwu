import assert from 'node:assert/strict';

import { createNoLifecycleLegacyCompensationHost } from './public-preview-legacy-compensation-host.mjs';
import { createLegacyDigitalCompensationExecutor } from './public-preview-legacy-digital-compensation.mjs';

// Compose the frozen native resource host. No Nest bootstrap, provider lifecycle hooks,
// notification subscriber, transport, cipher operation, scheduler, or worker is started.
export function createNoLifecycleLegacyDigitalCompensationHost(options) {
    const {
        runtime,
        dataSource,
        entities,
        clock,
        isolatedTest,
        verifyProductionRuntimeProtections,
        verifyReviewedArtifact,
    } = options;
    for (const key of ['DigitalProductService', 'ManualDigitalDeliveryService', 'IncidentResponseService'])
        assert.equal(typeof runtime[key], 'function', `Exact native ${key} class required`);
    assert.equal(
        typeof runtime.ManualDigitalDeliveryService.prototype.closeHistoricalTestTask,
        'function',
        'WAIT_REPAIR_DEPLOYMENT: native manual task closeout is missing',
    );
    assert.equal(
        typeof runtime.IncidentResponseService.prototype.closeHistoricalTestTaskIncidents,
        'function',
        'WAIT_REPAIR_DEPLOYMENT: native incident closeout is missing',
    );
    const native = createNoLifecycleLegacyCompensationHost(options);
    const unavailable = new Proxy(
        {},
        {
            get() {
                throw new Error('Unreviewed digital host provider path attempted');
            },
        },
    );
    const { connection, providers } = native;
    const strategy = providers.stockLocations.configService.catalogOptions.stockLocationStrategy;
    if (strategy.constructor.name === 'PackagingStockLocationStrategy') {
        const configuredRelease = strategy.forRelease.bind(strategy);
        const allocationRelease = runtime.BaseStockLocationStrategy.prototype.forRelease;
        assert.equal(typeof allocationRelease, 'function', 'Native allocation release selector missing');
        // This no-lifecycle host is only used after the executor's historical locks, full CAS
        // and resource/funding review. A removed catalog item must not prevent undoing its
        // recorded allocation. Keep native StockMovementService and its inventory updates.
        Object.defineProperty(strategy, 'forRelease', {
            value: async (ctx, locations, line, quantity) => {
                const exactHistoricalLine =
                    String(ctx.channelId) === '5' &&
                    String(line.id) === '248' &&
                    String(line.productVariantId) === '1093' &&
                    line.quantity === 1 &&
                    quantity === 1;
                if (exactHistoricalLine) {
                    const ownedLine = await connection.getRepository(ctx, runtime.core.OrderLine).findOne({
                        where: {
                            id: '248',
                            order: { id: '37' },
                            productVariant: { id: '1093' },
                            quantity: 1,
                        },
                    });
                    assert.ok(ownedLine, 'Historical native order line ownership changed');
                    const variant = await connection
                        .getRepository(ctx, runtime.core.ProductVariant)
                        .findOneBy({ id: '1093' });
                    if (variant?.deletedAt) {
                        const selected = await allocationRelease.call(
                            strategy,
                            ctx,
                            locations,
                            line,
                            quantity,
                        );
                        assert.equal(selected.length, 1, 'Historical native allocation selector ambiguous');
                        assert.equal(
                            String(selected[0].location?.id),
                            '10',
                            'Historical original warehouse changed',
                        );
                        assert.equal(
                            selected[0].quantity,
                            1,
                            'Historical native allocation quantity changed',
                        );
                        return selected;
                    }
                }
                return configuredRelease(ctx, locations, line, quantity);
            },
        });
    }
    const allocatedUpdate = providers.stockLevels.updateStockAllocatedForLocation;
    Object.defineProperty(providers.stockLevels, 'updateStockAllocatedForLocation', {
        value: async (ctx, variantId, locationId, change) => {
            const exactRelease =
                String(ctx.channelId) === '5' &&
                String(variantId) === '1093' &&
                String(locationId) === '10' &&
                change === -1;
            if (!exactRelease)
                return allocatedUpdate.call(providers.stockLevels, ctx, variantId, locationId, change);
            const variant = await connection
                .getRepository(ctx, runtime.core.ProductVariant)
                .findOneBy({ id: '1093' });
            if (!variant?.deletedAt)
                return allocatedUpdate.call(providers.stockLevels, ctx, variantId, locationId, change);
            const ownedLine = await connection.getRepository(ctx, runtime.core.OrderLine).findOne({
                where: { id: '248', order: { id: '37' }, productVariant: { id: '1093' }, quantity: 1 },
            });
            assert.ok(ownedLine, 'Historical native allocated update ownership changed');
            assert.equal(String(variant.productId), '5907', 'Historical native product changed');
            // Per-call native clones preserve the original stock assertions and increment.
            // Only these two catalog reads can include removed rows; no shared connection,
            // strategy, sale, stock creation or on-hand update receives that permission.
            const releaseConnection = Object.create(connection);
            releaseConnection.getRepository = connection.getRepository.bind(connection);
            releaseConnection.getEntityOrThrow = (request, entity, entityId, readOptions = {}) => {
                const ownedCatalogRead =
                    request === ctx &&
                    ((entity === runtime.core.ProductVariant && String(entityId) === '1093') ||
                        (entity === runtime.core.Product && String(entityId) === '5907'));
                return connection.getEntityOrThrow(
                    request,
                    entity,
                    entityId,
                    ownedCatalogRead ? { ...readOptions, includeSoftDeleted: true } : readOptions,
                );
            };
            const releaseStrategy = Object.create(strategy);
            releaseStrategy.connection = releaseConnection;
            const releaseConfig = Object.create(providers.stockLocations.configService);
            Object.defineProperty(releaseConfig, 'catalogOptions', {
                get: () => ({
                    ...providers.stockLocations.configService.catalogOptions,
                    stockLocationStrategy: releaseStrategy,
                }),
            });
            const releaseLocations = Object.create(providers.stockLocations);
            releaseLocations.configService = releaseConfig;
            const releaseLevels = Object.create(providers.stockLevels);
            releaseLevels.connection = releaseConnection;
            releaseLevels.stockLocationService = releaseLocations;
            return allocatedUpdate.call(releaseLevels, ctx, variantId, locationId, change);
        },
    });
    const subscriber = dataSource.subscribers.find(
        candidate => candidate instanceof runtime.TransactionSubscriber,
    );
    assert.ok(subscriber, 'Existing native transaction subscriber required');
    const eventBus = new runtime.core.EventBus(subscriber);
    const digitalProducts = new runtime.DigitalProductService(
        connection,
        providers.orders,
        unavailable,
        new runtime.core.RequestContextCacheService(),
    );
    const manualDelivery = new runtime.ManualDigitalDeliveryService(
        connection,
        unavailable,
        eventBus,
        providers.orders,
        unavailable,
        digitalProducts,
        unavailable,
        unavailable,
    );
    const incidents = new runtime.IncidentResponseService(connection, unavailable, unavailable);
    const executor = createLegacyDigitalCompensationExecutor({
        connection,
        ...providers,
        manualDelivery,
        incidents,
        entities,
        superAdminPermission: runtime.core.Permission.SuperAdmin,
        clock,
        isolatedTest,
        verifyProductionRuntimeProtections,
        verifyReviewedArtifact,
    });
    return {
        ...executor,
        connection,
        providers: { ...providers, manualDelivery, incidents },
        lifecycle: {
            ...native.lifecycle,
            notificationSubscriberStarted: false,
            externalTransportStarted: false,
            cipherInvoked: false,
            historicalIncidentClosureUsesNativeTransaction: true,
            historicalDeletedReleaseUsesNativeAllocationStrategy: true,
            historicalDeletedAllocatedUpdateRetainsNativeAssertions: true,
        },
        close() {
            eventBus.onModuleDestroy();
            native.close();
        },
    };
}
