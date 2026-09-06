import { CommerceFulfillmentPlugin } from '@vendure/commerce-fulfillment-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ConfigService,
    LanguageCode,
    mergeConfig,
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
        CommerceFulfillmentPlugin,
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
