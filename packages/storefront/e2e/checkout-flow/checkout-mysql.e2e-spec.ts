import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CommerceFulfillmentPlugin } from '@vendure/commerce-fulfillment-plugin';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { mergeConfig, PaymentMethodHandler } from '@vendure/core';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../../e2e-common/test-config';

const localPayment = new PaymentMethodHandler({
    code: 'checkout-browser-local-fixture',
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
    authOptions: { requireVerification: false, tokenMethod: ['bearer', 'cookie'] },
    paymentOptions: { paymentMethodHandlers: [localPayment] },
    customFields: {
        Order: [
            { name: 'customerNote', type: 'text', nullable: true, public: true },
            { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
            { name: 'deliveryEmailContactId', type: 'string', length: 64, nullable: true, public: false },
        ],
    },
    plugins: [
        CatalogManagementPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'checkout-browser-local',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'checkout-browser-local',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StorefrontCartPlugin,
        StorefrontContentPlugin,
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'checkout-browser-local-fixture-signing-secret',
        }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: true }),
    ],
});
const { server, adminClient } = createTestEnvironment(config);
const email = 'checkout-browser@example.test';
const hookEmail = 'checkout-coupon-hook@example.test';
let variantId = '';
let campaignId = '';

describe.runIf(process.env.DB === 'mysql')('checkout page on isolated MySQL', () => {
    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                defaultZone: 'Asia',
                countries: [...initialData.countries, { name: 'Malaysia', code: 'MY', zone: 'Asia' }],
                collections: [],
                paymentMethods: [
                    { name: 'Local payment fixture', handler: { code: localPayment.code, arguments: [] } },
                ],
            },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
        const channel = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                }
            }
        `);
        const currency = await adminClient.query(
            gql`
                mutation ($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel {
                            defaultCurrencyCode
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    id: channel.activeChannel.id,
                    defaultCurrencyCode: 'MYR',
                    availableCurrencyCodes: ['MYR'],
                },
            },
        );
        expect(currency.updateChannel.defaultCurrencyCode, currency.updateChannel.message).toBe('MYR');
        const product = await adminClient.query(gql`
            mutation {
                createProduct(
                    input: {
                        enabled: true
                        translations: [
                            {
                                languageCode: zh_Hans
                                name: "结算浏览器测试商品"
                                slug: "checkout-browser-item"
                                description: "隔离数据库中的浏览器结算测试商品"
                            }
                        ]
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
                        enabled: true,
                        sku: 'CHECKOUT-BROWSER-LOCAL',
                        price: 10_000,
                        stockOnHand: 100,
                        optionIds: [],
                        translations: [{ languageCode: 'zh_Hans', name: '数字交付规格' }],
                        customFields: {
                            digitalDeliveryMode: 'manual_service',
                            digitalStockPolicy: 'unlimited',
                        },
                    },
                ],
            },
        );
        variantId = variant.createProductVariants[0].id;
        const campaign = await adminClient.query(gql`
            mutation {
                createStoreCouponCampaign(
                    input: {
                        name: "结算浏览器测试券"
                        kind: ORDER_FIXED
                        minimumSpend: 10000
                        discountAmount: 1000
                        issueLimit: 10
                        validityDays: 7
                    }
                ) {
                    id
                }
            }
        `);
        campaignId = campaign.createStoreCouponCampaign.id;
        const customer = await adminClient.query(gql`
            mutation {
                createCustomer(
                    input: {
                        firstName: "Browser"
                        lastName: "Checkout"
                        emailAddress: "checkout-browser@example.test"
                    }
                    password: "local-checkout-fixture"
                ) {
                    ... on Customer {
                        id
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `);
        expect(customer.createCustomer.id, customer.createCustomer.message).toBeTruthy();
        const hookCustomer = await adminClient.query(gql`
            mutation {
                createCustomer(
                    input: {
                        firstName: "Browser"
                        lastName: "Coupon"
                        emailAddress: "checkout-coupon-hook@example.test"
                    }
                    password: "local-checkout-fixture"
                ) {
                    ... on Customer {
                        id
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `);
        expect(hookCustomer.createCustomer.id, hookCustomer.createCustomer.message).toBeTruthy();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('applies a claimed coupon, restores it on refresh, and prepares the same order', async () => {
        const { chromium, expect: browserExpect } = await import('@playwright/test');
        const { createServer } = await import('vite');
        const react = (await import('@vitejs/plugin-react')).default;
        const previousChannelSwitching = process.env.VITE_CLIENT_CHANNEL_SWITCHING;
        process.env.VITE_CLIENT_CHANNEL_SWITCHING = 'false';
        const frontend = await createServer({
            configFile: false,
            root: path.resolve(__dirname, '../..'),
            plugins: [react()],
            server: {
                host: '127.0.0.1',
                port: 0,
                proxy: {
                    '/shop-api': `http://127.0.0.1:${config.apiOptions.port}`,
                },
            },
        });
        const browser = await chromium.launch({ headless: true });
        try {
            await frontend.listen();
            const address = frontend.httpServer?.address();
            if (!address || typeof address === 'string') throw new Error('Local checkout page did not start');
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            const pageErrors: string[] = [];
            const shopErrors: string[] = [];
            const cartSnapshots: object[] = [];
            const orderIds: string[] = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('response', response => {
                if (!response.url().includes('/shop-api')) return;
                void response
                    .json()
                    .then(body => {
                        if (body.errors?.length)
                            shopErrors.push(
                                body.errors.map((item: { message: string }) => item.message).join(' | '),
                            );
                        const data = body.data ?? {};
                        const cart =
                            data.storefrontCart ??
                            data.applyStorefrontCartCommand?.cart ??
                            data.beginStorefrontCartCheckout?.cart;
                        if (cart)
                            cartSnapshots.push({
                                cartId: cart.id,
                                orderId: cart.checkoutOrder?.id,
                                couponCodes: cart.checkoutOrder?.couponCodes,
                                total: cart.checkoutOrder?.totalWithTax,
                            });
                        if (cart?.checkoutOrder?.id) orderIds.push(String(cart.checkoutOrder.id));
                        if (data.myStorefrontCoupons)
                            cartSnapshots.push({
                                coupons: data.myStorefrontCoupons.map(
                                    (item: { status: string; lockedOrderId: string }) => ({
                                        status: item.status,
                                        lockedOrderId: item.lockedOrderId,
                                    }),
                                ),
                            });
                    })
                    .catch(() => undefined);
            });
            const diagnostics = async () =>
                [
                    (await page.locator('body').innerText()).slice(0, 1000),
                    `snapshots: ${JSON.stringify(cartSnapshots)}`,
                    `shop errors: ${shopErrors.join(' | ')}`,
                    `page errors: ${pageErrors.join(' | ')}`,
                ].join('; ');
            const params = new URLSearchParams({ email, digital: variantId, campaign: campaignId });
            await page.goto(`http://127.0.0.1:${address.port}/e2e/checkout-flow/index.html?${params}`);
            await browserExpect(page.getByRole('button', { name: /选择已领取优惠券/ })).toBeVisible();
            await page.getByRole('button', { name: /选择已领取优惠券/ }).click();
            await page.getByRole('button', { name: '使用: 结算浏览器测试券' }).click();
            const summaryCoupon = page.locator('.price-summary-coupon button');
            try {
                await browserExpect(summaryCoupon).toContainText('结算浏览器测试券');
            } catch (error) {
                throw new Error(`Coupon could not be applied: ${await diagnostics()}`, { cause: error });
            }
            const firstOrderId = orderIds.at(-1);
            expect(firstOrderId).toBeTruthy();
            const discountedTotal = await page.locator('.price-summary .summary-total dd').innerText();
            expect(discountedTotal).not.toContain('120');
            await page.reload();
            try {
                await browserExpect(summaryCoupon).toContainText('结算浏览器测试券');
            } catch (error) {
                throw new Error(`Coupon did not recover after reload: ${await diagnostics()}`, {
                    cause: error,
                });
            }
            expect(orderIds.at(-1)).toBe(firstOrderId);
            await browserExpect(page.locator('.price-summary .summary-total dd')).toHaveText(discountedTotal);
            await page.locator('input[name="confirmDeliveryEmail"]').fill(email);
            await page.getByRole('button', { name: /提交订单/ }).click();
            const prepared = page.getByRole('region', { name: 'Prepared local order' });
            await browserExpect(prepared).toContainText('订单已准备');
            await browserExpect(prepared.locator('[data-order-id]')).toHaveAttribute(
                'data-order-id',
                firstOrderId ?? '',
            );
            await browserExpect(prepared).toContainText('ArrangingPayment');
            expect(shopErrors).toEqual([]);
            expect(pageErrors).toEqual([]);

            const hookPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
            const hookErrors: string[] = [];
            let bestCommands = 0;
            hookPage.on('pageerror', error => hookErrors.push(error.message));
            hookPage.on('request', request => {
                if (!request.url().includes('/shop-api')) return;
                try {
                    const body = request.postDataJSON();
                    if (body?.variables?.input?.coupon?.action === 'BEST') bestCommands++;
                } catch {
                    // Ignore non-JSON requests from the local fixture.
                }
            });
            const hookParams = new URLSearchParams({
                email: hookEmail,
                digital: variantId,
                campaign: campaignId,
            });
            await hookPage.goto(
                `http://127.0.0.1:${address.port}/e2e/checkout-flow/coupon-hook.html?${hookParams}`,
            );
            const hookState = hookPage.getByTestId('coupon-hook-state');
            await browserExpect(hookState).toContainText('已使用：结算浏览器测试券');
            expect(bestCommands).toBeGreaterThan(0);
            const hookOrderId = await hookState.getAttribute('data-order-id');
            const discountedHookTotal = Number(await hookState.getAttribute('data-total'));
            await hookPage.getByRole('button', { name: '取消用券' }).click();
            await browserExpect(hookState).toContainText('未使用优惠券');
            const fullHookTotal = Number(await hookState.getAttribute('data-total'));
            expect(fullHookTotal).toBeGreaterThan(discountedHookTotal);
            const bestCountBeforeReload = bestCommands;
            await hookPage.reload();
            await browserExpect(hookState).toContainText('未使用优惠券');
            await hookPage.waitForLoadState('networkidle');
            expect(bestCommands).toBe(bestCountBeforeReload);
            await browserExpect(hookState).toHaveAttribute('data-order-id', hookOrderId ?? '');
            await browserExpect(hookState).toHaveAttribute('data-total', String(fullHookTotal));
            expect(hookErrors).toEqual([]);
        } finally {
            await browser.close();
            await frontend.close();
            if (previousChannelSwitching === undefined) delete process.env.VITE_CLIENT_CHANNEL_SWITCHING;
            else process.env.VITE_CLIENT_CHANNEL_SWITCHING = previousChannelSwitching;
        }
    }, 120_000);
});
