import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Customer,
    DefaultLogger,
    EventBus,
    LogLevel,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    Payment,
    ProductService,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { createOperatingStoreFixture } from '../../../e2e-common/operating-store-fixture';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { AutoCardCipherService } from '../src/auto-card-cipher.service';
import { AutoCardPoolEnabledEvent } from '../src/auto-card-delivery.event';
import { AutoCardService } from '../src/auto-card.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { DigitalProductService } from '../src/digital-product.service';
import { AutoCardConfig } from '../src/entities/auto-card-config.entity';
import { AutoCardDelivery } from '../src/entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from '../src/entities/auto-card-pool-item.entity';
import { DigitalVariantConfig } from '../src/entities/digital-product.entity';

const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37421, hostname: '127.0.0.1' },
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    plugins: [
        OperationsDashboardPlugin,
        StoreDomainPlugin,
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'synthetic-local-only',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'synthetic-local-only',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        CommerceFulfillmentPlugin.init({
            testPaymentsEnabled: false,
            evidenceStorage: {
                rootDirectory: path.resolve(__dirname, '../artifacts/pool-concurrency'),
                signingSecret: randomUUID(),
            },
        }),
    ],
});
const { server } = createTestEnvironment(config);
let connection: TransactionalConnection;
let own: RequestContext;
let foreign: RequestContext;
let customer: Customer;
let autoCards: AutoCardService;

beforeAll(async () => {
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            shippingMethods: [],
            paymentMethods: [],
            collections: [],
        },
        customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    expect(connection.rawConnection.options.type).toBe('mysql');
    const contexts = server.app.get(RequestContextService);
    assert(config.authOptions.superadminCredentials);
    const user = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: config.authOptions.superadminCredentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    customer = await connection.rawConnection.getRepository(Customer).findOneOrFail({
        where: {},
        relations: ['user'],
    });
    const store = await createOperatingStoreFixture(server.app, {
        code: 'pool-own',
        defaultLanguageCode: LanguageCode.zh_Hans,
        currencyCode: CurrencyCode.GBP,
        commerceMode: 'HYBRID',
    });
    const other = await createOperatingStoreFixture(server.app, {
        code: 'pool-foreign',
        defaultLanguageCode: LanguageCode.zh_Hans,
        currencyCode: CurrencyCode.GBP,
        commerceMode: 'HYBRID',
    });
    own = await contexts.create({ apiType: 'admin', user, channelOrToken: store });
    foreign = await contexts.create({ apiType: 'admin', user, channelOrToken: other });
    autoCards = server.app.get(AutoCardService);
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());

