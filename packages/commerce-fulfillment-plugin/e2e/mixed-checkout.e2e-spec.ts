import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Channel,
    DefaultLogger,
    LogLevel,
    mergeConfig,
    Order,
    PaymentMethodHandler,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreUsdtWallet } from '../../store-management-plugin/src/entities/store-usdt-wallet.entity';
import { StoreDefaultCurrencyPriceSelectionStrategy } from '../../store-management-plugin/src/store-currency-price-selection-strategy';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import { USDT_TRC20_CONTRACT_ADDRESS } from '../../store-management-plugin/src/usdt/usdt-payment.constants';
import {
    fingerprintReceivingAddress,
    UsdtWalletConfigurationService,
} from '../../store-management-plugin/src/usdt/usdt-wallet-configuration.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';

// Exercises the shared desktop/mobile cart API with the actual Admin shipping configuration.
// This handler is local to the test; it never contacts a payment provider or sends money.
let paymentCalls = 0;
const paymentHandler = new PaymentMethodHandler({
    code: 'mixed-checkout-fixture',
    description: [{ languageCode: LanguageCode.en, value: 'Local mixed checkout fixture' }],
    args: {},
    createPayment: (_ctx, order, amount) => {
        paymentCalls++;
        return { amount, state: 'Settled', transactionId: `fixture-${order.code}`, metadata: {} };
    },
    settlePayment: () => ({ success: true }),
});
const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig(), {
        apiOptions: { port: 37389 },
        defaultLanguageCode: LanguageCode.zh_Hans,
        logger: new DefaultLogger({ level: LogLevel.Error }),
        catalogOptions: {
            productVariantPriceSelectionStrategy: new StoreDefaultCurrencyPriceSelectionStrategy(),
        },
        paymentOptions: { paymentMethodHandlers: [paymentHandler] },
        // The application registers these order fields in dev-config.ts, outside the plugin.
        customFields: {
            Order: [
                { name: 'customerNote', type: 'text', nullable: true, public: true },
                { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
                { name: 'deliveryEmailContactId', type: 'string', length: 64, nullable: true, public: false },
            ],
            // Mirror the production Channel currency fields used by this API scenario.
            Channel: [
                { name: 'currencySelectorEnabled', type: 'boolean', defaultValue: true },
                { name: 'currencyRateMode', type: 'string', length: 16, defaultValue: 'AUTO' },
                { name: 'cnyToMyrRate', type: 'float', nullable: true },
                { name: 'currencyRateMarkupBps', type: 'int', defaultValue: 0 },
                { name: 'currencyRoundingMode', type: 'string', length: 16, defaultValue: 'CENT' },
                { name: 'usdtDisplayEnabled', type: 'boolean', defaultValue: true },
                { name: 'usdtRateMarkupBps', type: 'int', defaultValue: 0 },
                { name: 'usdtRateScheduleMode', type: 'string', length: 16, defaultValue: 'INTERVAL' },
                { name: 'usdtRateIntervalMinutes', type: 'int', defaultValue: 5 },
                { name: 'usdtRateDailyTime', type: 'string', length: 5, defaultValue: '10:00' },
                { name: 'cnyPerUsdtRate', type: 'float', nullable: true },
                { name: 'usdtRateSource', type: 'string', length: 120, nullable: true },
                { name: 'usdtRateUpdatedAt', type: 'datetime', nullable: true },
            ],
        },
        plugins: [
            CatalogManagementPlugin,
            StorefrontCartPlugin,
            ContentTranslationPlugin.init({
                provider: {
                    name: 'mixed-checkout-local',
                    isConfigured: () => true,
                    translate: request =>
                        Promise.resolve({
                            provider: 'mixed-checkout-local',
                            translations: request.segments.map(segment => ({
                                key: segment.key,
                                text: segment.text,
                            })),
                        }),
                },
            }),
            StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
            CommerceFulfillmentPlugin.init({ testPaymentsEnabled: false }),
        ],
    }),
);

const orderFields = `id code state currencyCode subTotalWithTax shippingWithTax totalWithTax couponCodes
    shippingAddress { fullName postalCode countryCode }
    customFields { deliveryEmail }
    checkoutFulfillment { fulfillmentType requiresShippingAddress requiresShippingMethod }
    checkoutShipping { methodCode priceWithTax freeShippingApplied freeShippingThreshold }
    lines { id quantity discountedLinePriceWithTax proratedLinePriceWithTax productVariant { id }
        customFields { fulfillmentTypeSnapshot digitalDeliveryModeSnapshot } }
    shippingLines { id priceWithTax shippingMethod { id code } }
    payments { id amount state }
    manualDigitalDeliveries { id state orderLineId quantity }`;
const cartFields = `id revision state lines { id quantity selected productVariant { id } }
    checkoutOrder { ${orderFields} }`;
const readCart = gql`query { storefrontCart { ${cartFields} } }`;
const sendCommand = gql`mutation($input: StorefrontCartCommandInput!) {
    applyStorefrontCartCommand(input: $input) {
        status errorCode message cart { ${cartFields} }
        shippingMethods { id code priceWithTax } selectedShippingMethodId
    }
}`;
const couponFields = 'id status lockedOrderId usedOrderId';
const address = {
    fullName: 'Synthetic Checkout',
    streetLine1: '1 Test Street',
    city: 'Kuala Lumpur',
    province: 'Kuala Lumpur',
    postalCode: '50000',
    countryCode: 'MY',
    phoneNumber: '+60100000000',
};
let physicalId: string;
let physicalProductId: string;
let digitalId: string;
let couponId: string;
let shippingMethodId: string;
let channelToken: string;
let channelCode: string;
let campaignId: string;

