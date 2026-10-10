import {
    CatalogResourceOwnership,
    ProductSalesAuthorization,
    ProductVariant,
    RequestContextCacheService,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AutoCardDeliveryReadyEvent } from './auto-card-delivery.event';
import { AutoCardSupplyService } from './auto-card-supply.service';
import { AutoCardService } from './auto-card.service';
import { DigitalProductService } from './digital-product.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDeliveryEvent } from './entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { AutoCardSupplyGrant } from './entities/auto-card-supply-grant.entity';
import { DigitalVariantConfig } from './entities/digital-product.entity';

function todoSummaryHarness(size = 1) {
    type Row = Record<string, any>;
    const variants: Row[] = Array.from({ length: size }, (_, index) => ({
        id: `variant-${index}`,
        productId: `product-${index}`,
        deletedAt: null,
        channels: [{ id: 'A' }],
        customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
        product: {
            deletedAt: null,
            customFields: { fulfillmentType: 'digital' },
            channels: [{ id: 'A', code: 'store-a' }],
        },
    }));
    const configs: Row[] = variants.map(variant => ({
        id: `config-${variant.id}`,
        channelId: 'A',
        productVariantId: variant.id,
        enabled: true,
        lowStockThreshold: 5,
    }));
    const owners: Row[] = variants.map(variant => ({
        resourceType: 'Product',
        resourceId: variant.productId,
        ownerChannelId: 'A',
    }));
    const digital: Row[] = [];
    const sales: Row[] = [];
    const pool: Row[] = [];
    const deliveries: Row[] = [
        { channelId: 'A', state: 'WAITING_STOCK' },
        { channelId: 'A', state: 'MANUAL_REVIEW' },
        { channelId: 'B', state: 'WAITING_STOCK' },
        { channelId: 'B', state: 'MANUAL_REVIEW' },
    ];
    const rows = new Map<unknown, Row[]>([
        [ProductVariant, variants],
        [AutoCardConfig, configs],
        [CatalogResourceOwnership, owners],
        [DigitalVariantConfig, digital],
        [ProductSalesAuthorization, sales],
        [AutoCardSupplyGrant, []],
    ]);
    const reads: string[] = [];
    const matches = (row: Row, where: Row): boolean =>
        Object.entries(where).every(([key, value]) => {
            if (value?._type === 'in') return value._value.map(String).includes(String(row[key]));
            if (value?._type === 'isNull') return row[key] == null;
            if (value && typeof value === 'object')
                return Array.isArray(row[key])
                    ? row[key].some((item: Row) => matches(item, value))
                    : matches(row[key] ?? {}, value);
            return row[key] === value;
        });
    const find = (entity: { name: string }, where: Row | Row[]) => {
        reads.push(entity.name);
        return Promise.resolve(
            (rows.get(entity) ?? []).filter(row =>
                (Array.isArray(where) ? where : [where]).some(part => matches(row, part)),
            ),
        );
    };
    const query = {
        leftJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        addGroupBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn(() => {
            reads.push('AutoCardConfig:aggregate');
            return Promise.resolve(
                configs
                    .filter(config => config.channelId === 'A' && config.enabled)
                    .map(config => ({
                        ...config,
                        availableCount: pool.filter(
                            item => item.configId === config.id && item.state === 'AVAILABLE',
                        ).length,
                    })),
            );
        }),
    };
    const count = vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(deliveries.filter(row => matches(row, where)).length),
    );
    const connection = {
        getRepository: (_ctx: unknown, entity: { name: string }) => ({
            find: ({ where }: { where: Row | Row[] }) => find(entity, where),
            createQueryBuilder: () => query,
            count,
            manager: {
                getRepository: (target: { name: string }) => ({
                    find: ({ where }: { where: Row | Row[] }) => find(target, where),
                }),
            },
        }),
    };
    const cache = new RequestContextCacheService();
    const supply = new AutoCardSupplyService(connection as any, {} as any, {} as any, cache);
    const digitalProducts = new DigitalProductService(connection as any, {} as any, {} as any, cache);
    const service = Object.assign(Object.create(AutoCardService.prototype), {
        connection,
        supply,
        digitalProducts,
    }) as AutoCardService;
    const ctx = { channelId: 'A', channel: { code: 'store-a' }, apiType: 'admin' } as any;
    return { service, ctx, variants, configs, owners, digital, sales, pool, query, count, reads };
}