async function fixture(state: 'AVAILABLE' | 'DISABLED' = 'AVAILABLE', quantity = 1) {
    const tag = randomUUID();
    const product = await server.app.get(ProductService).create(own, {
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: 'Synthetic pool ' + tag,
                slug: 'synthetic-pool-' + tag,
                description: 'Local synthetic transaction regression',
            },
        ],
        customFields: { fulfillmentType: 'digital' },
    });
    const [variant] = await server.app.get(ProductVariantService).create(own, [
        {
            productId: product.id,
            sku: 'POOL-' + tag,
            price: 1000,
            translations: [{ languageCode: LanguageCode.zh_Hans, name: 'Synthetic pool' }],
            customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
        },
    ]);
    const fields = JSON.stringify([{ key: 'code', label: 'Code', labelEn: 'Code', secret: true }]);
    const poolConfig = await connection.getRepository(own, AutoCardConfig).save(
        new AutoCardConfig({
            channelId: own.channelId,
            productVariantId: variant.id,
            enabled: true,
            formatName: 'Synthetic',
            delimiter: '----',
            fieldsJson: fields,
            instructions: '',
            instructionsZh: '',
            instructionsEn: '',
            lowStockThreshold: 0,
        }),
    );
    const digitalRepository = connection.getRepository(own, DigitalVariantConfig);
    const currentDigital = await digitalRepository.findOne({
        where: { channelId: own.channelId, productVariantId: variant.id },
    });
    await digitalRepository.save(
        new DigitalVariantConfig({
            ...currentDigital,
            channelId: own.channelId,
            productVariantId: variant.id,
            deliveryMode: 'auto_card',
            stockPolicy: 'pool_derived',
            availableQuantity: 0,
            fileVersionId: null,
            migrationState: 'ACTIVE',
        }),
    );
    const cipher = server.app.get(AutoCardCipherService);
    const item = await connection.getRepository(own, AutoCardPoolItem).save(
        new AutoCardPoolItem({
            configId: poolConfig.id,
            sequence: 1,
            state: 'AVAILABLE',
            encryptedPayload: cipher.encrypt({ code: 'synthetic-' + tag }),
            encryptedRawPayload: null,
            fingerprint: cipher.fingerprint(poolConfig.id, { code: tag }),
            assignedAt: null,
            deliveryId: null,
            disabledReason: null,
        }),
    );
    const orders = server.app.get(OrderService);
    const items = [item];
    for (let sequence = 2; sequence <= quantity; sequence++) {
        items.push(
            await connection.getRepository(own, AutoCardPoolItem).save(
                new AutoCardPoolItem({
                    ...item,
                    id: undefined,
                    sequence,
                    fingerprint: cipher.fingerprint(poolConfig.id, { code: tag + '-' + sequence }),
                    encryptedPayload: cipher.encrypt({ code: 'synthetic-' + tag + '-' + sequence }),
                }),
            ),
        );
    }
    assert(customer.user);
    const order = await orders.create(own, customer.user.id);
    const added = await orders.addItemToOrder(own, order.id, variant.id, quantity);
    if ('errorCode' in added) throw new Error(added.message);
    const line = await connection
        .getRepository(own, OrderLine)
        .findOneOrFail({ where: { order: { id: order.id } }, relations: ['productVariant'] });
    if (state === 'DISABLED')
        await connection.getRepository(own, AutoCardPoolItem).update(item.id, { state });
    return { item, items, variant, poolConfig, order, line, fields };
}

async function markPaid(input: Awaited<ReturnType<typeof fixture>>) {
    const priced = await server.app.get(OrderService).findOne(own, input.order.id);
    assert(priced);
    await connection.getRepository(own, Order).update(input.order.id, {
        state: 'PaymentSettled',
        active: false,
        orderPlacedAt: new Date(),
    });
    await connection.getRepository(own, OrderLine).update(input.line.id, {
        orderPlacedQuantity: 1,
        customFields: { fulfillmentTypeSnapshot: 'digital', digitalDeliveryModeSnapshot: 'auto_card' },
    });
    await connection.getRepository(own, Payment).save(
        new Payment({
            order: input.order,
            state: 'Settled',
            amount: priced.totalWithTax,
            method: 'synthetic-no-charge',
            metadata: {},
        }),
    );
    return connection.getRepository(own, AutoCardDelivery).save(
        new AutoCardDelivery({
            channelId: own.channelId,
            configId: input.poolConfig.id,
            orderId: input.order.id,
            orderLineId: input.line.id,
            state: 'WAITING_STOCK',
            recipientEmail: 'synthetic@example.invalid',
            languageCode: LanguageCode.zh_Hans,
            productName: 'Synthetic pool',
            sku: 'SYNTHETIC',
            quantity: 1,
            schemaSnapshot: input.fields,
            instructionsSnapshot: '',
            attemptCount: 0,
        }),
    );
}

