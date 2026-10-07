import assert from 'node:assert/strict';

import { createLegacyCompensationExecutor } from './public-preview-legacy-compensation.mjs';

// A narrow native-provider host. It does not create/open a DataSource, import an application
// config, invoke Nest/worker bootstrap or call any provider lifecycle hook.
// The caller must attest the runtime classes/config/entity metadata and connection separately.
export function createNoLifecycleLegacyCompensationHost({
    dataSource,
    configService,
    runtime,
    entities,
    clock,
    isolatedTest = false,
    verifyProductionRuntimeProtections,
}) {
    assert.ok(dataSource?.isInitialized, 'An independently reviewed initialized DataSource is required');
    assert.ok(['mysql', 'mariadb'].includes(dataSource.options.type), 'Native MySQL host required');
    if (!isolatedTest) {
        assert.equal(dataSource.options.synchronize, false, 'Production schema synchronization is forbidden');
        assert.ok(
            !dataSource.options.dropSchema && !dataSource.options.migrationsRun,
            'Schema lifecycle is forbidden',
        );
    } else {
        assert.match(
            String(dataSource.options.database),
            /^(?:order_closure|legacy_preview)_[a-f0-9]+$/,
            'Only an owned UUID test database is permitted',
        );
    }
    const core = runtime.core;
    const { TransactionWrapper, BaseStockLocationStrategy } = runtime;
    assert.ok(
        core && TransactionWrapper && BaseStockLocationStrategy,
        'Exact native runtime classes required',
    );
    assert.ok(configService instanceof core.ConfigService, 'Native ConfigService is required');
    const configuredStrategy = configService.catalogOptions.stockLocationStrategy;
    assert.ok(
        [
            'PackagingStockLocationStrategy',
            'MultiChannelStockLocationStrategy',
            'DefaultStockLocationStrategy',
        ].includes(configuredStrategy.constructor.name),
        'Unreviewed stock strategy cannot use the narrow host',
    );
    const unavailable = new Proxy(
        {},
        {
            get() {
                throw new Error('Unreviewed provider path attempted in no-lifecycle compensation host');
            },
        },
    );
    // The reviewed strategy's forRelease path uses the native Base connection initializer.
    // Subclass init() installs caches/listeners for allocation/display paths which this host
    // never calls. Clone the exact configured class, not a replacement inventory strategy.
    const strategy = new configuredStrategy.constructor();
    const hostConfig = Object.create(configService);
    Object.defineProperty(hostConfig, 'catalogOptions', {
        get: () => ({ ...configService.catalogOptions, stockLocationStrategy: strategy }),
    });
    const connection = new core.TransactionalConnection(dataSource, new TransactionWrapper(), hostConfig);
    BaseStockLocationStrategy.prototype.init.call(strategy, {
        get(token) {
            assert.equal(token, core.TransactionalConnection, 'Unexpected strategy dependency');
            return connection;
        },
    });
    const requestCache = new core.RequestContextCacheService();
    const existingSubscriber = dataSource.subscribers.find(
        candidate => candidate instanceof runtime.TransactionSubscriber,
    );
    const subscriber = existingSubscriber ?? new runtime.TransactionSubscriber(dataSource);
    const eventBus = new core.EventBus(subscriber);
    const globalSettings = new core.GlobalSettingsService(
        connection,
        hostConfig,
        unavailable,
        eventBus,
        requestCache,
    );
    const stockLocations = new core.StockLocationService(
        unavailable,
        connection,
        unavailable,
        unavailable,
        unavailable,
        hostConfig,
        requestCache,
        unavailable,
        eventBus,
    );
    const stockLevels = new core.StockLevelService(connection, stockLocations, hostConfig, requestCache);
    const stockMovements = new core.StockMovementService(
        connection,
        unavailable,
        globalSettings,
        stockLevels,
        eventBus,
        stockLocations,
    );
    const orders = new core.OrderService(
        connection,
        hostConfig,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        eventBus,
        unavailable,
        unavailable,
        unavailable,
        requestCache,
        unavailable,
        stockLevels,
    );
    const carts = new runtime.StorefrontCartService(
        connection,
        unavailable,
        unavailable,
        orders,
        unavailable,
        unavailable,
        hostConfig,
        unavailable,
    );
    // Register only the existing native Cart-before-Order lock. No lifecycle validator,
    // reconciler, scanner, scheduler, backfill, job processor or HTTP endpoint is started.
    assert.equal(
        typeof orders.withOrderMutationTransaction,
        'function',
        'Native RC transaction helper missing',
    );
    assert.equal(typeof orders.lockOrderForRefund, 'function', 'Native order lock helper missing');
    if (typeof orders.registerOrderMutationLock === 'function') {
        orders.registerOrderMutationLock('legacy-compensation-native-cart-before-order', (ctx, orderId) =>
            carts.lockForOrder(ctx, orderId),
        );
    }
    // a535 has no registration API; the executor itself always calls native Cart lock before
    // native Order lock. It must never replace the running Core to obtain the newer API.
    const administrator = new core.AdministratorService(
        connection,
        hostConfig,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        unavailable,
        eventBus,
        unavailable,
        unavailable,
    );
    const history = new core.HistoryService(connection, administrator, unavailable, eventBus);
    const coupons = new runtime.StoreCouponLifecycleService(
        connection,
        unavailable,
        unavailable,
        orders,
        eventBus,
        unavailable,
        unavailable,
        carts,
    );
    const executor = createLegacyCompensationExecutor({
        connection,
        orders,
        carts,
        stockMovements,
        stockLocations,
        coupons,
        history,
        entities,
        superAdminPermission: core.Permission.SuperAdmin,
        isolatedTest,
        verifyProductionRuntimeProtections,
        clock,
    });
    return {
        ...executor,
        connection,
        providers: { orders, carts, stockMovements, stockLocations, stockLevels, coupons, history },
        lifecycle: {
            nestBootstrap: false,
            workerBootstrap: false,
            moduleInitializationHooksInvoked: false,
            applicationBootstrapHooksInvoked: false,
            workerSchedulerHooksInvoked: false,
            baseStrategyConnectionInitializerInvoked: true,
            eventBusDestroyHookInvokedOnlyOnClose: true,
            scannerStarted: false,
            schedulerStarted: false,
            jobsStarted: false,
            // Isolated EventBus emits native stock/coupon/history events, but cannot invalidate
            // caches in the existing production process. The authorized data writer must complete
            // an explicitly reviewed cache/readback step before claiming online availability.
            productionCacheRefreshRequired: true,
        },
        close() {
            eventBus.onModuleDestroy();
        },
    };
}
