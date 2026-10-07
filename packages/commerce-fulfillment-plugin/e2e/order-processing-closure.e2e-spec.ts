import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CurrencyCode, GlobalFlag, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    DefaultLogger,
    Fulfillment,
    FulfillmentService,
    LogLevel,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    Payment,
    PaymentMethod,
    PaymentMethodHandler,
    PaymentMethodService,
    ProductService,
    ProductVariantService,
    Refund,
    RequestContext,
    RequestContextService,
    Role,
    StockLocationService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { CommerceModeService } from '../src/commerce-mode.service';

import { closureDatabase } from './order-closure-db';
// Only an owned local test database. No SMTP or external payment provider is registered.
// Fresh synthetic schema on each run: cached pre-migration test seeds cannot validate new entities.
const database = closureDatabase(
    path.resolve(__dirname, '../../../reports/order-closure-e2e/sqljs-' + randomUUID()),
);
let refundCalls = 0;
function localHandler(
    code: string,
    pending = false,
    manualScoped = false,
    nextRefundState?: () => 'Pending' | 'Settled' | 'Failed',
) {
    return new PaymentMethodHandler({
        code,
        description: [{ languageCode: LanguageCode.en, value: 'Synthetic local order closure fixture' }],
        args: {},
        refundSettlementMode: manualScoped ? 'manual' : 'automatic',
        createPayment: (_ctx, order, amount) => ({
            amount,
            state: 'Settled',
            transactionId: 'local-payment-' + order.code,
            metadata: {},
        }),
        settlePayment: () => ({ success: true }),
        cancelPayment: () => ({ success: true }),
        ...(manualScoped
            ? {}
            : {
                  createRefund: () => {
                      refundCalls++;
                      const state = nextRefundState?.() ?? (pending ? 'Pending' : 'Settled');
                      return {
                          state,
                          transactionId: state === 'Settled' ? 'local-refund-' + refundCalls : undefined,
                          errorMessage: state === 'Failed' ? 'Synthetic local provider rejection' : undefined,
                          metadata: {},
                      };
                  },
              }),
    });
}
const automatic = localHandler('closure-local-automatic');
const pendingProvider = localHandler('closure-local-pending', true);
const manual = localHandler('closure-local-manual', false, true);
const retryStates: Array<'Failed' | 'Pending'> = ['Failed', 'Pending'];
const retryProvider = localHandler(
    'closure-local-retry',
    false,
    false,
    () => retryStates.shift() ?? 'Pending',
);
const splitRetryStates: Array<'Failed' | 'Pending'> = ['Failed', 'Pending'];
const splitRetryProvider = localHandler(
    'closure-local-split-retry',
    false,
    false,
    () => splitRetryStates.shift() ?? 'Pending',
);
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37393, hostname: '127.0.0.1' },
    dbConnectionOptions: database,
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    paymentOptions: {
        paymentMethodHandlers: [automatic, pendingProvider, manual, retryProvider, splitRetryProvider],
    },
    customFields: {
        Order: [
            { name: 'customerNote', type: 'text', nullable: true, public: true },
            { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
            { name: 'deliveryEmailContactId', type: 'string', length: 64, nullable: true, public: false },
        ],
    },
    plugins: [
        OperationsDashboardPlugin,
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        StoreDomainPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'local-no-network',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'local-no-network',
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
                rootDirectory: path.resolve(__dirname, '../../../reports/order-closure-e2e/evidence'),
                signingSecret: randomUUID(),
            },
        }),
    ],
});
const { server, adminClient } = createTestEnvironment(config);
const entityIdStrategy = config.entityOptions.entityIdStrategy;
const superadminCredentials = config.authOptions.superadminCredentials;
if (!entityIdStrategy || !superadminCredentials)
    throw new Error('Missing synthetic test identity configuration');
let connection: TransactionalConnection;
let own: RequestContext;
let foreign: RequestContext;
let customer: Customer;
let physicalId: string;
let digitalId: string;
let ownToken: string;
let foreignToken: string;
const encode = (id: string | number) => entityIdStrategy.encodeId(id);
const summaryFields = `orderId businessState kind paymentStatus fulfillmentStatus needsProcessing
    canManage canRefund refundableAmount refundedAmount pendingRefundAmount outstandingAmount
    remainingDigitalQuantity remainingPhysicalQuantity
    nextAction { code label enabled reason targetId }
    lines { orderLineId quantity requiredQuantity refundableQuantity pendingQuantity pendingDispatchQuantity status }
    paymentCapabilities { paymentId canRefund canCancel refundableAmount }`;
const orderFields = `id code state totalWithTax lines { id quantity } payments { id state amount }
    processingSummary { ${summaryFields} }`;
