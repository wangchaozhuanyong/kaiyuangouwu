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
        },
        close() {
            eventBus.onModuleDestroy();
            native.close();
        },
    };
}
