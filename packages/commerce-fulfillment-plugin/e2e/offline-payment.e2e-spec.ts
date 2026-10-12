import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CurrencyCode, GlobalFlag, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    CustomerService,
    DefaultLogger,
    isGraphQlErrorResult,
    LogLevel,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    Payment,
    PaymentMethod,
    PaymentMethodService,
    ProductService,
    ProductVariantPrice,
    ProductVariantService,
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
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import { CheckoutResourcesService } from '../src/checkout-resources.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { CommerceModeService } from '../src/commerce-mode.service';
import { DigitalProductService } from '../src/digital-product.service';
import { OFFLINE_MANUAL_CHECKER, OFFLINE_MANUAL_HANDLER } from '../src/offline-manual-payment';
import { OfflinePaymentService } from '../src/offline-payment.service';

import { closureDatabase } from './order-closure-db';

// Fresh, owned synthetic MySQL; no SMTP, payment provider, real customer or production database.
const directory = path.resolve(
    __dirname,
    '../../../docs/local-validation/experience-offline-20261013/payment',
);
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37396, hostname: '127.0.0.1' },
    dbConnectionOptions: closureDatabase(directory),
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new DefaultLogger({ level: LogLevel.Error }),
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
            evidenceStorage: { rootDirectory: directory, signingSecret: randomUUID() },
        }),
    ],
});
const { server, adminClient } = createTestEnvironment(config);
const entityIdStrategy = requireFixture(config.entityOptions.entityIdStrategy);
const superadminCredentials = requireFixture(config.authOptions.superadminCredentials);
const encode = (id: string | number) => entityIdStrategy.encodeId(id);
let connection: TransactionalConnection;
let own: RequestContext;
let foreign: RequestContext;
let customer: Customer;
let physicalId: string;
let digitalId: string;
let zeroId: string;
let quotaId: string;
let ownToken: string;
let foreignToken: string;
function requireFixture<T>(value: T | undefined | null): T {
    if (!value) throw new Error('Missing local fixture');
    return value;
}
beforeAll(async () => {
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            collections: [],
            paymentMethods: [],
            shippingMethods: [],
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
    await server.app.get(PaymentMethodService).create(platform, {
        code: 'offline-manual-local',
        enabled: true,
        handler: { code: OFFLINE_MANUAL_HANDLER, arguments: [] },
        checker: { code: OFFLINE_MANUAL_CHECKER, arguments: [] },
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: '提交后联系客服（测试文案）',
                description: '真实人工收款',
            },
        ],
    });
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
        const scopedUser = await connection
            .getRepository(platform, User)
            .findOneOrFail({ where: { id: user.id }, relations: ['roles', 'roles.channels'] });
        return contexts.create({ apiType: 'admin', user: scopedUser, channelOrToken: result.token });
    };
    own = await createChannel('offline-own-local');
    foreign = await createChannel('offline-foreign-local');
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
        await server.app.get(PaymentMethodService).setStorePaymentOptionEnabled(own, method.id, true);
    }
    const createVariant = async (kind: 'physical' | 'digital', price = 1000) => {
        const product = await server.app.get(ProductService).create(own, {
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: 'Synthetic ' + kind,
                    slug: 'offline-' + kind + '-' + price,
                    description: 'Synthetic local API verification only',
                },
            ],
            customFields: { fulfillmentType: kind },
        });
        const [variant] = await server.app.get(ProductVariantService).create(own, [
            {
                productId: product.id,
                sku: 'OFFLINE-' + kind + '-' + price,
                price,
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
    zeroId = await createVariant('digital', 0);
    quotaId = await createVariant('digital', 900);
    await connection.withTransaction(own, tx =>
        server.app.get(DigitalProductService).update(tx, {
            productVariantId: quotaId,
            deliveryMode: 'manual_service',
            stockPolicy: 'limited',
            availableQuantity: 1,
            expectedAvailableQuantity: 0,
        }),
    );
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(ownToken);
    // This is the testing package's synthetic superadmin, never an operator's real password.
    adminClient.setRequestHeader('x-vendure-sensitive-action-password', superadminCredentials.password);
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());

async function submitted(zero = false, variantId?: string) {
    const orders = server.app.get(OrderService);
    const created = await orders.create(own);
    const buyer = check(
        await server.app.get(CustomerService).create(own, {
            emailAddress: `offline-${randomUUID()}@example.invalid`,
            firstName: 'Synthetic',
            lastName: 'Buyer',
        }),
    );
    // Established synthetic customer: newly-created unverified buyers correctly require risk review.
    await connection
        .getRepository(own, Customer)
        .update(buyer.id, { createdAt: new Date(Date.now() - 3 * 86_400_000) });
    check(await orders.addCustomerToOrder(own, created.id, buyer));
    check(await orders.addItemToOrder(own, created.id, variantId ?? (zero ? zeroId : digitalId), 1));
    await orders.updateCustomFields(own, created.id, {
        deliveryEmail: customer.emailAddress,
        customerNote: 'Synthetic manual receipt',
    });
    return orders.withOrderMutationTransaction(own, async tx => {
        check(await orders.transitionToState(tx, created.id, 'ArrangingPayment'));
        const result = check(
            await orders.addPaymentToOrder(tx, created.id, {
                method: 'offline-manual-local',
                metadata: { public: { testPayment: true }, offlineManual: { receiptProof: 'forged' } },
            }),
        );
        const payments = await orders.getOrderPayments(tx, created.id);
        return {
            order: result,
            payment: requireFixture(payments.find(payment => payment.state === 'PendingManual')),
        };
    });
}

function check<T>(result: T): Exclude<T, { errorCode: unknown }> {
    if (isGraphQlErrorResult(result as any))
        throw new Error((result as any).transitionError || (result as any).message);
    return result as any;
}
const confirmMutation = gql`
    mutation ($input: ConfirmOfflinePaymentInput!) {
        confirmOfflinePayment(input: $input) {
            id
            state
            amount
            kind
            transactionId
        }
    }
`;
const detailQuery = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            code
            state
            active
            orderPlacedAt
            payments {
                id
                state
                kind
            }
            processingSummary {
                paymentStatus
                hasException
                needsProcessing
                isTestOrder
                nextAction {
                    code
                    enabled
                    targetId
                }
            }
        }
    }
