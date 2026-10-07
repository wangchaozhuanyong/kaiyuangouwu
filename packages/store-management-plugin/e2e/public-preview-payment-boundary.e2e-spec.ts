import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    CurrencyCode,
    Customer,
    defaultOrderProcess,
    defaultPaymentProcess,
    LanguageCode,
    mergeConfig,
    Order,
    OrderService,
    Payment,
    PaymentMethodHandler,
    PaymentMethodService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontActivationService, StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { createControlledTestPayment } from '../../commerce-fulfillment-plugin/src/controlled-test-payment';
import { StoreProfile } from '../src/entities/store-profile.entity';

// An isolated SQLJS database and local Nest server; all customers, domains and payments are synthetic.
const controlled = createControlledTestPayment(true);
let realHandlerCalls = 0;
const syntheticRealHandler = new PaymentMethodHandler({
    code: 'synthetic-real-handler',
    description: [{ languageCode: LanguageCode.en, value: 'Synthetic real-payment boundary fixture' }],
    args: {},
    createPayment: (_ctx, _order, amount) => {
        realHandlerCalls++;
        return { amount, state: 'Settled', transactionId: `synthetic-${randomUUID()}`, metadata: {} };
    },
    settlePayment: () => ({ success: true }),
});
const artifactsDirectory = resolve(__dirname, '../artifacts/public-preview-payment-boundary', randomUUID());
const { server, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
        apiOptions: { port: 37486, hostname: '127.0.0.1' },
        authOptions: { requireVerification: false },
        paymentOptions: {
            paymentMethodHandlers: [controlled.handler, syntheticRealHandler],
            paymentMethodEligibilityCheckers: [controlled.checker],
            process: [defaultPaymentProcess, controlled.paymentProcess],
        },
        orderOptions: { process: [defaultOrderProcess, controlled.orderProcess] },
        plugins: [
            OperationsDashboardPlugin,
            CatalogManagementPlugin,
            StoreDomainPlugin,
            StorefrontCartPlugin,
            ContentTranslationPlugin.init({
                provider: {
                    name: 'synthetic-no-network',
                    isConfigured: () => false,
                    translate: () => {
                        throw new Error('No external providers in the preview test');
                    },
                },
            }),
            StoreManagementPlugin.init({
                enabled: false,
                signingSecret: 'synthetic-preview-signing-secret-at-least-32-characters',
            }),
        ],
    }),
);
let connection: TransactionalConnection;
let ctx: RequestContext;
let orders: OrderService;
let methods: PaymentMethodService;
let profile: StoreProfile;
let customer: Customer;
let testMethodId: string | number;

function stage(name: string): void {
    appendFileSync(
        resolve(artifactsDirectory, 'stages.jsonl'),
        `${JSON.stringify({ stage: name, at: new Date().toISOString() })}\n`,
    );
}

beforeAll(async () => {
    mkdirSync(artifactsDirectory, { recursive: true });
    stage('beforeAll');
    const initializer = new SqljsInitializer(artifactsDirectory);
    const populate = initializer.populate.bind(initializer);
    initializer.populate = async populateFn => {
        stage('populate:start');
        await populate(populateFn);
        stage('populate:done');
    };
    registerInitializer('sqljs', initializer);
    stage('server:init:start');
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [] },
        customerCount: 1,
    });
    stage('server:init:done');
    connection = server.app.get(TransactionalConnection);
    orders = server.app.get(OrderService);
    methods = server.app.get(PaymentMethodService);
    const contexts = server.app.get(RequestContextService);
    const platformCtx = await contexts.create({ apiType: 'admin' });
    const channel = await server.app.get(ChannelService).create(platformCtx, {
        code: 'synthetic-preview-store',
        token: 'synthetic-preview-store',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: false,
        defaultTaxZoneId: platformCtx.channel.defaultTaxZone?.id ?? '',
        defaultShippingZoneId: platformCtx.channel.defaultShippingZone?.id ?? '',
    });
    if (!('id' in channel)) throw new Error(channel.message);
    stage('channel:created');
    ctx = await contexts.create({ apiType: 'shop', channelOrToken: channel.token });
    customer = await connection.getRepository(platformCtx, Customer).findOneOrFail({ where: {} });
    await server.app
        .get(ChannelService)
        .assignToChannels(platformCtx, Customer, customer.id, [ctx.channelId]);
    profile = await connection.getRepository<StoreProfile>(ctx, 'StoreProfile').save({
        channelId: ctx.channelId,
        status: 'DRAFT',
        isPublished: true,
        descriptionZh: 'synthetic',
        descriptionEn: 'synthetic',
        sortOrder: 0,
    });
    await connection.getRepository(ctx, StoreDomain).save(
        new StoreDomain({
            channelId: ctx.channelId,
            domain: 'synthetic-preview.example.invalid',
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: ctx.channelId,
            verificationToken: randomUUID(),
            verifiedAt: new Date(),
        }),
    );
    const testMethod = await methods.create(platformCtx, {
        code: 'controlled-test-payment-platform',
        enabled: true,
        translations: [
            { languageCode: LanguageCode.en, name: 'Synthetic controlled test', description: '' },
            { languageCode: LanguageCode.zh_Hans, name: '合成模拟付款', description: '本地隔离测试' },
        ],
        checker: { code: controlled.checker.code, arguments: [] },
        handler: {
            code: controlled.handler.code,
            arguments: [
                { name: 'channelId', value: `T_${platformCtx.channelId}` },
                { name: 'allowAllOrders', value: 'true' },
            ],
        },
    });
    const liveMethod = await methods.create(platformCtx, {
        code: 'synthetic-real',
        enabled: true,
        translations: [
            { languageCode: LanguageCode.en, name: 'Synthetic real', description: '' },
            { languageCode: LanguageCode.zh_Hans, name: '合成真实入口', description: '本地隔离测试' },
        ],
        handler: { code: syntheticRealHandler.code, arguments: [] },
    });
    testMethodId = testMethod.id;
    for (const method of [testMethod, liveMethod]) {
        await connection.getRepository(ctx, 'StorePaymentMethodState').save({
            channelId: ctx.channelId,
            paymentMethodId: method.id,
            enabled: true,
        });
    }
    stage('fixture:ready');
    shopClient.setChannelToken(channel.token);
    await shopClient.asAnonymousUser();
}, 120000);