describe('AutoCardService current low-stock warnings', () => {
    it.each(['manual_service', 'file_download'])(
        'ignores a retained pool after changing to %s',
        async mode => {
            const test = todoSummaryHarness();
            test.digital.push({
                channelId: 'A',
                productVariantId: test.variants[0].id,
                migrationState: 'ACTIVE',
                deliveryMode: mode,
            });

            expect(await test.service.todoSummary(test.ctx)).toEqual({
                lowStockSkuCount: 0,
                waitingStockDeliveryCount: 1,
                manualReviewCount: 1,
            });
            expect(test.configs[0].enabled).toBe(true);
        },
    );

    it('uses legacy mode only when there is no active store-specific configuration', async () => {
        const test = todoSummaryHarness();
        test.variants[0].customFields.digitalDeliveryMode = 'manual_service';
        test.digital.push({
            channelId: 'A',
            productVariantId: test.variants[0].id,
            migrationState: 'PREPARED',
            deliveryMode: 'auto_card',
        });
        test.digital.push({
            channelId: 'B',
            productVariantId: test.variants[0].id,
            migrationState: 'ACTIVE',
            deliveryMode: 'auto_card',
        });

        expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(0);
    });

    it('reports an active auto-card configuration even when the legacy field is manual', async () => {
        const test = todoSummaryHarness();
        test.variants[0].customFields.digitalDeliveryMode = 'manual_service';
        test.digital.push({
            channelId: 'A',
            productVariantId: test.variants[0].id,
            migrationState: 'ACTIVE',
            deliveryMode: 'auto_card',
        });

        expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(1);
    });

    it.each(['variant', 'product'])(
        'excludes a physical %s and retains historical delivery tasks',
        async target => {
            const test = todoSummaryHarness();
            const record = target === 'product' ? test.variants[0].product : test.variants[0];
            record.customFields.fulfillmentType = 'physical';
            expect(await test.service.todoSummary(test.ctx)).toEqual({
                lowStockSkuCount: 0,
                waitingStockDeliveryCount: 1,
                manualReviewCount: 1,
            });
        },
    );

    it.each(['variant', 'product', 'both'])(
        'preserves valid auto-card warnings with missing legacy %s type',
        async target => {
            const test = todoSummaryHarness();
            if (target !== 'product') delete test.variants[0].customFields.fulfillmentType;
            if (target !== 'variant') delete test.variants[0].product.customFields.fulfillmentType;
            expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(1);
        },
    );

    it.each(['variant', 'product'])('excludes a deleted %s', async target => {
        const test = todoSummaryHarness();
        const record = target === 'product' ? test.variants[0].product : test.variants[0];
        record.deletedAt = new Date();
        expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(0);
    });

    it.each(['channel', 'owner', 'revoked-sale', 'pending-sale', 'ambiguous-legacy'])(
        'rejects stale %s scope',
        async scenario => {
            const test = todoSummaryHarness();
            if (scenario === 'channel') test.variants[0].channels = [{ id: 'B' }];
            if (scenario === 'owner') test.owners[0].ownerChannelId = 'B';
            if (scenario.endsWith('-sale'))
                test.sales.push({
                    productId: test.variants[0].productId,
                    channelId: 'A',
                    state: scenario === 'revoked-sale' ? 'REVOKED' : 'PENDING',
                    variantIds: [test.variants[0].id],
                    pendingVariantIds: [],
                });
            if (scenario === 'ambiguous-legacy') {
                test.owners.length = 0;
                test.variants[0].product.channels.push({ id: 'B', code: 'store-b' });
            }
            expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(0);
        },
    );

    it('preserves the single-store legacy ownership fallback', async () => {
        const test = todoSummaryHarness();
        test.owners.length = 0;
        expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(1);
    });

    it.each([0, 4, 5, 6])('only warns at or below the threshold with %i available cards', async available => {
        const test = todoSummaryHarness();
        test.pool.push(
            ...Array.from({ length: available }, () => ({
                configId: test.configs[0].id,
                state: 'AVAILABLE',
            })),
            { configId: test.configs[0].id, state: 'ASSIGNED' },
        );
        expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(available <= 5 ? 1 : 0);
        expect(test.query.where).toHaveBeenCalledWith('config.channelId = :channelId', { channelId: 'A' });
        expect(test.query.andWhere).toHaveBeenCalledWith('config.enabled = :enabled', { enabled: true });
    });

    it('ignores disabled pools without hiding historical paid-order work', async () => {
        const test = todoSummaryHarness();
        test.configs[0].enabled = false;
        expect(await test.service.todoSummary(test.ctx)).toEqual({
            lowStockSkuCount: 0,
            waitingStockDeliveryCount: 1,
            manualReviewCount: 1,
        });
    });

    it.each([1, 48])('batches current mode and ownership reads for %i low-stock SKUs', async size => {
        const test = todoSummaryHarness(size);
        expect((await test.service.todoSummary(test.ctx)).lowStockSkuCount).toBe(size);
        expect(test.reads).toEqual([
            'AutoCardConfig:aggregate',
            'ProductVariant',
            'DigitalVariantConfig',
            'ProductVariant',
            'CatalogResourceOwnership',
            'ProductSalesAuthorization',
            'AutoCardConfig',
        ]);
        expect(test.count).toHaveBeenCalledTimes(2);
    });
});

