import {
    Allocation,
    ConfigService,
    getConfig,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    ProductVariant,
    Release,
    RequestContextService,
    StockLevel,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import { OrderLineEntityResolver } from '@vendure/core/dist/api/resolvers/entity/order-line-entity.resolver';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StorefrontCartLine } from '../src/entities/storefront-cart-line.entity';
import { StorefrontCartPlugin } from '../src/storefront-cart.plugin';

const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig(), {
        apiOptions: { port: 13388 },
        importExportOptions: { importAssetsDir: path.join(__dirname, '../../core/e2e/fixtures/assets') },
        customFields: {
            ProductVariant: [{ name: 'fulfillmentType', type: 'string', nullable: true, public: true }],
            OrderLine: [{ name: 'fulfillmentTypeSnapshot', type: 'string', nullable: true, public: true }],
        },
        plugins: [StorefrontCartPlugin],
    }),
);
const fields = `id revision state selectedQuantity lines { id quantity selected productVariant { id } } checkoutOrder { id totalWithTax lines { id
quantity productVariant { id } } }`;
const cartQuery = gql`query { storefrontCart { ${fields} } }`;
const command = gql`mutation($input: StorefrontCartCommandInput!) { applyStorefrontCartCommand(input: $input) { commandId status appliedRevision
errorCode cart { ${fields} } shippingMethods { id code name priceWithTax } selectedShippingMethodId } }`;
const recover = gql`mutation($id: String!, $cartId: ID!, $cancel: Boolean!) { recoverStorefrontCartCommand(cartId: $cartId, commandId: $id, cancel:
$cancel) { status cart { ${fields} } } }`;
let variantIds: string[];
let cartId: string;
const read = async () => (await shopClient.query(cartQuery)).storefrontCart;
const send = async (input: Record<string, unknown>) =>
    (await shopClient.query(command, { input })).applyStorefrontCartCommand;

beforeAll(async () => {
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });
    await adminClient.asSuperAdmin();
    const result = await shopClient.query(gql`
        query {
            products(options: { take: 10 }) {
                items {
                    variants {
                        id
                    }
                }
            }
        }
    `);
    variantIds = result.products.items.flatMap((product: any) =>
        product.variants.map((variant: any) => variant.id),
    );
    cartId = (await read()).id; // Establish a single guest session before concurrent requests.
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());

