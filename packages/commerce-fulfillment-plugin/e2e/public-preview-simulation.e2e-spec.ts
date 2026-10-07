import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Allocation,
    ChannelService,
    ConfigService,
    CurrencyCode,
    Customer,
    EventBus,
    FulfillmentLine,
    LanguageCode,
    mergeConfig,
    Order,
    OrderService,
    OrderStateTransitionEvent,
    Payment,
    PaymentMethodHandler,
    PaymentMethodService,
    ProductService,
    ProductVariantService,
    Release,
    RequestContext,
    RequestContextService,
    Role,
    RoleService,
    Sale,
    StockLevel,
    StockLocationService,
    TransactionalConnection,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCart, StorefrontCartPlugin, StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { CouponLedgerEntry } from '../../store-management-plugin/src/entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../../store-management-plugin/src/entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../../store-management-plugin/src/entities/customer-coupon.entity';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StoreCouponLifecycleService } from '../../store-management-plugin/src/promotion/store-coupon-lifecycle.service';
import { StorePromotionCampaignService } from '../../store-management-plugin/src/promotion/store-promotion-campaign.service';
import { CheckoutResourcesService } from '../src/checkout-resources.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import {
    CheckoutResourceHold,
    DigitalOrderReservation,
    DigitalVariantConfig,
} from '../src/entities/digital-product.entity';
import { ManualDigitalDelivery } from '../src/entities/manual-digital-delivery.entity';

import { browserNativeCustomFields } from './browser-native-custom-fields';
import { closureDatabase } from './order-closure-db';

// A disposable local SQLJS/Nest fixture. All domains, people, secrets and payments are synthetic.
const artifactsDirectory = resolve(__dirname, '../artifacts/public-preview-simulation', randomUUID());
const isMysql = process.env.DB === 'mysql' && process.env.ORDER_CLOSURE_MYSQL === '1';
const mysqlOptions = isMysql ? closureDatabase(artifactsDirectory) : {};
const envNames = [
    'DIGITAL_DELIVERY_ROOT',
    'DIGITAL_DELIVERY_SIGNING_SECRET',
    'AUTO_CARD_ENCRYPTION_KEY',
] as const;
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const receiptCalls = { settle: 0, cancel: 0 };
let receiptGate: { entered: ReturnType<typeof barrier>; proceed: ReturnType<typeof barrier> } | undefined;
async function originalReceiptOperation(operation: 'settle' | 'cancel') {
    receiptCalls[operation]++;
    receiptGate?.entered.release();
    if (receiptGate) await receiptGate.proceed.promise;
    return { success: true };
}
const originalReceiptHandler = new PaymentMethodHandler({
    code: 'synthetic-original-receipt',
    description: [{ languageCode: LanguageCode.en, value: 'Isolated original receipt' }],
    args: {},
    createPayment: (_ctx, _order, amount) => ({ amount, state: 'Authorized', metadata: {} }),
    settlePayment: () => originalReceiptOperation('settle'),
    cancelPayment: () => originalReceiptOperation('cancel'),
});
process.env.DIGITAL_DELIVERY_ROOT = resolve(artifactsDirectory, 'digital');
process.env.DIGITAL_DELIVERY_SIGNING_SECRET = randomBytes(32).toString('base64url');
process.env.AUTO_CARD_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig, {
        apiOptions: { port: isMysql ? 37488 : 37487, hostname: '127.0.0.1' },
        ...(isMysql ? { dbConnectionOptions: mysqlOptions } : {}),
        authOptions: { requireVerification: false },
        paymentOptions: { paymentMethodHandlers: [originalReceiptHandler] },
        customFields: browserNativeCustomFields,
        plugins: [
            OperationsDashboardPlugin,
            CatalogManagementPlugin,
            StoreDomainPlugin,
            StorefrontCartPlugin,
            ContentTranslationPlugin.init({
                provider: {
                    name: 'synthetic-no-network',
                    isConfigured: () => true,
                    translate: request =>
                        Promise.resolve({
                            provider: 'synthetic-no-network',
                            translations: request.segments.map(segment => ({
                                key: segment.key,
                                text: segment.text,
                            })),
                        }),
                },
            }),
            StoreManagementPlugin.init({
                enabled: false,
                signingSecret: 'synthetic-preview-signing-secret-at-least-32-characters',
            }),
            CommerceFulfillmentPlugin.init({
                testPaymentsEnabled: true,
                evidenceStorage: {
                    rootDirectory: resolve(artifactsDirectory, 'evidence'),
                    signingSecret: randomUUID(),
                },
            }),
        ],
    }),
);
let connection: TransactionalConnection;
let ctx: RequestContext;
let adminCtx: RequestContext;
let customer: Customer;
let orders: OrderService;
let resources: CheckoutResourcesService;
let coupons: StoreCouponLifecycleService;
let physicalId: string | number;
let digitalId: string | number;
let digitalConfigId: string | number;
let couponCampaignId: string | number;
let initialMysqlDeadlock = '';

function mysqlDeadlockReport(text: string) {
    const start = text.indexOf('LATEST DETECTED DEADLOCK');
    const end = text.indexOf('\nTRANSACTIONS\n', start);
    return start < 0 ? '' : text.slice(start, end > start ? end : start + 20000);
}