function autoCardLine(quantity = 2) {
    return {
        id: 'line-1',
        quantity,
        customFields: {
            fulfillmentTypeSnapshot: 'digital',
            digitalDeliveryModeSnapshot: 'auto_card',
        },
        productVariant: {
            id: 'variant-1',
            name: 'Google account',
            sku: 'GOOGLE-1',
            customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
        },
    } as any;
}

function createHarness(input: { delivery?: any; candidates?: any[]; affected?: number }) {
    const events: any[] = [];
    const delivery =
        input.delivery ??
        ({
            id: 'delivery-1',
            state: 'WAITING_STOCK',
            quantity: 2,
            configId: 'config-1',
            poolItems: [],
            events: [],
        } as any);
    delivery.channelId ??= 'channel-1';
    delivery.orderId ??= 'order-1';
    delivery.order ??= { id: delivery.orderId };
    delivery.order.active ??= false;
    delivery.order.state ??= 'PaymentSettled';
    delivery.order.totalWithTax ??= 1000;
    delivery.order.payments ??= [{ state: 'Settled', amount: 1000, refunds: [] }];
    delivery.orderLine ??= autoCardLine(delivery.quantity);
    delivery.order.salesChannelId ??= delivery.channelId;
    delivery.order.state ??= 'PaymentSettled';
    delivery.order.payments ??= [{ state: 'Settled', amount: 1000, refunds: [] }];
    delivery.orderLine ??= autoCardLine(delivery.quantity);
    delivery.orderLineId ??= delivery.orderLine.id;
    delivery.config ??= { id: delivery.configId };
    delivery.config.channelId ??= delivery.channelId;
    const candidates = input.candidates ?? [
        { id: 'pool-1', sequence: 1, state: 'AVAILABLE' },
        { id: 'pool-2', sequence: 2, state: 'AVAILABLE' },
    ];
    const poolBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(candidates),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        whereInIds: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: input.affected ?? candidates.length }),
    };
    const deliveryRepository = {
        findOne: vi.fn().mockResolvedValue(delivery),
        save: vi.fn((value: any) => Promise.resolve(value)),
    };
    const deliveryLockBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(delivery),
    };
    Object.assign(deliveryRepository, {
        createQueryBuilder: vi.fn().mockReturnValue(deliveryLockBuilder),
    });
    const poolRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(poolBuilder),
    };
    const eventRepository = {
        save: vi.fn((event: any) => {
            events.push(event);
            delivery.events.push(event);
            return Promise.resolve(event);
        }),
    };
    const connection = {
        withTransaction: (transactionCtx: any, work: any) => Promise.resolve(work(transactionCtx)),
        rawConnection: { options: { type: 'sqljs' } },
        getRepository: vi.fn((_ctx: any, entity: any) => {
            if (entity === AutoCardConfig)
                return {
                    findOneOrFail: vi
                        .fn()
                        .mockResolvedValue({ ...delivery.config, productVariantId: 'variant-1' }),
                };
            if (entity === AutoCardSupplyGrant) return { find: vi.fn().mockResolvedValue([]) };
            if (entity?.name === 'OrderLine') return { findOne: vi.fn().mockResolvedValue({ id: 'line-1' }) };
            if (entity === AutoCardDelivery) return deliveryRepository;
            if (entity === AutoCardPoolItem) return poolRepository;
            if (entity === AutoCardDeliveryEvent) return eventRepository;
            throw new Error(`Unexpected repository ${entity?.name}`);
        }),
    };
    const eventBus = { publish: vi.fn() };
    const service = new AutoCardService(
        connection as any,
        {} as any,
        eventBus as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { forPaidLine: vi.fn().mockResolvedValue({ config: delivery.config }) } as any,
        { assertOwned: vi.fn() } as any,
        { appendAudit: vi.fn() } as any,
        { reservation: vi.fn().mockResolvedValue(null), consumeLine: vi.fn(), lock: vi.fn() } as any,
        { createForDigitalReceipt: vi.fn(() => ({ token: 'synthetic-receipt-proof' })) } as any,
    );
    const ctx = {
        copy: () => ctx,
        channelId: 'channel-1',
        channel: { id: 'channel-1' },
        activeUserId: 'admin-1',
    } as any;
    return {
        service,
        ctx,
        delivery,
        events,
        poolBuilder,
        deliveryLockBuilder,
        deliveryRepository,
        eventBus,
    };
}