`;
function confirmation(payment: Payment) {
    return {
        paymentId: encode(payment.id),
        expectedAmount: payment.amount,
        transactionId: 'LOCAL-OFFLINE-' + payment.id,
        evidenceReference: 'synthetic-fixture://bank/' + payment.id,
        receivedAt: new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000).toISOString(),
        idempotencyKey: 'local-offline-' + payment.id,
    };
}
async function sourceLegacy() {
    const orders = server.app.get(OrderService);
    const created = await orders.create(own);
    const buyer = check(
        await server.app.get(CustomerService).create(own, {
            emailAddress: `offline-${randomUUID()}@example.invalid`,
            firstName: 'Synthetic',
            lastName: 'Buyer',
        }),
    );
    // Established synthetic customer: newly-created unverified buyers correctly require risk review.
    await connection
        .getRepository(own, Customer)
        .update(buyer.id, { createdAt: new Date(Date.now() - 3 * 86_400_000) });
    check(await orders.addCustomerToOrder(own, created.id, buyer));
    const added = check(await orders.addItemToOrder(own, created.id, digitalId, 1));
    await orders.updateCustomFields(own, created.id, { deliveryEmail: customer.emailAddress });
    await connection.getRepository(own, OrderLine).update(
        { order: { id: created.id } },
        {
            orderPlacedQuantity: 1,
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
        },
    );
    await connection
        .getRepository(own, Order)
        .update(created.id, { active: false, state: 'PaymentSettled', orderPlacedAt: new Date() });
    const payment = await connection.getRepository(own, Payment).save(
        new Payment({
            order: created,
            state: 'Settled',
            amount: added.totalWithTax,
            method: 'controlled-test-payment-legacy',
            transactionId: 'synthetic-test-' + created.id,
            metadata: { public: { testPayment: true } } as any,
        }),
    );
    return { order: created, payment };
}
describe('formal offline payment HTTP and owned MySQL', () => {
    it('places a real pending order and excludes forged client receipts', async () => {
        const fixture = await submitted();
        expect(fixture.order).toMatchObject({ state: 'AwaitingManualPayment', active: false });
        expect(fixture.order.orderPlacedAt).toBeTruthy();
        expect(fixture.payment).toMatchObject({
            state: 'PendingManual',
            metadata: {
                offlineManual: { kind: 'OFFLINE_MANUAL' },
                public: { paymentKind: 'OFFLINE_MANUAL' },
            },
        });
        expect(fixture.payment.metadata.offlineManual.receiptProof).toBeUndefined();
        const result = (await adminClient.query(detailQuery, { id: encode(fixture.order.id) })).order;
        expect(result.processingSummary).toMatchObject({
            paymentStatus: 'PENDING_MANUAL',
            needsProcessing: true,
            isTestOrder: false,
            nextAction: { code: 'CONFIRM_OFFLINE_PAYMENT', targetId: encode(fixture.payment.id) },
        });
        expect(result.payments[0].kind).toBe('OFFLINE_MANUAL');
        expect((await server.app.get(OrderService).getOrderFulfillments(own, fixture.order)).length).toBe(0);
        await expect(server.app.get(OrderService).settlePayment(own, fixture.payment.id)).rejects.toThrow(
            /客服核款/,
        );
    });
    it('keeps a zero-total formal order pending until a protected confirmation', async () => {
        const fixture = await submitted(true);
        expect(fixture.order).toMatchObject({
            state: 'AwaitingManualPayment',
            totalWithTax: 0,
            active: false,
        });
        const result = (await adminClient.query(detailQuery, { id: encode(fixture.order.id) })).order;
        expect(result.processingSummary).toMatchObject({
            paymentStatus: 'PENDING_MANUAL',
            needsProcessing: true,
        });
    });

    it('requires password and exact amount, rejects cross-shop, settles the original payment once', async () => {
        const fixture = await submitted();
        const input = confirmation(fixture.payment);
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', '');
        await expect(adminClient.query(confirmMutation, { input })).rejects.toThrow(/密码/);
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', superadminCredentials.password);
        await expect(
            adminClient.query(confirmMutation, {
                input: { ...input, expectedAmount: input.expectedAmount + 1 },
            }),
        ).rejects.toThrow(/金额|状态/);
        await expect(
            server.app
                .get(OfflinePaymentService)
                .confirm(foreign, { ...input, paymentId: fixture.payment.id }),
        ).rejects.toThrow();
        const [first, second] = await Promise.all([
            adminClient.query(confirmMutation, { input }),
            adminClient.query(confirmMutation, { input }),
        ]);
        expect(first.confirmOfflinePayment).toMatchObject({
            id: encode(fixture.payment.id),
            state: 'Settled',
            kind: 'OFFLINE_MANUAL',
            amount: fixture.payment.amount,
        });
        expect(second.confirmOfflinePayment.id).toBe(first.confirmOfflinePayment.id);
        const payments = await server.app.get(OrderService).getOrderPayments(own, fixture.order.id);
        expect(payments).toHaveLength(1);
        expect(payments[0].metadata.offlineManual.confirmation.receivedAt).toBe(Date.parse(input.receivedAt));
        await expect(
            adminClient.query(confirmMutation, { input: { ...input, evidenceReference: 'changed' } }),
        ).rejects.toThrow(/其他凭证/);
    });
    it('retains real received evidence on a business failure and rechecks that same payment', async () => {
        const fixture = await submitted();
        let reject = true;
        server.app
            .get(OrderService)
            .registerPaymentConfirmationValidator('offline-local-business-check', (_ctx, _order, payment) =>
                Promise.resolve(
                    payment.id === fixture.payment.id && reject
                        ? 'Synthetic business verification unavailable'
                        : undefined,
                ),
            );
        const first = (await adminClient.query(confirmMutation, { input: confirmation(fixture.payment) }))
            .confirmOfflinePayment;
        expect(first.state).toBe('Error');
        const stored = await connection
            .getRepository(own, Payment)
            .findOneByOrFail({ id: fixture.payment.id });
        expect(stored.metadata.manualReview).toMatchObject({ required: true, receivedState: 'Settled' });
        expect(stored.metadata.offlineManual.receiptProof).toBeTruthy();
        reject = false;
        const retry = await adminClient.query(
            gql`
                mutation ($paymentId: ID!) {
                    retryOfflinePaymentReview(paymentId: $paymentId) {
                        id
                        state
                    }
                }
            `,
            { paymentId: encode(fixture.payment.id) },
        );
        expect(retry.retryOfflinePaymentReview).toMatchObject({
            id: encode(fixture.payment.id),
            state: 'Settled',
        });
        expect(await server.app.get(OrderService).getOrderPayments(own, fixture.order.id)).toHaveLength(1);
    });
    it('rejects reuse of one bank receipt on another order', async () => {
        const first = await submitted();
        const second = await submitted();
        const input = confirmation(first.payment);
        await adminClient.query(confirmMutation, { input });
        await expect(
            adminClient.query(confirmMutation, {
                input: { ...confirmation(second.payment), transactionId: input.transactionId },
            }),
        ).rejects.toThrow(/另一笔订单/);
        expect(
            (await connection.getRepository(own, Payment).findOneByOrFail({ id: second.payment.id })).state,
        ).toBe('PendingManual');
    });
    it('makes a reviewed receipt refundable through its original payment without approving delivery', async () => {
        const fixture = await submitted();
        server.app
            .get(OrderService)
            .registerPaymentConfirmationValidator('offline-local-refund-check', (_ctx, _order, payment) =>
                Promise.resolve(
                    payment.id === fixture.payment.id && !payment.metadata?.offlineManual?.refundOnly
                        ? 'Synthetic failed business quote'
                        : undefined,
                ),
            );
        expect(
            (await adminClient.query(confirmMutation, { input: confirmation(fixture.payment) }))
                .confirmOfflinePayment.state,
        ).toBe('Error');
        const prepared = await adminClient.query(
            gql`
                mutation ($paymentId: ID!) {
                    prepareOfflinePaymentRefund(paymentId: $paymentId) {
                        id
                        state
                    }
                }
            `,
            { paymentId: encode(fixture.payment.id) },
        );
        expect(prepared.prepareOfflinePaymentRefund).toMatchObject({
            id: encode(fixture.payment.id),
            state: 'Settled',
        });
        const order = (await adminClient.query(detailQuery, { id: encode(fixture.order.id) })).order;
        expect(order.state).toBe('AwaitingManualPayment');
        expect(order.processingSummary.paymentStatus).toBe('RECEIPT_REVIEW');
        expect(await server.app.get(OrderService).getOrderFulfillments(own, fixture.order)).toHaveLength(0);
        const requested = await adminClient.query(
            gql`
                mutation ($input: RefundOrderInput!) {
                    refundOrder(input: $input) {
                        ... on Refund {
                            id
                            state
                            total
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    paymentId: encode(fixture.payment.id),
                    amount: fixture.payment.amount,
                    reasonType: 'COMPENSATION',
                    reason: 'Synthetic original receipt full return',
                    idempotencyKey: 'local-refund-only-' + fixture.payment.id,
                },
            },
        );
        expect(requested.refundOrder).toMatchObject({ state: 'Pending', total: fixture.payment.amount });
        const refunded = await adminClient.query(
            gql`
                mutation ($input: RecordManualRefundInput!) {
                    recordManualRefund(input: $input) {
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
            {
                input: {
                    refundId: requested.refundOrder.id,
                    transactionId: 'LOCAL-RETURN-' + fixture.payment.id,
                    evidenceReference: 'synthetic://return/' + fixture.payment.id,
                    note: 'Synthetic verified return, no external bank transfer',
                },
            },
        );
        expect(refunded.recordManualRefund.state).toBe('Settled');
        await server.app.get(CheckoutResourcesService).assertCancellationAllowed(own, fixture.order.id);
        expect(await server.app.get(OrderService).getOrderPayments(own, fixture.order.id)).toHaveLength(1);
    });
    it('releases expired unpaid resources without removing the pending order and revalidates late receipt', async () => {
        const fixture = await submitted();
        const resources = server.app.get(CheckoutResourcesService);
        const hold = requireFixture(await resources.hold(own, fixture.order.id));
        expect(hold?.state).toBe('HELD');
        await connection
            .getRepository(own, hold.constructor)
            .update(requireFixture(hold).id, { expiresAt: new Date(Date.now() - 60_000) });
        await resources.reconcileExpired();
        expect((await resources.hold(own, fixture.order.id))?.state).toBe('RELEASED');
        expect((await server.app.get(OrderService).findOne(own, fixture.order.id))?.state).toBe(
            'AwaitingManualPayment',
        );
        const result = await adminClient.query(confirmMutation, { input: confirmation(fixture.payment) });
        expect(result.confirmOfflinePayment.state).toBe('Settled');
        expect((await resources.hold(own, fixture.order.id))?.state).toBe('CONFIRMED');
    });
    it('keeps the actual receipt and an unfulfilled exception when expired limited inventory is no longer available', async () => {
        const digital = server.app.get(DigitalProductService);
        const resources = server.app.get(CheckoutResourcesService);
        const fixture = await submitted(false, quotaId);
        expect((await digital.config(own, quotaId))?.availableQuantity).toBe(0);
        const hold = requireFixture(await resources.hold(own, fixture.order.id));
        await connection
            .getRepository(own, hold.constructor)
            .update(hold.id, { expiresAt: new Date(Date.now() - 60_000) });
        await resources.reconcileExpired();
        expect((await digital.config(own, quotaId))?.availableQuantity).toBe(1);
        await connection.withTransaction(own, tx =>
            digital.update(tx, {
                productVariantId: quotaId,
                deliveryMode: 'manual_service',
                stockPolicy: 'limited',
                availableQuantity: 0,
                expectedAvailableQuantity: 1,
            }),
        );
        const confirmed = await adminClient.query(confirmMutation, { input: confirmation(fixture.payment) });
        expect(confirmed.confirmOfflinePayment).toMatchObject({
            id: encode(fixture.payment.id),
            state: 'Settled',
        });
        expect((await resources.hold(own, fixture.order.id))?.state).toBe('REVIEW');
        expect(await server.app.get(OrderService).getOrderFulfillments(own, fixture.order)).toHaveLength(0);
        expect(
            (await adminClient.query(detailQuery, { id: encode(fixture.order.id) })).order.processingSummary
                .hasException,
        ).toBe(true);
        await connection.withTransaction(own, tx =>
            digital.update(tx, {
                productVariantId: quotaId,
                deliveryMode: 'manual_service',
                stockPolicy: 'limited',
                availableQuantity: 1,
                expectedAvailableQuantity: 0,
            }),
        );
        await connection.withTransaction(own, tx => resources.retryDelivery(tx, fixture.order.id));
        expect((await resources.hold(own, fixture.order.id))?.state).toBe('CONFIRMED');
        expect(await server.app.get(OrderService).getOrderPayments(own, fixture.order.id)).toHaveLength(1);
        expect((await digital.config(own, quotaId))?.availableQuantity).toBe(0);
    });

    it('blocks historical recovery when real or mixed funds are present', async () => {
        const legacy = await sourceLegacy();
        await connection.getRepository(own, Payment).save(
            new Payment({
                order: legacy.order,
                state: 'Settled',
                amount: 10,
                method: 'offline-manual-local',
                metadata: {},
            }),
        );
        await expect(
            server.app.get(OfflinePaymentService).prepare(own, {
                sourceOrderId: legacy.order.id,
                idempotencyKey: 'blocked-' + legacy.order.id,
            }),
        ).rejects.toThrow(/真实或混合/);
    });

    it('restores legacy orders as a repriced linked draft and requires quote confirmation without altering simulation', async () => {
        const legacy = await sourceLegacy();
        const service = server.app.get(OfflinePaymentService);
        // Change the owned synthetic current catalog price; restoration must re-read this row.
        await connection
            .getRepository(own, ProductVariantPrice)
            .update(
                { variant: { id: digitalId }, channelId: own.channelId, currencyCode: own.currencyCode },
                { price: 1200 },
            );
        const prepareInput = {
            sourceOrderId: legacy.order.id,
            idempotencyKey: 'local-prepare-' + legacy.order.id,
        };
        const [prepared, replay] = await Promise.all([
            service.prepare(own, prepareInput),
            service.prepare(own, prepareInput),
        ]);
        expect(prepared.stage).toBe('DRAFT');
        expect(prepared.quotedTotal).not.toBe(prepared.originalTotal);
        expect(prepared.changes.length).toBeGreaterThan(0);
        expect(replay.draftOrderId).toBe(prepared.draftOrderId);
        const changed = await service.submit(own, {
            sourceOrderId: legacy.order.id,
            quoteHash: 'stale',
            method: 'offline-manual-local',
            idempotencyKey: 'local-submit-' + legacy.order.id,
        });
        expect(changed.stage).toBe('DRAFT');
        const result = await service.submit(own, {
            sourceOrderId: legacy.order.id,
            quoteHash: requireFixture(changed.quoteHash),
            method: 'offline-manual-local',
            idempotencyKey: 'local-submit-' + legacy.order.id,
        });
        expect(result.stage).toBe('SUBMITTED');
        expect(
            (await server.app.get(OrderService).findOne(own, requireFixture(result.draftOrderId)))?.state,
        ).toBe('AwaitingManualPayment');
        expect(
            (
                await service.submit(own, {
                    sourceOrderId: legacy.order.id,
                    quoteHash: requireFixture(changed.quoteHash),
                    method: 'offline-manual-local',
                    idempotencyKey: 'replay',
                })
            ).draftOrderId,
        ).toBe(result.draftOrderId);
        const original = await connection
            .getRepository(own, Payment)
            .findOneByOrFail({ id: legacy.payment.id });
        expect(original).toMatchObject({
            state: 'Settled',
            amount: legacy.payment.amount,
            transactionId: legacy.payment.transactionId,
            metadata: { public: { testPayment: true } },
        });
        expect((await service.recovery(own, legacy.order.id)).originalTotal).toBe(prepared.originalTotal);
    });
});