/** Shared only by isolated local acceptance fixtures after this file's native setup completes. */
export function previewSimulationFixture() {
    if (!connection) throw new Error('The isolated preview fixture has not finished setup');
    return {
        server,
        connection,
        ctx,
        adminCtx,
        customer,
        orders,
        resources,
        coupons,
        physicalId,
        digitalId,
        digitalConfigId,
        couponCampaignId,
        artifactsDirectory,
    } as const;
}

beforeAll(
    async () => {
        mkdirSync(artifactsDirectory, { recursive: true });
        registerInitializer('sqljs', new SqljsInitializer(artifactsDirectory));
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 1,
        });
        connection = server.app.get(TransactionalConnection);
        if (isMysql) {
            const status = await connection.rawConnection.query('SHOW ENGINE INNODB STATUS');
            const text = String(status[0]?.Status ?? '');
            initialMysqlDeadlock = mysqlDeadlockReport(text);
            if (initialMysqlDeadlock) {
                // Retain the lock graph and SQL table names, not physical record dumps.
                const lines = initialMysqlDeadlock
                    .split('\n')
                    .filter(line =>
                        /LATEST DETECTED DEADLOCK|^20\d\d-|TRANSACTION|WAITING FOR|HOLDS THE LOCK|ROLL BACK|^UPDATE |^RECORD LOCKS/.test(
                            line,
                        ),
                    )
                    .map(line =>
                        line.startsWith('UPDATE ')
                            ? (line.match(/^UPDATE\s+`[^`]+`/)?.[0] ?? 'UPDATE') + ' [parameters omitted]'
                            : line,
                    );
                writeFileSync(
                    resolve(artifactsDirectory, 'prior-innodb-deadlock.log'),
                    lines.join('\n') + '\n',
                );
            }
        }
        orders = server.app.get(OrderService);
        resources = server.app.get(CheckoutResourcesService);
        coupons = server.app.get(StoreCouponLifecycleService);
        const contexts = server.app.get(RequestContextService);
        const platform = await contexts.create({ apiType: 'admin' });
        const channel = await server.app.get(ChannelService).create(platform, {
            code: 'synthetic-preview-fulfillment',
            token: 'synthetic-preview-fulfillment',
            defaultLanguageCode: LanguageCode.en,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: false,
            defaultTaxZoneId: platform.channel.defaultTaxZone?.id ?? '',
            defaultShippingZoneId: platform.channel.defaultShippingZone?.id ?? '',
            customFields: { commerceMode: 'HYBRID' },
        });
        if (!('id' in channel)) throw new Error(channel.message);
        // Direct synthetic ChannelService creation does not provision administrator role assignments.
        const administratorRole = await server.app.get(RoleService).getSuperAdminRole(platform);
        await connection
            .getRepository(platform, Role)
            .createQueryBuilder()
            .relation(Role, 'channels')
            .of(administratorRole.id)
            .add(channel.id);
        customer = await connection
            .getRepository(platform, Customer)
            .findOneOrFail({ where: {}, relations: ['user', 'user.roles', 'user.roles.channels'] });
        if (!customer.user) throw new Error('Synthetic customer fixture requires its test account');
        await server.app.get(ChannelService).assignToChannels(platform, Customer, customer.id, [channel.id]);
        ctx = await contexts.create({ apiType: 'shop', channelOrToken: channel.token, user: customer.user });
        adminCtx = await contexts.create({ apiType: 'admin', channelOrToken: channel.token });
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(channel.token);
        await connection.getRepository(ctx, StoreProfile).save(
            new StoreProfile({
                channelId: ctx.channelId,
                status: 'DRAFT',
                isPublished: true,
                descriptionZh: 'synthetic',
                descriptionEn: 'synthetic',
                sortOrder: 0,
            }),
        );
        await connection.getRepository(ctx, StoreDomain).save(
            new StoreDomain({
                channelId: ctx.channelId,
                domain: 'synthetic-fulfillment.example.invalid',
                status: 'ACTIVE',
                isPrimary: true,
                primaryChannelId: ctx.channelId,
                verifiedAt: new Date(),
                verificationToken: randomUUID(),
            }),
        );
        const method = await server.app.get(PaymentMethodService).create(platform, {
            code: 'controlled-test-payment-platform',
            enabled: true,
            translations: [
                { languageCode: LanguageCode.en, name: 'Synthetic controlled test', description: '' },
                { languageCode: LanguageCode.zh_Hans, name: '合成模拟付款', description: '本地隔离验证' },
            ],
            checker: { code: 'controlled-test-payment-checker', arguments: [] },
            handler: {
                code: 'controlled-test-payment-handler',
                arguments: [
                    { name: 'channelId', value: `T_${platform.channelId}` },
                    { name: 'allowAllOrders', value: 'true' },
                ],
            },
        });
        await connection
            .getRepository(ctx, 'StorePaymentMethodState')
            .save({ channelId: ctx.channelId, paymentMethodId: method.id, enabled: true });
        await server.app.get(PaymentMethodService).create(platform, {
            code: originalReceiptHandler.code,
            enabled: true,
            translations: [
                { languageCode: LanguageCode.en, name: 'Synthetic original receipt', description: '' },
                { languageCode: LanguageCode.zh_Hans, name: '合成原始收款凭证', description: '本地隔离验证' },
            ],
            handler: { code: originalReceiptHandler.code, arguments: [] },
        });
        const location = await server.app
            .get(StockLocationService)
            .create(adminCtx, { name: 'Synthetic warehouse' });
        for (const kind of ['physical', 'digital'] as const) {
            const product = await server.app.get(ProductService).create(adminCtx, {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: `Synthetic ${kind}`,
                        slug: `synthetic-${kind}`,
                        description: 'Disposable local fixture',
                    },
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: `合成${kind}商品`,
                        slug: `synthetic-${kind}`,
                        description: '本地隔离验证商品',
                    },
                ],
                customFields: { fulfillmentType: kind },
            });
            const [variant] = await server.app.get(ProductVariantService).create(adminCtx, [
                {
                    productId: product.id,
                    sku: `SYNTHETIC-${kind}`,
                    price: 1000,
                    trackInventory: kind === 'physical' ? GlobalFlag.TRUE : GlobalFlag.FALSE,
                    ...(kind === 'physical'
                        ? { stockLevels: [{ stockLocationId: location.id, stockOnHand: 10 }] }
                        : {}),
                    translations: [
                        { languageCode: LanguageCode.en, name: `Synthetic ${kind}` },
                        { languageCode: LanguageCode.zh_Hans, name: `合成${kind}规格` },
                    ],
                },
            ]);
            if (kind === 'physical') physicalId = variant.id;
            else digitalId = variant.id;
        }
        const existingConfig = await connection.getRepository(ctx, DigitalVariantConfig).findOneByOrFail({
            channelId: ctx.channelId,
            productVariantId: digitalId,
        });
        const config = await connection.getRepository(ctx, DigitalVariantConfig).save(
            new DigitalVariantConfig({
                ...existingConfig,
                channelId: ctx.channelId,
                productVariantId: digitalId,
                deliveryMode: 'manual_service',
                stockPolicy: 'limited',
                availableQuantity: 3,
                fileVersionId: null,
                migrationState: 'ACTIVE',
            }),
        );
        digitalConfigId = config.id;
        const campaign = await server.app.get(StorePromotionCampaignService).createCoupon(adminCtx, {
            name: 'Synthetic preview coupon',
            kind: 'ORDER_FIXED',
            discountAmount: 100,
            minimumSpend: 0,
            validityDays: 7,
            issueLimit: 20,
        });
        couponCampaignId = campaign.id;
    },
    isMysql ? 300000 : 120000,
);

afterAll(async () => {
    try {
        if (isMysql && connection) {
            const status = await connection.rawConnection.query('SHOW ENGINE INNODB STATUS');
            expect(
                createHash('sha256')
                    .update(mysqlDeadlockReport(String(status[0]?.Status ?? '')))
                    .digest('hex'),
                'No new InnoDB deadlock may be hidden by transaction retry',
            ).toBe(createHash('sha256').update(initialMysqlDeadlock).digest('hex'));
        }
    } finally {
        await server.destroy();
        for (const name of envNames) {
            if (previousEnv[name] == null) delete process.env[name];
            else process.env[name] = previousEnv[name];
        }
    }
});

async function checkoutFixture() {
    const stockAllocatedBefore = (
        await connection.getRepository(ctx, StockLevel).findOneByOrFail({ productVariantId: physicalId })
    ).stockAllocated;
    const availableQuantityBefore = (
        await connection.getRepository(ctx, DigitalVariantConfig).findOneByOrFail({ id: digitalConfigId })
    ).availableQuantity;
    const order = await orders.create(ctx, customer.user?.id);
    for (const variant of [physicalId, digitalId]) {
        const result = await orders.addItemToOrder(ctx, order.id, variant, 1);
        if ('errorCode' in result) throw new Error(result.message);
    }
    const coupon = await connection.withTransaction(adminCtx, tx =>
        coupons.grant(tx, couponCampaignId, customer.id),
    );
    await orders.withOrderMutationTransaction(ctx, tx => coupons.apply(tx, coupon.id));
    // Seed the already validated checkout boundary. Payment, stock, digital and coupon handlers are real.
    await connection.getRepository(ctx, Order).update(order.id, {
        state: 'ArrangingPayment',
        customFields: { deliveryEmail: 'synthetic@example.invalid' },
    });
    const checkout = await connection.getEntityOrThrow(ctx, Order, order.id, {
        relations: ['lines', 'lines.productVariant', 'payments'],
    });
    const physical = checkout.lines.find(line => String(line.productVariantId) === String(physicalId));
    const digital = checkout.lines.find(line => String(line.productVariantId) === String(digitalId));
    if (!physical || !digital) throw new Error('Synthetic checkout lines missing');
    await orders.withOrderMutationTransaction(ctx, tx => resources.reserve(tx, checkout, [physical]));
    expect(
        (await connection.getRepository(ctx, CheckoutResourceHold).findOneByOrFail({ orderId: order.id }))
            .state,
    ).toBe('HELD');
    expect(
        (await connection.getRepository(ctx, DigitalVariantConfig).findOneByOrFail({ id: digitalConfigId }))
            .availableQuantity,
    ).toBe(availableQuantityBefore - 1);
    expect(await resources.outstandingAllocation(ctx, physical.id)).toBe(1);
    return { order: checkout, physical, digital, coupon, availableQuantityBefore, stockAllocatedBefore };
}

async function pendingCartFor(order: Order) {
    const repository = connection.getRepository(ctx, StorefrontCart);
    const existing = await repository.findOne({
        where: { channelId: ctx.channelId, ownerType: 'CUSTOMER', ownerId: customer.id },
    });
    return repository.save(
        new StorefrontCart({
            ...existing,
            channelId: ctx.channelId,
            ownerType: 'CUSTOMER',
            ownerId: customer.id,
            checkoutOrderId: order.id,
            state: 'PAYMENT_PENDING',
            initialized: true,
            lastActivityAt: new Date(),
            revision: 1,
            projectedRevision: 1,
        }),
    );
}

function barrier() {
    let release!: () => void;
    const promise = new Promise<void>(resolveBarrier => {
        release = resolveBarrier;
    });
    return { promise, release };
}

async function authorizedReceiptFixture() {
    const fixture = await checkoutFixture();
    await pendingCartFor(fixture.order);
    const payment = await connection.getRepository(ctx, Payment).save(
        new Payment({
            order: fixture.order,
            method: originalReceiptHandler.code,
            amount: fixture.order.totalWithTax,
            state: 'Authorized',
            transactionId: `synthetic-authorized-${randomUUID()}`,
            metadata: {},
        }),
    );
    await connection.getRepository(ctx, Order).update(fixture.order.id, {
        state: 'PaymentAuthorized',
        active: false,
        orderPlacedAt: new Date(),
    });
    await orders.withOrderMutationTransaction(adminCtx, tx => resources.confirm(tx, fixture.order));
    return { ...fixture, payment };
}

async function adminPaymentMutation(
    operation: 'settlePayment' | 'cancelPayment' | 'transitionPaymentToState',
    id: string | number,
) {
    // Exercise the native sensitive-action password confirmation with the isolated test account.
    adminClient.setRequestHeader(
        'x-vendure-sensitive-action-password',
        server.app.get(ConfigService).authOptions.superadminCredentials.password,
    );
    const query =
        operation === 'transitionPaymentToState'
            ? gql`
                  mutation OriginalReceipt($id: ID!) {
                      transitionPaymentToState(id: $id, state: "Settled") {
                          __typename
                          ... on Payment {
                              id
                              state
                          }
                          ... on PaymentStateTransitionError {
                              fromState
                              toState
                              transitionError
                          }
                      }
                  }
              `
            : operation === 'settlePayment'
              ? gql`
                    mutation OriginalReceipt($id: ID!) {
                        settlePayment(id: $id) {
                            __typename
                            ... on Payment {
                                id
                                state
                            }
                            ... on PaymentStateTransitionError {
                                fromState
                                toState
                                transitionError
                            }
                            ... on SettlePaymentError {
                                paymentErrorMessage
                            }
                        }
                    }
                `
              : gql`
                    mutation OriginalReceipt($id: ID!) {
                        cancelPayment(id: $id) {
                            __typename
                            ... on Payment {
                                id
                                state
                            }
                            ... on PaymentStateTransitionError {
                                fromState
                                toState
                                transitionError
                            }
                            ... on CancelPaymentError {
                                paymentErrorMessage
                            }
                        }
                    }
                `;
    try {
        return (
            await adminClient.query<Record<string, { state?: string; __typename: string }>>(query, { id })
        )[operation];
    } finally {
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
    }
}

it.runIf(isMysql)(
    'serializes real Admin Authorized settlement against cancellation before receipt handlers',
    async () => {
        const fixture = await authorizedReceiptFixture();
        const before = { ...receiptCalls };
        receiptGate = { entered: barrier(), proceed: barrier() };
        let settling: Promise<unknown> | undefined;
        let cancelling: Promise<unknown> | undefined;
        try {
            settling = adminPaymentMutation('settlePayment', fixture.payment.id);
            await Promise.race([
                receiptGate.entered.promise,
                settling.then(() => {
                    throw new Error('Settlement finished without entering the isolated receipt handler');
                }),
            ]);
            cancelling = adminPaymentMutation('cancelPayment', fixture.payment.id);
            // Register rejection immediately: the losing cancellation must reject settled funds.
            const cancelledResult = cancelling.then(
                value => ({ value }),
                error => ({ error }),
            );
            expect(await waitForMysqlLockWaiters(1)).toBeGreaterThanOrEqual(1);
            expect(receiptCalls.cancel).toBe(before.cancel);
            receiptGate.proceed.release();
            expect(await settling).toMatchObject({ state: 'Settled' });
            expect(await cancelledResult).toHaveProperty('error');
            expect(receiptCalls).toEqual({ settle: before.settle + 1, cancel: before.cancel });
            expect(
                await connection.getRepository(ctx, Payment).findOneByOrFail({ id: fixture.payment.id }),
            ).toMatchObject({ state: 'Settled' });
            expect(
                await connection
                    .getRepository(ctx, CustomerCoupon)
                    .findOneByOrFail({ id: fixture.coupon.id }),
            ).toMatchObject({ status: 'USED' });
            expect(
                await connection
                    .getRepository(ctx, CheckoutResourceHold)
                    .findOneByOrFail({ orderId: fixture.order.id }),
            ).toMatchObject({ state: 'CONFIRMED' });
            writeFileSync(
                resolve(artifactsDirectory, 'admin-payment-settle-cancel.json'),
                JSON.stringify(
                    {
                        genuineAdminGraphql: true,
                        authorizedReceiptSeeded: true,
                        externalFunds: false,
                        winner: 'Settled',
                        rejectedCancellationBeforeHandler: true,
                        handlerCalls: { settle: 1, cancel: 0 },
                    },
                    null,
                    2,
                ),
            );
        } finally {
            receiptGate?.proceed.release();
            await Promise.allSettled([settling, cancelling].filter(Boolean) as Array<Promise<unknown>>);
            receiptGate = undefined;
        }
    },
    30000,
);

it.runIf(isMysql)(
    'serializes real Admin repeated settle and payment transition after a fresh locked receipt',
    async () => {
        const fixture = await authorizedReceiptFixture();
        const before = { ...receiptCalls };
        receiptGate = { entered: barrier(), proceed: barrier() };
        let settling: Promise<unknown> | undefined;
        let duplicate: Promise<unknown> | undefined;
        try {
            settling = adminPaymentMutation('settlePayment', fixture.payment.id);
            await Promise.race([
                receiptGate.entered.promise,
                settling.then(() => {
                    throw new Error('Settlement finished without entering the isolated receipt handler');
                }),
            ]);
            duplicate = adminPaymentMutation('transitionPaymentToState', fixture.payment.id);
            expect(await waitForMysqlLockWaiters(1)).toBeGreaterThanOrEqual(1);
            expect(receiptCalls.settle).toBe(before.settle + 1);
            receiptGate.proceed.release();
            expect(await settling).toMatchObject({ state: 'Settled' });
            expect(await duplicate).toMatchObject({ state: 'Settled' });
            expect(receiptCalls).toEqual({ settle: before.settle + 1, cancel: before.cancel });
            expect(
                await connection
                    .getRepository(ctx, Payment)
                    .count({ where: { order: { id: fixture.order.id } } }),
            ).toBe(1);
            expect(
                await connection
                    .getRepository(ctx, CouponLedgerEntry)
                    .count({ where: { customerCouponId: fixture.coupon.id, eventType: 'REDEEMED' } }),
            ).toBe(1);
            writeFileSync(
                resolve(artifactsDirectory, 'admin-payment-duplicate-settle.json'),
                JSON.stringify(
                    {
                        genuineAdminGraphql: true,
                        authorizedReceiptSeeded: true,
                        externalFunds: false,
                        finalState: 'Settled',
                        handlerCalls: { settle: 1, cancel: 0 },
                        paymentCount: 1,
                        redeemedLedgerCount: 1,
                    },
                    null,
                    2,
                ),
            );
        } finally {
            receiptGate?.proceed.release();
            await Promise.allSettled([settling, duplicate].filter(Boolean) as Array<Promise<unknown>>);
            receiptGate = undefined;
        }
    },
    30000,
);

async function waitForMysqlLockWaiters(count: number) {
    let observed = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
        const result = await connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits',
        );
        observed = Number(result[0].count);
        if (observed >= count) return observed;
        await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    throw new Error(`Expected ${count} real InnoDB waiters, observed ${observed}`);
}

async function assertReleased(fixture: Awaited<ReturnType<typeof checkoutFixture>>) {
    const { order, physical, digital, coupon } = fixture;
    expect(
        (await connection.getRepository(ctx, CheckoutResourceHold).findOneByOrFail({ orderId: order.id }))
            .state,
    ).toBe('RELEASED');
    expect(await resources.outstandingAllocation(ctx, physical.id)).toBe(0);
    expect(
        await connection.getRepository(ctx, Allocation).count({ where: { orderLine: { id: physical.id } } }),
    ).toBe(1);
    expect(
        await connection.getRepository(ctx, Release).count({ where: { orderLine: { id: physical.id } } }),
    ).toBe(1);
    expect(
        await connection.getRepository(ctx, Sale).count({ where: { orderLine: { id: physical.id } } }),
    ).toBe(0);
    expect(
        (await connection.getRepository(ctx, StockLevel).findOneByOrFail({ productVariantId: physicalId }))
            .stockAllocated,
    ).toBe(fixture.stockAllocatedBefore);
    expect(
        await connection
            .getRepository(ctx, DigitalOrderReservation)
            .findOneByOrFail({ orderLineId: digital.id }),
    ).toMatchObject({ state: 'RELEASED', consumedQuantity: 0, releasedQuantity: 1 });
    expect(
        (await connection.getRepository(ctx, DigitalVariantConfig).findOneByOrFail({ id: digitalConfigId }))
            .availableQuantity,
    ).toBe(fixture.availableQuantityBefore);
    expect(
        await connection.getRepository(ctx, FulfillmentLine).count({ where: { orderLineId: digital.id } }),
    ).toBe(0);
    expect(
        await connection.getRepository(ctx, ManualDigitalDelivery).count({ where: { orderId: order.id } }),
    ).toBe(0);
    expect(
        await connection.getRepository(ctx, CustomerCoupon).findOneByOrFail({ id: coupon.id }),
    ).toMatchObject({ status: 'AVAILABLE', usedAt: null, lockedOrderId: null });
    expect(
        await connection
            .getRepository(ctx, CouponOrderAllocation)
            .findOneByOrFail({ customerCouponId: coupon.id, orderId: order.id }),
    ).toMatchObject({ status: 'RELEASED', usedAt: null });
    expect(
        await connection
            .getRepository(ctx, CouponLedgerEntry)
            .count({ where: { customerCouponId: coupon.id, eventType: 'REDEEMED' } }),
    ).toBe(0);
}

it('runs native controlled payment and blocking handlers, then keeps repeated completion idempotent', async () => {
    const fixture = await checkoutFixture();
    const result = await orders.withOrderMutationTransaction(ctx, tx =>
        orders.addPaymentToOrder(tx, fixture.order.id, {
            method: 'controlled-test-payment-platform',
            metadata: {},
        }),
    );
    expect(result).toMatchObject({ state: 'PaymentSettled', active: false });
    expect(
        await connection.getRepository(ctx, Payment).findOneByOrFail({ order: { id: fixture.order.id } }),
    ).toMatchObject({ state: 'Settled', metadata: { public: { testPayment: true } } });
    await assertReleased(fixture);
    await orders.withOrderMutationTransaction(ctx, async tx => {
        await resources.confirm(tx, fixture.order);
        await server.app
            .get(EventBus)
            .publish(new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', tx, fixture.order));
    });
    const duplicate = await orders.withOrderMutationTransaction(ctx, tx =>
        orders.addPaymentToOrder(tx, fixture.order.id, {
            method: 'controlled-test-payment-platform',
            metadata: {},
        }),
    );
    expect(duplicate).toHaveProperty('errorCode');
    expect(
        await connection.getRepository(ctx, Payment).count({ where: { order: { id: fixture.order.id } } }),
    ).toBe(1);
    await assertReleased(fixture);
}, 30000);

async function cancelThroughAdminApi(orderId: string | number) {
    return (
        await adminClient.query(
            gql`
                mutation PreviewCancel($id: ID!) {
                    transitionOrderToState(id: $id, state: "Cancelled") {
                        __typename
                        ... on Order {
                            id
                            state
                        }
                        ... on OrderStateTransitionError {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { id: orderId },
        )
    ).transitionOrderToState;
}

it('releases an unpaid cancellation through the real Admin GraphQL transition and coupon handler', async () => {
    const fixture = await checkoutFixture();
    const transaction = connection.withTransaction.bind(connection);
    const transactionEntries: Array<{ active: boolean | undefined; isolation: unknown }> = [];
    const nativeTransactions = vi.spyOn(connection, 'withTransaction').mockImplementation(((
        ...args: any[]
    ) => {
        transactionEntries.push({
            active: connection.getRepository(args[0], Order).manager.queryRunner?.isTransactionActive,
            isolation: args[2],
        });
        return (transaction as (...args: any[]) => Promise<any>)(...args);
    }) as typeof connection.withTransaction);
    try {
        const cancelled = await cancelThroughAdminApi(fixture.order.id);
        expect(cancelled).toMatchObject({ __typename: 'Order', state: 'Cancelled' });
        if (isMysql) {
            expect(transactionEntries[0].active).not.toBe(true);
            expect(transactionEntries[0].isolation).toBe('READ COMMITTED');
            writeFileSync(
                resolve(artifactsDirectory, 'admin-graphql-transition-validation.json'),
                JSON.stringify(
                    {
                        endpoint: 'isolated localhost Admin GraphQL',
                        mutation: 'transitionOrderToState',
                        finalState: cancelled.state,
                        entryTransaction: transactionEntries[0],
                        syntheticOnly: true,
                    },
                    null,
                    2,
                ),
            );
        }
    } finally {
        nativeTransactions.mockRestore();
    }
    await assertReleased(fixture);
}, 30000);

it('automatically expires a definitely unpaid hold and coupon without manually reopening checkout', async () => {
    const fixture = await checkoutFixture();
    await pendingCartFor(fixture.order);
    await connection
        .getRepository(ctx, CheckoutResourceHold)
        .update({ orderId: fixture.order.id }, { expiresAt: new Date(Date.now() - 60_000) });
    expect(await resources.reconcileExpired()).toMatchObject({ released: 1 });
    expect(
        (
            await connection
                .getRepository(ctx, CheckoutResourceHold)
                .findOneByOrFail({ orderId: fixture.order.id })
        ).state,
    ).toBe('RELEASED');
    expect(await resources.outstandingAllocation(ctx, fixture.physical.id)).toBe(0);
    expect(
        (await connection.getRepository(ctx, DigitalVariantConfig).findOneByOrFail({ id: digitalConfigId }))
            .availableQuantity,
    ).toBe(fixture.availableQuantityBefore);
    expect(
        await connection.getRepository(ctx, Payment).count({ where: { order: { id: fixture.order.id } } }),
    ).toBe(0);
    await connection
        .getRepository(ctx, CustomerCoupon)
        .update(fixture.coupon.id, { lockExpiresAt: new Date(Date.now() - 60_000) });
    expect(await coupons.reconcile()).toMatchObject({ released: 1 });
    expect(await coupons.reconcile()).toMatchObject({ released: 0 });
    expect((await connection.getRepository(ctx, Order).findOneByOrFail({ id: fixture.order.id })).state).toBe(
        'ArrangingPayment',
    );
    expect(
        (
            await connection
                .getRepository(ctx, StorefrontCart)
                .findOneByOrFail({ checkoutOrderId: fixture.order.id })
        ).state,
    ).toBe('PAYMENT_PENDING');
    await assertReleased(fixture);
    const lateReceipt = new Payment({
        method: 'synthetic-trusted-server-receipt',
        amount: fixture.order.totalWithTax,
        state: 'Settled',
        transactionId: `synthetic-late-${fixture.order.id}`,
        metadata: {},
    });
    const lateConfirmation = await connection.withTransaction(ctx, txCtx =>
        (coupons as any).validateConfirmedPayment(txCtx, fixture.order.id, lateReceipt, 'Settled', 'handler'),
    );
    expect(lateConfirmation).toContain('已收款订单需人工核对');
    expect(lateReceipt.metadata).not.toHaveProperty('couponPaymentValidation');
    await assertReleased(fixture);
}, 30000);

it.runIf(isMysql)(
    'serializes native payment against coupon maintenance with actual InnoDB cart and order locks',
    async () => {
        const fixture = await checkoutFixture();
        await pendingCartFor(fixture.order);
        await connection.getRepository(ctx, CustomerCoupon).update(fixture.coupon.id, {
            lockExpiresAt: new Date(Date.now() - 60_000),
        });
        const orderLocked = barrier();
        const resumePayment = barrier();
        const lockOrder = orders.lockOrderForRefund.bind(orders);
        let paymentContext: RequestContext;
        let pause = true;
        const instrument = vi.spyOn(orders, 'lockOrderForRefund').mockImplementation(async (tx, id) => {
            await lockOrder(tx, id);
            if (tx === paymentContext && pause) {
                pause = false;
                orderLocked.release();
                await resumePayment.promise;
            }
        });
        let payment: Promise<unknown> | undefined;
        let maintenance: Promise<unknown> | undefined;
        try {
            payment = orders.withOrderMutationTransaction(ctx, tx => {
                paymentContext = tx;
                return orders.addPaymentToOrder(tx, fixture.order.id, {
                    method: 'controlled-test-payment-platform',
                    metadata: {},
                });
            });
            await orderLocked.promise;
            maintenance = coupons.reconcile();
            expect(await waitForMysqlLockWaiters(1)).toBeGreaterThanOrEqual(1);
            resumePayment.release();
            const results = await Promise.allSettled([payment, maintenance]);
            const failure = results.find(result => result.status === 'rejected');
            const failureCode =
                failure?.status === 'rejected'
                    ? (failure.reason?.driverError?.code ?? failure.reason?.code ?? failure.reason?.message)
                    : 'none';
            expect(
                results.map(result => result.status),
                `Native MySQL lock failure: ${failureCode}`,
            ).toEqual(['fulfilled', 'fulfilled']);
            expect(results[0]).toMatchObject({ status: 'fulfilled', value: { state: 'PaymentSettled' } });
            await assertReleased(fixture);
        } finally {
            resumePayment.release();
            await Promise.allSettled([payment, maintenance].filter(Boolean) as Array<Promise<unknown>>);
            instrument.mockRestore();
        }
    },
    30000,
);

it.runIf(isMysql)(
    'serializes duplicate native payment and repeated settlement without double resource or coupon release',
    async () => {
        const fixture = await checkoutFixture();
        await pendingCartFor(fixture.order);
        const results = await Promise.all([
            orders.withOrderMutationTransaction(ctx, tx =>
                orders.addPaymentToOrder(tx, fixture.order.id, {
                    method: 'controlled-test-payment-platform',
                    metadata: {},
                }),
            ),
            orders.withOrderMutationTransaction(ctx, tx =>
                orders.addPaymentToOrder(tx, fixture.order.id, {
                    method: 'controlled-test-payment-platform',
                    metadata: {},
                }),
            ),
        ]);
        expect(results.filter(result => 'state' in result && result.state === 'PaymentSettled')).toHaveLength(
            1,
        );
        expect(results.filter(result => 'errorCode' in result)).toHaveLength(1);
        await Promise.all(
            [0, 1].map(() =>
                orders.withOrderMutationTransaction(ctx, async tx => {
                    await resources.confirm(tx, fixture.order);
                    await server.app
                        .get(EventBus)
                        .publish(
                            new OrderStateTransitionEvent(
                                'ArrangingPayment',
                                'PaymentSettled',
                                tx,
                                fixture.order,
                            ),
                        );
                }),
            ),
        );
        expect(
            await connection
                .getRepository(ctx, Payment)
                .count({ where: { order: { id: fixture.order.id } } }),
        ).toBe(1);
        expect(
            await connection
                .getRepository(ctx, CouponLedgerEntry)
                .count({ where: { customerCouponId: fixture.coupon.id, eventType: 'RELEASED' } }),
        ).toBe(1);
        await assertReleased(fixture);
    },
    30000,
);

it.runIf(isMysql)(
    'keeps native cancellation and expiry maintenance idempotent when their transactions compete',
    async () => {
        const fixture = await checkoutFixture();
        await connection
            .getRepository(ctx, CheckoutResourceHold)
            .update({ orderId: fixture.order.id }, { expiresAt: new Date(Date.now() - 60000) });
        await connection
            .getRepository(ctx, CustomerCoupon)
            .update(fixture.coupon.id, { lockExpiresAt: new Date(Date.now() - 60000) });
        const results = await Promise.all([
            cancelThroughAdminApi(fixture.order.id),
            resources.reconcileExpired(),
            coupons.reconcile(),
        ]);
        expect(results[0]).toMatchObject({ state: 'Cancelled' });
        expect(
            await connection
                .getRepository(ctx, CouponLedgerEntry)
                .count({ where: { customerCouponId: fixture.coupon.id, eventType: 'RELEASED' } }),
        ).toBe(1);
        await assertReleased(fixture);
    },
    30000,
);

it.runIf(isMysql).each(['Created', 'Settled'] as const)(
    'retains inventory and coupon when a late %s receipt commits ahead of competing expiry transactions',
    async state => {
        const fixture = await checkoutFixture();
        await pendingCartFor(fixture.order);
        await connection
            .getRepository(ctx, CheckoutResourceHold)
            .update({ orderId: fixture.order.id }, { expiresAt: new Date(Date.now() - 60000) });
        await connection
            .getRepository(ctx, CustomerCoupon)
            .update(fixture.coupon.id, { lockExpiresAt: new Date(Date.now() - 60000) });
        const locked = barrier();
        const commitReceipt = barrier();
        const receipt = new Payment({
            order: fixture.order,
            method: 'synthetic-existing-real-receipt',
            amount: fixture.order.totalWithTax,
            state,
            metadata: {},
            transactionId: `synthetic-existing-${state}-${fixture.order.id}`,
        });
        let receiptTransaction: Promise<unknown> | undefined;
        let expiry: Promise<unknown> | undefined;
        let maintenance: Promise<unknown> | undefined;
        try {
            receiptTransaction = orders.withOrderMutationTransaction(ctx, async tx => {
                await server.app.get(StorefrontCartService).lockForOrder(tx, fixture.order.id);
                await orders.lockOrderForRefund(tx, fixture.order.id);
                locked.release();
                await commitReceipt.promise;
                if (state === 'Settled') {
                    expect(
                        await (coupons as any).validateConfirmedPayment(
                            tx,
                            fixture.order.id,
                            receipt,
                            state,
                            'handler',
                        ),
                    ).toBeUndefined();
                    expect(receipt.metadata).toHaveProperty('couponPaymentValidation');
                }
                await connection.getRepository(tx, Payment).save(receipt);
            });
            await locked.promise;
            expiry = resources.reconcileExpired();
            maintenance = coupons.reconcile();
            expect(await waitForMysqlLockWaiters(2)).toBeGreaterThanOrEqual(2);
            commitReceipt.release();
            const results = await Promise.all([receiptTransaction, expiry, maintenance]);
            expect(results[1]).toMatchObject({ released: 0 });
            expect(results[2]).toMatchObject({ released: 0 });
            expect(await resources.outstandingAllocation(ctx, fixture.physical.id)).toBe(1);
            expect(
                await connection
                    .getRepository(ctx, Release)
                    .count({ where: { orderLine: { id: fixture.physical.id } } }),
            ).toBe(0);
            expect(
                await connection
                    .getRepository(ctx, CheckoutResourceHold)
                    .findOneByOrFail({ orderId: fixture.order.id }),
            ).toMatchObject({ state: state === 'Settled' ? 'CONFIRMED' : 'HELD' });
            expect(
                await connection
                    .getRepository(ctx, CustomerCoupon)
                    .findOneByOrFail({ id: fixture.coupon.id }),
            ).toMatchObject({ status: 'LOCKED', usedAt: null, lockedOrderId: fixture.order.id });
            expect(
                await connection
                    .getRepository(ctx, DigitalOrderReservation)
                    .findOneByOrFail({ orderLineId: fixture.digital.id }),
            ).toMatchObject({ state: 'HELD', consumedQuantity: 0, releasedQuantity: 0 });
            expect(
                await connection
                    .getRepository(ctx, ManualDigitalDelivery)
                    .count({ where: { orderId: fixture.order.id } }),
            ).toBe(0);
        } finally {
            commitReceipt.release();
            await Promise.allSettled(
                [receiptTransaction, expiry, maintenance].filter(Boolean) as Array<Promise<unknown>>,
            );
        }
    },
    30000,
);