describe('AutoCardService allocation invariants', () => {
    it('never reconciles append-only event rows from a stale delivery snapshot', () => {
        const relation = getMetadataArgsStorage().relations.find(
            item => item.target === AutoCardDelivery && item.propertyName === 'events',
        );
        expect(relation?.options.persistence).toBe(false);
    });

    it('allocates the requested quantity in pool sequence order', async () => {
        const test = createHarness({});

        const result = await (test.service as any).allocateExistingDelivery(test.ctx, test.delivery);

        expect(test.poolBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(test.poolBuilder.orderBy).toHaveBeenCalledWith('item.sequence', 'ASC');
        expect(test.poolBuilder.take).toHaveBeenCalledWith(2);
        expect(result.state).toBe('ALLOCATED');
        expect(result.poolItems.map((item: any) => item.sequence)).toEqual([1, 2]);
        expect(test.events.at(-1)).toMatchObject({ type: 'ALLOCATED' });
    });

    it('allocates only the remaining quantity after a partial concurrent assignment', async () => {
        const existing = { id: 'pool-1', sequence: 1, state: 'ASSIGNED', deliveryId: 'delivery-1' };
        const test = createHarness({
            delivery: {
                id: 'delivery-1',
                state: 'WAITING_STOCK',
                quantity: 2,
                configId: 'config-1',
                poolItems: [existing],
                events: [],
            },
            candidates: [{ id: 'pool-2', sequence: 2, state: 'AVAILABLE' }],
        });

        const result = await (test.service as any).allocateExistingDelivery(test.ctx, test.delivery);

        expect(test.poolBuilder.take).toHaveBeenCalledWith(1);
        expect(result.poolItems.map((item: any) => item.id)).toEqual(['pool-1', 'pool-2']);
        expect(result.state).toBe('ALLOCATED');
    });

    it('raises a P0 incident when the card pool cannot cover a paid order', async () => {
        const test = createHarness({
            delivery: {
                id: 'delivery-1',
                state: 'WAITING_STOCK',
                quantity: 2,
                configId: 'config-1',
                channelId: 'channel-1',
                orderId: 'order-1',
                sku: 'GOOGLE-1',
                poolItems: [],
                events: [],
            },
            candidates: [],
        });

        const result = await (test.service as any).allocateExistingDelivery(test.ctx, test.delivery);

        expect(result.state).toBe('WAITING_STOCK');
        const notification = test.eventBus.publish.mock.calls
            .map(call => call[0])
            .find(event => event instanceof AdminNotificationRequestedEvent);
        expect(notification?.notification).toMatchObject({
            mode: 'INCIDENT_FIRING',
            eventType: 'inventory.auto_card.empty',
            severity: 'P0',
            fingerprint: 'inventory.auto_card.empty:channel-1:config-1',
        });
    });

    it('raises a P1 incident after the final email attempt fails', async () => {
        const delivery = {
            id: 'delivery-1',
            state: 'RETRYING',
            quantity: 1,
            attemptCount: 4,
            channelId: 'channel-1',
            orderId: 'order-1',
            sku: 'GOOGLE-1',
            poolItems: [{ id: 'pool-1' }],
            config: { id: 'config-1' },
            order: { id: 'order-1', code: 'ORDER-1' },
            orderLine: autoCardLine(1),
            events: [],
        };
        const test = createHarness({ delivery });

        await test.service.recordEmailResult(test.ctx, delivery.id, false, new Error('SMTP down'));

        expect(delivery.state).toBe('MANUAL_REVIEW');
        const notification = test.eventBus.publish.mock.calls
            .map(call => call[0])
            .find(event => event instanceof AdminNotificationRequestedEvent);
        expect(notification?.notification).toMatchObject({
            mode: 'INCIDENT_FIRING',
            eventType: 'commerce.fulfillment.auto_card_failed',
            severity: 'P1',
        });
    });

    it('does not dispatch the same allocated delivery again within the retry window', async () => {
        const existing = {
            id: 'delivery-1',
            state: 'ALLOCATED',
            quantity: 1,
            poolItems: [{ id: 'pool-1' }],
            config: { id: 'config-1' },
            lastDispatchedAt: new Date(),
        };
        const test = createHarness({ delivery: existing });
        const order = {
            id: 'order-1',
            salesChannelId: 'channel-1',
            state: 'PaymentSettled',
            customFields: { deliveryEmail: 'buyer@example.com' },
            customer: { emailAddress: 'customer@example.com' },
            lines: [autoCardLine(1)],
        } as any;

        const result = await test.service.allocateSettledOrder(test.ctx, order);

        expect(result).toEqual([existing]);
        expect(test.eventBus.publish).not.toHaveBeenCalled();
    });

    it('never downgrades a successful delivery because a duplicate email attempt failed later', async () => {
        const sent = {
            id: 'delivery-1',
            state: 'SENT',
            quantity: 1,
            attemptCount: 1,
            poolItems: [{ id: 'pool-1' }],
            config: { id: 'config-1' },
            order: { id: 'order-1' },
            orderLine: autoCardLine(1),
            events: [],
        };
        const test = createHarness({ delivery: sent });

        await test.service.recordEmailResult(test.ctx, sent.id, false, new Error('duplicate failed'));

        expect(sent.state).toBe('SENT');
        expect(sent.attemptCount).toBe(1);
        expect(test.deliveryRepository.save).not.toHaveBeenCalled();
        expect(test.events.at(-1)).toMatchObject({ type: 'EMAIL_FAILED' });
    });

    it('locks manual retries and rejects a duplicate request that is already queued', async () => {
        const allocated = {
            id: 'delivery-1',
            state: 'ALLOCATED',
            quantity: 1,
            lastError: null,
            lastDispatchedAt: null,
            poolItems: [{ id: 'pool-1' }],
            config: { id: 'config-1' },
            order: { id: 'order-1' },
            orderLine: autoCardLine(1),
            events: [],
        };
        const test = createHarness({ delivery: allocated });

        await test.service.retryDelivery(test.ctx, allocated.id);

        expect(test.deliveryLockBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(
            test.eventBus.publish.mock.calls.filter(([event]) => event instanceof AutoCardDeliveryReadyEvent),
        ).toHaveLength(1);
        expect(test.events.map(event => event.type)).toEqual(['MANUAL_RETRY', 'EMAIL_QUEUED']);

        await expect(test.service.retryDelivery(test.ctx, allocated.id)).rejects.toThrow(
            '重发请求已进入邮件队列，请勿重复提交',
        );
        expect(
            test.eventBus.publish.mock.calls.filter(([event]) => event instanceof AutoCardDeliveryReadyEvent),
        ).toHaveLength(1);
        expect(test.events.map(event => event.type)).toEqual(['MANUAL_RETRY', 'EMAIL_QUEUED']);
    });

    it('does not expose Chinese delivery instructions to an English client', () => {
        const test = createHarness({});
        const config = {
            instructions: '旧中文说明',
            instructionsZh: '中文说明',
            instructionsEn: '仍然是中文说明',
        };

        expect((test.service as any).localizedInstructions(config, 'en')).toBe('');
        config.instructionsEn = 'Your credentials will be delivered by email.';
        expect((test.service as any).localizedInstructions(config, 'en')).toBe(
            'Your credentials will be delivered by email.',
        );
    });
});

it.each(['channel-2', null])(
    'blocks card allocation for a task whose parent sale owner is %s',
    async salesChannelId => {
        const test = createHarness({});
        test.delivery.order.salesChannelId = salesChannelId;
        await expect(
            (test.service as any).allocateExistingDelivery(test.ctx, test.delivery),
        ).rejects.toThrow();
        expect(test.eventBus.publish).not.toHaveBeenCalled();
        expect(test.delivery.poolItems).toHaveLength(0);
    },
);
