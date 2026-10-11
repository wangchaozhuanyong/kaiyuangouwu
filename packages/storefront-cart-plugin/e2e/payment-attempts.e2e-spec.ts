import { LanguageCode, mergeConfig, PaymentMethodHandler } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StorefrontCartPlugin } from '../src/storefront-cart.plugin';

// Synthetic local provider only. No network, charge, fulfillment or production configuration.
let providerCalls = 0;
let decline = true;
let failProvider = false;
const handler = new PaymentMethodHandler({
    code: 'receipt-fixture',
    description: [{ languageCode: LanguageCode.en, value: 'Isolated receipt fixture' }],
    args: {},
    createPayment: (_ctx, _order, amount) => {
        providerCalls++;
        if (failProvider) throw new Error('Synthetic provider outcome is unknown');
        return { amount, state: decline ? 'Declined' : 'Settled', transactionId: `fixture-${providerCalls}` };
    },
    settlePayment: () => ({ success: true }),
});
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 13389 },
    importExportOptions: { importAssetsDir: path.join(__dirname, '../../core/e2e/fixtures/assets') },
    paymentOptions: { paymentMethodHandlers: [handler] },
    plugins: [StorefrontCartPlugin],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const fields = 'id revision state checkoutOrder { id state currencyCode totalWithTax }';
const cartQuery = gql`query { storefrontCart { ${fields} } }`;
const command = gql`mutation($input: StorefrontCartCommandInput!) {
    applyStorefrontCartCommand(input: $input) { status errorCode cart { ${fields} } }
}`;
const receiptQuery = gql`
    query ($input: StorefrontPaymentAttemptInput!) {
        storefrontPaymentAttempt(input: $input) {
            requestId
            status
            errorCode
            order {
                id
                state
                payments {
                    id
                    state
                    amount
                }
            }
        }
    }
`;
const fence = gql`
    mutation ($input: StorefrontPaymentAttemptInput!) {
        fenceUnstartedStorefrontPaymentAttempt(input: $input) {
            requestId
            status
            errorCode
        }
    }
`;
const pay = gql`
    mutation ($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            ... on Order {
                id
                state
                payments {
                    id
                    state
                    amount
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
let descriptor: {
    requestId: string;
    orderId: string;
    kind: string;
    method: string;
    currencyCode: string;
    amount: number;
};
let prepareCheckout: () => Promise<void>;
const readReceipt = async (input = descriptor) =>
    (await shopClient.query(receiptQuery, { input })).storefrontPaymentAttempt;
const submit = (input = descriptor) =>
    shopClient.query(pay, {
        input: { method: input.method, metadata: { storefrontPaymentAttempt: input } },
    });
beforeAll(async () => {
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });
    await adminClient.asSuperAdmin();
    await adminClient.query(
        gql`
            mutation ($input: CreatePaymentMethodInput!) {
                createPaymentMethod(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                code: 'receipt-fixture',
                enabled: true,
                translations: [{ languageCode: 'en', name: 'Receipt fixture', description: '' }],
                handler: { code: 'receipt-fixture', arguments: [] },
            },
        },
    );
    const products = await shopClient.query(gql`
        query {
            products(options: { take: 1 }) {
                items {
                    variants {
                        id
                    }
                }
            }
        }
    `);
    const change = async (operation: object) => {
        const cart = (await shopClient.query(cartQuery)).storefrontCart;
        const result = (
            await shopClient.query(command, {
                input: {
                    cartId: cart.id,
                    commandId: randomUUID(),
                    expectedRevision: cart.revision,
                    ...operation,
                },
            })
        ).applyStorefrontCartCommand;
        expect(result.status, result.errorCode).toBe('APPLIED');
        return result.cart;
    };
    prepareCheckout = async () => {
        await change({
            changes: { add: [{ productVariantId: products.products.items[0].variants[0].id, quantity: 1 }] },
        });
        await change({
            order: {
                customer: {
                    firstName: 'Receipt',
                    lastName: 'Fixture',
                    emailAddress: 'receipt-fixture@example.test',
                },
            },
        });
        await change({
            prepareShipping: {
                shippingAddress: {
                    fullName: 'Receipt Fixture',
                    streetLine1: '100 Test Street',
                    city: 'London',
                    postalCode: 'SW1A 1AA',
                    countryCode: 'GB',
                },
            },
        });
        await change({ beginCheckout: true });
        const preparedCart = await change({ preparePayment: true });
        descriptor = {
            requestId: randomUUID(),
            orderId: preparedCart.checkoutOrder.id,
            kind: 'payment',
            method: 'receipt-fixture',
            currencyCode: preparedCart.checkoutOrder.currencyCode,
            amount: preparedCart.checkoutOrder.totalWithTax,
        };
    };
    await prepareCheckout();
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());