describe('cart commands against a real database', () => {
    it('rejects cross-channel cart ids and cannot read another channel receipt', async () => {
        const before = await read();
        const original = (
            await adminClient.query(gql`
                query {
                    activeChannel {
                        token
                        defaultTaxZone {
                            id
                        }
                        defaultShippingZone {
                            id
                        }
                    }
                }
            `)
        ).activeChannel;
        const created = await adminClient.query(
            gql`
                mutation ($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            token
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'cart-scope-qa',
                    token: 'cart-scope-qa',
                    defaultLanguageCode: 'en',
                    pricesIncludeTax: false,
                    defaultCurrencyCode: 'USD',
                    defaultTaxZoneId: original.defaultTaxZone.id,
                    defaultShippingZoneId: original.defaultShippingZone.id,
                },
            },
        );
        expect(created.createChannel.token, created.createChannel.message).toBe('cart-scope-qa');
        shopClient.setChannelToken('cart-scope-qa');
        try {
            const other = await read();
            expect(other.lines).toEqual([]);
            expect(other.id).not.toBe(before.id);
            const commandId = randomUUID();
            const denied = await send({
                cartId: before.id,
                commandId,
                expectedRevision: 0,
                changes: { add: [{ productVariantId: variantIds[0], quantity: 1 }] },
            });
            expect(denied.errorCode).toBe('CART_SCOPE_CHANGED');
            expect(denied.cart.id).toBe(other.id);
            expect(
                (await shopClient.query(recover, { cartId: before.id, id: commandId, cancel: false }))
                    .recoverStorefrontCartCommand.status,
            ).toBe('REJECTED');
            expect(
                (
                    await send({
                        cartId: other.id,
                        commandId: randomUUID(),
                        expectedRevision: other.revision,
                        changes: { add: [{ productVariantId: variantIds[0], quantity: 1 }] },
                    })
                ).status,
            ).toBe('REJECTED');
        } finally {
            shopClient.setChannelToken(original.token);
        }
        expect(await read()).toEqual(before);
    });

    it('deduplicates simultaneous additive commands and returns the current snapshot on replay', async () => {
        const before = await read();
        const input = {
            commandId: randomUUID(),
            cartId,
            expectedRevision: before.revision,
            changes: { add: [{ productVariantId: variantIds[0], quantity: 1 }] },
        };
        const [a, b] = await Promise.all([send(input), send(input)]);
        expect(a.status).toBe('APPLIED');
        expect(b.status).toBe('APPLIED');
        const cart = await read();
        expect(cart.lines[0].quantity).toBe(1);
        expect(cart.revision).toBe(before.revision + 1);
        await send({
            commandId: randomUUID(),
            cartId,
            expectedRevision: cart.revision,
            changes: { lines: [{ lineId: cart.lines[0].id, quantity: 2 }] },
        });
        const replay = await send(input);
        expect(replay.appliedRevision).toBe(before.revision + 1);
        expect(replay.cart.lines[0].quantity).toBe(2);
        expect(
            (await send({ ...input, changes: { add: [{ productVariantId: variantIds[0], quantity: 3 }] } }))
                .errorCode,
        ).toBe('COMMAND_ID_REUSED');
    });

    it('atomically rejects an invalid batch without changing quantities or revision', async () => {
        const before = await read();
        const input = {
            commandId: randomUUID(),
            cartId,
            expectedRevision: before.revision,
            changes: {
                add: [
                    { productVariantId: variantIds[0], quantity: 2 },
                    { productVariantId: variantIds[1], quantity: -1 },
                ],
            },
        };
        expect((await send(input)).status).toBe('REJECTED');
        expect(await read()).toEqual(before);
        expect((await send(input)).status).toBe('REJECTED');
    });

    it('fences late commands after an unknown result is cancelled', async () => {
        const before = await read();
        const commandId = randomUUID();
        expect(
            (await shopClient.query(recover, { id: commandId, cartId: before.id, cancel: false }))
                .recoverStorefrontCartCommand.status,
        ).toBe('NOT_FOUND');
        expect(
            (await shopClient.query(recover, { id: commandId, cartId: before.id, cancel: true }))
                .recoverStorefrontCartCommand.status,
        ).toBe('CANCELLED');
        expect(
            (
                await send({
                    commandId,
                    cartId: before.id,
                    expectedRevision: before.revision,
                    changes: { add: [{ productVariantId: variantIds[0], quantity: 8 }] },
                })
            ).status,
        ).toBe('CANCELLED');
        expect(await read()).toEqual(before);
    });

    it('applies mixed targets as one revision while preserving retained order line identity', async () => {
        let cart = await read();
        cart = (
            await send({
                commandId: randomUUID(),
                cartId,
                expectedRevision: cart.revision,
                changes: { add: [{ productVariantId: variantIds[1], quantity: 1 }] },
            })
        ).cart;
        const retained = cart.checkoutOrder.lines.find(
            (line: any) => line.productVariant.id === variantIds[0],
        ).id;
        const result = await send({
            commandId: randomUUID(),
            cartId,
            expectedRevision: cart.revision,
            changes: {
                lines: [
                    { lineId: cart.lines[0].id, quantity: 3, selected: true },
                    { lineId: cart.lines[1].id, selected: false },
                ],
            },
        });
        expect(result.status).toBe('APPLIED');
        expect(result.cart.revision).toBe(cart.revision + 1);
        expect(result.cart.checkoutOrder.lines).toHaveLength(1);
        expect(result.cart.checkoutOrder.lines[0]).toMatchObject({ id: retained, quantity: 3 });
    });

    it('buys only the requested item after stock reservations while retaining the ledger and other cart items', async () => {
        const connection = server.app.get(TransactionalConnection);
        const contexts = server.app.get(RequestContextService);
        const stock = server.app.get(StockMovementService);
        const ctx = await contexts.create({ apiType: 'admin' });
        const decode = (id: string) => {
            const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
            if (!strategy) throw new Error('Test entity ID strategy missing');
            return strategy.decodeId(id);
        };
        const couponCode = 'CART-STOCK-HISTORY';
        await adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: [{ id: variantIds[1], trackInventory: 'TRUE', stockOnHand: 100 }] },
        );
        const created = await adminClient.query(
            gql`
                mutation ($input: CreatePromotionInput!) {
                    createPromotion(input: $input) {
                        ... on Promotion {
                            id
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    enabled: true,
                    couponCode,
                    conditions: [],
                    actions: [
                        { code: 'order_fixed_discount', arguments: [{ name: 'discount', value: '100' }] },
                    ],
                    translations: [{ languageCode: 'en', name: 'Stock history regression', description: '' }],
                },
            },
        );
        expect(created.createPromotion.id, created.createPromotion.message).toBeTruthy();
        const orderQuery = gql`
            query {
                activeOrder {
                    id
                    currencyCode
                    couponCodes
                    totalWithTax
                    discounts {
                        amountWithTax
                    }
                    lines {
                        id
                        quantity
                        productVariant {
                            id
                        }
                    }
                }
            }
        `;
        const readOrder = async () => (await shopClient.query(orderQuery)).activeOrder;

        for (const previouslyReleased of [true, false]) {
            let before = await read();
            const other = before.lines.find((line: any) => line.productVariant.id === variantIds[1]);
            before = (
                await send({
                    cartId,
                    commandId: randomUUID(),
                    expectedRevision: before.revision,
                    changes: { lines: [{ lineId: other.id, selected: true }] },
                })
            ).cart;
            const otherOrderLine = before.checkoutOrder.lines.find(
                (line: any) => line.productVariant.id === variantIds[1],
            );
            const otherId = decode(otherOrderLine.id);
            const variantId = decode(variantIds[1]);
            const levels = () =>
                connection.getRepository(ctx, StockLevel).find({ where: { productVariantId: variantId } });
            const allocatedBefore = (await levels()).reduce(
                (total, level) => total + level.stockAllocated,
                0,
            );
            await stock.createAllocationsForOrderLines(ctx, [{ orderLineId: otherId, quantity: 1 }]);
            if (previouslyReleased)
                await stock.createReleasesForOrderLines(ctx, [{ orderLineId: otherId, quantity: 1 }]);
            // The real FK reproduces the production failure before exercising the safe service path.
            await expect(connection.getRepository(ctx, OrderLine).delete(otherId)).rejects.toThrow();
            const coupon = await shopClient.query(
                gql`
                    mutation ($code: String!) {
                        applyCouponCode(couponCode: $code) {
                            ... on Order {
                                couponCodes
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                { code: couponCode },
            );
            expect(coupon.applyCouponCode.couponCodes, coupon.applyCouponCode.message).toContain(couponCode);
            before = await read();
            const priorOrder = await readOrder();
            const priorCartLines = before.lines.map((line: any) => ({
                id: line.id,
                variantId: line.productVariant.id,
                quantity: line.quantity,
            }));
            const retainedId = before.checkoutOrder.lines.find(
                (line: any) => line.productVariant.id === variantIds[0],
            ).id;

            // Cancelling an unknown command must be a fence, not a cart/coupon mutation.
            const cancelled = (await shopClient.query(recover, { id: randomUUID(), cartId, cancel: true }))
                .recoverStorefrontCartCommand;
            expect(cancelled.status).toBe('CANCELLED');
            expect(cancelled.cart).toEqual(before);
            expect(await readOrder()).toEqual(priorOrder);

            const input = {
                cartId,
                commandId: randomUUID(),
                expectedRevision: before.revision,
                buyNow: { productVariantId: variantIds[0], quantity: 1 },
            };
            if (!previouslyReleased) {
                const orders = server.app.get(OrderService);
                const originalOrderCount = await connection.getRepository(ctx, Order).count();
                const failure = vi
                    .spyOn(orders, 'addItemsToOrder')
                    .mockRejectedValueOnce(new Error('Synthetic projection migration failure'));
                try {
                    await expect(send(input)).rejects.toThrow('Synthetic projection migration failure');
                } finally {
                    failure.mockRestore();
                }
                expect(await read()).toEqual(before);
                expect(await readOrder()).toEqual(priorOrder);
                expect(await connection.getRepository(ctx, Order).count()).toBe(originalOrderCount);
                expect(
                    await connection
                        .getRepository(ctx, Release)
                        .count({ where: { orderLine: { id: otherId } } }),
                ).toBe(0);
                expect((await levels()).reduce((total, level) => total + level.stockAllocated, 0)).toBe(
                    allocatedBefore + 1,
                );
            }
            const purchased = await send(input);
            expect(purchased.status, purchased.message).toBe('APPLIED');
            expect(purchased.cart.checkoutOrder.lines).toEqual([
                { id: expect.any(String), quantity: 1, productVariant: { id: variantIds[0] } },
            ]);
            expect(purchased.cart.checkoutOrder.id).not.toBe(priorOrder.id);
            expect(purchased.cart.checkoutOrder.lines[0].id).not.toBe(retainedId);
            expect(
                purchased.cart.lines.map((line: any) => ({
                    id: line.id,
                    variantId: line.productVariant.id,
                    quantity: line.quantity,
                })),
            ).toEqual(
                priorCartLines.map((line: any) => ({
                    ...line,
                    quantity: line.variantId === variantIds[0] ? 1 : line.quantity,
                })),
            );
            expect(purchased.cart.lines.find((line: any) => line.id === other.id)).toMatchObject({
                selected: false,
                quantity: other.quantity,
            });
            const archived = await connection
                .getRepository(ctx, OrderLine)
                .findOne({ where: { id: otherId }, relations: ['order'] });
            expect(archived).toBeTruthy();
            expect(archived?.order).toMatchObject({
                id: decode(priorOrder.id),
                state: 'Cancelled',
                active: false,
            });
            const historyResolver = Object.assign(Object.create(OrderLineEntityResolver.prototype), {
                orderService: server.app.get(OrderService),
            }) as OrderLineEntityResolver;
            if (!archived) throw new Error('The historical order line is missing');
            const resolvedHistoryOrder = await historyResolver.order(ctx, archived, []);
            expect(resolvedHistoryOrder?.id).toBe(decode(priorOrder.id));
            const historyOrder = await adminClient.query(
                gql`
                    query ($id: ID!) {
                        order(id: $id) {
                            id
                            state
                            lines {
                                id
                            }
                        }
                    }
                `,
                { id: priorOrder.id },
            );
            expect(historyOrder.order).toMatchObject({ id: priorOrder.id, state: 'Cancelled' });
            expect(historyOrder.order.lines).toContainEqual({ id: otherOrderLine.id });
            const stockHistory = await adminClient.query(
                gql`
                    query ($id: ID!) {
                        productVariant(id: $id) {
                            stockMovements(options: { take: 100 }) {
                                items {
                                    ... on StockMovement {
                                        id
                                        type
                                        quantity
                                    }
                                }
                                totalItems
                            }
                        }
                    }
                `,
                { id: variantIds[1] },
            );
            expect(
                stockHistory.productVariant.stockMovements.items.some(
                    (movement: any) => movement.type === 'ALLOCATION',
                ),
            ).toBe(true);
            expect(
                (
                    await connection
                        .getRepository(ctx, StorefrontCartLine)
                        .findOneByOrFail({ id: decode(other.id) })
                ).orderLineId,
            ).toBeNull();
            expect(
                await connection
                    .getRepository(ctx, Allocation)
                    .count({ where: { orderLine: { id: otherId } } }),
            ).toBe(1);
            const releases = await connection
                .getRepository(ctx, Release)
                .find({ where: { orderLine: { id: otherId } } });
            expect(releases).toHaveLength(1);
            expect(releases[0].quantity).toBe(1);
            expect((await levels()).reduce((total, level) => total + level.stockAllocated, 0)).toBe(
                allocatedBefore,
            );
            const purchasedOrder = await readOrder();
            expect(purchasedOrder.couponCodes).toEqual(priorOrder.couponCodes);
            expect(purchasedOrder.currencyCode).toBe(priorOrder.currencyCode);
            expect(purchasedOrder.discounts).toEqual(priorOrder.discounts);
            expect(purchasedOrder.totalWithTax).toBe(purchased.cart.checkoutOrder.totalWithTax);

            // Same-id replay returns the same purchase without another release or quantity change.
            const replay = await send(input);
            expect(replay.status).toBe('APPLIED');
            expect(replay.cart).toEqual(purchased.cart);
            expect(
                await connection.getRepository(ctx, Release).count({ where: { orderLine: { id: otherId } } }),
            ).toBe(1);
        }
        await shopClient.query(
            gql`
                mutation ($code: String!) {
                    removeCouponCode(couponCode: $code) {
                        id
                    }
                }
            `,
            { code: couponCode },
        );
    });

    it('continues a digital historical purchase without an eligible legacy carrier and allows clearing its selection', async () => {
        const client = new SimpleGraphQLClient(getConfig(), 'http://127.0.0.1:13388/shop-api');
        const ownRead = async () => (await client.query(cartQuery)).storefrontCart;
        const ownSend = async (operation: object) => {
            const current = await ownRead();
            return (
                await client.query(command, {
                    input: {
                        cartId: current.id,
                        commandId: randomUUID(),
                        expectedRevision: current.revision,
                        ...operation,
                    },
                })
            ).applyStorefrontCartCommand;
        };
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        if (!strategy) throw new Error('Test entity ID strategy missing');
        const stock = server.app.get(StockMovementService);
        await ownSend({
            changes: {
                add: [
                    { productVariantId: variantIds[0], quantity: 1 },
                    { productVariantId: variantIds[1], quantity: 1 },
                ],
            },
        });
        const methods = (
            await client.query(gql`
                query {
                    eligibleShippingMethods {
                        id
                    }
                }
            `)
        ).eligibleShippingMethods;
        expect(methods.length).toBeGreaterThan(0);
        const methodId = methods[0].id;
        const originalMethod = (
            await adminClient.query(
                gql`
                    query ($id: ID!) {
                        shippingMethod(id: $id) {
                            translations {
                                languageCode
                                name
                                description
                            }
                            checker {
                                code
                                args {
                                    name
                                    value
                                }
                            }
                        }
                    }
                `,
                { id: methodId },
            )
        ).shippingMethod;
        expect(originalMethod.checker.code).toBe('default-shipping-eligibility-checker');
        expect((await ownSend({ order: { shippingMethodId: methodId } })).status).toBe('APPLIED');
        let before = await ownRead();
        const otherId = strategy.decodeId(
            before.checkoutOrder.lines.find((line: any) => line.productVariant.id === variantIds[1]).id,
        );
        await stock.createAllocationsForOrderLines(ctx, [{ orderLineId: otherId, quantity: 1 }]);
        await stock.createReleasesForOrderLines(ctx, [{ orderLineId: otherId, quantity: 1 }]);
        const variantRepository = connection.getRepository(ctx, ProductVariant);
        const purchasedVariantId = strategy.decodeId(variantIds[0]);
        const originalVariant = await variantRepository.findOneByOrFail({ id: purchasedVariantId });
        await variantRepository.update(purchasedVariantId, {
            customFields: { ...originalVariant.customFields, fulfillmentType: 'digital' },
        });
        try {
            const purchased = await ownSend({ buyNow: { productVariantId: variantIds[0], quantity: 1 } });
            expect(purchased.status, purchased.message).toBe('APPLIED');
            const shipping = await client.query(gql`
                query {
                    activeOrder {
                        shippingWithTax
                        lines {
                            productVariant {
                                customFields {
                                    fulfillmentType
                                }
                            }
                        }
                        shippingLines {
                            id
                        }
                    }
                }
            `);
            expect(shipping.activeOrder.lines[0].productVariant.customFields.fulfillmentType).toBe('digital');
            const stillEligible = await client.query(gql`
                query {
                    eligibleShippingMethods {
                        id
                    }
                }
            `);
            expect(stillEligible.eligibleShippingMethods.map((method: any) => method.id)).toContain(methodId);
            expect(shipping.activeOrder.shippingLines).toEqual([]);
            expect(shipping.activeOrder.shippingWithTax).toBe(0);
            const currentLineId = strategy.decodeId(purchased.cart.checkoutOrder.lines[0].id);
            await stock.createAllocationsForOrderLines(ctx, [{ orderLineId: currentLineId, quantity: 1 }]);
            await stock.createReleasesForOrderLines(ctx, [{ orderLineId: currentLineId, quantity: 1 }]);
            before = await ownRead();
            const cleared = await ownSend({
                changes: { lines: before.lines.map((line: any) => ({ lineId: line.id, selected: false })) },
            });
            expect(cleared.status, cleared.message).toBe('APPLIED');
            expect(cleared.cart.selectedQuantity).toBe(0);
            expect(cleared.cart.checkoutOrder.totalWithTax).toBe(0);
            expect(cleared.cart.checkoutOrder.lines).toEqual([]);
            expect(cleared.cart.lines.map((line: any) => ({ id: line.id, quantity: line.quantity }))).toEqual(
                before.lines.map((line: any) => ({ id: line.id, quantity: line.quantity })),
            );
            const previous = await connection
                .getRepository(ctx, OrderLine)
                .findOne({ where: { id: currentLineId }, relations: ['order'] });
            expect(previous?.order.state).toBe('Cancelled');
        } finally {
            await variantRepository.update(purchasedVariantId, {
                customFields: originalVariant.customFields,
            });
        }
    });

    it('rejects a stale concurrent command instead of overwriting another device', async () => {
        const cart = await read();
        const results = await Promise.all(
            [4, 5].map(quantity =>
                send({
                    commandId: randomUUID(),
                    cartId,
                    expectedRevision: cart.revision,
                    changes: { lines: [{ lineId: cart.lines[0].id, quantity }] },
                }),
            ),
        );
        expect(results.filter(result => result.status === 'APPLIED')).toHaveLength(1);
        expect(results.filter(result => result.errorCode === 'CART_REVISION_CONFLICT_ERROR')).toHaveLength(1);
    });
    it('changes currency through native pricing without replacing retained lines', async () => {
        const channel = (
            await adminClient.query(gql`
                query {
                    activeChannel {
                        id
                        defaultCurrencyCode
                    }
                }
            `)
        ).activeChannel;
        const target = channel.defaultCurrencyCode === 'GBP' ? 'USD' : 'GBP';
        await adminClient.query(
            gql`
                mutation ($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `,
            { input: { id: channel.id, availableCurrencyCodes: [channel.defaultCurrencyCode, target] } },
        );
        await adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: variantIds.map(id => ({ id, prices: [{ currencyCode: target, price: 700 }] })) },
        );
        const before = await read();
        const changed = await send({
            cartId,
            commandId: randomUUID(),
            expectedRevision: before.revision,
            order: { currencyCode: target },
        });
        expect(changed.status, changed.message).toBe('APPLIED');
        expect(changed.cart.checkoutOrder.lines.map((line: any) => line.id)).toEqual(
            before.checkoutOrder.lines.map((line: any) => line.id),
        );
        const order = (
            await shopClient.query(gql`
                query {
                    activeOrder {
                        currencyCode
                    }
                }
            `)
        ).activeOrder;
        expect(order.currencyCode).toBe(target);
        const restored = await send({
            cartId,
            commandId: randomUUID(),
            expectedRevision: changed.cart.revision,
            order: { currencyCode: channel.defaultCurrencyCode },
        });
        expect(restored.status).toBe('APPLIED');
    });

    it('preserves physical shipping selections through edits and validates checkout', async () => {
        const change = async (operation: object) => {
            const current = await read();
            return send({
                cartId: current.id,
                commandId: randomUUID(),
                expectedRevision: current.revision,
                ...operation,
            });
        };
        expect(
            (
                await change({
                    order: {
                        customer: {
                            firstName: 'Cart',
                            lastName: 'Guest',
                            emailAddress: 'physical-cart@example.test',
                        },
                    },
                })
            ).status,
        ).toBe('APPLIED');
        const shipping = await change({
            prepareShipping: {
                shippingAddress: {
                    fullName: 'Cart Guest',
                    streetLine1: '100 Test Street',
                    city: 'London',
                    postalCode: 'SW1A 1AA',
                    countryCode: 'GB',
                },
            },
        });
        expect(shipping.status).toBe('APPLIED');
        expect(shipping.shippingMethods.length).toBeGreaterThan(0);
        expect(shipping.selectedShippingMethodId).toBe(shipping.shippingMethods[0].id);
        const before = await shopClient.query(gql`
            query {
                activeOrder {
                    shippingAddress {
                        streetLine1
                        countryCode
                    }
                    shippingLines {
                        shippingMethod {
                            id
                        }
                    }
                }
            }
        `);
        const cart = await read();
        expect(
            (await change({ changes: { lines: [{ lineId: cart.lines[0].id, quantity: 2 }] } })).status,
        ).toBe('APPLIED');
        expect((await change({ beginCheckout: true })).status).toBe('APPLIED');
        expect(
            (
                await shopClient.query(gql`
                    query {
                        activeOrder {
                            shippingAddress {
                                streetLine1
                                countryCode
                            }
                            shippingLines {
                                shippingMethod {
                                    id
                                }
                            }
                        }
                    }
                `)
            ).activeOrder,
        ).toEqual(before.activeOrder);
        expect((await change({ preparePayment: true })).status).toBe('APPLIED');
        expect((await change({ reopen: true })).status).toBe('APPLIED');
    });

    it('rolls back actual native order writes when one added variant is out of stock', async () => {
        const before = await read();
        await adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: [{ id: variantIds[3], trackInventory: 'TRUE', stockOnHand: 0 }] },
        );
        const input = {
            commandId: randomUUID(),
            cartId,
            expectedRevision: before.revision,
            changes: {
                add: [
                    { productVariantId: variantIds[2], quantity: 1 },
                    { productVariantId: variantIds[3], quantity: 1 },
                ],
            },
        };
        const rejected = await send(input);
        expect(rejected.status).toBe('REJECTED');
        expect(rejected.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
        expect(rejected.cart.revision).toBe(before.revision);
        expect(await read()).toEqual(before);
        expect((await send(input)).status).toBe('REJECTED');
    });
    it('rejects adding or reselecting a stored unselected item after stock falls to zero, including receipt replay', async () => {
        const variantId = variantIds[3];
        const setStock = (stockOnHand: number) =>
            adminClient.query(
                gql`
                    mutation ($input: [UpdateProductVariantInput!]!) {
                        updateProductVariants(input: $input) {
                            id
                        }
                    }
                `,
                { input: [{ id: variantId, trackInventory: 'TRUE', stockOnHand }] },
            );
        const change = async (changes: object) => {
            const current = await read();
            return send({ commandId: randomUUID(), cartId, expectedRevision: current.revision, changes });
        };
        await setStock(5);
        expect((await change({ add: [{ productVariantId: variantId, quantity: 2 }] })).status).toBe(
            'APPLIED',
        );
        const lineId = (await read()).lines.find((line: any) => line.productVariant.id === variantId).id;
        expect((await change({ lines: [{ lineId, selected: false }] })).status).toBe('APPLIED');
        await setStock(0);
        const before = await read();
        const input = {
            commandId: randomUUID(),
            cartId,
            expectedRevision: before.revision,
            changes: { add: [{ productVariantId: variantId, quantity: 1 }] },
        };
        const rejection = await send(input);
        expect(rejection).toMatchObject({
            status: 'REJECTED',
            errorCode: 'INSUFFICIENT_STOCK_ERROR',
            cart: before,
        });
        expect(await send(input)).toMatchObject({
            status: 'REJECTED',
            errorCode: 'INSUFFICIENT_STOCK_ERROR',
            cart: before,
        });
        expect(await change({ lines: [{ lineId, selected: true }] })).toMatchObject({
            status: 'REJECTED',
            errorCode: 'INSUFFICIENT_STOCK_ERROR',
            cart: before,
        });
        expect(await change({ remove: [lineId] })).toMatchObject({ status: 'APPLIED' });
    });
    it('blocks checkout of disabled products while allowing their removal', async () => {
        const before = await read();
        await adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: [{ id: before.lines[0].productVariant.id, enabled: false }] },
        );
        const unavailable = await read();
        const rejected = await send({
            cartId,
            commandId: randomUUID(),
            expectedRevision: unavailable.revision,
            beginCheckout: true,
        });
        expect(rejected.status).toBe('REJECTED');
        const removed = await send({
            cartId,
            commandId: randomUUID(),
            expectedRevision: unavailable.revision,
            changes: { remove: [unavailable.lines[0].id] },
        });
        expect(removed.status).toBe('APPLIED');
        expect(removed.cart.lines.some((line: any) => line.id === unavailable.lines[0].id)).toBe(false);
    });
});
