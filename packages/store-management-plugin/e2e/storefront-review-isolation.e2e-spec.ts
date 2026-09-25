import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Channel,
    ChannelService,
    ConfigService,
    Customer,
    mergeConfig,
    Order,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontCatalogPlugin } from '@vendure/storefront-catalog-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { CommerceFulfillmentPlugin } from '../../commerce-fulfillment-plugin/src/commerce-fulfillment.plugin';
import { StorefrontReviewPlugin } from '../../storefront-review-plugin/src/storefront-review.plugin';
import { StoreProfile } from '../src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    plugins: [
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        StorefrontCatalogPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'review-isolation-e2e',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'review-isolation-e2e',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: false }),
        StorefrontReviewPlugin,
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);

const MY_REVIEWS = gql`
    query ReviewIsolationMine {
        myStorefrontReviews {
            id
            state
            customerName
            anonymous
        }
        myStorefrontReviewCandidates {
            orderLineId
        }
    }
`;
const ADMIN_REVIEWS = gql`
    query ReviewIsolationAdmin {
        storefrontReviews {
            items {
                id
                state
                customerId
                customerName
                anonymous
            }
            totalItems
        }
    }
`;
const PUBLIC_REVIEWS = gql`
    query ReviewIsolationPublic($productId: ID!) {
        storefrontProductReviews(productId: $productId) {
            totalItems
            items {
                id
                customerName
                anonymous
            }
        }
    }
`;
const SUBMIT_REVIEW = gql`
    mutation ReviewIsolationSubmit($orderLineId: ID!) {
        submitStorefrontReview(
            input: {
                orderLineId: $orderLineId
                rating: 5
                title: "Helpful product"
                body: "This synthetic product was useful for our local review acceptance."
                anonymous: true
            }
        ) {
            id
            state
            customerName
            anonymous
        }
    }
`;