const readOrder = gql`query($id: ID!) { order(id: $id) { ${orderFields} } }`;
const listOrders = gql`query($options: OrderProcessingListOptions) {
    processingOrders(options: $options) { totalItems items { ${orderFields} } }
    orderProcessingCounts { pending digital physical exceptions afterSales }
}`;
const refundMutation = gql`
    mutation ($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ... on Refund {
                id
                state
                total
                transactionId
                lines {
                    orderLineId
                    quantity
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on RefundStateTransitionError {
                transitionError
                fromState
                toState
            }
        }
    }
`;
async function read(id: string | number) {
    return (await adminClient.query(readOrder, { id: encode(id) })).order;
}
async function refund(input: Record<string, unknown>) {
    return (await adminClient.query(refundMutation, { input })).refundOrder;
}
const transitionFulfillment = gql`
    mutation ($id: ID!, $state: String!) {
        transitionFulfillmentToState(id: $id, state: $state) {
            ... on Fulfillment {
                id
                state
                method
                trackingCode
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on FulfillmentStateTransitionError {
                transitionError
                fromState
                toState
            }
        }
    }
`;
const prepareShipment = gql`
    mutation ($input: PrepareFulfillmentShipmentInput!) {
        prepareFulfillmentShipment(input: $input) {
            id
            state
            method
            trackingCode
        }
    }
`;
async function createPackage(fixture: Awaited<ReturnType<typeof placed>>, quantity = 1) {
    const owner = await server.app
        .get(OrderService)
        .findOne(own, fixture.order.id, ['lines', 'lines.productVariant']);
    if (!owner) throw new Error('Expected fixture owner');
    const result = await server.app
        .get(FulfillmentService)
        .create(own, [owner], [{ orderLineId: fixture.line.id, quantity }], {
            code: 'manual-fulfillment',
            arguments: [
                { name: 'method', value: '' },
                { name: 'trackingCode', value: '' },
            ],
        });
    if ('errorCode' in result) throw new Error(result.message);
    await connection
        .getRepository(own, Order)
        .createQueryBuilder()
        .relation('fulfillments')
        .of(owner)
        .add(result);
    return result;
}
beforeAll(async () => {
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            collections: [],
            paymentMethods: [],
        },
        customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    const user = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: superadminCredentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    const platform = await contexts.create({ apiType: 'admin', user });
    await server.app.get(CommerceModeService).updateActiveMode(platform, 'HYBRID');
    for (const handler of [automatic, pendingProvider, manual, retryProvider, splitRetryProvider]) {
        await server.app.get(PaymentMethodService).create(platform, {
            code: handler.code,
            enabled: true,
            handler: { code: handler.code, arguments: [] },
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: handler.code, description: 'Local fake handler' },
            ],
        });
    }
    customer = await connection.getRepository(platform, Customer).findOneOrFail({
        where: {},
        relations: ['user', 'user.roles', 'user.roles.channels'],
    });
    const createChannel = async (code: string) => {
        const result = await server.app.get(ChannelService).create(platform, {
            code,
            token: code,
            defaultLanguageCode: LanguageCode.zh_Hans,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: true,
            defaultTaxZoneId: requireFixture(platform.channel.defaultTaxZone).id,
            defaultShippingZoneId: requireFixture(platform.channel.defaultShippingZone).id,
            customFields: { commerceMode: 'HYBRID' },
        });
        if (!('id' in result)) throw new Error(result.message);
        await connection
            .getRepository(platform, Role)
            .createQueryBuilder()
            .relation(Role, 'channels')
            .of(user.roles[0].id)
            .add(result.id);
        return contexts.create({ apiType: 'admin', user, channelOrToken: result.token });
    };
    own = await createChannel('closure-own-local');
    foreign = await createChannel('closure-foreign-local');
    for (const context of [own, foreign]) {
        await connection.getRepository(platform, StoreProfile).save(
            new StoreProfile({
                channelId: context.channelId,
                status: 'ACTIVE',
                isPublished: true,
                descriptionZh: '合成本地验收店铺',
                descriptionEn: 'Synthetic local API acceptance store',
            }),
        );
        await connection.getRepository(platform, StoreDomain).save(
            new StoreDomain({
                channelId: context.channelId,
                domain: `${context.channel.code}.example.invalid`,
                status: 'ACTIVE',
                isPrimary: true,
                primaryChannelId: context.channelId,
                verifiedAt: new Date(),
                verificationToken: randomUUID(),
            }),
        );
    }
    ownToken = own.channel.token;
    foreignToken = foreign.channel.token;
    const location = await server.app
        .get(StockLocationService)
        .create(own, { name: 'Synthetic closure warehouse' });
    const methods = await connection.getRepository(platform, PaymentMethod).find();
    for (const method of methods) {
        await server.app
            .get(ChannelService)
            .assignToChannels(platform, PaymentMethod, method.id, [own.channelId]);
    }
    const createVariant = async (kind: 'physical' | 'digital') => {
        const product = await server.app.get(ProductService).create(own, {
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: 'Synthetic ' + kind,
                    slug: 'closure-' + kind,
                    description: 'Synthetic local API verification only',
                },
            ],
            customFields: { fulfillmentType: kind },
        });
        const [variant] = await server.app.get(ProductVariantService).create(own, [
            {
                productId: product.id,
                sku: 'CLOSURE-' + kind,
                price: 1000,
                trackInventory: GlobalFlag.FALSE,
                ...(kind === 'physical'
                    ? { stockLevels: [{ stockLocationId: location.id, stockOnHand: 100 }] }
                    : {}),
                translations: [{ languageCode: LanguageCode.zh_Hans, name: 'Synthetic ' + kind }],
            },
        ]);
        return String(variant.id);
    };
    physicalId = await createVariant('physical');
    digitalId = await createVariant('digital');
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(ownToken);
    // This is the testing package's synthetic superadmin, never an operator's real password.
    adminClient.setRequestHeader('x-vendure-sensitive-action-password', superadminCredentials.password);
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());
async function placed(
    options: {
        kind?: 'physical' | 'digital';
        quantity?: number;
        state?: Order['state'];
        handler?: string;
        paymentState?: 'Settled' | 'Authorized';
        amount?: number;
        code?: string;
    } = {},
) {
    const orders = server.app.get(OrderService);
    const order = await orders.create(own, customer.user?.id);
    const quantity = options.quantity ?? 2;
    const added = await orders.addItemToOrder(
        own,
        order.id,
        options.kind === 'digital' ? digitalId : physicalId,
        quantity,
    );
    if ('errorCode' in added) throw new Error(added.message);
    const line = await connection.getRepository(own, OrderLine).findOneOrFail({
        where: { order: { id: order.id } },
        relations: ['productVariant'],
    });
    await connection.getRepository(own, OrderLine).update(line.id, {
        orderPlacedQuantity: quantity,
        customFields: {
            fulfillmentTypeSnapshot: options.kind ?? 'physical',
            ...(options.kind === 'digital' ? { digitalDeliveryModeSnapshot: 'manual_service' as const } : {}),
        },
    });
    const total = added.totalWithTax;
    await connection.getRepository(own, Order).update(order.id, {
        active: false,
        state: options.state ?? 'PaymentSettled',
        orderPlacedAt: new Date(),
        ...(options.code ? { code: options.code } : {}),
    });
    const syntheticPayment = new Payment({
        order,
        state: options.paymentState ?? 'Settled',
        amount: options.amount ?? total,
        method: options.handler ?? automatic.code,
        transactionId: 'synthetic-charge-' + order.id,
        metadata: {},
    });
    syntheticPayment.metadata = { refundBudget: { shippingWithTax: 0 } };
    const payment = await connection.getRepository(own, Payment).save(syntheticPayment);
    return { order, line, payment, total };
}
describe('local SQLjs order closure API', () => {
    it('starts real schema and DI, and serializes processing summaries over HTTP GraphQL', async () => {
        const fixture = await placed({ code: 'CLOSURE-DI-START' });
        const result = await read(fixture.order.id);
        expect(result.state).toBe('PaymentSettled');
        expect(result.processingSummary).toMatchObject({
            kind: 'PHYSICAL',
            paymentStatus: 'PAID',
            remainingPhysicalQuantity: 2,
            nextAction: { code: 'SHIP_PHYSICAL', enabled: true },
        });
        expect(connection.rawConnection.options.type).toBe(process.env.DB);
    });
    it('filters processing categories before pagination and sorts derived quantity and money', async () => {
        const first = await placed({ quantity: 1, code: 'CLOSURE-PAGE-ONE' });
        const second = await placed({ quantity: 2, code: 'CLOSURE-PAGE-TWO' });
        await placed({ quantity: 3, code: 'CLOSURE-PAGE-THREE' });
        const digital = await placed({ quantity: 1, kind: 'digital', code: 'CLOSURE-PAGE-DIGITAL' });
        const physical = await adminClient.query(listOrders, {
            options: {
                category: 'PHYSICAL',
                term: 'CLOSURE-PAGE',
                skip: 1,
                take: 1,
                sortBy: 'totalQuantity',
                sortOrder: 'ASC',
            },
        });
        expect(physical.processingOrders.totalItems).toBe(3);
        expect(physical.processingOrders.items.map((item: any) => item.id)).toEqual([
            encode(second.order.id),
        ]);
        const byMoney = await adminClient.query(listOrders, {
            options: {
                category: 'PHYSICAL',
                term: 'CLOSURE-PAGE',
                skip: 0,
                take: 1,
                sortBy: 'totalWithTax',
                sortOrder: 'ASC',
            },
        });
        expect(byMoney.processingOrders.items[0].id).toBe(encode(first.order.id));
        const virtual = await adminClient.query(listOrders, {
            options: { category: 'DIGITAL', term: 'CLOSURE-PAGE' },
        });
        expect(virtual.processingOrders.totalItems).toBe(1);
        expect(virtual.processingOrders.items[0].id).toBe(encode(digital.order.id));
        expect(virtual.processingOrders.items[0].processingSummary.nextAction.code).toBe('PREPARE_DELIVERY');
    });
    it('matches payment transaction ids and treats percent and underscore as literal search text', async () => {
        const exact = await placed({ quantity: 1, code: 'CLOSURE-SEARCH-EXACT' });
        const wildcardLookalike = await placed({ quantity: 1, code: 'CLOSURE-SEARCH-DECOY' });
        await connection
            .getRepository(own, Payment)
            .update(exact.payment.id, { transactionId: 'LOCAL-SEARCH_%-literal' });
        await connection
            .getRepository(own, Payment)
            .update(wildcardLookalike.payment.id, { transactionId: 'LOCAL-SEARCHXY-literal' });
        const result = await adminClient.query(listOrders, {
            options: { category: 'ALL', term: 'LOCAL-SEARCH_%' },
        });
        expect(result.processingOrders.totalItems).toBe(1);
        expect(result.processingOrders.items.map((item: any) => item.id)).toEqual([encode(exact.order.id)]);
        await connection.getRepository(own, Order).update(exact.order.id, { code: 'CLOSURE-LITERAL_%-ONE' });
        await connection
            .getRepository(own, Order)
            .update(wildcardLookalike.order.id, { code: 'CLOSURE-LITERALXY-ONE' });
        const codes = await adminClient.query(listOrders, {
            options: { category: 'ALL', term: 'CLOSURE-LITERAL_%' },
        });
        expect(codes.processingOrders.totalItems).toBe(1);
        expect(codes.processingOrders.items[0].id).toBe(encode(exact.order.id));
    });
    it('keeps historical collected funds refundable after actual cancellation and exposes authorization holds', async () => {
        const fixture = await placed({ quantity: 1, code: 'CLOSURE-CANCELLED-COLLECTED' });
        const cancelled = await adminClient.query(
            gql`
                mutation ($input: CancelOrderInput!) {
                    cancelOrder(input: $input) {
                        ... on Order {
                            id
                            state
                            totalWithTax
                            lines {
                                quantity
                            }
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { input: { orderId: encode(fixture.order.id), reason: 'Synthetic cancellation' } },
        );
        expect(cancelled.cancelOrder.state).toBe('Cancelled');
        expect(cancelled.cancelOrder.totalWithTax).toBe(0);
        const result = await read(fixture.order.id);
        expect(result.processingSummary).toMatchObject({
            refundableAmount: fixture.total,
            needsProcessing: true,
            nextAction: { code: 'PROCESS_REFUND' },
        });
        const authorized = await placed({
            quantity: 1,
            state: 'Cancelled',
            paymentState: 'Authorized',
            code: 'CLOSURE-AUTH-HOLD',
        });
        const held = await read(authorized.order.id);
        expect(held.processingSummary).toMatchObject({
            refundableAmount: 0,
            paymentStatus: 'AUTHORIZED',
            needsProcessing: true,
            nextAction: { code: 'CANCEL_AUTHORIZATION' },
        });
        const page = await adminClient.query(listOrders, {
            options: { category: 'AFTER_SALES', term: 'CLOSURE-AUTH-HOLD' },
        });
        expect(page.processingOrders.totalItems).toBe(1);
    });
    it('validates refund amounts and preserves one transfer per stable idempotency key', async () => {
        const fixture = await placed({ quantity: 2, code: 'CLOSURE-REFUND-IDEMPOTENCY' });
        const startCalls = refundCalls;
        const request = {
            paymentId: encode(fixture.payment.id),
            amount: 100,
            idempotencyKey: 'local-idempotent-compensation',
            reasonType: 'COMPENSATION',
            reason: 'Synthetic compensation',
        };
        const [first, replay] = await Promise.all([refund(request), refund(request)]);
        expect(first).toMatchObject({ state: 'Settled', total: 100 });
        expect(replay.id).toBe(first.id);
        expect(refundCalls).toBe(startCalls + 1);
        await expect(refund({ ...request, amount: 101 })).rejects.toThrow(/退款请求编号/);
        for (const amount of [-1, 0]) {
            await expect(refund({ ...request, amount, idempotencyKey: 'invalid-' + amount })).rejects.toThrow(
                /退款金额/,
            );
        }
        const excessive = await refund({
            ...request,
            amount: fixture.total,
            idempotencyKey: 'local-over-limit',
        });
        expect(excessive.errorCode).toBe('REFUND_AMOUNT_ERROR');
        expect(refundCalls).toBe(startCalls + 1);
        expect((await read(fixture.order.id)).processingSummary).toMatchObject({
            refundedAmount: 100,
            remainingPhysicalQuantity: 2,
            refundableAmount: fixture.total - 100,
        });
    });
    it('reserves Pending refunds and only removes selected units from delivery eligibility', async () => {
        const fixture = await placed({
            quantity: 2,
            handler: pendingProvider.code,
            code: 'CLOSURE-PENDING-UNITS',
        });
        const request = {
            paymentId: encode(fixture.payment.id),
            amount: Math.floor(fixture.total / 2),
            idempotencyKey: 'local-one-unit',
            reasonType: 'ITEMS',
            lines: [{ orderLineId: encode(fixture.line.id), quantity: 1 }],
            reason: 'Synthetic unit refund',
        };
        const first = await refund(request);
        expect(first).toMatchObject({ state: 'Pending', total: request.amount });
        expect(first.lines).toEqual([{ orderLineId: encode(fixture.line.id), quantity: 1 }]);
        const result = await read(fixture.order.id);
        expect(result.processingSummary).toMatchObject({
            paymentStatus: 'REFUND_PENDING',
            remainingPhysicalQuantity: 1,
            pendingRefundAmount: request.amount,
            refundableAmount: fixture.total - request.amount,
        });
        expect(result.processingSummary.lines[0].requiredQuantity).toBe(1);
        await expect(
            refund({
                ...request,
                lines: [{ orderLineId: encode(fixture.line.id), quantity: 2 }],
                idempotencyKey: 'local-over-units',
            }),
        ).rejects.toThrow(/退款份数/);
        const excessive = await refund({
            paymentId: encode(fixture.payment.id),
            reasonType: 'COMPENSATION',
            amount: fixture.total,
            idempotencyKey: 'local-pending-over-budget',
        });
        expect(excessive.errorCode).toBe('REFUND_AMOUNT_ERROR');
        await expect(
            adminClient.query(
                gql`
                    mutation ($input: SettleRefundInput!) {
                        settleRefund(input: $input) {
                            ... on Refund {
                                id
                                state
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                { input: { id: first.id, transactionId: 'unverified-local-receipt' } },
            ),
        ).rejects.toThrow(/渠道回执/);
        expect((await refund(request)).id).toBe(first.id);
        const tooLarge = await createPackage(fixture, 2);
        const denied = (
            await adminClient.query(transitionFulfillment, { id: encode(tooLarge.id), state: 'Pending' })
        ).transitionFulfillmentToState;
        expect(denied).toMatchObject({
            errorCode: 'FULFILLMENT_STATE_TRANSITION_ERROR',
            transitionError: expect.stringMatching(/可发数量/),
        });
        expect(
            (await connection.getRepository(own, Fulfillment).findOneByOrFail({ id: tooLarge.id })).state,
        ).toBe('Created');
        const valid = await createPackage(fixture, 1);
        const pending = (
            await adminClient.query(transitionFulfillment, { id: encode(valid.id), state: 'Pending' })
        ).transitionFulfillmentToState;
        expect(pending.state, JSON.stringify(pending)).toBe('Pending');
    });
    it('requires the separate manual receipt workflow and rejects reused receipts across orders', async () => {
        const fixture = await placed({ quantity: 1, handler: manual.code, code: 'CLOSURE-MANUAL-RECEIPT' });
        const requested = await refund({
            paymentId: encode(fixture.payment.id),
            amount: 100,
            reasonType: 'COMPENSATION',
            idempotencyKey: 'local-manual-refund',
        });
        expect(requested.state).toBe('Pending');
        const mutation = gql`
            mutation ($input: RecordManualRefundInput!) {
                recordManualRefund(input: $input) {
                    ... on Refund {
                        id
                        state
                        transactionId
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `;
        await expect(
            adminClient.query(mutation, {
                input: {
                    refundId: requested.id,
                    transactionId: '',
                    evidenceReference: '',
                    note: 'Synthetic receipt',
                },
            }),
        ).rejects.toThrow(/凭证/);
        const input = {
            refundId: requested.id,
            transactionId: 'LOCAL-RECEIPT-UNIQUE',
            evidenceReference: 'local-fixture://receipt-1',
            note: 'Synthetic receipt, no transfer performed',
        };
        const settled = (await adminClient.query(mutation, { input })).recordManualRefund;
        expect(settled).toMatchObject({
            id: requested.id,
            state: 'Settled',
            transactionId: input.transactionId,
        });
        expect((await adminClient.query(mutation, { input })).recordManualRefund.id).toBe(requested.id);
        const other = await placed({ quantity: 1, handler: manual.code, code: 'CLOSURE-MANUAL-OTHER' });
        const another = await refund({
            paymentId: encode(other.payment.id),
            amount: 100,
            reasonType: 'COMPENSATION',
            idempotencyKey: 'local-manual-other-refund',
        });
        await expect(
            adminClient.query(mutation, { input: { ...input, refundId: another.id } }),
        ).rejects.toThrow(/退款流水已登记/);
    });
    it('retries an explicitly Failed refund on the same record and reserves its units and money once', async () => {
        const fixture = await placed({
            quantity: 2,
            handler: retryProvider.code,
            code: 'CLOSURE-FAILED-REFUND-RETRY',
        });
        const startCalls = refundCalls;
        const failed = await refund({
            paymentId: encode(fixture.payment.id),
            amount: Math.floor(fixture.total / 2),
            idempotencyKey: 'local-original-failed',
            reasonType: 'ITEMS',
            reason: 'Synthetic rejected refund',
            lines: [{ orderLineId: encode(fixture.line.id), quantity: 1 }],
        });
        expect(failed.state).toBe('Failed');
        expect(refundCalls).toBe(startCalls + 1);
        expect((await read(fixture.order.id)).processingSummary).toMatchObject({
            remainingPhysicalQuantity: 2,
            pendingRefundAmount: 0,
            refundableAmount: fixture.total,
        });
        const mutation = gql`
            mutation ($input: RetryRefundInput!) {
                retryRefund(input: $input) {
                    ... on Refund {
                        id
                        state
                        total
                        lines {
                            orderLineId
                            quantity
                        }
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                    ... on RefundStateTransitionError {
                        transitionError
                    }
                }
            }
        `;
        const input = { refundId: failed.id, idempotencyKey: 'local-reviewed-attempt' };
        const [retried, replay] = await Promise.all([
            adminClient.query(mutation, { input }),
            adminClient.query(mutation, { input }),
        ]);
        expect(retried.retryRefund).toMatchObject({
            id: failed.id,
            state: 'Pending',
            total: failed.total,
            lines: [{ orderLineId: encode(fixture.line.id), quantity: 1 }],
        });
        expect(replay.retryRefund.id).toBe(failed.id);
        expect(refundCalls).toBe(startCalls + 2);
        expect((await read(fixture.order.id)).processingSummary).toMatchObject({
            remainingPhysicalQuantity: 1,
            pendingRefundAmount: failed.total,
            refundableAmount: fixture.total - failed.total,
        });
        expect(
            await connection
                .getRepository(own, Refund)
                .count({ where: { payment: { id: fixture.payment.id } } }),
        ).toBe(1);
        await expect(
            adminClient.query(mutation, { input: { ...input, idempotencyKey: 'local-unreviewed-repeat' } }),
        ).rejects.toThrow(/已明确失败|处理中/);
        adminClient.setChannelToken(foreignToken);
        try {
            await expect(adminClient.query(mutation, { input })).rejects.toThrow();
        } finally {
            adminClient.setChannelToken(ownToken);
        }
        expect(refundCalls).toBe(startCalls + 2);
    });
    it('exits modification with no price change and enters additional payment after an actual increase', async () => {
        const fixture = await placed({ quantity: 1, code: 'CLOSURE-MODIFY' });
        const transition = gql`
            mutation ($id: ID!, $state: String!) {
                transitionOrderToState(id: $id, state: $state) {
                    ... on Order {
                        id
                        state
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `;
        const finish = gql`
            mutation ($id: ID!) {
                finishOrderModification(orderId: $id) {
                    id
                    state
                    processingSummary {
                        outstandingAmount
                    }
                }
            }
        `;
        expect(
            (await adminClient.query(transition, { id: encode(fixture.order.id), state: 'Modifying' }))
                .transitionOrderToState.state,
        ).toBe('Modifying');
        expect(
            (await adminClient.query(finish, { id: encode(fixture.order.id) })).finishOrderModification.state,
        ).toBe('PaymentSettled');
        await adminClient.query(transition, { id: encode(fixture.order.id), state: 'Modifying' });
        const modified = await adminClient.query(
            gql`
                mutation ($input: ModifyOrderInput!) {
                    modifyOrder(input: $input) {
                        ... on Order {
                            id
                            state
                            totalWithTax
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    orderId: encode(fixture.order.id),
                    dryRun: false,
                    note: 'Synthetic quantity increase',
                    adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity: 2 }],
                },
            },
        );
        expect(modified.modifyOrder.state).toBe('Modifying');
        const result = (await adminClient.query(finish, { id: encode(fixture.order.id) }))
            .finishOrderModification;
        expect(result.state).toBe('ArrangingAdditionalPayment');
        expect(result.processingSummary.outstandingAmount).toBeGreaterThan(0);
        await expect(adminClient.query(finish, { id: encode(fixture.order.id) })).resolves.toMatchObject({
            finishOrderModification: { state: 'ArrangingAdditionalPayment' },
        });
    });
    it('splits one removed unit across original payments, preserves its reservation on partial failure and retries the same fragment', async () => {
        const fixture = await placed({
            quantity: 2,
            amount: 500,
            handler: splitRetryProvider.code,
            code: 'CLOSURE-SPLIT-UNIT',
        });
        const second = await connection.getRepository(own, Payment).save(
            new Payment({
                order: fixture.order,
                state: 'Settled',
                amount: 500,
                method: automatic.code,
                transactionId: 'local-second-' + fixture.order.id,
                metadata: {},
            }),
        );
        await connection.getRepository(own, Payment).save(
            new Payment({
                order: fixture.order,
                state: 'Settled',
                amount: 1000,
                method: automatic.code,
                transactionId: 'local-third-' + fixture.order.id,
                metadata: {},
            }),
        );
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    transitionOrderToState(id: $id, state: "Modifying") {
                        ... on Order {
                            id
                            state
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { id: encode(fixture.order.id) },
        );
        const changed = (
            await adminClient.query(
                gql`
                    mutation ($input: ModifyOrderInput!) {
                        modifyOrder(input: $input) {
                            ... on Order {
                                id
                                state
                                totalWithTax
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        orderId: encode(fixture.order.id),
                        dryRun: false,
                        adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity: 1 }],
                        refunds: [
                            {
                                paymentId: encode(fixture.payment.id),
                                amount: 500,
                                idempotencyKey: 'split-source-one',
                            },
                            { paymentId: encode(second.id), amount: 500, idempotencyKey: 'split-source-two' },
                        ],
                    },
                },
            )
        ).modifyOrder;
        expect(changed.errorCode, changed.message).toBeUndefined();
        const records = await connection.getRepository(own, Refund).find({
            where: { payment: { order: { id: fixture.order.id } } },
            relations: ['lines', 'payment'],
        });
        expect(records).toHaveLength(2);
        expect(records.every(record => record.metadata.refundRequest.reasonType === 'ITEMS')).toBe(true);
        expect(records.flatMap(record => record.lines)).toHaveLength(1);
        expect(new Set(records.map(record => record.metadata.refundRequest.quantityGroup.key)).size).toBe(1);
        const failed = requireFixture(records.find(record => record.state === 'Failed'));
        expect(failed.lines).toHaveLength(1);
        const before = (await read(fixture.order.id)).processingSummary;
        expect(before.refundedAmount).toBe(500);
        expect(before.lines[0].refundableQuantity).toBe(1);
        const input = { refundId: encode(failed.id), idempotencyKey: 'split-reviewed-retry' };
        const retry = gql`
            mutation ($input: RetryRefundInput!) {
                retryRefund(input: $input) {
                    ... on Refund {
                        id
                        state
                        total
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `;
        const retried = (await adminClient.query(retry, { input })).retryRefund;
        expect(retried).toMatchObject({ id: encode(failed.id), state: 'Pending', total: 500 });
        expect((await adminClient.query(retry, { input })).retryRefund.id).toBe(retried.id);
        const after = (await read(fixture.order.id)).processingSummary;
        expect(after.pendingRefundAmount).toBe(500);
        expect(after.lines[0].refundableQuantity).toBe(1);
        expect(
            await connection
                .getRepository(own, Refund)
                .count({ where: { payment: { order: { id: fixture.order.id } } } }),
        ).toBe(2);
        await expect(
            refund({
                paymentId: encode(second.id),
                amount: 1,
                reasonType: 'ITEMS',
                lines: [],
                idempotencyKey: 'forged-empty-item-fragment',
            }),
        ).rejects.toThrow('商品退款必须选择');
    });
    it('prepares an existing Created package, dispatches it once, and closes delivery only with evidence', async () => {
        const fixture = await placed({ quantity: 1, code: 'CLOSURE-PACKAGE' });
        const packageRecord = await createPackage(fixture);
        const before = await read(fixture.order.id);
        expect(before.processingSummary).toMatchObject({
            remainingPhysicalQuantity: 1,
            nextAction: { code: 'DISPATCH_PHYSICAL', targetId: encode(packageRecord.id) },
        });
        const prepared = await adminClient.query(prepareShipment, {
            input: {
                fulfillmentId: encode(packageRecord.id),
                carrier: 'Local fake carrier',
                trackingCode: 'LOCAL-TRACK-001',
            },
        });
        expect(prepared.prepareFulfillmentShipment).toMatchObject({
            state: 'Created',
            trackingCode: 'LOCAL-TRACK-001',
        });
        const pending = (
            await adminClient.query(transitionFulfillment, { id: encode(packageRecord.id), state: 'Pending' })
        ).transitionFulfillmentToState;
        expect(pending.state, JSON.stringify(pending)).toBe('Pending');
        const shipped = (
            await adminClient.query(transitionFulfillment, { id: encode(packageRecord.id), state: 'Shipped' })
        ).transitionFulfillmentToState;
        expect(shipped.state, JSON.stringify(shipped)).toBe('Shipped');
        const withoutProof = (
            await adminClient.query(transitionFulfillment, {
                id: encode(packageRecord.id),
                state: 'Delivered',
            })
        ).transitionFulfillmentToState;
        expect(withoutProof.errorCode).toBe('FULFILLMENT_STATE_TRANSITION_ERROR');
        const delivered = await adminClient.query(
            gql`
                mutation ($input: UpdateFulfillmentDeliveryInput!) {
                    updateFulfillmentDelivery(input: $input) {
                        status
                        proofReference
                    }
                }
            `,
            {
                input: {
                    fulfillmentId: encode(packageRecord.id),
                    status: 'DELIVERED',
                    proofReference: 'LOCAL-POD-001',
                    note: 'Synthetic delivered proof',
                    idempotencyKey: 'local-delivery-proof',
                },
            },
        );
        expect(delivered.updateFulfillmentDelivery.status).toBe('DELIVERED');
        expect((await read(fixture.order.id)).processingSummary.fulfillmentStatus).toBe('COMPLETE');
    });
    it('allows fully funded physical authorization and rejects underfunded, cancelled and digital Pending transitions', async () => {
        const allowed = await placed({
            quantity: 1,
            state: 'PaymentAuthorized',
            paymentState: 'Authorized',
            code: 'CLOSURE-PHYSICAL-AUTH',
        });
        const packageRecord = await createPackage(allowed);
        await adminClient.query(prepareShipment, {
            input: {
                fulfillmentId: encode(packageRecord.id),
                carrier: 'Local fake carrier',
                trackingCode: 'LOCAL-AUTH-TRACK',
            },
        });
        for (const state of ['Pending', 'Shipped']) {
            const result = (
                await adminClient.query(transitionFulfillment, { id: encode(packageRecord.id), state })
            ).transitionFulfillmentToState;
            expect(result.state, JSON.stringify(result)).toBe(state);
        }
        const cases = [
            {
                fixture: await placed({
                    quantity: 1,
                    state: 'PaymentAuthorized',
                    paymentState: 'Authorized',
                    amount: 1,
                    code: 'CLOSURE-UNDERFUNDED',
                }),
                reason: /补款/,
            },
            {
                fixture: await placed({ quantity: 1, state: 'Cancelled', code: 'CLOSURE-CANCELLED-PACKAGE' }),
                reason: /取消/,
            },
            {
                fixture: await placed({ quantity: 1, kind: 'digital', code: 'CLOSURE-DIGITAL-PACKAGE' }),
                reason: /数字|虚拟/,
            },
        ];
        for (const item of cases) {
            const record = await createPackage(item.fixture);
            const result = (
                await adminClient.query(transitionFulfillment, { id: encode(record.id), state: 'Pending' })
            ).transitionFulfillmentToState;
            expect(result).toMatchObject({
                errorCode: 'FULFILLMENT_STATE_TRANSITION_ERROR',
                transitionError: expect.stringMatching(item.reason),
            });
            expect(
                (await connection.getRepository(own, Fulfillment).findOneByOrFail({ id: record.id })).state,
            ).toBe('Created');
        }
    });
    it('rejects foreign-store reads and package preparation even when management membership is assigned', async () => {
        const fixture = await placed({ quantity: 1, code: 'CLOSURE-CROSSSTORE' });
        const packageRecord = await createPackage(fixture);
        await server.app
            .get(ChannelService)
            .assignToChannels(own, Order, fixture.order.id, [foreign.channelId]);
        adminClient.setChannelToken(foreignToken);
        try {
            expect(await read(fixture.order.id)).toBeNull();
            expect(
                (
                    await adminClient.query(listOrders, {
                        options: { category: 'ALL', term: 'CLOSURE-CROSSSTORE' },
                    })
                ).processingOrders.totalItems,
            ).toBe(0);
            await expect(
                adminClient.query(prepareShipment, {
                    input: {
                        fulfillmentId: encode(packageRecord.id),
                        carrier: 'Local fake carrier',
                        trackingCode: 'LOCAL-CROSS-REJECT',
                    },
                }),
            ).rejects.toThrow(/经营店铺/);
            await expect(
                refund({
                    paymentId: encode(fixture.payment.id),
                    amount: 100,
                    reasonType: 'COMPENSATION',
                    idempotencyKey: 'local-cross-refund',
                }),
            ).rejects.toThrow();
        } finally {
            adminClient.setChannelToken(ownToken);
        }
    });
    it('runs actual SQLjs transactions for two packages competing for one unit', async () => {
        const fixture = await placed({ quantity: 1, code: 'CLOSURE-SQLJS-CONCURRENT' });
        const first = await createPackage(fixture);
        const second = await createPackage(fixture);
        for (const item of [first, second]) {
            await adminClient.query(prepareShipment, {
                input: {
                    fulfillmentId: encode(item.id),
                    carrier: 'Local fake carrier',
                    trackingCode: 'LOCAL-RACE-' + item.id,
                },
            });
            const pending = (
                await adminClient.query(transitionFulfillment, { id: encode(item.id), state: 'Pending' })
            ).transitionFulfillmentToState;
            expect(pending.state, JSON.stringify(pending)).toBe('Pending');
        }
        const results = await Promise.all(
            [first, second].map(item =>
                adminClient.query(transitionFulfillment, {
                    id: encode(item.id),
                    state: 'Shipped',
                }),
            ),
        );
        expect(
            results.filter(result => result.transitionFulfillmentToState.state === 'Shipped'),
            JSON.stringify(results),
        ).toHaveLength(1);
        expect(
            results.filter(
                result =>
                    result.transitionFulfillmentToState.errorCode === 'FULFILLMENT_STATE_TRANSITION_ERROR',
            ),
        ).toHaveLength(1);
        const persisted = await connection
            .getRepository(own, Fulfillment)
            .find({ where: { orders: { id: fixture.order.id } } });
        expect(persisted.filter(item => item.state === 'Shipped')).toHaveLength(1);
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
