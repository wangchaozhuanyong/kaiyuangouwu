import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StorefrontCartPlugin } from '../src/storefront-cart.plugin';

const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig(), {
        apiOptions: { port: 13388 },
        importExportOptions: { importAssetsDir: path.join(__dirname, '../../core/e2e/fixtures/assets') },
        plugins: [StorefrontCartPlugin],
    }),
);
const fields = `id revision state selectedQuantity lines { id quantity selected productVariant { id } } checkoutOrder { id totalWithTax lines { id
quantity productVariant { id } } }`;
const cartQuery = gql`query { storefrontCart { ${fields} } }`;
const command = gql`mutation($input: StorefrontCartCommandInput!) { applyStorefrontCartCommand(input: $input) { commandId status appliedRevision
errorCode cart { ${fields} } } }`;
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
        expect(
            (
                await change({
                    order: {
                        shippingAddress: {
                            fullName: 'Cart Guest',
                            streetLine1: '100 Test Street',
                            city: 'London',
                            postalCode: 'SW1A 1AA',
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
            (await change({ order: { shippingMethodId: methods.eligibleShippingMethods[0].id } })).status,
        ).toBe('APPLIED');
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
        expect(rejected.errorCode).toBe('CART_PROJECTION_ERROR');
        expect(rejected.cart.revision).toBe(before.revision);
        expect(await read()).toEqual(before);
        expect((await send(input)).status).toBe('REJECTED');
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