describe('storefront review account and channel isolation', () => {
    let primaryToken: string;
    let secondaryToken: string;
    let customerEmail: string;
    let customerId: string;
    let productId: string;
    let variantId: string;
    let orderLineId: string;

    beforeAll(async () => {
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        await server.app.get(TransactionalConnection).rawConnection.synchronize();
        await adminClient.asSuperAdmin();

        const channel = (
            await adminClient.query(gql`
                query ReviewIsolationChannel {
                    activeChannel {
                        token
                    }
                }
            `)
        ).activeChannel;
        primaryToken = channel.token;
        const zones = await adminClient.query(gql`
            query ReviewIsolationZones {
                zones {
                    items {
                        id
                    }
                }
            }
        `);
        const zoneId =
            zones.zones.items[0]?.id ??
            (
                await adminClient.query(gql`
                    mutation ReviewIsolationCreateZone {
                        createZone(input: { name: "Review isolation zone" }) {
                            id
                        }
                    }
                `)
            ).createZone.id;
        expect(zoneId).toBeTruthy();
        secondaryToken = `review-isolation-${randomUUID().slice(0, 12)}`;
        const secondary = await adminClient.query(
            gql`
                mutation ReviewIsolationCreateChannel($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
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
                    code: secondaryToken,
                    token: secondaryToken,
                    defaultLanguageCode: 'en',
                    currencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: zoneId,
                    defaultShippingZoneId: zoneId,
                },
            },
        );
        expect(secondary.createChannel.id, secondary.createChannel.message).toBeTruthy();

        customerEmail = `review-${randomUUID()}@example.test`;
        const created = await adminClient.query(
            gql`
                mutation ReviewIsolationCreateCustomer($input: CreateCustomerInput!) {
                    createCustomer(input: $input, password: "ReviewIsolationPass123!") {
                        ... on Customer {
                            id
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { input: { firstName: 'Review', lastName: 'Customer', emailAddress: customerEmail } },
        );
        customerId = created.createCustomer.id;
        expect(customerId, created.createCustomer.message).toBeTruthy();
        const ctx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: primaryToken,
        });
        const rawConnection = server.app.get(TransactionalConnection).rawConnection;
        const entityIdStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        if (!entityIdStrategy) throw new Error('The E2E entity ID strategy is missing');
        const decodeId = entityIdStrategy.decodeId;
        const rawCustomer = await rawConnection.getRepository(Customer).findOneByOrFail({
            emailAddress: customerEmail,
        });
        const secondaryId = decodeId(secondary.createChannel.id);
        expect(await rawConnection.getRepository(Channel).findOneBy({ id: secondaryId })).toBeTruthy();
        await server.app
            .get(TransactionalConnection)
            .getRepository(ctx, StoreProfile)
            .save(
                new StoreProfile({
                    channelId: secondaryId,
                    status: 'ACTIVE',
                    descriptionZh: '',
                    descriptionEn: '',
                }),
            );
        await server.app.get(ChannelService).assignToChannels(ctx, Customer, rawCustomer.id, [secondaryId]);

        const slug = `review-isolation-${randomUUID()}`;
        const product = await adminClient.query(
            gql`
                mutation ReviewIsolationCreateProduct($input: CreateProductInput!) {
                    createProduct(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    enabled: true,
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Review isolation fixture',
                            slug,
                            description: 'Synthetic local review acceptance product',
                        },
                        {
                            languageCode: 'zh_Hans',
                            name: '评价隔离测试商品',
                            slug: `${slug}-zh`,
                            description: '仅用于本地评价验收的合成商品',
                        },
                    ],
                },
            },
        );
        productId = product.createProduct.id;
        const variants = await adminClient.query(
            gql`
                mutation ReviewIsolationCreateVariant($input: [CreateProductVariantInput!]!) {
                    createProductVariants(input: $input) {
                        id
                    }
                }
            `,
            {
                input: [
                    {
                        productId,
                        sku: `REVIEW-${randomUUID().slice(0, 10)}`,
                        price: 2_000,
                        stockOnHand: 2,
                        trackInventory: 'TRUE',
                        optionIds: [],
                        translations: [
                            { languageCode: 'en', name: 'Review isolation fixture' },
                            { languageCode: 'zh_Hans', name: '评价隔离测试规格' },
                        ],
                    },
                ],
            },
        );
        variantId = variants.createProductVariants[0].id;
        await shopClient.asUserWithCredentials(customerEmail, 'ReviewIsolationPass123!');
        const added = await shopClient.query(
            gql`
                mutation ReviewIsolationAddItem($variantId: ID!) {
                    addItemToOrder(productVariantId: $variantId, quantity: 1) {
                        ... on Order {
                            id
                            lines {
                                id
                            }
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { variantId },
        );
        const order = added.addItemToOrder;
        expect(order.id, order.message).toBeTruthy();
        orderLineId = order.lines[0].id;
        // The review test needs a paid eligible order, but deliberately does not run a real payment.
        await server.app.get(TransactionalConnection).getRepository(ctx, Order).update(decodeId(order.id), {
            state: 'PaymentSettled',
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(() => server.destroy());

    it('keeps an anonymous customer review private across stores while showing its owner to Admin', async () => {
        const before = await shopClient.query(MY_REVIEWS);
        expect(before.myStorefrontReviewCandidates).toContainEqual({ orderLineId });
        const submitted = (await shopClient.query(SUBMIT_REVIEW, { orderLineId })).submitStorefrontReview;
        expect(submitted).toMatchObject({
            state: 'PENDING',
            customerName: 'Anonymous customer',
            anonymous: true,
        });
        expect((await shopClient.query(MY_REVIEWS)).myStorefrontReviewCandidates).toEqual([]);
        const primaryAdmin = (await adminClient.query(ADMIN_REVIEWS)).storefrontReviews;
        expect(primaryAdmin.items).toContainEqual(
            expect.objectContaining({ id: submitted.id, customerId, state: 'PENDING', anonymous: true }),
        );
        expect(primaryAdmin.items[0].customerName).not.toBe('Anonymous customer');

        const approved = await adminClient.query(
            gql`
                mutation ReviewIsolationApprove($id: ID!) {
                    moderateStorefrontReview(input: { id: $id, state: APPROVED }) {
                        id
                        state
                    }
                }
            `,
            { id: submitted.id },
        );
        expect(approved.moderateStorefrontReview.state).toBe('APPROVED');
        const english = (await shopClient.query(PUBLIC_REVIEWS, { productId })).storefrontProductReviews;
        expect(english.items).toContainEqual(
            expect.objectContaining({
                id: submitted.id,
                customerName: 'Anonymous customer',
                anonymous: true,
            }),
        );
        const chinese = (await shopClient.query(PUBLIC_REVIEWS, { productId }, { languageCode: 'zh_Hans' }))
            .storefrontProductReviews;
        expect(chinese.items).toContainEqual(
            expect.objectContaining({ id: submitted.id, customerName: '匿名用户', anonymous: true }),
        );

        try {
            shopClient.setChannelToken(secondaryToken);
            shopClient.setAuthToken('');
            shopClient.setRequestHeader('Authorization', null);
            await shopClient.asUserWithCredentials(customerEmail, 'ReviewIsolationPass123!');
            expect((await shopClient.query(MY_REVIEWS)).myStorefrontReviews).toEqual([]);
            expect((await shopClient.query(MY_REVIEWS)).myStorefrontReviewCandidates).toEqual([]);
            expect(
                (await shopClient.query(PUBLIC_REVIEWS, { productId })).storefrontProductReviews.totalItems,
            ).toBe(0);
            await expect(shopClient.query(SUBMIT_REVIEW, { orderLineId })).rejects.toThrow(
                '订单商品不存在或当前账号无权评价',
            );
            adminClient.setChannelToken(secondaryToken);
            expect((await adminClient.query(ADMIN_REVIEWS)).storefrontReviews.totalItems).toBe(0);
            await expect(
                adminClient.query(
                    gql`
                        mutation ReviewIsolationForeignApprove($id: ID!) {
                            moderateStorefrontReview(
                                input: { id: $id, state: REJECTED, response: "Not owned here" }
                            ) {
                                id
                            }
                        }
                    `,
                    { id: submitted.id },
                ),
            ).rejects.toThrow();
        } finally {
            adminClient.setChannelToken(primaryToken);
            shopClient.setChannelToken(primaryToken);
            shopClient.setAuthToken('');
            shopClient.setRequestHeader('Authorization', null);
        }
        expect((await adminClient.query(ADMIN_REVIEWS)).storefrontReviews.totalItems).toBe(1);
    });

    it('submits through the production review component and keeps another store empty on mobile', async () => {
        const { chromium, webkit, devices, expect: browserExpect } = await import('@playwright/test');
        const { createServer } = await import('vite');
        const browserCustomerEmail = `review-browser-${randomUUID()}@example.test`;
        const created = await adminClient.query(
            gql`
                mutation ReviewIsolationBrowserCustomer($input: CreateCustomerInput!) {
                    createCustomer(input: $input, password: "ReviewIsolationPass123!") {
                        ... on Customer {
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
                    firstName: 'Browser',
                    lastName: 'Reviewer',
                    emailAddress: browserCustomerEmail,
                },
            },
        );
        expect(created.createCustomer.id, created.createCustomer.message).toBeTruthy();
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        if (!strategy) throw new Error('The E2E entity ID strategy is missing');
        const ctx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: primaryToken,
        });
        const browserCustomer = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Customer)
            .findOneByOrFail({ emailAddress: browserCustomerEmail });
        const secondaryChannel = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Channel)
            .findOneByOrFail({ token: secondaryToken });
        await server.app
            .get(ChannelService)
            .assignToChannels(ctx, Customer, browserCustomer.id, [secondaryChannel.id]);
        await shopClient.asUserWithCredentials(browserCustomerEmail, 'ReviewIsolationPass123!');
        const added = await shopClient.query(
            gql`
                mutation ReviewIsolationBrowserOrder($variantId: ID!) {
                    addItemToOrder(productVariantId: $variantId, quantity: 1) {
                        ... on Order {
                            id
                            lines {
                                id
                            }
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { variantId },
        );
        const order = added.addItemToOrder;
        expect(order.id, order.message).toBeTruthy();
        await server.app
            .get(TransactionalConnection)
            .getRepository(ctx, Order)
            .update(strategy.decodeId(order.id), {
                state: 'PaymentSettled',
            });
        expect((await shopClient.query(MY_REVIEWS)).myStorefrontReviewCandidates).toContainEqual({
            orderLineId: order.lines[0].id,
        });

        const frontend = await createServer({
            root: path.resolve(__dirname, '../../storefront'),
            server: {
                host: '127.0.0.1',
                port: 0,
                strictPort: false,
                proxy: { '/shop-api': `http://127.0.0.1:${config.apiOptions.port}` },
            },
        });
        const output = path.resolve(
            __dirname,
            '../../storefront/artifacts/readiness/review-isolation-browser',
        );
        await mkdir(output, { recursive: true });
        await frontend.listen();
        const desktopBrowser = await chromium.launch({ headless: true });
        const mobileBrowser = await webkit.launch({ headless: true });
        try {
            const address = frontend.httpServer?.address();
            if (!address || typeof address === 'string') throw new Error('Review fixture did not start');
            const baseUrl = `http://127.0.0.1:${address.port}/e2e/review-isolation/index.html`;
            const fixtureUrl = (channel: string) =>
                `${baseUrl}?${new URLSearchParams({ channel, email: browserCustomerEmail }).toString()}`;
            const desktop = await desktopBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
            const primaryErrors: string[] = [];
            desktop.on('pageerror', error => primaryErrors.push(error.message));
            await desktop.goto(fixtureUrl(primaryToken));
            try {
                await browserExpect(desktop.locator('.review-candidate-row')).toHaveCount(1, {
                    timeout: 20_000,
                });
            } catch (cause) {
                await desktop.screenshot({
                    path: path.join(output, 'desktop-primary-load-failed.png'),
                    fullPage: true,
                });
                const pageText = (await desktop.locator('body').innerText()).slice(0, 500);
                throw new Error(
                    `Review page did not load its candidate: ${pageText}; ` +
                        `page errors: ${primaryErrors.join(' | ')}; assertion: ${String(cause)}`,
                );
            }
            await desktop.locator('.review-candidate-row').click();
            const composer = desktop.locator('.review-composer');
            await browserExpect(composer).toBeVisible();
            await composer.locator('input:not([type="checkbox"])').fill('桌面真实接口评价');
            await composer.locator('textarea').fill('这是一条通过正式评价组件提交的本地跨店铺验收内容。');
            await composer.locator('input[type="checkbox"]').check();
            await composer.locator('.review-submit').click();
            await browserExpect(desktop.locator('.my-review-list article')).toHaveCount(1, {
                timeout: 20_000,
            });
            await browserExpect(desktop.getByText('评价已提交，审核通过后将公开展示')).toBeVisible();
            await desktop.screenshot({
                path: path.join(output, 'desktop-primary-submitted.png'),
                fullPage: true,
            });
            expect(primaryErrors).toEqual([]);

            const mobile = await mobileBrowser.newPage({ ...devices['iPhone 13'] });
            const foreignErrors: string[] = [];
            mobile.on('pageerror', error => foreignErrors.push(error.message));
            await mobile.goto(fixtureUrl(secondaryToken));
            try {
                await browserExpect(mobile.locator('.review-center-page')).toBeVisible({ timeout: 20_000 });
            } catch (cause) {
                await mobile.screenshot({
                    path: path.join(output, 'mobile-secondary-load-failed.png'),
                    fullPage: true,
                });
                const pageText = (await mobile.locator('body').innerText()).slice(0, 500);
                throw new Error(
                    `Review page did not load in the other store: ${pageText}; ` +
                        `page errors: ${foreignErrors.join(' | ')}; assertion: ${String(cause)}`,
                );
            }
            await browserExpect(mobile.locator('.review-center-loading')).toHaveCount(0, { timeout: 20_000 });
            await browserExpect(mobile.locator('.review-candidate-row')).toHaveCount(0);
            await browserExpect(mobile.locator('.my-review-list article')).toHaveCount(0);
            await mobile.screenshot({
                path: path.join(output, 'mobile-secondary-empty.png'),
                fullPage: true,
            });
            expect(foreignErrors).toEqual([]);
            const overflow = await mobile.evaluate(
                'document.documentElement.scrollWidth > window.innerWidth + 1',
            );
            expect(overflow).toBe(false);

            await mobile.goto(fixtureUrl(primaryToken));
            await browserExpect(mobile.locator('.my-review-list article')).toHaveCount(1, {
                timeout: 20_000,
            });
            await browserExpect(mobile.getByText('桌面真实接口评价')).toBeVisible();
            await mobile.screenshot({
                path: path.join(output, 'mobile-primary-submitted.png'),
                fullPage: true,
            });
            expect(foreignErrors).toEqual([]);
        } finally {
            await desktopBrowser.close();
            await mobileBrowser.close();
            await frontend.close();
        }
        const reviews = (await shopClient.query(MY_REVIEWS)).myStorefrontReviews;
        expect(reviews).toHaveLength(1);
        expect(reviews).toContainEqual(expect.objectContaining({ state: 'PENDING', anonymous: true }));
    }, 90_000);
});