async function partiallyReusedPool() {
    const input = await fixture('AVAILABLE', 2);
    const orders = server.app.get(OrderService);
    const digitalProducts = server.app.get(DigitalProductService);
    await connection.withTransaction(own, async tx => {
        const initialOrder = await orders.findOne(tx, input.order.id);
        assert(initialOrder);
        await digitalProducts.reserveOrder(tx, initialOrder);
        await digitalProducts.releaseLine(tx, input.line.id, 1);
    });
    const adjusted = await orders.adjustOrderLine(own, input.order.id, input.line.id, 1);
    if ('errorCode' in adjusted) throw new Error(adjusted.message);
    assert(customer.user);
    const second = await orders.create(own, customer.user.id);
    const added = await orders.addItemToOrder(own, second.id, input.variant.id, 1);
    if ('errorCode' in added) throw new Error(added.message);
    await connection.withTransaction(own, async tx => {
        const secondOrder = await orders.findOne(tx, second.id);
        assert(secondOrder);
        await digitalProducts.reserveOrder(tx, secondOrder);
    });
    const delivery = await markPaid(input);
    const secondLine = await connection
        .getRepository(own, OrderLine)
        .findOneOrFail({ where: { order: { id: second.id } } });
    return { input, delivery, digitalProducts, secondLine };
}

