import { CommerceFulfillmentPlugin } from '@vendure/commerce-fulfillment-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ConfigService,
    EventBus,
    LanguageCode,
    mergeConfig,
    Order,
    OrderPlacedEvent,
    OrderService,
    PaymentMethodHandler,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import {
    CustomerCoupon,
    StoreCouponLifecycleService,
    StoreManagementPlugin,
} from '@vendure/store-management-plugin';
import {
    StorefrontCartLifecycleService,
    StorefrontCartPlugin,
    StorefrontCartService,
} from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { cartFields } from '../../storefront/src/api/fragments';
import { AddCartCommandReceipts1788678060000 } from '../migrations/1788678060000-add-cart-command-receipts';

const localPayment = new PaymentMethodHandler({
    code: 'cart-local-fixture',
    description: [{ languageCode: LanguageCode.en, value: 'Local fixture, no external charge' }],
    args: {},
    createPayment: (_ctx, order, amount) => ({
        amount,
        state: 'Settled',
        transactionId: `fixture-${order.code}`,
        metadata: {},
    }),
    settlePayment: () => ({ success: true }),
});
const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    paymentOptions: { paymentMethodHandlers: [localPayment] },
    customFields: {
        Order: [
            { name: 'customerNote', type: 'text', nullable: true, public: true },
            { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
            { name: 'deliveryEmailContactId', type: 'string', length: 64, nullable: true, public: false },
        ],
    },
    plugins: [
        ContentTranslationPlugin.init({
            provider: {
                name: 'cart-qa',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'cart-qa',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StorefrontCartPlugin,
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'cart-qa-signing-secret-not-for-production',
        }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: true }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const fields = cartFields;
const query = gql`query { storefrontCart { ${fields} } }`;
const mutation = gql`mutation($input: StorefrontCartCommandInput!) { applyStorefrontCartCommand(input: $input) {
    status errorCode message appliedRevision cart { ${fields} } session { checkout { id cartRevision state } } } }`;
const read = async () => (await shopClient.query(query)).storefrontCart;
const send = async (operation: object) => {
    const cart = await read();
    return (
        await shopClient.query(mutation, {
            input: {
                commandId: randomUUID(),
                cartId: cart.id,
                expectedRevision: cart.revision,
                ...operation,
            },
        })
    ).applyStorefrontCartCommand;
};
let variants: string[];
let couponId: string;

beforeAll(async () => {
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            collections: [],
            paymentMethods: [
                { name: 'Cart local fixture', handler: { code: localPayment.code, arguments: [] } },
            ],
        },
        customerCount: 0,
    });
    await adminClient.asSuperAdmin();
    adminClient.setRequestHeader(
        'x-vendure-sensitive-action-password',
        config.authOptions.superadminCredentials?.password ?? '',
    );
    const product = await adminClient.query(gql`
        mutation {
            createProduct(
                input: {
                    translations: [
                        {
                            languageCode: zh_Hans
                            name: "购物车验证商品"
                            slug: "cart-qa-digital"
                            description: "购物车状态、库存、优惠与结算验收商品"
                        }
                    ]
                }
            ) {
                id
            }
        }
    `);
    const group = await adminClient.query(
        gql`
            mutation ($input: CreateProductOptionGroupInput!) {
                createProductOptionGroup(input: $input) {
                    id
                    options {
                        id
                    }
                }
            }
        `,
        {
            input: {
                code: 'cart-qa-size',
                translations: [{ languageCode: 'zh_Hans', name: '验证规格' }],
                options: Array.from({ length: 50 }, (_, index) => ({
                    code: `qa-${index}`,
                    translations: [{ languageCode: 'zh_Hans', name: `规格 ${index}` }],
                })),
            },
        },
    );
    await adminClient.query(
        gql`
            mutation ($productId: ID!, $optionGroupId: ID!) {
                addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) {
                    id
                }
            }
        `,
        { productId: product.createProduct.id, optionGroupId: group.createProductOptionGroup.id },
    );
    const created = await adminClient.query(
        gql`
            mutation ($input: [CreateProductVariantInput!]!) {
                createProductVariants(input: $input) {
                    id
                }
            }
        `,
        {
            input: Array.from({ length: 50 }, (_, index) => ({
                productId: product.createProduct.id,
                optionIds: [group.createProductOptionGroup.options[index].id],
                sku: `CART-QA-${index}`,
                price: 1000,
                stockOnHand: 100,
                translations: [{ languageCode: 'zh_Hans', name: `购物车验证 ${index}` }],
                customFields: {
                    digitalDeliveryMode: 'manual_service',
                    digitalStockPolicy: 'unlimited',
                },
            })),
        },
    );
    variants = created.createProductVariants.map((variant: any) => variant.id);
    await adminClient.query(gql`
        mutation {
            createCustomer(
                input: { firstName: "Cart", lastName: "QA", emailAddress: "cart-qa@example.test" }
                password: "local-cart-qa-password"
            ) {
                ... on Customer {
                    id
                }
            }
        }
    `);
    await shopClient.asUserWithCredentials('cart-qa@example.test', 'local-cart-qa-password');
    await read();
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());

describe('complete cart domain on MySQL', () => {
    it('rehearses the additive migration and retains receipt fences on rollback', async () => {
        const connection = server.app.get(TransactionalConnection);
        const runner = connection.rawConnection.createQueryRunner();
        try {
            const rows = await runner.query('SELECT COUNT(*) AS count FROM storefront_cart_command_receipt');
            expect(Number(rows[0].count)).toBe(0);
            // This freshly initialized disposable test schema contains no command data.
            await runner.dropTable('storefront_cart_command_receipt');
            const migration = new AddCartCommandReceipts1788678060000();
            await migration.up(runner);
            await migration.up(runner);
            const table = await runner.getTable('storefront_cart_command_receipt');
            expect(
                table?.indices.some(
                    index => index.isUnique && index.columnNames.join(',') === 'cartId,commandId',
                ),
            ).toBe(true);
            await expect(migration.down()).rejects.toThrow('Retain');
            expect(await runner.hasTable('storefront_cart_command_receipt')).toBe(true);
        } finally {
            await runner.release();
        }
    });
    it('keeps contact and note through selection, quantities and full checkout validation', async () => {
        let result = await send({
            changes: {
                add: variants.slice(0, 4).map(productVariantId => ({ productVariantId, quantity: 1 })),
            },
        });
        expect(result.status, result.message).toBe('APPLIED');
        expect((await send({ order: { note: 'Keep this reviewed delivery note' } })).status).toBe('APPLIED');
        expect(
            (
                await send({
                    deliveryEmail: {
                        emailAddress: 'delivery@example.test',
                        confirmEmailAddress: 'delivery@example.test',
                    },
                })
            ).status,
        ).toBe('APPLIED');
        const before = await read();
        result = await send({
            changes: {
                lines: [
                    { lineId: before.lines[0].id, quantity: 3 },
                    { lineId: before.lines[1].id, selected: false },
                ],
            },
        });
        expect(result.status, result.message).toBe('APPLIED');
        const orderLines = result.cart.checkoutOrder.lines.map((line: any) => line.id);
        result = await send({ beginCheckout: true });
        expect(result.status, result.message).toBe('APPLIED');
        expect(result.cart.checkoutOrder.lines.map((line: any) => line.id)).toEqual(orderLines);
        expect(result.cart.checkoutOrder.customFields).toEqual({
            customerNote: 'Keep this reviewed delivery note',
            deliveryEmail: 'delivery@example.test',
        });
    });

    it('uses existing owned-coupon rules through automatic selection and manual removal', async () => {
        const campaign = await adminClient.query(gql`
            mutation {
                createStoreCouponCampaign(
                    input: { name: "Cart QA 10 percent", kind: ORDER_PERCENTAGE, discountRate: 9 }
                ) {
                    id
                }
            }
        `);
        couponId = (
            await shopClient.query(
                gql`
                    mutation ($id: ID!) {
                        claimStorefrontCoupon(campaignId: $id) {
                            id
                        }
                    }
                `,
                { id: campaign.createStoreCouponCampaign.id },
            )
        ).claimStorefrontCoupon.id;
        const before = await read();
        const applied = await send({ coupon: { action: 'BEST' } });
        expect(applied.status, applied.message).toBe('APPLIED');
        expect(applied.cart.checkoutOrder.totalWithTax).toBeLessThan(before.checkoutOrder.totalWithTax);
        const removed = await send({ coupon: { action: 'REMOVE', couponId } });
        expect(removed.status, removed.message).toBe('APPLIED');
        expect(removed.cart.checkoutOrder.totalWithTax).toBe(before.checkoutOrder.totalWithTax);
        expect(removed.cart.revision).toBeGreaterThan(applied.cart.revision);
    });

    it('creates an idempotent payment snapshot and rejects price changes while locked', async () => {
        const applied = await send({ coupon: { action: 'APPLY', couponId } });
        expect(applied.status, applied.message).toBe('APPLIED');
        const cart = await read();
        const input = {
            commandId: randomUUID(),
            cartId: cart.id,
            expectedRevision: cart.revision,
            preparePayment: true,
        };
        const a = (await shopClient.query(mutation, { input })).applyStorefrontCartCommand;
        expect(a.status, a.message).toBe('APPLIED');
        const b = (await shopClient.query(mutation, { input })).applyStorefrontCartCommand;
        expect(b.session.checkout.id).toBe(a.session.checkout.id);
        expect(a.cart.state).toBe('PAYMENT_PENDING');
        const connection = server.app.get(TransactionalConnection);
        const decodedCouponId = server.app.get(ConfigService).entityIdStrategy.decodeId(couponId);
        await connection.rawConnection
            .getRepository(CustomerCoupon)
            .update(decodedCouponId, { lockExpiresAt: new Date(Date.now() - 60000) });
        expect((await server.app.get(StoreCouponLifecycleService).reconcile()).released).toBe(0);
        await expect(
            adminClient.query(
                gql`
                    mutation ($id: ID!) {
                        revokeStoreCustomerCoupon(id: $id) {
                            id
                        }
                    }
                `,
                { id: couponId },
            ),
        ).rejects.toThrow('Checkout is locked');
        expect((await read()).checkoutOrder.totalWithTax).toBe(a.cart.checkoutOrder.totalWithTax);
        expect((await read()).revision).toBe(a.cart.revision);
        await connection.rawConnection
            .getRepository(CustomerCoupon)
            .update(decodedCouponId, { lockExpiresAt: new Date(Date.now() + 600000) });
        expect((await send({ coupon: { action: 'REMOVE', couponId } })).errorCode).toBe(
            'CART_CHECKOUT_LOCKED_ERROR',
        );
        expect(
            (await send({ changes: { lines: [{ lineId: cart.lines[0].id, quantity: 6 }] } })).errorCode,
        ).toBe('CART_CHECKOUT_LOCKED_ERROR');
        expect((await send({ reopen: true })).status).toBe('APPLIED');
    });

    it('completes a local fixture payment once and preserves unselected items on repeated completion', async () => {
        const before = await read();
        const prepared = await send({ preparePayment: true });
        expect(prepared.status, prepared.message).toBe('APPLIED');
        const paid = await shopClient.query(gql`
            mutation {
                addPaymentToOrder(input: { method: "cart-local-fixture", metadata: {} }) {
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
        `);
        expect(paid.addPaymentToOrder.state, paid.addPaymentToOrder.message).toBe('PaymentSettled');
        const after = await read();
        expect(after.lines.map((line: any) => line.id)).toEqual(
            before.lines.filter((line: any) => !line.selected).map((line: any) => line.id),
        );
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const connection = server.app.get(TransactionalConnection);
        await connection.withTransaction(ctx, tx =>
            server.app
                .get(StorefrontCartLifecycleService)
                .completeCheckoutForOrder(
                    tx,
                    server.app.get(ConfigService).entityIdStrategy.decodeId(paid.addPaymentToOrder.id),
                ),
        );
        expect(await read()).toEqual(after);
    });

    it('does not reveal another session cart or receipt', async () => {
        const other = new SimpleGraphQLClient(config, `http://127.0.0.1:${config.apiOptions.port}/shop-api`);
        const cart = (await other.query(query)).storefrontCart;
        expect(cart.lines).toEqual([]);
        expect(cart.id).not.toBe((await read()).id);
    });

    it('preserves a concurrent account edit during login merge and rejects an old guest command', async () => {
        const before = await read();
        const guest = new SimpleGraphQLClient(config, `http://127.0.0.1:${config.apiOptions.port}/shop-api`);
        const empty = (await guest.query(query)).storefrontCart;
        const input = {
            cartId: empty.id,
            commandId: randomUUID(),
            expectedRevision: empty.revision,
            changes: { add: [{ productVariantId: before.lines[0].productVariant.id, quantity: 2 }] },
        };
        expect((await guest.query(mutation, { input })).applyStorefrontCartCommand.status).toBe('APPLIED');
        const carts = server.app.get(StorefrontCartService);
        const merge = carts.mergeAfterLogin.bind(carts);
        let started!: () => void;
        let resume!: () => void;
        const entering = new Promise<void>(resolve => {
            started = resolve;
        });
        const gate = new Promise<void>(resolve => {
            resume = resolve;
        });
        const spy = vi.spyOn(carts, 'mergeAfterLogin').mockImplementationOnce(async (ctx, userId) => {
            started();
            await gate;
            return merge(ctx, userId);
        });
        const loggingIn = guest.query(gql`
            mutation {
                login(username: "cart-qa@example.test", password: "local-cart-qa-password") {
                    ... on CurrentUser {
                        id
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `);
        try {
            await entering;
            const edited = await send({ changes: { lines: [{ lineId: before.lines[0].id, quantity: 5 }] } });
            expect(edited.status, edited.message).toBe('APPLIED');
        } finally {
            resume();
        }
        await loggingIn;
        spy.mockRestore();
        const merged = (await guest.query(query)).storefrontCart;
        expect(
            merged.lines.find((line: any) => line.productVariant.id === before.lines[0].productVariant.id)
                ?.quantity,
        ).toBe(7);
        expect(merged.totalQuantity).toBe(before.totalQuantity - before.lines[0].quantity + 7);
        const replay = (await guest.query(mutation, { input })).applyStorefrontCartCommand;
        expect(replay.errorCode).toBe('CART_SCOPE_CHANGED');
        expect((await guest.query(query)).storefrontCart.totalQuantity).toBe(merged.totalQuantity);
    });

    it('measures 1/4/20/50-line edits and avoids whole-order removal', async () => {
        const orders = server.app.get(OrderService);
        const removeAll = vi.spyOn(orders, 'removeAllItemsFromOrder');
        const adjust = vi.spyOn(orders, 'adjustOrderLines');
        const measurements: object[] = [];
        const pricing = vi.spyOn(orders, 'applyPriceAdjustments');
        const connection = server.app.get(TransactionalConnection);
        const logger = connection.rawConnection.logger;
        const originalLogQuery = logger.logQuery.bind(logger);
        let queryCount = 0;
        logger.logQuery = (...args) => {
            queryCount++;
            originalLogQuery(...args);
        };
        for (const size of [1, 4, 20, 50]) {
            const previous = await read();
            const seeded = await send({
                changes: {
                    remove: previous.lines.map((line: any) => line.id),
                    add: variants.slice(0, size).map(productVariantId => ({ productVariantId, quantity: 1 })),
                },
            });
            expect(seeded.status, seeded.message).toBe('APPLIED');
            const samples: number[] = [];
            const sqlCounts: number[] = [];
            const pricingCounts: number[] = [];
            const responseBytes: number[] = [];
            for (let index = 0; index < 10; index++) {
                const cart = await read();
                const beforeQueries = queryCount;
                const beforePricing = pricing.mock.calls.length;
                const start = performance.now();
                const result = (
                    await shopClient.query(mutation, {
                        input: {
                            commandId: randomUUID(),
                            cartId: cart.id,
                            expectedRevision: cart.revision,
                            changes: { lines: [{ lineId: cart.lines[0].id, quantity: (index % 2) + 1 }] },
                        },
                    })
                ).applyStorefrontCartCommand;
                samples.push(performance.now() - start);
                sqlCounts.push(queryCount - beforeQueries);
                pricingCounts.push(pricing.mock.calls.length - beforePricing);
                responseBytes.push(Buffer.byteLength(JSON.stringify(result)));
                expect(result.status, result.message).toBe('APPLIED');
            }
            samples.sort((a, b) => a - b);
            measurements.push({
                lines: size,
                samples: samples.length,
                p50Ms: Math.round(samples[4]),
                p95Ms: Math.round(samples[9]),
                maxSqlQueries: Math.max(...sqlCounts),
                maxPricingCalls: Math.max(...pricingCounts),
                maxResponseBytes: Math.max(...responseBytes),
            });
        }
        expect(removeAll).not.toHaveBeenCalled();
        expect(adjust).toHaveBeenCalled();
        const output = path.join(__dirname, '../../../artifacts/cart-commands');
        mkdirSync(output, { recursive: true });
        writeFileSync(path.join(output, 'mysql-performance.json'), JSON.stringify(measurements, null, 2));
        process.stdout.write(JSON.stringify({ mysqlCartMeasurements: measurements }) + '\n');
        logger.logQuery = originalLogQuery;
        pricing.mockRestore();
        removeAll.mockRestore();
        adjust.mockRestore();
    }, 120000);
    it('quotes a mixed cart with physical shipping and digital delivery requirements', async () => {
        await adminClient.query(gql`
            mutation {
                updateMyStoreCommerceMode(mode: HYBRID) {
                    mode
                }
            }
        `);
        const product = await adminClient.query(gql`
            mutation {
                createProduct(
                    input: {
                        translations: [
                            {
                                languageCode: zh_Hans
                                name: "实体配送验证"
                                slug: "cart-qa-physical"
                                description: "混合购物车配送验证商品"
                            }
                        ]
                        customFields: { fulfillmentType: "physical" }
                    }
                ) {
                    id
                }
            }
        `);
        const variant = await adminClient.query(
            gql`
                mutation ($input: [CreateProductVariantInput!]!) {
                    createProductVariants(input: $input) {
                        id
                    }
                }
            `,
            {
                input: [
                    {
                        productId: product.createProduct.id,
                        sku: 'CART-PHYSICAL-QA',
                        price: 1500,
                        stockOnHand: 100,
                        translations: [{ languageCode: 'zh_Hans', name: '实体配送验证规格' }],
                    },
                ],
            },
        );
        const added = await send({
            changes: { add: [{ productVariantId: variant.createProductVariants[0].id, quantity: 1 }] },
        });
        expect(added.status, added.message).toBe('APPLIED');
        expect(added.cart.checkoutOrder.checkoutFulfillment).toMatchObject({
            fulfillmentType: 'MIXED',
            containsDigitalProducts: true,
            containsPhysicalProducts: true,
            requiresShippingAddress: true,
            requiresShippingMethod: true,
        });
        expect(
            (
                await send({
                    order: {
                        shippingAddress: {
                            fullName: 'Cart QA',
                            streetLine1: '100 Test Street',
                            city: 'London',
                            postalCode: 'SW1A 1AA',
                            province: 'London',
                            phoneNumber: '10000000000',
                            countryCode: 'GB',
                        },
                    },
                })
            ).status,
        ).toBe('APPLIED');
        const methods = await shopClient.query(gql`
            query {
                eligibleShippingMethods {
                    id
                }
            }
        `);
        expect(
            (await send({ order: { shippingMethodId: methods.eligibleShippingMethods[0].id } })).status,
        ).toBe('APPLIED');
        expect(
            (
                await send({
                    deliveryEmail: {
                        emailAddress: 'mixed@example.test',
                        confirmEmailAddress: 'mixed@example.test',
                    },
                })
            ).status,
        ).toBe('APPLIED');
        const prepared = await send({ preparePayment: true });
        expect(prepared.status, prepared.message).toBe('APPLIED');
        expect(prepared.cart.state).toBe('PAYMENT_PENDING');
    });
});

// Controlled checkout uses the real cart, payment, fulfillment and store plugins against a disposable DB.
describe('controlled test payments', () => {
    it('allows all checkout customers, settles the amount due and follows normal order and fulfillment steps', async () => {
        const client = new SimpleGraphQLClient(config, `http://127.0.0.1:${config.apiOptions.port}/shop-api`);
        const guest = new SimpleGraphQLClient(config, `http://127.0.0.1:${config.apiOptions.port}/shop-api`);
        const other = new SimpleGraphQLClient(config, `http://127.0.0.1:${config.apiOptions.port}/shop-api`);
        const channel = (
            await adminClient.query(gql`
                query {
                    activeChannel {
                        id
                    }
                }
            `)
        ).activeChannel;
        const createCustomer = gql`
            mutation ($input: CreateCustomerInput!) {
                createCustomer(input: $input, password: "local-controlled-test-only") {
                    ... on Customer {
                        id
                        user {
                            id
                            verified
                        }
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `;
        const created = await adminClient.query(createCustomer, {
            input: {
                firstName: 'Controlled',
                lastName: 'Test',
                emailAddress: 'controlled-payment@example.test',
            },
        });
        await adminClient.query(createCustomer, {
            input: { firstName: 'Outside', lastName: 'Test', emailAddress: 'outside-payment@example.test' },
        });
        const customer = created.createCustomer;
        expect(customer.user?.verified, customer.message).toBe(true);
        const code = `controlled-test-payment-${channel.id}`;
        const input = {
            code,
            enabled: false,
            translations: [
                {
                    languageCode: 'zh_Hans',
                    name: '测试支付',
                    description: '按应付金额模拟支付成功，无需真实转账',
                },
            ],
            checker: { code: 'controlled-test-payment-checker', arguments: [] },
            handler: {
                code: 'controlled-test-payment-handler',
                arguments: [{ name: 'channelId', value: JSON.stringify(channel.id) }],
            },
        };
        const createMethod = gql`
            mutation ($input: CreatePaymentMethodInput!) {
                createPaymentMethod(input: $input) {
                    id
                    enabled
                }
            }
        `;
        const updateMethod = gql`
            mutation ($input: UpdatePaymentMethodInput!) {
                updatePaymentMethod(input: $input) {
                    id
                    enabled
                    checker {
                        code
                    }
                }
            }
        `;
        await expect(adminClient.query(createMethod, { input: { ...input, checker: null } })).rejects.toThrow(
            '测试',
        );
        const method = (await adminClient.query(createMethod, { input })).createPaymentMethod;
        const storedMethod = (
            await adminClient.query(
                gql`
                    query ($id: ID!) {
                        paymentMethod(id: $id) {
                            checker {
                                code
                            }
                            handler {
                                code
                                args {
                                    name
                                    value
                                }
                            }
                        }
                    }
                `,
                { id: method.id },
            )
        ).paymentMethod;
        expect(storedMethod.checker?.code, JSON.stringify(storedMethod)).toBe(
            'controlled-test-payment-checker',
        );
        const eligible = gql`
            query {
                eligiblePaymentMethods {
                    code
                    isEligible
                }
            }
        `;
        const pay = gql`
            mutation ($method: String!) {
                addPaymentToOrder(
                    input: { method: $method, metadata: { state: "Settled", public: { testPayment: false } } }
                ) {
                    ... on Order {
                        id
                        code
                        active
                        state
                        orderPlacedAt
                        totalWithTax
                        payments {
                            id
                            state
                            amount
                            metadata
                        }
                        lines {
                            id
                            quantity
                            productVariant {
                                sku
                            }
                        }
                    }
                    ... on ErrorResult {
                        message
                        errorCode
                    }
                }
            }
        `;
        const readClient = async (c: SimpleGraphQLClient) => (await c.query(query)).storefrontCart;
        const commandFor = async (c: SimpleGraphQLClient, operation: object) => {
            const cart = await readClient(c);
            const result = (
                await c.query(mutation, {
                    input: {
                        commandId: randomUUID(),
                        cartId: cart.id,
                        expectedRevision: cart.revision,
                        ...operation,
                    },
                })
            ).applyStorefrontCartCommand;
            expect(result.status, result.message).toBe('APPLIED');
            return result.cart;
        };
        const prepare = async (c: SimpleGraphQLClient, email: string) => {
            await commandFor(c, { changes: { add: [{ productVariantId: variants[0], quantity: 1 }] } });
            await commandFor(c, { beginCheckout: true });
            if (c === guest)
                await c.query(
                    gql`
                        mutation ($input: CreateCustomerInput!) {
                            setCustomerForOrder(input: $input) {
                                ... on Order {
                                    id
                                }
                                ... on ErrorResult {
                                    message
                                }
                            }
                        }
                    `,
                    {
                        input: { firstName: 'Guest', lastName: 'Test', emailAddress: email },
                    },
                );
            await commandFor(c, { deliveryEmail: { emailAddress: email, confirmEmailAddress: email } });
            return commandFor(c, { preparePayment: true });
        };
        await client.asUserWithCredentials('controlled-payment@example.test', 'local-controlled-test-only');
        const before = await prepare(client, 'controlled-payment@example.test');
        expect((await client.query(eligible)).eligiblePaymentMethods.some((m: any) => m.code === code)).toBe(
            false,
        );
        await expect(client.query(pay, { method: code })).rejects.toThrow();
        await adminClient.query(updateMethod, { input: { id: method.id, enabled: true } });
        await expect(
            adminClient.query(updateMethod, { input: { id: method.id, checker: null } }),
        ).rejects.toThrow('测试');
        expect(
            (await client.query(eligible)).eligiblePaymentMethods.find((m: any) => m.code === code)
                ?.isEligible,
        ).toBe(true);

        // Everyone who can complete the ordinary checkout can use the enabled method.
        await prepare(guest, 'guest-test@example.test');
        expect(
            (await guest.query(eligible)).eligiblePaymentMethods.find((m: any) => m.code === code)
                ?.isEligible,
        ).toBe(true);
        await other.asUserWithCredentials('outside-payment@example.test', 'local-controlled-test-only');
        await prepare(other, 'outside-payment@example.test');
        expect(
            (await other.query(eligible)).eligiblePaymentMethods.find((m: any) => m.code === code)
                ?.isEligible,
        ).toBe(true);

        const connection = server.app.get(TransactionalConnection);
        const snapshot = async () => {
            const names = [
                'stock_movement',
                'auto_card_delivery',
                'manual_digital_delivery',
                'referral_reward',
                'referral_ledger_entry',
            ];
            const result: Record<string, unknown> = {};
            for (const table of names)
                result[table] = await connection.rawConnection.query(
                    `SELECT COUNT(*) AS count FROM ${table}`,
                );
            result.stock = await connection.rawConnection.query(
                'SELECT id, stockOnHand, stockAllocated FROM stock_level ORDER BY id',
            );
            return result;
        };
        const placedOrderIds: string[] = [];
        server.app.get(EventBus).registerBlockingEventHandler({
            event: OrderPlacedEvent,
            id: 'normal-test-payment-order-placed',
            handler: event => {
                placedOrderIds.push(String(event.order.id));
            },
        });
        const baseline = await snapshot();
        const token = (
            await client.query(gql`
                mutation {
                    createStorefrontOrderConfirmationToken {
                        token
                    }
                }
            `)
        ).createStorefrontOrderConfirmationToken.token;
        const paid = (await client.query(pay, { method: code })).addPaymentToOrder;
        expect(paid.state, paid.message).toBe('PaymentSettled');
        expect(paid.active).toBe(false);
        expect(paid.orderPlacedAt).not.toBeNull();
        expect(paid.payments).toHaveLength(1);
        expect(paid.payments[0].state).toBe('Settled');
        expect(paid.payments[0].metadata.public.testPayment).toBe(true);
        expect(paid.payments[0].amount).toBe(paid.totalWithTax);
        const cartAfter = await readClient(client);
        expect(cartAfter.state).toBe('OPEN');
        expect(cartAfter.lines).toHaveLength(0);
        const confirmation = await client.query(
            gql`
                query ($token: String!) {
                    storefrontOrderByConfirmationToken(token: $token) {
                        code
                        state
                    }
                }
            `,
            { token },
        );
        expect(confirmation.storefrontOrderByConfirmationToken.state).toBe('PaymentSettled');
        const repeated = await client.query(pay, { method: code });
        expect(repeated.addPaymentToOrder.state).not.toBe('PaymentSettled');
        const runtimeConfig = server.app.get(ConfigService);
        const idStrategy = runtimeConfig.entityOptions.entityIdStrategy ?? runtimeConfig.entityIdStrategy;
        const decoded = idStrategy.decodeId(paid.id);
        const saved = await connection.rawConnection
            .getRepository(Order)
            .findOneOrFail({ where: { id: decoded }, relations: ['payments'] });
        expect(saved.payments).toHaveLength(1);
        expect(placedOrderIds.filter(id => id === String(decoded))).toHaveLength(1);
        const normalDelivery = await connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM manual_digital_delivery WHERE orderId = ?',
            [decoded],
        );
        expect(Number(normalDelivery[0].count)).toBe(1);
        for (const account of [guest, other]) {
            const accountPaid = (await account.query(pay, { method: code })).addPaymentToOrder;
            expect(accountPaid.state, accountPaid.message).toBe('PaymentSettled');
            expect(accountPaid.payments[0]).toMatchObject({
                state: 'Settled',
                amount: accountPaid.totalWithTax,
            });
            expect(accountPaid.payments[0].metadata.public.testPayment).toBe(true);
        }

        // Concurrent submissions must place exactly one ordinary order, payment and delivery.
        const concurrentCart = await prepare(client, 'controlled-payment@example.test');
        const submissions = await Promise.allSettled([
            client.query(pay, { method: code }),
            client.query(pay, { method: code }),
        ]);
        expect(
            submissions.some(
                result =>
                    result.status === 'fulfilled' &&
                    result.value.addPaymentToOrder.state === 'PaymentSettled',
            ),
        ).toBe(true);
        const concurrentOrder = await connection.rawConnection.getRepository(Order).findOneOrFail({
            where: {
                id: idStrategy.decodeId(concurrentCart.checkoutOrder.id),
            },
            relations: ['payments'],
        });
        expect(concurrentOrder.state).toBe('PaymentSettled');
        expect(concurrentOrder.payments).toHaveLength(1);
        expect(placedOrderIds.filter(id => id === String(concurrentOrder.id))).toHaveLength(1);
        const concurrentDelivery = await connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM manual_digital_delivery WHERE orderId = ?',
            [concurrentOrder.id],
        );
        expect(Number(concurrentDelivery[0].count)).toBe(1);

        // The mixed physical/digital cart prepared above must use the same stock and shipment path.
        const physicalStock = async () =>
            (
                await connection.rawConnection.query(
                    'SELECT sl.stockOnHand, sl.stockAllocated FROM stock_level sl JOIN product_variant pv ON pv.id = sl.productVariantId WHERE pv.sku = ?',
                    ['CART-PHYSICAL-QA'],
                )
            )[0];
        const stockBefore = await physicalStock();
        const mixedPaid = (await shopClient.query(pay, { method: code })).addPaymentToOrder;
        expect(mixedPaid.state, mixedPaid.message).toBe('PaymentSettled');
        const stockAfterPayment = await physicalStock();
        expect(Number(stockAfterPayment.stockAllocated)).toBe(Number(stockBefore.stockAllocated) + 1);
        const physicalLine = mixedPaid.lines.find(
            (line: any) => line.productVariant.sku === 'CART-PHYSICAL-QA',
        );
        const fulfillment = (
            await adminClient.query(
                gql`
                    mutation ($input: FulfillOrderInput!) {
                        addFulfillmentToOrder(input: $input) {
                            ... on Fulfillment {
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
                        lines: [{ orderLineId: physicalLine.id, quantity: 1 }],
                        handler: {
                            code: 'manual-fulfillment',
                            arguments: [
                                { name: 'method', value: 'test' },
                                { name: 'trackingCode', value: '' },
                            ],
                        },
                    },
                },
            )
        ).addFulfillmentToOrder;
        expect(fulfillment.id, fulfillment.message).toBeTruthy();

        // A subsequent order still uses the normal settlement and manual delivery path.
        await prepare(client, 'controlled-payment@example.test');
        const regular = (await client.query(pay, { method: 'cart-local-fixture' })).addPaymentToOrder;
        expect(regular.state, regular.message).toBe('PaymentSettled');
        expect(regular.orderPlacedAt).not.toBeNull();
        expect(regular.payments[0].state).toBe('Settled');
        const deliveries = await connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM manual_digital_delivery',
        );
        expect(Number(deliveries[0].count)).toBeGreaterThan(
            Number((baseline.manual_digital_delivery as any[])[0].count),
        );
        await adminClient.query(updateMethod, { input: { id: method.id, enabled: false } });
        expect(before.checkoutOrder.id).not.toBe(regular.id);
    }, 60_000);
});