async function read() {
    return (await shopClient.query(readCart)).storefrontCart;
}
async function command(input: Record<string, unknown>) {
    const before = await read();
    return (
        await shopClient.query(sendCommand, {
            input: {
                cartId: before.id,
                expectedRevision: before.revision,
                commandId: randomUUID(),
                ...input,
            },
        })
    ).applyStorefrontCartCommand;
}
async function applied(input: Record<string, unknown>) {
    const result = await command(input);
    expect(result.status, JSON.stringify({ code: result.errorCode, message: result.message })).toBe(
        'APPLIED',
    );
    return result;
}
async function setStock(id: string, stockOnHand: number) {
    await adminClient.query(
        gql`
            mutation ($input: [UpdateProductVariantInput!]!) {
                updateProductVariants(input: $input) {
                    id
                    stockOnHand
                }
            }
        `,
        { input: [{ id, stockOnHand }] },
    );
}
async function createVariant(kind: 'physical' | 'digital') {
    const product = (
        await adminClient.query(
            gql`
                mutation ($input: CreateProductInput!) {
                    createProduct(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    enabled: true,
                    customFields: { fulfillmentType: kind },
                    translations: [
                        {
                            languageCode: 'zh_Hans',
                            name: `混合验收 ${kind}`,
                            slug: `mixed-${kind}`,
                            description: '仅用于本地结算验收的合成商品',
                        },
                    ],
                },
            },
        )
    ).createProduct;
    const result = await adminClient.query(
        gql`
            mutation ($input: [CreateProductVariantInput!]!) {
                createProductVariants(input: $input) {
                    id
                    customFields {
                        fulfillmentType
                        digitalDeliveryMode
                    }
                }
            }
        `,
        {
            input: [
                {
                    productId: product.id,
                    sku: `MIXED-${kind}`,
                    price: 10_000,
                    stockOnHand: 12,
                    trackInventory: 'TRUE',
                    optionIds: [],
                    translations: [{ languageCode: 'zh_Hans', name: `混合验收 ${kind}` }],
                },
            ],
        },
    );
    expect(result.createProductVariants[0].customFields.fulfillmentType).toBe(kind);
    if (kind === 'physical') physicalProductId = product.id;
    return result.createProductVariants[0].id as string;
}

beforeAll(async () => {
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            defaultZone: 'Asia',
            collections: [],
            shippingMethods: [],
            countries: [...initialData.countries, { name: 'Malaysia', code: 'MY', zone: 'Asia' }],
            paymentMethods: [
                { name: paymentHandler.code, handler: { code: paymentHandler.code, arguments: [] } },
            ],
        },
        customerCount: 1,
    });
    await adminClient.asSuperAdmin();
    const { activeChannel, customers } = await adminClient.query(gql`
        query {
            activeChannel {
                id
                token
                code
            }
            customers(options: { take: 1 }) {
                items {
                    emailAddress
                }
            }
        }
    `);
    channelToken = activeChannel.token;
    channelCode = activeChannel.code;
    const channel = await adminClient.query(
        gql`
            mutation ($input: UpdateChannelInput!) {
                updateChannel(input: $input) {
                    ... on Channel {
                        id
                        defaultCurrencyCode
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `,
        { input: { id: activeChannel.id, defaultCurrencyCode: 'MYR', availableCurrencyCodes: ['MYR'] } },
    );
    expect(channel.updateChannel.defaultCurrencyCode).toBe('MYR');
    expect(
        (
            await adminClient.query(gql`
                mutation {
                    updateMyStoreCommerceMode(mode: HYBRID) {
                        mode
                    }
                }
            `)
        ).updateMyStoreCommerceMode.mode,
    ).toBe('HYBRID');
    const configuration = (
        await adminClient.query(gql`
            query {
                myStoreCommerceConfiguration {
                    updatedAt
                }
            }
        `)
    ).myStoreCommerceConfiguration;
    const configured = await adminClient.query(
        gql`
            mutation ($input: UpdateMyStoreCommerceConfigurationInput!) {
                updateMyStoreCommerceConfiguration(input: $input) {
                    ready
                    currencyCode
                    countryCode
                    baseRate
                    freeShippingThreshold
                    shippingMethodId
                }
            }
        `,
        {
            input: {
                expectedUpdatedAt: configuration.updatedAt,
                pricesIncludeTax: true,
                countryCode: 'MY',
                taxRate: 0,
                shippingMethodNameZh: '本地配送',
                shippingMethodNameEn: 'Local delivery',
                shippingDescriptionZh: '混合订单测试',
                shippingDescriptionEn: 'Mixed checkout fixture',
                baseRate: 1_000,
                freeShippingThreshold: 20_000,
                shippingTaxRate: 0,
                shippingPriceIncludesTax: true,
                estimateMinDays: 1,
                estimateMaxDays: 3,
                blockedPostalPrefixes: '99',
            },
        },
    );
    expect(configured.updateMyStoreCommerceConfiguration).toMatchObject({
        ready: true,
        currencyCode: 'MYR',
        countryCode: 'MY',
        baseRate: 1_000,
        freeShippingThreshold: 20_000,
    });
    shippingMethodId = configured.updateMyStoreCommerceConfiguration.shippingMethodId;
    physicalId = await createVariant('physical');
    digitalId = await createVariant('digital');
    const campaign = await adminClient.query(
        gql`
            mutation ($input: CreateStoreCouponCampaignInput!) {
                createStoreCouponCampaign(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                name: '混合订单满100减10',
                kind: 'ORDER_FIXED',
                appearanceTheme: 'blue',
                minimumSpend: 10_000,
                discountAmount: 1_000,
                issueLimit: 10,
                validityDays: 7,
                stackPolicy: 'EXCLUSIVE',
                returnOnCancellation: true,
                returnOnFullRefund: true,
            },
        },
    );
    campaignId = campaign.createStoreCouponCampaign.id;
    await shopClient.asUserWithCredentials(customers.items[0].emailAddress, 'test');
    const claimed = await shopClient.query(
        gql`mutation($id: ID!) {
        claimStorefrontCoupon(campaignId: $id) { ${couponFields} }
    }`,
        { id: campaign.createStoreCouponCampaign.id },
    );
    couponId = claimed.claimStorefrontCoupon.id;
}, TEST_SETUP_TIMEOUT_MS);

afterAll(() => server.destroy());

describe('Admin configuration and mixed physical/digital checkout', () => {
    it('requires a confirmed digital email but no shipping for a digital-only selection', async () => {
        await applied({ changes: { add: [{ productVariantId: digitalId, quantity: 1 }] } });
        await applied({ beginCheckout: true });
        const missing = await command({ preparePayment: true });
        expect(missing.status).toBe('REJECTED');
        expect(missing.message).toContain('交付邮箱');
        expect((await read()).state).toBe('OPEN');
        expect(
            (
                await command({
                    deliveryEmail: {
                        emailAddress: 'delivery@example.test',
                        confirmEmailAddress: 'different@example.test',
                    },
                })
            ).status,
        ).toBe('REJECTED');
        await applied({
            deliveryEmail: {
                emailAddress: 'delivery@example.test',
                confirmEmailAddress: 'delivery@example.test',
            },
        });
        const digital = (await applied({ preparePayment: true })).cart.checkoutOrder;
        expect(digital).toMatchObject({
            state: 'ArrangingPayment',
            totalWithTax: 10_000,
            shippingWithTax: 0,
            checkoutFulfillment: {
                fulfillmentType: 'DIGITAL',
                requiresShippingAddress: false,
                requiresShippingMethod: false,
            },
        });
        expect(digital.shippingLines).toEqual([]);
        await applied({ reopen: true });
    });

    it('requires shipping for mixed orders and excludes digital value from the free-shipping threshold', async () => {
        await applied({ changes: { add: [{ productVariantId: physicalId, quantity: 1 }] } });
        expect((await command({ preparePayment: true })).status).toBe('REJECTED');
        const quote = await applied({ prepareShipping: { shippingAddress: address } });
        expect(quote.shippingMethods).toEqual([
            expect.objectContaining({ id: shippingMethodId, priceWithTax: 1_000 }),
        ]);
        expect(quote.cart.checkoutOrder).toMatchObject({
            currencyCode: 'MYR',
            subTotalWithTax: 20_000,
            shippingWithTax: 1_000,
            totalWithTax: 21_000,
            customFields: { deliveryEmail: 'delivery@example.test' },
            checkoutFulfillment: {
                fulfillmentType: 'MIXED',
                requiresShippingAddress: true,
                requiresShippingMethod: true,
            },
            checkoutShipping: { freeShippingApplied: false, freeShippingThreshold: 20_000 },
        });
    });

    it('invalidates a previous shipping choice when the address is no longer served', async () => {
        const blocked = await applied({
            prepareShipping: { shippingAddress: { ...address, postalCode: '99000' } },
        });
        expect(blocked.shippingMethods).toEqual([]);
        expect(blocked.selectedShippingMethodId).toBeNull();
        expect((await command({ preparePayment: true })).status).toBe('REJECTED');
        expect((await read()).state).toBe('OPEN');
        await applied({ prepareShipping: { shippingAddress: address } });
    });

    it('recalculates shipping, coupon and totals after changing the selected quantity', async () => {
        const physical = (await read()).lines.find(
            (line: { productVariant: { id: string } }) => line.productVariant.id === physicalId,
        );
        const free = await applied({ changes: { lines: [{ lineId: physical.id, quantity: 2 }] } });
        expect(free.cart.checkoutOrder).toMatchObject({
            subTotalWithTax: 30_000,
            shippingWithTax: 0,
            totalWithTax: 30_000,
        });
        const discounted = await applied({ coupon: { action: 'APPLY', couponId } });
        expect(discounted.cart.checkoutOrder.subTotalWithTax).toBe(29_000);
        expect(discounted.cart.checkoutOrder.totalWithTax).toBe(
            29_000 + discounted.cart.checkoutOrder.shippingWithTax,
        );
        const normal = await applied({ changes: { lines: [{ lineId: physical.id, quantity: 1 }] } });
        expect(normal.cart.checkoutOrder).toMatchObject({
            subTotalWithTax: 19_000,
            shippingWithTax: 1_000,
            totalWithTax: 20_000,
        });
        const coupons = await shopClient.query(gql`query { myStorefrontCoupons { ${couponFields} } }`);
        expect(coupons.myStorefrontCoupons).toContainEqual(
            expect.objectContaining({
                id: couponId,
                status: 'LOCKED',
                lockedOrderId: normal.cart.checkoutOrder.id,
            }),
        );
    });

    it('rejects changed stock before payment while keeping the cart and entered delivery details', async () => {
        await setStock(physicalId, 0);
        try {
            const blocked = await command({ preparePayment: true });
            expect(blocked.status).toBe('REJECTED');
            const cart = await read();
            expect(cart.state).toBe('OPEN');
            expect(cart.lines).toHaveLength(2);
            expect(cart.checkoutOrder).toMatchObject({
                customFields: { deliveryEmail: 'delivery@example.test' },
                shippingAddress: { postalCode: '50000', countryCode: 'MY' },
            });
            expect(paymentCalls).toBe(0);
        } finally {
            await setStock(physicalId, 12);
        }
    });

    it('uses the final quote exactly once and exposes separate physical and digital fulfillment in Admin', async () => {
        const prepared = await applied({ preparePayment: true });
        const order = prepared.cart.checkoutOrder;
        expect(order).toMatchObject({ state: 'ArrangingPayment', totalWithTax: 20_000 });
        const paid = await shopClient.query(
            gql`mutation($input: PaymentInput!) {
            addPaymentToOrder(input: $input) { __typename ... on Order { ${orderFields} } ... on ErrorResult { errorCode message } }
        }`,
            { input: { method: paymentHandler.code, metadata: {} } },
        );
        expect(paid.addPaymentToOrder, paid.addPaymentToOrder.message).toMatchObject({
            __typename: 'Order',
            id: order.id,
            state: 'PaymentSettled',
            totalWithTax: 20_000,
            payments: [expect.objectContaining({ amount: 20_000, state: 'Settled' })],
        });
        expect(paymentCalls).toBe(1);
        const admin = await adminClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        id
                        state
                        totalWithTax
                        shippingWithTax
                        customFields {
                            deliveryEmail
                        }
                        lines {
                            id
                            quantity
                            productVariant {
                                id
                            }
                            customFields {
                                fulfillmentTypeSnapshot
                            }
                        }
                        fulfillments {
                            id
                            state
                        }
                        manualDigitalDeliveries {
                            id
                            state
                            orderLineId
                            quantity
                        }
                        storeCouponAllocations {
                            status
                            discountAmountWithTax
                        }
                    }
                }
            `,
            { id: order.id },
        );
        expect(admin.order).toMatchObject({
            state: 'PaymentSettled',
            totalWithTax: 20_000,
            shippingWithTax: 1_000,
            customFields: { deliveryEmail: 'delivery@example.test' },
            fulfillments: [],
            storeCouponAllocations: [
                expect.objectContaining({ status: 'USED', discountAmountWithTax: 1_000 }),
            ],
        });
        const digital = admin.order.lines.find(
            (line: { productVariant: { id: string } }) => line.productVariant.id === digitalId,
        );
        // Shipping-line assignment is an internal order relation, not an Admin GraphQL field.
        const stored = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Order)
            .findOneOrFail({
                where: { code: order.code },
                relations: ['lines', 'lines.productVariant', 'lines.shippingLine'],
            });
        expect(
            stored.lines.find(line => line.productVariant.sku === 'MIXED-physical')?.shippingLine,
        ).toBeTruthy();
        expect(
            stored.lines.find(line => line.productVariant.sku === 'MIXED-digital')?.shippingLine,
        ).toBeNull();
        expect(admin.order.manualDigitalDeliveries).toEqual([
            expect.objectContaining({ orderLineId: digital.id, quantity: 1, state: 'WAITING_PROCESSING' }),
        ]);
        const coupons = await shopClient.query(gql`query { myStorefrontCoupons { ${couponFields} } }`);
        expect(coupons.myStorefrontCoupons).toContainEqual(
            expect.objectContaining({ id: couponId, status: 'USED', usedOrderId: order.id }),
        );
        expect((await read()).lines).toEqual([]);

        const physical = admin.order.lines.find(
            (line: { productVariant: { id: string } }) => line.productVariant.id === physicalId,
        );
        const created = await adminClient.query(
            gql`
                mutation ($input: FulfillOrderInput!) {
                    addFulfillmentToOrder(input: $input) {
                        __typename
                        ... on Fulfillment {
                            id
                            state
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
                    lines: [{ orderLineId: physical.id, quantity: 1 }],
                    handler: {
                        code: 'manual-fulfillment',
                        arguments: [
                            { name: 'method', value: 'Synthetic carrier' },
                            { name: 'trackingCode', value: 'MIXED-TRACK-1' },
                        ],
                    },
                },
            },
        );
        expect(created.addFulfillmentToOrder, created.addFulfillmentToOrder.message).toMatchObject({
            __typename: 'Fulfillment',
            state: 'Pending',
        });
        const fulfillmentId = created.addFulfillmentToOrder.id;
        const transition = gql`
            mutation ($id: ID!, $state: String!) {
                transitionFulfillmentToState(id: $id, state: $state) {
                    __typename
                    ... on Fulfillment {
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
        const shipped = await adminClient.query(transition, { id: fulfillmentId, state: 'Shipped' });
        expect(
            shipped.transitionFulfillmentToState,
            shipped.transitionFulfillmentToState.message,
        ).toMatchObject({
            __typename: 'Fulfillment',
            state: 'Shipped',
        });
        const unproven = await adminClient.query(transition, { id: fulfillmentId, state: 'Delivered' });
        expect(unproven.transitionFulfillmentToState.__typename).not.toBe('Fulfillment');
        const confirmed = await shopClient.query(
            gql`
                mutation ($input: ConfirmFulfillmentDeliveryInput!) {
                    confirmMyFulfillmentDelivery(input: $input) {
                        status
                        proofReference
                    }
                }
            `,
            { input: { fulfillmentId, idempotencyKey: `customer-delivered-${fulfillmentId}` } },
        );
        expect(confirmed.confirmMyFulfillmentDelivery).toEqual({
            status: 'DELIVERED',
            proofReference: 'CUSTOMER_CONFIRMED',
        });
        const completed = await shopClient.query(
            gql`
                query ($id: ID!) {
                    order(id: $id) {
                        state
                        fulfillments {
                            id
                            state
                            deliveryEvidence {
                                status
                                proofReference
                            }
                        }
                    }
                }
            `,
            { id: order.id },
        );
        expect(completed.order.fulfillments).toContainEqual({
            id: fulfillmentId,
            state: 'Delivered',
            deliveryEvidence: { status: 'DELIVERED', proofReference: 'CUSTOMER_CONFIRMED' },
        });
    });

    it('connects the desktop and mobile checkout forms to real quotes, coupons and preparation', async () => {
        const { chromium, webkit, devices, expect: browserExpect } = await import('@playwright/test');
        const { createServer } = await import('vite');
        const frontend = await createServer({
            root: path.resolve(__dirname, '../../storefront'),
            server: {
                host: '127.0.0.1',
                port: 5302,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:37389' },
            },
        });
        const output = path.resolve(__dirname, '../../storefront/artifacts/readiness/mixed-checkout-browser');
        await mkdir(output, { recursive: true });
        await frontend.listen();
        try {
            for (const [name, engine, options] of [
                ['desktop', chromium, { viewport: { width: 1440, height: 1100 } }],
                ['mobile', webkit, { ...devices['iPhone 13'] }],
            ] as const) {
                const emailAddress = `mixed-${name}@example.test`;
                const customer = await adminClient.query(
                    gql`
                        mutation ($input: CreateCustomerInput!) {
                            createCustomer(input: $input, password: "local-checkout-fixture") {
                                ... on Customer {
                                    id
                                }
                                ... on ErrorResult {
                                    message
                                }
                            }
                        }
                    `,
                    { input: { firstName: 'Browser', lastName: name, emailAddress } },
                );
                expect(customer.createCustomer.id, customer.createCustomer.message).toBeTruthy();
                const browser = await engine.launch({ headless: true });
                const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
                const page = await context.newPage();
                const pageErrors: string[] = [];
                page.on('pageerror', error => pageErrors.push(error.message));
                let releaseShipping!: () => void;
                let shippingStarted!: () => void;
                const shippingHeld = new Promise<void>(resolve => {
                    releaseShipping = resolve;
                });
                const firstShipping = new Promise<void>(resolve => {
                    shippingStarted = resolve;
                });
                let held = false;
                await page.route('**/shop-api?*', async route => {
                    if (!held && route.request().postDataJSON()?.variables?.input?.prepareShipping) {
                        held = true;
                        shippingStarted();
                        await shippingHeld;
                    }
                    await route.continue();
                });
                try {
                    const query = new URLSearchParams({
                        channel: channelToken,
                        storeCode: channelCode,
                        email: emailAddress,
                        physical: physicalId,
                        digital: digitalId,
                        campaign: campaignId,
                    });
                    await page.goto(`http://127.0.0.1:5302/e2e/checkout-flow/index.html?${query}`);
                    await browserExpect(page.locator('.subpage-header strong')).toHaveText('确认订单');
                    await Promise.race([
                        firstShipping,
                        page.waitForTimeout(8_000).then(() => {
                            throw new Error('Shipping request was not made');
                        }),
                    ]);
                    const submit = page.locator('.submit-order-bar button');
                    await browserExpect(submit).toBeDisabled();
                    await browserExpect(submit).toContainText('正在确认运费');
                    releaseShipping();
                    await browserExpect(submit).toBeEnabled();
                    await browserExpect(submit).toContainText(/MYR\s*210(?:\.00)?/);
                    // Reopening after a browser refresh must retain the same two selected items.
                    await page.reload();
                    await browserExpect(submit).toBeEnabled();
                    await browserExpect(submit).toContainText('2件');
                    await browserExpect(submit).toContainText(/MYR\s*210(?:\.00)?/);
                    await page.getByLabel('交付邮箱', { exact: true }).fill('browser-delivery@example.test');
                    await page.getByLabel('再次输入交付邮箱', { exact: true }).fill('wrong@example.test');
                    await submit.click();
                    await browserExpect(page.locator('.desktop-checkout-summary')).toContainText(
                        '两次输入的交付邮箱不一致',
                    );
                    await page
                        .getByLabel('再次输入交付邮箱', { exact: true })
                        .fill('browser-delivery@example.test');
                    await browserExpect(page.locator('.desktop-checkout-summary')).not.toContainText(
                        '两次输入的交付邮箱不一致',
                    );
                    await page.getByRole('button', { name: '选择已领取优惠券' }).click();
                    await browserExpect(page.getByRole('dialog')).toBeVisible();
                    await page
                        .getByRole('dialog')
                        .getByRole('button', { name: /使用.*混合订单满100减10/ })
                        .click();
                    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
                    await browserExpect(submit).toBeEnabled();
                    await browserExpect(submit).toContainText(/MYR\s*200(?:\.00)?/);
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                    ).toBe(true);
                    await page.evaluate(() => scrollTo(0, 0));
                    await page.screenshot({ path: path.join(output, `${name}-quote.png`), fullPage: true });
                    if (name === 'mobile') {
                        await page.locator('.price-summary').scrollIntoViewIfNeeded();
                        await page.screenshot({ path: path.join(output, 'mobile-summary-viewport.png') });
                    }
                    await submit.click();
                    await browserExpect(page.getByRole('heading', { name: '订单已准备' })).toBeVisible();
                    await browserExpect(page.locator('output')).toHaveAttribute('data-total', '20000');
                    await browserExpect(page.locator('output')).toContainText('ArrangingPayment');
                    expect(pageErrors).toEqual([]);
                    await page.screenshot({
                        path: path.join(output, `${name}-prepared.png`),
                        fullPage: true,
                    });
                } catch (error) {
                    await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true });
                    await writeFile(
                        path.join(output, `${name}-failure.txt`),
                        JSON.stringify({ pageErrors, text: await page.locator('body').innerText() }, null, 2),
                    );
                    throw error;
                } finally {
                    releaseShipping();
                    await browser.close();
                }
            }
        } finally {
            await frontend.close();
        }
    }, 120_000);

    it('carries the formal product page quantity through add-to-cart and isolated buy-now checkout', async () => {
        const { chromium, webkit, devices, expect: browserExpect } = await import('@playwright/test');
        const { createServer } = await import('vite');
        const frontend = await createServer({
            root: path.resolve(__dirname, '../../storefront'),
            server: {
                host: '127.0.0.1',
                port: 5303,
                strictPort: true,
                proxy: { '/shop-api': 'http://127.0.0.1:37389' },
            },
        });
        await frontend.listen();
        try {
            for (const [name, engine, options] of [
                ['desktop', chromium, { viewport: { width: 1440, height: 1100 } }],
                ['mobile', webkit, { ...devices['iPhone 13'] }],
            ] as const) {
                const emailAddress = `product-quantity-${name}@example.test`;
                const customer = await adminClient.query(
                    gql`
                        mutation ($input: CreateCustomerInput!) {
                            createCustomer(input: $input, password: "local-checkout-fixture") {
                                ... on Customer {
                                    id
                                }
                                ... on ErrorResult {
                                    message
                                }
                            }
                        }
                    `,
                    { input: { firstName: 'Product', lastName: name, emailAddress } },
                );
                expect(customer.createCustomer.id, customer.createCustomer.message).toBeTruthy();
                const browser = await engine.launch({ headless: true });
                const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
                const page = await context.newPage();
                const pageErrors: string[] = [];
                page.on('pageerror', error => pageErrors.push(error.message));
                try {
                    const query = new URLSearchParams({
                        channel: channelToken,
                        storeCode: channelCode,
                        email: emailAddress,
                        productId: physicalProductId,
                        digital: digitalId,
                    });
                    await page.goto(`http://127.0.0.1:5303/e2e/checkout-flow/index.html?${query}`);
                    const quantity = page.locator('.detail-quantity output');
                    await browserExpect(quantity).toHaveText('1');
                    await page.getByRole('button', { name: '增加数量' }).click();
                    await browserExpect(quantity).toHaveText('2');
                    await page.getByRole('button', { name: '加入购物车' }).click();
                    await browserExpect(page.getByTestId('fixture-cart-quantity')).toHaveText('3');
                    await page.getByRole('button', { name: '增加数量' }).click();
                    await browserExpect(quantity).toHaveText('3');
                    await page.getByRole('button', { name: '立即购买' }).click();
                    await browserExpect(page.locator('.subpage-header strong')).toHaveText('确认订单');
                    const submit = page.locator('.submit-order-bar button');
                    await browserExpect(submit).toBeEnabled();
                    await browserExpect(submit).toContainText('3件');
                    await browserExpect(submit).toContainText(/MYR\s*300(?:\.00)?/);
                    expect(pageErrors).toEqual([]);
                } finally {
                    await browser.close();
                }
            }
        } finally {
            await frontend.close();
        }
    }, 120_000);

    it('quotes the final MYR and CNY amounts through the Shop API after Admin enables USDT', async () => {
        const previousEncryptionKey = process.env.USDT_WALLET_ENCRYPTION_KEY;
        process.env.USDT_WALLET_ENCRYPTION_KEY = randomUUID() + randomUUID();
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
        try {
            const ctx = await server.app.get(RequestContextService).create({
                apiType: 'admin',
                channelOrToken: channelToken,
            });
            const connection = server.app.get(TransactionalConnection);
            const walletCrypto = server.app.get(UsdtWalletConfigurationService);
            const receivingAddress = USDT_TRC20_CONTRACT_ADDRESS;
            await connection.getRepository(ctx, StoreUsdtWallet).save(
                new StoreUsdtWallet({
                    channelId: ctx.channelId,
                    reviewStatus: 'ACTIVE',
                    activeReceivingAddressEncrypted: walletCrypto.encryptReceivingAddress(receivingAddress),
                    activeReceivingAddressFingerprint: fingerprintReceivingAddress(receivingAddress),
                }),
            );

            const original = (
                await adminClient.query(gql`
                    query {
                        myStoreCurrencyConfiguration {
                            updatedAt
                        }
                    }
                `)
            ).myStoreCurrencyConfiguration;
            const configured = (
                await adminClient.query(
                    gql`
                        mutation ($input: UpdateStoreCurrencyConfigurationInput!) {
                            updateMyStoreCurrencyConfiguration(input: $input) {
                                selectorEnabled
                                usdtDisplayEnabled
                            }
                        }
                    `,
                    {
                        input: {
                            expectedUpdatedAt: original.updatedAt,
                            defaultCurrencyCode: 'MYR',
                            availableCurrencyCodes: ['MYR', 'CNY'],
                            selectorEnabled: true,
                            rateMode: 'MANUAL',
                            cnyToMyrRate: 0.6,
                            markupPercent: 0,
                            roundingMode: 'CENT',
                            usdtDisplayEnabled: true,
                            usdtMarkupPercent: 0,
                            usdtRateScheduleMode: 'INTERVAL',
                            usdtRateIntervalMinutes: 5,
                            usdtRateDailyTime: '10:00',
                        },
                    },
                )
            ).updateMyStoreCurrencyConfiguration;
            const persistedConfiguration = (
                await adminClient.query(gql`
                    query {
                        myStoreCurrencyConfiguration {
                            selectorEnabled
                            usdtDisplayEnabled
                        }
                    }
                `)
            ).myStoreCurrencyConfiguration;
            const channelRepository = connection.getRepository(ctx, Channel);
            const channel = await channelRepository.findOneOrFail({ where: { id: ctx.channelId } });
            expect({ configured, persistedConfiguration }).toMatchObject({
                configured: { selectorEnabled: true, usdtDisplayEnabled: true },
                persistedConfiguration: { selectorEnabled: true, usdtDisplayEnabled: true },
            });
            Object.assign(channel.customFields, {
                cnyPerUsdtRate: 7.2,
                usdtRateSource: 'synthetic-local-rate',
                usdtRateUpdatedAt: new Date(),
            });
            await channelRepository.save(channel);
            const adminCurrency = (
                await adminClient.query(gql`
                    query {
                        myStoreCurrencyConfiguration {
                            cnyPerUsdtRate
                            usdtRateAvailable
                        }
                    }
                `)
            ).myStoreCurrencyConfiguration;
            const publicCurrency = (
                await shopClient.query(gql`
                    query {
                        storefrontCurrencyConfiguration {
                            usdtRateAvailable
                            usdtPaymentConfigured
                            myrPerUsdtRate
                        }
                    }
                `)
            ).storefrontCurrencyConfiguration;
            expect({ adminCurrency, publicCurrency }).toMatchObject({
                adminCurrency: { cnyPerUsdtRate: 7.2, usdtRateAvailable: true },
                publicCurrency: {
                    usdtRateAvailable: true,
                    usdtPaymentConfigured: true,
                    myrPerUsdtRate: 4.32,
                },
            });

            await applied({ changes: { add: [{ productVariantId: physicalId, quantity: 1 }] } });
            await applied({ prepareShipping: { shippingAddress: address } });
            await applied({ order: { shippingMethodId } });
            const selected = (
                await shopClient.query(gql`
                    mutation {
                        setStorefrontPaymentCurrency(currencyCode: "USDT") {
                            id
                            currencyCode
                            customFields {
                                paymentCurrencyCode
                            }
                        }
                    }
                `)
            ).setStorefrontPaymentCurrency;
            expect(selected).toMatchObject({
                currencyCode: 'MYR',
                customFields: { paymentCurrencyCode: 'USDT' },
            });
            const ready = (await applied({ preparePayment: true })).cart.checkoutOrder;
            expect(ready).toMatchObject({ state: 'ArrangingPayment', currencyCode: 'MYR' });

            const quoteQuery = gql`
                mutation {
                    createStorefrontUsdtCheckoutQuote {
                        id
                        fiatCurrencyCode
                        fiatAmount
                        fiatPerUsdtRate
                        usdtAmount
                        network
                        receivingAddress
                        paymentStatus
                    }
                }
            `;
            const first = (await shopClient.query(quoteQuery)).createStorefrontUsdtCheckoutQuote;
            expect(first).toMatchObject({
                fiatCurrencyCode: 'MYR',
                fiatAmount: ready.totalWithTax,
                fiatPerUsdtRate: 4.32,
                network: 'TRC20',
                receivingAddress,
                paymentStatus: 'PENDING',
            });
            expect(first.usdtAmount).toBeGreaterThan(0);
            const second = (await shopClient.query(quoteQuery)).createStorefrontUsdtCheckoutQuote;
            expect(second).toMatchObject({ id: first.id, usdtAmount: first.usdtAmount });

            await applied({ reopen: true });
            const cnyOrder = (
                await shopClient.query(gql`
                    mutation {
                        setStorefrontPaymentCurrency(currencyCode: "CNY") {
                            id
                            currencyCode
                            customFields {
                                paymentCurrencyCode
                            }
                        }
                    }
                `)
            ).setStorefrontPaymentCurrency;
            expect(cnyOrder).toMatchObject({
                id: ready.id,
                currencyCode: 'CNY',
                customFields: { paymentCurrencyCode: 'CNY' },
            });
            await applied({ prepareShipping: { shippingAddress: address } });
            await applied({ order: { shippingMethodId } });
            const cnyShippingOrder = (await read()).checkoutOrder;
            expect(cnyShippingOrder).toMatchObject({ id: ready.id, currencyCode: 'CNY' });
            expect(cnyShippingOrder.subTotalWithTax).toBe(Math.round(ready.subTotalWithTax / 0.6));
            expect(cnyShippingOrder.shippingWithTax).toBe(Math.round(ready.shippingWithTax / 0.6));
            const cnyCampaign = (
                await adminClient.query(
                    gql`
                        mutation ($input: CreateStoreCouponCampaignInput!) {
                            createStoreCouponCampaign(input: $input) {
                                id
                            }
                        }
                    `,
                    {
                        input: {
                            name: '混合币种旧接口优惠券',
                            kind: 'ORDER_FIXED',
                            appearanceTheme: 'blue',
                            minimumSpend: 1_000,
                            discountAmount: 1_000,
                            issueLimit: 10,
                            validityDays: 7,
                            stackPolicy: 'EXCLUSIVE',
                            returnOnCancellation: true,
                            returnOnFullRefund: true,
                        },
                    },
                )
            ).createStoreCouponCampaign;
            const cnyCoupon = (
                await shopClient.query(
                    gql`
                        mutation ($id: ID!) {
                            claimStorefrontCoupon(campaignId: $id) {
                                id
                            }
                        }
                    `,
                    { id: cnyCampaign.id },
                )
            ).claimStorefrontCoupon;
            const cnyAppliedCoupon = (
                await shopClient.query(
                    gql`
                        mutation ($id: ID!) {
                            applyStorefrontCoupon(id: $id) {
                                status
                            }
                        }
                    `,
                    { id: cnyCoupon.id },
                )
            ).applyStorefrontCoupon;
            expect(cnyAppliedCoupon.status).toBe('LOCKED');
            const discountedCnyOrder = (await read()).checkoutOrder;
            expect(discountedCnyOrder.currencyCode).toBe('CNY');
            expect(discountedCnyOrder.totalWithTax).toBeLessThan(cnyShippingOrder.totalWithTax);
            const cnyRemovedCoupon = (
                await shopClient.query(
                    gql`
                        mutation ($id: ID!) {
                            removeStorefrontCoupon(id: $id) {
                                status
                            }
                        }
                    `,
                    { id: cnyCoupon.id },
                )
            ).removeStorefrontCoupon;
            expect(cnyRemovedCoupon.status).toBe('AVAILABLE');
            expect((await read()).checkoutOrder).toMatchObject({
                currencyCode: 'CNY',
                totalWithTax: cnyShippingOrder.totalWithTax,
            });
            const cnySelected = (
                await shopClient.query(gql`
                    mutation {
                        setStorefrontPaymentCurrency(currencyCode: "USDT") {
                            id
                            currencyCode
                            customFields {
                                paymentCurrencyCode
                            }
                        }
                    }
                `)
            ).setStorefrontPaymentCurrency;
            expect(cnySelected).toMatchObject({
                currencyCode: 'CNY',
                customFields: { paymentCurrencyCode: 'USDT' },
            });
            const cnyReady = (await applied({ preparePayment: true })).cart.checkoutOrder;
            expect(cnyReady).toMatchObject({ id: ready.id, state: 'ArrangingPayment', currencyCode: 'CNY' });
            const cnyQuote = (await shopClient.query(quoteQuery)).createStorefrontUsdtCheckoutQuote;
            expect(cnyQuote).toMatchObject({
                fiatCurrencyCode: 'CNY',
                fiatAmount: cnyReady.totalWithTax,
                fiatPerUsdtRate: 7.2,
                network: 'TRC20',
                receivingAddress,
                paymentStatus: 'PENDING',
            });
            expect(cnyQuote.id).not.toBe(first.id);
            expect(cnyQuote.usdtAmount).toBeGreaterThan(0);

            await applied({ reopen: true });
            const myrOrder = (
                await shopClient.query(gql`
                    mutation {
                        setStorefrontPaymentCurrency(currencyCode: "MYR") {
                            currencyCode
                            customFields {
                                paymentCurrencyCode
                            }
                        }
                    }
                `)
            ).setStorefrontPaymentCurrency;
            expect(myrOrder).toMatchObject({
                currencyCode: 'MYR',
                customFields: { paymentCurrencyCode: 'MYR' },
            });
            await applied({ prepareShipping: { shippingAddress: address } });
            await applied({ order: { shippingMethodId } });
            await shopClient.query(gql`
                mutation {
                    setStorefrontPaymentCurrency(currencyCode: "USDT") {
                        id
                    }
                }
            `);
            const myrReady = (await applied({ preparePayment: true })).cart.checkoutOrder;
            expect(myrReady).toMatchObject({
                currencyCode: 'MYR',
                subTotalWithTax: ready.subTotalWithTax,
                shippingWithTax: ready.shippingWithTax,
                totalWithTax: ready.totalWithTax,
            });
            const myrQuote = (await shopClient.query(quoteQuery)).createStorefrontUsdtCheckoutQuote;
            expect(myrQuote).toMatchObject({
                fiatCurrencyCode: 'MYR',
                fiatAmount: myrReady.totalWithTax,
                fiatPerUsdtRate: 4.32,
                paymentStatus: 'PENDING',
            });
        } finally {
            adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
            if (previousEncryptionKey === undefined) delete process.env.USDT_WALLET_ENCRYPTION_KEY;
            else process.env.USDT_WALLET_ENCRYPTION_KEY = previousEncryptionKey;
        }
    }, 120_000);
});