afterAll(async () => {
    await server.destroy();
});

async function newOrder(): Promise<Order> {
    return connection.getRepository(ctx, Order).save(
        new Order({
            code: `SYNTHETIC-PREVIEW-${randomUUID()}`,
            salesChannelId: ctx.channelId,
            channels: [ctx.channel],
            customer,
            active: true,
            state: 'ArrangingPayment',
            currencyCode: CurrencyCode.GBP,
            couponCodes: [],
            shippingAddress: {},
            billingAddress: {},
            subTotal: 100,
            subTotalWithTax: 100,
            shipping: 0,
            shippingWithTax: 0,
        }),
    );
}
async function pay(order: Order, method: string) {
    return orders.withOrderMutationTransaction(ctx, txCtx =>
        orders.addPaymentToOrder(txCtx, order.id, { method, metadata: {} }),
    );
}

it('registers real plugin DI, exposes only configured tests in PREVIEW, closes both GraphQL and new payments, then restores LIVE', async () => {
    stage('assertions:start');
    const policy = server.app.get(StorefrontActivationService);
    expect(await policy.getAccessMode(ctx)).toBe('PREVIEW');
    const previewOrder = await newOrder();
    const quotes = await orders.getEligiblePaymentMethods(ctx, previewOrder.id);
    expect(quotes).toEqual([
        expect.objectContaining({ code: 'controlled-test-payment-platform', isEligible: true }),
    ]);
    await connection
        .getRepository(ctx, 'StorePaymentMethodState')
        .update({ channelId: ctx.channelId, paymentMethodId: testMethodId }, { enabled: false });
    expect(await orders.getEligiblePaymentMethods(ctx, previewOrder.id)).toEqual([]);
    expect(await pay(previewOrder, 'synthetic-real')).toMatchObject({ __typename: 'PaymentFailedError' });
    expect(realHandlerCalls).toBe(0);
    await connection
        .getRepository(ctx, 'StorePaymentMethodState')
        .update({ channelId: ctx.channelId, paymentMethodId: testMethodId }, { enabled: true });
    expect(await pay(previewOrder, 'controlled-test-payment-platform')).toMatchObject({
        state: 'PaymentSettled',
    });
    expect(
        await connection.getRepository(ctx, Payment).findOneByOrFail({ order: { id: previewOrder.id } }),
    ).toMatchObject({
        method: 'controlled-test-payment-platform',
        metadata: { public: { testPayment: true } },
        state: 'Settled',
    });
    const closedOrder = await newOrder();
    await connection
        .getRepository<StoreProfile>(ctx, 'StoreProfile')
        .update(profile.id, { isPublished: false });
    expect(await policy.getAccessMode(ctx)).toBe('CLOSED');
    expect(await orders.getEligiblePaymentMethods(ctx, closedOrder.id)).toEqual([]);
    expect(await pay(closedOrder, 'synthetic-real')).toMatchObject({ __typename: 'PaymentFailedError' });
    await expect(
        shopClient.query(gql`
            query {
                products(options: { take: 1 }) {
                    totalItems
                }
            }
        `),
    ).rejects.toMatchObject({
        response: {
            errors: [
                expect.objectContaining({
                    extensions: expect.objectContaining({ code: 'STOREFRONT_CLOSED' }),
                }),
            ],
        },
    });
    expect(realHandlerCalls).toBe(0);
    await connection
        .getRepository<StoreProfile>(ctx, 'StoreProfile')
        .update(profile.id, { status: 'ACTIVE' });
    expect(await policy.getAccessMode(ctx)).toBe('LIVE');
    const liveOrder = await newOrder();
    expect((await orders.getEligiblePaymentMethods(ctx, liveOrder.id)).map(q => q.code)).toContain(
        'synthetic-real',
    );
    expect(await pay(liveOrder, 'synthetic-real')).toMatchObject({ state: 'PaymentSettled' });
    expect(realHandlerCalls).toBe(1);
    await expect(
        policy.assertNewRealPaymentAllowed(ctx, ctx.channelId, {
            payments: await connection
                .getRepository(ctx, Payment)
                .find({ where: { order: { id: previewOrder.id } } }),
        }),
    ).rejects.toThrow('模拟付款订单');
}, 30000);