describe('full-entity MySQL card-pool maintenance transactions', () => {
    it('keeps B reserved card after A partial release and allocates only A remaining card', async () => {
        const { input, delivery, digitalProducts } = await partiallyReusedPool();
        await connection.withTransaction(own, tx =>
            (autoCards as any).allocateExistingDelivery(tx, delivery),
        );
        const rows = await connection.getRepository(own, AutoCardPoolItem).find({
            where: { configId: input.poolConfig.id },
            order: { sequence: 'ASC' },
        });
        expect(rows[0]).toMatchObject({ state: 'RESERVED', deliveryId: null, assignedAt: null });
        expect(rows[1].state).toBe('ASSIGNED');
        expect(String(rows[1].deliveryId)).toBe(String(delivery.id));
        const claim = await digitalProducts.reservation(own, input.line.id);
        expect(claim).toMatchObject({ releasedQuantity: 1, consumedQuantity: 1, state: 'CONSUMED' });
    });
    it('lets unpaid B release under the shared config lock while A recovery waits without holding B claim', async () => {
        const { input, delivery, digitalProducts, secondLine } = await partiallyReusedPool();
        let announceDeliveryLock!: () => void;
        const deliveryLocked = new Promise<void>(resolve => {
            announceDeliveryLock = resolve;
        });
        const internalCards = autoCards as unknown as {
            lockDeliveryOrThrow(ctx: RequestContext, id: AutoCardDelivery['id']): Promise<AutoCardDelivery>;
        };
        const original = internalCards.lockDeliveryOrThrow.bind(autoCards);
        const spy = vi.spyOn(internalCards, 'lockDeliveryOrThrow').mockImplementation(async (tx, id) => {
            const locked = await original(tx, id);
            if (String(id) === String(delivery.id)) announceDeliveryLock();
            return locked;
        });
        let allocation: Promise<unknown> | undefined;
        try {
            await connection.withTransaction(own, async cancelling => {
                const secondClaim = await digitalProducts.reservation(cancelling, secondLine.id);
                assert(secondClaim);
                await connection.getRepository(cancelling, DigitalVariantConfig).findOne({
                    where: { id: secondClaim.configId },
                    lock: { mode: 'pessimistic_write' },
                });
                allocation = connection.withTransaction(own, tx =>
                    (autoCards as any).allocateExistingDelivery(tx, delivery),
                );
                await deliveryLocked;
                await digitalProducts.releaseLine(cancelling, secondLine.id, 1);
            });
            await allocation;
            const rows = await connection.getRepository(own, AutoCardPoolItem).find({
                where: { configId: input.poolConfig.id },
                order: { sequence: 'ASC' },
            });
            expect(rows[0].state).toBe('AVAILABLE');
            expect(rows[1].state).toBe('ASSIGNED');
            expect(String(rows[1].deliveryId)).toBe(String(delivery.id));
        } finally {
            spy.mockRestore();
        }
    });
    it.each(['RESERVED', 'ASSIGNED'] as const)(
        'rejects stale maintenance after a second real transaction commits %s',
        async state => {
            const input = await fixture();
            const delivery = state === 'ASSIGNED' ? await markPaid(input) : undefined;
            await connection.withTransaction(
                own,
                async maintenance => {
                    expect(
                        (
                            await connection
                                .getRepository(maintenance, AutoCardPoolItem)
                                .findOneByOrFail({ id: input.item.id })
                        ).state,
                    ).toBe('AVAILABLE');
                    await connection.withTransaction(
                        own,
                        async purchaser => {
                            if (delivery) {
                                // Invoke the same allocation method used by paid-order recovery,
                                // with the actual service, entity graph, row locks and CAS.
                                await (autoCards as any).allocateExistingDelivery(purchaser, delivery);
                            } else {
                                const order = await server.app
                                    .get(OrderService)
                                    .findOne(purchaser, input.order.id);
                                assert(order);
                                await server.app.get(DigitalProductService).reserveOrder(purchaser, order);
                            }
                        },
                        'REPEATABLE READ',
                    );
                    await expect(
                        autoCards.setPoolItemEnabled(maintenance, input.item.id, false),
                    ).rejects.toThrow(/状态已变化|未核清/);
                },
                'REPEATABLE READ',
            );
            const persisted = await connection
                .getRepository(own, AutoCardPoolItem)
                .findOneByOrFail({ id: input.item.id });
            expect(persisted.state).toBe(state);
            if (delivery) expect(String(persisted.deliveryId)).toBe(String(delivery.id));
        },
    );

    it('rejects a stale purchaser when maintenance commits the disable first', async () => {
        const input = await fixture();
        await expect(
            connection.withTransaction(
                own,
                async purchaser => {
                    expect(
                        (
                            await connection
                                .getRepository(purchaser, AutoCardPoolItem)
                                .findOneByOrFail({ id: input.item.id })
                        ).state,
                    ).toBe('AVAILABLE');
                    await connection.withTransaction(own, tx =>
                        autoCards.setPoolItemEnabled(tx, input.item.id, false),
                    );
                    const order = await server.app.get(OrderService).findOne(purchaser, input.order.id);
                    assert(order);
                    await server.app.get(DigitalProductService).reserveOrder(purchaser, order);
                },
                'REPEATABLE READ',
            ),
        ).rejects.toThrow(/被其他订单占用|可用卡密不足/);
        expect(
            (await connection.getRepository(own, AutoCardPoolItem).findOneByOrFail({ id: input.item.id }))
                .state,
        ).toBe('DISABLED');
    });

    it('publishes recovery only after commit and drops a rolled-back enable event', async () => {
        const input = await fixture('DISABLED');
        const received = vi.fn();
        const subscription = server.app.get(EventBus).ofType(AutoCardPoolEnabledEvent).subscribe(received);
        try {
            await expect(
                connection.withTransaction(own, async tx => {
                    await autoCards.setPoolItemEnabled(tx, input.item.id, true);
                    expect(received).not.toHaveBeenCalled();
                    throw new Error('Synthetic rollback');
                }),
            ).rejects.toThrow('Synthetic rollback');
            expect(received).not.toHaveBeenCalled();
            expect(
                (await connection.getRepository(own, AutoCardPoolItem).findOneByOrFail({ id: input.item.id }))
                    .state,
            ).toBe('DISABLED');
            await connection.withTransaction(own, async tx => {
                await autoCards.setPoolItemEnabled(tx, input.item.id, true);
                expect(received).not.toHaveBeenCalled();
            });
            await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
            await connection.withTransaction(own, tx =>
                autoCards.setPoolItemEnabled(tx, input.item.id, true),
            );
            expect(received).toHaveBeenCalledTimes(1);
        } finally {
            subscription.unsubscribe();
        }
    });

    it('rejects maintenance from a different store without changing its pool', async () => {
        const input = await fixture();
        await expect(
            connection.withTransaction(foreign, tx => autoCards.setPoolItemEnabled(tx, input.item.id, false)),
        ).rejects.toThrow('号池记录不存在');
        expect(
            (await connection.getRepository(own, AutoCardPoolItem).findOneByOrFail({ id: input.item.id }))
                .state,
        ).toBe('AVAILABLE');
    });
});