describe('payment receipts through the actual shop resolver and payment transaction', () => {
    it('fences an unstarted request and prevents the original delayed mutation', async () => {
        expect((await readReceipt()).status).toBe('NOT_FOUND');
        expect(
            (await shopClient.query(fence, { input: descriptor })).fenceUnstartedStorefrontPaymentAttempt
                .status,
        ).toBe('NOT_EXECUTED');
        await expect(submit()).rejects.toThrow('PAYMENT_REQUEST_NOT_EXECUTED');
        expect(providerCalls).toBe(0);
    });
    it('commits a definitive rejection receipt after the native transaction', async () => {
        descriptor = { ...descriptor, requestId: randomUUID() };
        expect((await submit()).addPaymentToOrder.errorCode).toBe('PAYMENT_DECLINED_ERROR');
        expect((await readReceipt()).status).toBe('REJECTED');
        await expect(submit()).rejects.toThrow('PAYMENT_REQUEST_ALREADY_RECEIVED');
        expect(providerCalls).toBe(1);
    });
    it('executes two concurrent same-id submissions once and reads the receipt after the active order is unset', async () => {
        decline = false;
        descriptor = { ...descriptor, requestId: randomUUID() };
        const results = await Promise.allSettled([submit(), submit()]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const paid = results.find(result => result.status === 'fulfilled');
        expect(paid?.status === 'fulfilled' && paid.value.addPaymentToOrder.state).toBe('PaymentSettled');
        expect(providerCalls).toBe(2);
        expect((await readReceipt()).status).toBe('APPLIED');
        // Guest recovery after a reload cannot use the customer-only native order query.
        const native = await shopClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        id
                    }
                }
            `,
            { id: descriptor.orderId },
        );
        expect(native.order).toBeNull();
        const recovery = await shopClient.query(
            gql`
                query ($input: StorefrontPaymentAttemptInput!) {
                    storefrontPaymentAttempt(input: $input) {
                        order {
                            id
                            state
                            currencyCode
                            totalWithTax
                            payments {
                                id
                                state
                                amount
                            }
                        }
                    }
                }
            `,
            { input: descriptor },
        );
        expect(recovery.storefrontPaymentAttempt.order).toMatchObject({
            id: descriptor.orderId,
            state: 'PaymentSettled',
            currencyCode: descriptor.currencyCode,
        });
        const { shopClient: anotherGuest } = createTestEnvironment(config);
        await anotherGuest.query(cartQuery);
        await expect(anotherGuest.query(receiptQuery, { input: descriptor })).rejects.toThrow();
        await expect(submit()).rejects.toThrow('PAYMENT_REQUEST_ALREADY_APPLIED');
        expect(providerCalls).toBe(2);
        await expect(readReceipt({ ...descriptor, amount: descriptor.amount + 1 })).rejects.toThrow(
            'PAYMENT_REQUEST_SCOPE_CHANGED',
        );
    });
    it('blocks reopening from another request while a provider outcome is unknown, even without a successful payment row', async () => {
        await prepareCheckout();
        failProvider = true;
        await submit().catch(() => undefined);
        const uncertain = await readReceipt();
        expect(uncertain.status).toBe('UNKNOWN');
        expect(
            uncertain.order.payments.some((payment: { state: string }) =>
                ['Settled', 'Authorized'].includes(payment.state),
            ),
        ).toBe(false);
        const before = (await shopClient.query(cartQuery)).storefrontCart;
        const reopened = (
            await shopClient.query(command, {
                input: {
                    cartId: before.id,
                    commandId: randomUUID(),
                    expectedRevision: before.revision,
                    reopen: true,
                },
            })
        ).applyStorefrontCartCommand;
        expect(reopened).toMatchObject({ status: 'REJECTED', errorCode: 'CART_CHECKOUT_LOCKED_ERROR' });
        expect((await shopClient.query(cartQuery)).storefrontCart).toMatchObject(before);
        expect((await readReceipt()).status).toBe('UNKNOWN');
        expect(providerCalls).toBe(3);
    });
});
