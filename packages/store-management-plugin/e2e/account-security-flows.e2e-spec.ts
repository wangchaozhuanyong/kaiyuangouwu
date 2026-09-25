import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import {
    ChannelService,
    ConfigService,
    Customer,
    DefaultSearchPlugin,
    mergeConfig,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontCatalogPlugin } from '@vendure/storefront-catalog-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { AssetServerPlugin } from '../../asset-server-plugin/src/plugin';
import { CommerceFulfillmentPlugin } from '../../commerce-fulfillment-plugin/src/commerce-fulfillment.plugin';
import { CustomerProductActivity } from '../src/entities/customer-product-activity.entity';
import { FraudRiskCase } from '../src/entities/fraud-risk-case.entity';
import { StoreProfile } from '../src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const translationProvider: ContentTranslationProvider = {
    name: 'account-security-e2e-local',
    isConfigured: () => true,
    translate: request =>
        Promise.resolve({
            provider: 'account-security-e2e-local',
            translations: request.segments.map(segment => ({ key: segment.key, text: segment.text })),
        }),
};

const accountTestConfig = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false, tokenMethod: ['bearer', 'cookie'] },
    customFields: {
        Order: [
            { name: 'customerNote', type: 'text', nullable: true, public: true },
            { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
        ],
        Channel: [
            { name: 'storefrontNameZh', type: 'string', defaultValue: '测试店铺', public: true },
            { name: 'storefrontNameEn', type: 'string', defaultValue: 'Test store', public: true },
        ],
    },
    plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.resolve(
                __dirname,
                '../../storefront/artifacts/readiness/account-security-browser/assets',
            ),
        }),
        CatalogManagementPlugin,
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        StorefrontCartPlugin,
        StorefrontCatalogPlugin,
        StorefrontContentPlugin,
        ContentTranslationPlugin.init({ provider: translationProvider }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: randomUUID(),
        }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: false }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(accountTestConfig);

const REQUESTS = gql`
    query AccountSecurityRequestsE2E {
        myDataSubjectRequests {
            id
            requestType
            status
            requestedAt
            dueAt
            cancelledAt
            resultDigest
        }
    }
`;
const CLOSE = gql`
    mutation AccountSecurityCloseE2E($password: String!) {
        requestMyAccountClosure(password: $password) {
            id
            requestType
            status
            requestedAt
            dueAt
        }
    }
`;
const CANCEL = gql`
    mutation AccountSecurityCancelE2E {
        cancelMyAccountClosure {
            id
            status
            cancelledAt
        }
    }
`;
const EXPORT = gql`
    mutation AccountSecurityExportE2E($password: String!) {
        exportMyPersonalData(password: $password) {
            fileName
            mimeType
            content
            sha256
            request {
                id
                requestType
                status
                resultDigest
            }
        }
    }
`;
const LOGOUT = gql`
    mutation AccountSecurityLogoutE2E {
        logout {
            success
        }
    }
`;

describe('authenticated account security API', () => {
    let customerEmail: string;
    let secondCustomerEmail: string;
    let channelToken: string;

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                collections: [],
            },
            customerCount: 1,
        });
        // The test harness reuses a cached SQL.js fixture created before new plugin entities existed.
        await server.app.get(TransactionalConnection).rawConnection.synchronize();
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(gql`
            query {
                customers(options: { take: 1 }) {
                    items {
                        id
                        emailAddress
                    }
                }
            }
        `);
        customerEmail = result.customers.items[0].emailAddress;
        secondCustomerEmail = `account-secondary-${randomUUID()}@example.test`;
        const second = await adminClient.query(
            gql`
                mutation ($input: CreateCustomerInput!) {
                    createCustomer(input: $input, password: "AccountSecondaryPass123!") {
                        ... on Customer {
                            id
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { input: { firstName: 'Second', lastName: 'Account', emailAddress: secondCustomerEmail } },
        );
        expect(second.createCustomer.id, second.createCustomer.message).toBeTruthy();
        await shopClient.asUserWithCredentials(customerEmail, 'test');
        const active = await shopClient.query(gql`
            query {
                activeCustomer {
                    id
                }
                activeChannel {
                    token
                }
            }
        `);
        expect(active.activeCustomer.id).toBeTruthy();
        channelToken = active.activeChannel.token;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(() => server.destroy());

    it('stores customer service feedback per account and exposes it to the current store admin', async () => {
        const feedbackFields = gql`
            query MyServiceFeedback {
                myCustomerServiceFeedback {
                    id
                    rating
                    tags
                    comment
                    customerId
                    orderCode
                }
            }
        `;
        const submitFeedback = gql`
            mutation SubmitServiceFeedback($input: SubmitCustomerServiceFeedbackInput!) {
                submitMyCustomerServiceFeedback(input: $input) {
                    id
                    rating
                    tags
                    comment
                    customerId
                    orderCode
                }
            }
        `;
        const initial = await shopClient.query(feedbackFields);
        expect(initial.myCustomerServiceFeedback).toBeNull();
        const saved = await shopClient.query(submitFeedback, {
            input: { rating: 4, tags: ['FRIENDLY'], comment: 'Helpful support' },
        });
        expect(saved.submitMyCustomerServiceFeedback).toMatchObject({
            rating: 4,
            tags: ['FRIENDLY'],
            comment: 'Helpful support',
            orderCode: null,
        });
        expect((await shopClient.query(feedbackFields)).myCustomerServiceFeedback.id).toBe(
            saved.submitMyCustomerServiceFeedback.id,
        );
        await expect(
            shopClient.query(submitFeedback, {
                input: { orderCode: 'NOT-OWNED-ORDER', rating: 5, tags: [], comment: '' },
            }),
        ).rejects.toThrow('订单不存在或不可评价');
        await expect(
            shopClient.query(submitFeedback, {
                input: { rating: 6, tags: [], comment: '' },
            }),
        ).rejects.toThrow('客服评分必须为 1 至 5 星');
        const admin = await adminClient.query(gql`
            query ServiceFeedbackAdmin {
                customerServiceFeedbacks {
                    totalItems
                    items {
                        id
                        rating
                        comment
                        customerId
                    }
                }
            }
        `);
        expect(admin.customerServiceFeedbacks.items).toContainEqual(
            expect.objectContaining({ id: saved.submitMyCustomerServiceFeedback.id, rating: 4 }),
        );

        await shopClient.asUserWithCredentials(secondCustomerEmail, 'AccountSecondaryPass123!');
        expect((await shopClient.query(feedbackFields)).myCustomerServiceFeedback).toBeNull();
        await shopClient.asUserWithCredentials(customerEmail, 'test');
    });

    it('keeps favorites and visits with the account across sessions', async () => {
        const product = await adminClient.query(
            gql`
                mutation CreateActivityProduct($input: CreateProductInput!) {
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
                            languageCode: LanguageCode.zh_Hans,
                            name: 'Account activity fixture',
                            slug: `account-activity-${randomUUID()}`,
                            description: 'Account activity fixture',
                        },
                    ],
                },
            },
        );
        const productId = product.createProduct.id;
        const fields = gql`
            query MyActivity {
                myCustomerProductActivity {
                    favoriteProductIds
                    recentProductVisits {
                        productId
                        visitedAt
                    }
                }
            }
        `;
        const favorite = gql`
            mutation SetFavorite($productId: ID!, $favorite: Boolean!) {
                setMyFavoriteProduct(productId: $productId, favorite: $favorite) {
                    favoriteProductIds
                }
            }
        `;
        const visit = gql`
            mutation RecordVisit($productId: ID!) {
                recordMyProductVisit(productId: $productId) {
                    recentProductVisits {
                        productId
                        visitedAt
                    }
                }
            }
        `;
        expect((await shopClient.query(fields)).myCustomerProductActivity.favoriteProductIds).toEqual([]);
        expect(
            (await shopClient.query(favorite, { productId, favorite: true })).setMyFavoriteProduct
                .favoriteProductIds,
        ).toContain(productId);
        expect(
            (await shopClient.query(visit, { productId })).recordMyProductVisit.recentProductVisits[0]
                .productId,
        ).toBe(productId);
        const secondDeviceClient = new SimpleGraphQLClient(
            accountTestConfig,
            `http://localhost:${accountTestConfig.apiOptions.port}/${accountTestConfig.apiOptions.shopApiPath}`,
        );
        await secondDeviceClient.asUserWithCredentials(customerEmail, 'test');
        expect((await secondDeviceClient.query(fields)).myCustomerProductActivity).toMatchObject({
            favoriteProductIds: [productId],
            recentProductVisits: [expect.objectContaining({ productId })],
        });
        await shopClient.query(LOGOUT);
        await shopClient.asUserWithCredentials(customerEmail, 'test');
        expect((await shopClient.query(fields)).myCustomerProductActivity).toMatchObject({
            favoriteProductIds: [productId],
            recentProductVisits: [expect.objectContaining({ productId })],
        });
        await shopClient.asUserWithCredentials(secondCustomerEmail, 'AccountSecondaryPass123!');
        expect((await shopClient.query(fields)).myCustomerProductActivity).toEqual({
            favoriteProductIds: [],
            recentProductVisits: [],
        });
        await expect(shopClient.query(favorite, { productId: '999999', favorite: true })).rejects.toThrow(
            '商品不存在或不可用',
        );
        expect(
            (await shopClient.query(favorite, { productId: '999999', favorite: false })).setMyFavoriteProduct
                .favoriteProductIds,
        ).toEqual([]);
        await shopClient.asUserWithCredentials(customerEmail, 'test');
        expect(
            (
                await shopClient.query(gql`
                    mutation {
                        clearMyFavoriteProducts {
                            favoriteProductIds
                        }
                    }
                `)
            ).clearMyFavoriteProducts.favoriteProductIds,
        ).toEqual([]);
        expect(
            (
                await shopClient.query(gql`
                    mutation {
                        clearMyProductVisits {
                            recentProductVisits {
                                productId
                            }
                        }
                    }
                `)
            ).clearMyProductVisits.recentProductVisits,
        ).toEqual([]);
        await shopClient.query(favorite, { productId, favorite: true });
        await shopClient.query(visit, { productId });
    });

    it('trims more than two MySQL history batches without deleting another account or store', async () => {
        const connection = server.app.get(TransactionalConnection);
        const contexts = server.app.get(RequestContextService);
        const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        if (!idStrategy) throw new Error('Entity ID strategy is missing');
        const decodeId = (id: string) => idStrategy.decodeId(id);
        const ownContext = await contexts.create({ apiType: 'admin', channelOrToken: channelToken });
        const repository = connection.getRepository(ownContext, CustomerProductActivity);
        const otherCustomer = await connection
            .getRepository(ownContext, Customer)
            .findOneByOrFail({ emailAddress: secondCustomerEmail });
        const channel = (
            await adminClient.query(gql`
                query {
                    activeChannel {
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
        const token = `history-trim-${randomUUID()}`;
        const otherChannel = (
            await adminClient.query(
                gql`
                    mutation ($input: CreateChannelInput!) {
                        createChannel(input: $input) {
                            ... on Channel {
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
                        code: token,
                        token,
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: 'MYR',
                        pricesIncludeTax: false,
                        defaultTaxZoneId: channel.defaultTaxZone.id,
                        defaultShippingZoneId: channel.defaultShippingZone.id,
                    },
                },
            )
        ).createChannel;
        expect(otherChannel.id, otherChannel.message).toBeTruthy();

        const email = `history-trim-${randomUUID()}@example.test`;
        const created = (
            await adminClient.query(
                gql`
                    mutation ($input: CreateCustomerInput!) {
                        createCustomer(input: $input, password: "HistoryTrimPass123!") {
                            ... on Customer {
                                id
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                { input: { firstName: 'History', lastName: 'Trim', emailAddress: email } },
            )
        ).createCustomer;
        expect(created.id, created.message).toBeTruthy();

        const productIds: string[] = [];
        for (let index = 0; index < 45; index++) {
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
                            translations: [
                                {
                                    languageCode: LanguageCode.zh_Hans,
                                    name: `History trim ${index}`,
                                    slug: `history-trim-${randomUUID()}`,
                                    description: 'MySQL history trim fixture',
                                },
                            ],
                        },
                    },
                )
            ).createProduct;
            productIds.push(product.id);
        }
        const now = Date.now();
        await repository.save([
            ...productIds.slice(0, 44).map(
                (productId, index) =>
                    new CustomerProductActivity({
                        channelId: ownContext.channelId,
                        customerId: decodeId(created.id),
                        productId: decodeId(productId),
                        kind: 'HISTORY',
                        visitedAt: new Date(now - (44 - index) * 60_000),
                    }),
            ),
            ...productIds.slice(0, 2).map(
                productId =>
                    new CustomerProductActivity({
                        channelId: ownContext.channelId,
                        customerId: otherCustomer.id,
                        productId: decodeId(productId),
                        kind: 'HISTORY',
                        visitedAt: new Date(now),
                    }),
            ),
            ...productIds.slice(0, 2).map(
                productId =>
                    new CustomerProductActivity({
                        channelId: decodeId(otherChannel.id),
                        customerId: decodeId(created.id),
                        productId: decodeId(productId),
                        kind: 'HISTORY',
                        visitedAt: new Date(now),
                    }),
            ),
        ]);
        try {
            await shopClient.asUserWithCredentials(email, 'HistoryTrimPass123!');
            const result = await shopClient.query(
                gql`
                    mutation ($productId: ID!) {
                        recordMyProductVisit(productId: $productId) {
                            recentProductVisits {
                                productId
                            }
                        }
                    }
                `,
                { productId: productIds[44] },
            );
            expect(
                result.recordMyProductVisit.recentProductVisits.map((visit: any) => visit.productId),
            ).toEqual([productIds[44], ...productIds.slice(25, 44).reverse()]);
            expect(
                await repository.countBy({
                    channelId: ownContext.channelId,
                    customerId: decodeId(created.id),
                    kind: 'HISTORY',
                }),
            ).toBe(20);
            expect(
                await repository.countBy({
                    channelId: ownContext.channelId,
                    customerId: otherCustomer.id,
                    kind: 'HISTORY',
                }),
            ).toBe(2);
            expect(
                await repository.countBy({
                    channelId: decodeId(otherChannel.id),
                    customerId: decodeId(created.id),
                    kind: 'HISTORY',
                }),
            ).toBe(2);
        } finally {
            await shopClient.asUserWithCredentials(customerEmail, 'test');
        }
    }, 120_000);

    it('requires the password, supports cooling-off cancellation, and exports the account without storing its body', async () => {
        await expect(shopClient.query(CLOSE, { password: 'incorrect' })).rejects.toThrow();
        expect((await shopClient.query(REQUESTS)).myDataSubjectRequests).toEqual([]);

        const first = (await shopClient.query(CLOSE, { password: 'test' })).requestMyAccountClosure;
        const repeated = (await shopClient.query(CLOSE, { password: 'test' })).requestMyAccountClosure;
        expect(repeated.id).toBe(first.id);
        expect(first).toMatchObject({ requestType: 'ACCOUNT_CLOSURE', status: 'PENDING' });
        expect(new Date(first.dueAt).getTime() - new Date(first.requestedAt).getTime()).toBe(
            7 * 24 * 60 * 60 * 1000,
        );
        expect((await shopClient.query(REQUESTS)).myDataSubjectRequests).toContainEqual(
            expect.objectContaining({ id: first.id, status: 'PENDING' }),
        );

        const cancelled = (await shopClient.query(CANCEL)).cancelMyAccountClosure;
        expect(cancelled).toMatchObject({ id: first.id, status: 'CANCELLED' });
        expect(cancelled.cancelledAt).toBeTruthy();
        await expect(shopClient.query(CANCEL)).rejects.toThrow();

        const exported = (await shopClient.query(EXPORT, { password: 'test' })).exportMyPersonalData;
        expect(exported).toMatchObject({
            mimeType: 'application/json',
            request: { requestType: 'EXPORT', status: 'FULFILLED' },
        });
        expect(exported.fileName).toMatch(/^my-data-\d{4}-\d{2}-\d{2}\.json$/u);
        expect(createHash('sha256').update(exported.content).digest('hex')).toBe(exported.sha256);
        expect(exported.request.resultDigest).toBe(exported.sha256);
        const exportedData = JSON.parse(exported.content);
        expect(exportedData.profile.emailAddress).toBe(customerEmail);
        expect(exportedData.serviceFeedback).toContainEqual(
            expect.objectContaining({ comment: 'Helpful support' }),
        );
        expect(exportedData.productActivity).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'FAVORITE' }),
                expect.objectContaining({ kind: 'HISTORY' }),
            ]),
        );

        const adminRows = (
            await adminClient.query(gql`
                query {
                    dataSubjectRequests {
                        id
                        requestType
                        status
                        resultDigest
                    }
                }
            `)
        ).dataSubjectRequests;
        expect(adminRows).toContainEqual(
            expect.objectContaining({ id: first.id, requestType: 'ACCOUNT_CLOSURE', status: 'CANCELLED' }),
        );
        expect(adminRows).toContainEqual(
            expect.objectContaining({
                id: exported.request.id,
                requestType: 'EXPORT',
                resultDigest: exported.sha256,
            }),
        );
        expect(JSON.stringify(adminRows)).not.toContain(customerEmail);
    }, 120_000);

    it('shows a held risk case to its customer and carries an appeal through Admin review', async () => {
        const ctx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: channelToken,
        });
        const connection = server.app.get(TransactionalConnection);
        const customerId = (
            await connection.getRepository(ctx, Customer).findOneByOrFail({
                emailAddress: customerEmail,
            })
        ).id;
        const repository = connection.getRepository(ctx, FraudRiskCase);
        const riskCase = await repository.save(
            new FraudRiskCase({
                channelId: ctx.channelId,
                caseCode: `ACCOUNT-${randomUUID().slice(0, 12)}`,
                subjectType: 'ACCOUNT',
                subjectId: String(customerId),
                orderId: null,
                customerId,
                status: 'OPEN',
                severity: 'P2',
                riskScore: 72,
                ruleVersion: 'local-account-e2e',
                subjectDigest: createHash('sha256').update(randomUUID()).digest('hex'),
                signalsJson: '[]',
                recommendedAction: 'MANUAL_REVIEW',
                dueAt: new Date(Date.now() + 60 * 60 * 1000),
                ownerUserId: null,
                decisionCode: null,
                decisionReason: null,
                decidedByUserId: null,
                decidedAt: null,
                idempotencyKey: randomUUID(),
            }),
        );
        const persisted = await repository.findOneByOrFail({ id: riskCase.id });
        expect(String(persisted.channelId)).toBe(String(ctx.channelId));
        expect(String(persisted.customerId)).toBe(String(customerId));
        const adminCases = (
            await adminClient.query(gql`
                query {
                    fraudRiskCases {
                        items {
                            id
                            caseCode
                            status
                        }
                    }
                }
            `)
        ).fraudRiskCases.items;
        const caseId = adminCases.find(
            (item: { caseCode: string }) => item.caseCode === riskCase.caseCode,
        )?.id;
        expect(caseId).toBeTruthy();
        await shopClient.query(LOGOUT);
        await shopClient.asUserWithCredentials(secondCustomerEmail, 'AccountSecondaryPass123!');
        expect((await shopClient.query(REQUESTS)).myDataSubjectRequests).toEqual([]);
        expect(
            (
                await shopClient.query(gql`
                    query {
                        myFraudRiskCases {
                            id
                        }
                    }
                `)
            ).myFraudRiskCases,
        ).toEqual([]);
        await expect(
            shopClient.query(
                gql`
                    mutation ($input: AppealFraudRiskCaseInput!) {
                        appealMyFraudRiskCase(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        id: caseId,
                        reason: 'A different account must not be able to appeal this case.',
                        idempotencyKey: randomUUID(),
                    },
                },
            ),
        ).rejects.toThrow('风险案件不存在或不属于当前客户');
        await shopClient.query(LOGOUT);
        await shopClient.asUserWithCredentials(customerEmail, 'test');
        const mine = (
            await shopClient.query(gql`
                query {
                    myFraudRiskCases {
                        id
                        caseCode
                        status
                        appeals {
                            id
                            status
                        }
                    }
                }
            `)
        ).myFraudRiskCases;
        expect(mine).toContainEqual(
            expect.objectContaining({ id: caseId, caseCode: riskCase.caseCode, status: 'OPEN' }),
        );

        const input = {
            id: caseId,
            reason: 'Please review this local test account case.',
            idempotencyKey: randomUUID(),
        };
        const appealMutation = gql`
            mutation ($input: AppealFraudRiskCaseInput!) {
                appealMyFraudRiskCase(input: $input) {
                    id
                    status
                    reason
                }
            }
        `;
        const appeal = (await shopClient.query(appealMutation, { input })).appealMyFraudRiskCase;
        expect(appeal).toMatchObject({ status: 'PENDING', reason: input.reason });
        const repeated = (await shopClient.query(appealMutation, { input })).appealMyFraudRiskCase;
        expect(repeated.id).toBe(appeal.id);
        await expect(
            shopClient.query(appealMutation, {
                input: { ...input, idempotencyKey: randomUUID() },
            }),
        ).rejects.toThrow('每个风险案件只能提交一次申诉');

        const reviewed = (
            await adminClient.query(
                gql`
                    mutation ($input: ReviewFraudRiskCaseInput!) {
                        reviewFraudRiskCase(input: $input) {
                            id
                            status
                            decisionCode
                            appeals {
                                id
                                status
                                response
                            }
                        }
                    }
                `,
                {
                    input: {
                        id: caseId,
                        action: 'RELEASE',
                        reason: 'Synthetic account ownership confirmed.',
                        idempotencyKey: randomUUID(),
                    },
                },
            )
        ).reviewFraudRiskCase;
        expect(reviewed).toMatchObject({
            id: caseId,
            status: 'APPROVED',
            decisionCode: 'RELEASE',
            appeals: [expect.objectContaining({ id: appeal.id, status: 'ACCEPTED' })],
        });
        const afterReviewRetry = (await shopClient.query(appealMutation, { input })).appealMyFraudRiskCase;
        expect(afterReviewRetry.id).toBe(appeal.id);
        expect(
            (
                await shopClient.query(gql`
                    query {
                        myFraudRiskCases {
                            id
                            status
                            appeals {
                                id
                                status
                            }
                        }
                    }
                `)
            ).myFraudRiskCases,
        ).toContainEqual(expect.objectContaining({ id: caseId, status: 'APPROVED' }));
    }, 120_000);

    it('removes and restores an uploaded avatar without exposing its recovery record to another account', async () => {
        const avatar = await sharp({
            create: { width: 64, height: 64, channels: 3, background: '#8b3a2f' },
        })
            .png()
            .toBuffer();
        const form = new FormData();
        form.set(
            'operations',
            JSON.stringify({
                query: 'mutation($file: Upload!) { setCustomerAvatar(file: $file) { id preview } }',
                variables: { file: null },
            }),
        );
        form.set('map', JSON.stringify({ 0: ['variables.file'] }));
        form.set('0', new Blob([new Uint8Array(avatar)], { type: 'image/png' }), 'avatar.png');
        const port = server.app.get(ConfigService).apiOptions.port;
        const uploadedResponse = await fetch(`http://127.0.0.1:${port}/shop-api`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${shopClient.getAuthToken()}`,
                'Apollo-Require-Preflight': 'true',
            },
            body: form,
        });
        const uploadedBody = await uploadedResponse.json();
        expect(uploadedResponse.ok).toBe(true);
        expect(uploadedBody.errors).toBeUndefined();
        const uploaded = uploadedBody.data.setCustomerAvatar;
        expect(uploaded.id).toBeTruthy();
        const avatarQuery = gql`
            query {
                myCustomerAvatar {
                    id
                    preview
                }
                myCustomerAvatarHistory {
                    id
                    status
                    quarantinedAt
                    purgeAfter
                    asset {
                        id
                    }
                }
            }
        `;
        expect((await shopClient.query(avatarQuery)).myCustomerAvatar.id).toBe(uploaded.id);
        expect(
            (
                await shopClient.query(gql`
                    mutation {
                        removeCustomerAvatar
                    }
                `)
            ).removeCustomerAvatar,
        ).toBe(true);
        const afterRemoval = await shopClient.query(avatarQuery);
        expect(afterRemoval.myCustomerAvatar).toBeNull();
        const history = afterRemoval.myCustomerAvatarHistory;
        expect(history).toContainEqual(
            expect.objectContaining({
                status: 'PENDING',
                asset: { id: uploaded.id },
            }),
        );
        const retentionId = history.find(
            (entry: { asset: { id: string } | null }) => entry.asset?.id === uploaded.id,
        )?.id;
        expect(retentionId).toBeTruthy();
        const retained = history.find((entry: { id: string }) => entry.id === retentionId);
        expect(new Date(retained.purgeAfter).getTime() - new Date(retained.quarantinedAt).getTime()).toBe(
            30 * 24 * 60 * 60 * 1000,
        );

        await shopClient.query(LOGOUT);
        await shopClient.asUserWithCredentials(secondCustomerEmail, 'AccountSecondaryPass123!');
        expect((await shopClient.query(avatarQuery)).myCustomerAvatarHistory).toEqual([]);
        const restore = gql`
            mutation ($id: ID!) {
                restoreCustomerAvatar(retentionId: $id) {
                    id
                }
            }
        `;
        await expect(shopClient.query(restore, { id: retentionId })).rejects.toThrow();
        await shopClient.query(LOGOUT);
        await shopClient.asUserWithCredentials(customerEmail, 'test');
        expect((await shopClient.query(restore, { id: retentionId })).restoreCustomerAvatar.id).toBe(
            uploaded.id,
        );
        const afterRestore = await shopClient.query(avatarQuery);
        expect(afterRestore.myCustomerAvatar.id).toBe(uploaded.id);
        expect(afterRestore.myCustomerAvatarHistory).toEqual([]);
    }, 120_000);

    it('separates store risk and avatar records while keeping account-wide privacy requests available', async () => {
        const password = 'AccountIsolationPass123!';
        const emailAddress = `account-isolation-${randomUUID()}@example.test`;
        const created = await adminClient.query(
            gql`
                mutation ($input: CreateCustomerInput!) {
                    createCustomer(input: $input, password: "AccountIsolationPass123!") {
                        ... on Customer {
                            id
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { input: { firstName: 'Isolated', lastName: 'Account', emailAddress } },
        );
        expect(created.createCustomer.id, created.createCustomer.message).toBeTruthy();
        const currentChannel = (
            await adminClient.query(gql`
                query {
                    activeChannel {
                        id
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
        const secondaryToken = `account-isolation-${randomUUID().slice(0, 12)}`;
        const secondary = await adminClient.query(
            gql`
                mutation ($input: CreateChannelInput!) {
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
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: 'MYR',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: currentChannel.defaultTaxZone.id,
                    defaultShippingZoneId: currentChannel.defaultShippingZone.id,
                },
            },
        );
        expect(secondary.createChannel.id, secondary.createChannel.message).toBeTruthy();
        const activityProduct = await adminClient.query(
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
                    translations: [
                        {
                            languageCode: LanguageCode.zh_Hans,
                            name: 'Cross-store activity fixture',
                            slug: `cross-store-activity-${randomUUID()}`,
                            description: 'Cross-store activity fixture',
                        },
                    ],
                },
            },
        );
        const activityProductId = activityProduct.createProduct.id;
        const ctx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: currentChannel.token,
        });
        const connection = server.app.get(TransactionalConnection);
        const customer = await connection.getRepository(ctx, Customer).findOneByOrFail({ emailAddress });
        const secondaryCtx = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: secondary.createChannel.token,
        });
        await connection.getRepository(secondaryCtx, StoreProfile).save(
            new StoreProfile({
                channelId: secondaryCtx.channelId,
                status: 'ACTIVE',
                descriptionZh: '',
                descriptionEn: '',
            }),
        );
        await server.app
            .get(ChannelService)
            .assignToChannels(ctx, Customer, customer.id, [secondaryCtx.channelId]);
        const riskCase = await connection.getRepository(ctx, FraudRiskCase).save(
            new FraudRiskCase({
                channelId: ctx.channelId,
                caseCode: `ISOLATION-${randomUUID().slice(0, 12)}`,
                subjectType: 'ACCOUNT',
                subjectId: String(customer.id),
                orderId: null,
                customerId: customer.id,
                status: 'OPEN',
                severity: 'P2',
                riskScore: 70,
                ruleVersion: 'local-channel-isolation-e2e',
                subjectDigest: createHash('sha256').update(randomUUID()).digest('hex'),
                signalsJson: '[]',
                recommendedAction: 'MANUAL_REVIEW',
                dueAt: new Date(Date.now() + 60 * 60 * 1000),
                ownerUserId: null,
                decisionCode: null,
                decisionReason: null,
                decidedByUserId: null,
                decidedAt: null,
                idempotencyKey: randomUUID(),
            }),
        );
        shopClient.setChannelToken(currentChannel.token);
        await shopClient.asUserWithCredentials(emailAddress, password);
        await shopClient.query(
            gql`
                mutation ($productId: ID!) {
                    setMyFavoriteProduct(productId: $productId, favorite: true) {
                        favoriteProductIds
                    }
                    recordMyProductVisit(productId: $productId) {
                        recentProductVisits {
                            productId
                        }
                    }
                }
            `,
            { productId: activityProductId },
        );
        await shopClient.query(gql`
            mutation {
                submitMyCustomerServiceFeedback(input: { rating: 4, tags: ["FRIENDLY"] }) {
                    id
                }
            }
        `);
        const privacy = (await shopClient.query(EXPORT, { password })).exportMyPersonalData.request;
        const avatar = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#69483b' } })
            .png()
            .toBuffer();
        const form = new FormData();
        form.set(
            'operations',
            JSON.stringify({
                query: 'mutation($file: Upload!) { setCustomerAvatar(file: $file) { id } }',
                variables: { file: null },
            }),
        );
        form.set('map', JSON.stringify({ 0: ['variables.file'] }));
        form.set('0', new Blob([new Uint8Array(avatar)], { type: 'image/png' }), 'avatar.png');
        const uploaded = await fetch(
            `http://127.0.0.1:${server.app.get(ConfigService).apiOptions.port}/shop-api`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${shopClient.getAuthToken()}`,
                    'vendure-token': currentChannel.token,
                    'Apollo-Require-Preflight': 'true',
                },
                body: form,
            },
        );
        const uploadBody = await uploaded.json();
        expect(uploaded.ok, JSON.stringify(uploadBody.errors)).toBe(true);
        const assetId = uploadBody.data.setCustomerAvatar.id;
        expect(assetId).toBeTruthy();
        expect(
            (
                await shopClient.query(gql`
                    mutation {
                        removeCustomerAvatar
                    }
                `)
            ).removeCustomerAvatar,
        ).toBe(true);
        const primaryHistory = (
            await shopClient.query(gql`
                query {
                    myCustomerAvatarHistory {
                        id
                        asset {
                            id
                        }
                    }
                }
            `)
        ).myCustomerAvatarHistory;
        const retentionId = primaryHistory.find(
            (entry: { asset: { id: string } | null }) => entry.asset?.id === assetId,
        )?.id;
        expect(retentionId).toBeTruthy();
        const primaryRiskCases = (
            await shopClient.query(gql`
                query {
                    myFraudRiskCases {
                        id
                    }
                }
            `)
        ).myFraudRiskCases;
        expect(primaryRiskCases).toHaveLength(1);
        const primaryRiskCaseId = primaryRiskCases[0].id;
        const primaryAuthToken = shopClient.getAuthToken();

        try {
            shopClient.setChannelToken(secondary.createChannel.token);
            shopClient.setAuthToken('');
            shopClient.setRequestHeader('Authorization', null);
            await shopClient.asUserWithCredentials(emailAddress, password);
            expect(
                (
                    await shopClient.query(gql`
                        query {
                            activeCustomer {
                                id
                            }
                        }
                    `)
                ).activeCustomer.id,
            ).toBe(created.createCustomer.id);
            expect((await shopClient.query(REQUESTS)).myDataSubjectRequests).toContainEqual(
                expect.objectContaining({ id: privacy.id, requestType: 'EXPORT' }),
            );
            const otherStore = await shopClient.query(gql`
                query {
                    myFraudRiskCases {
                        id
                    }
                    myCustomerAvatar {
                        id
                    }
                    myCustomerAvatarHistory {
                        id
                    }
                    myCustomerProductActivity {
                        favoriteProductIds
                        recentProductVisits {
                            productId
                        }
                    }
                    myCustomerServiceFeedback {
                        id
                    }
                }
            `);
            expect(otherStore.myFraudRiskCases).toEqual([]);
            expect(otherStore.myCustomerAvatar).toBeNull();
            expect(otherStore.myCustomerAvatarHistory).toEqual([]);
            expect(otherStore.myCustomerProductActivity).toEqual({
                favoriteProductIds: [],
                recentProductVisits: [],
            });
            expect(otherStore.myCustomerServiceFeedback).toBeNull();
            await expect(
                shopClient.query(
                    gql`
                        mutation ($productId: ID!) {
                            setMyFavoriteProduct(productId: $productId, favorite: true) {
                                favoriteProductIds
                            }
                        }
                    `,
                    { productId: activityProductId },
                ),
            ).rejects.toThrow('商品不存在或不可用');
            await shopClient.query(gql`
                mutation {
                    submitMyCustomerServiceFeedback(input: { rating: 5, tags: ["RESOLVED"] }) {
                        rating
                    }
                }
            `);
            expect(
                (
                    await shopClient.query(gql`
                        query {
                            myCustomerServiceFeedback {
                                rating
                                tags
                            }
                        }
                    `)
                ).myCustomerServiceFeedback,
            ).toEqual({ rating: 5, tags: ['RESOLVED'] });
            await expect(
                shopClient.query(
                    gql`
                        mutation ($input: AppealFraudRiskCaseInput!) {
                            appealMyFraudRiskCase(input: $input) {
                                id
                            }
                        }
                    `,
                    {
                        input: {
                            id: primaryRiskCaseId,
                            reason: 'A linked customer cannot appeal a different store case.',
                            idempotencyKey: randomUUID(),
                        },
                    },
                ),
            ).rejects.toThrow('风险案件不存在或不属于当前客户');
            await expect(
                shopClient.query(
                    gql`
                        mutation ($id: ID!) {
                            restoreCustomerAvatar(retentionId: $id) {
                                id
                            }
                        }
                    `,
                    { id: retentionId },
                ),
            ).rejects.toThrow();
        } finally {
            shopClient.setChannelToken(currentChannel.token);
            shopClient.setAuthToken(primaryAuthToken);
        }
        expect(
            (
                await shopClient.query(gql`
                    query {
                        myFraudRiskCases {
                            id
                        }
                    }
                `)
            ).myFraudRiskCases,
        ).toContainEqual(expect.objectContaining({ id: primaryRiskCaseId }));
        const primaryActivityAndFeedback = await shopClient.query(gql`
            query {
                myCustomerProductActivity {
                    favoriteProductIds
                    recentProductVisits {
                        productId
                    }
                }
                myCustomerServiceFeedback {
                    rating
                    tags
                }
            }
        `);
        expect(primaryActivityAndFeedback.myCustomerProductActivity).toEqual({
            favoriteProductIds: [activityProductId],
            recentProductVisits: [{ productId: activityProductId }],
        });
        expect(primaryActivityAndFeedback.myCustomerServiceFeedback).toEqual({
            rating: 4,
            tags: ['FRIENDLY'],
        });
        expect(
            (
                await shopClient.query(
                    gql`
                        mutation ($id: ID!) {
                            restoreCustomerAvatar(retentionId: $id) {
                                id
                            }
                        }
                    `,
                    { id: retentionId },
                )
            ).restoreCustomerAvatar.id,
        ).toBe(assetId);
    }, 120_000);

    it('operates the production account security component with local Shop API on desktop and mobile', async () => {
        const { chromium, webkit, devices, expect: browserExpect } = await import('@playwright/test');
        const { createServer } = await import('vite');
        const activeChannel = (
            await adminClient.query(gql`
                query {
                    activeChannel {
                        id
                    }
                }
            `)
        ).activeChannel;
        const channelUpdate = await adminClient.query(
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
                    id: activeChannel.id,
                    defaultCurrencyCode: 'MYR',
                    availableCurrencyCodes: ['MYR'],
                },
            },
        );
        expect(channelUpdate.updateChannel.defaultCurrencyCode, channelUpdate.updateChannel.message).toBe(
            'MYR',
        );
        const apiPort = server.app.get(ConfigService).apiOptions.port;
        const previousMarketCodes = process.env.VITE_MARKET_CODES;
        const previousChannelSwitching = process.env.VITE_CLIENT_CHANNEL_SWITCHING;
        process.env.VITE_MARKET_CODES = 'my-malaysia';
        process.env.VITE_CLIENT_CHANNEL_SWITCHING = 'false';
        const frontend = await createServer({
            root: path.resolve(__dirname, '../../storefront'),
            server: {
                host: '127.0.0.1',
                port: 0,
                strictPort: false,
                proxy: {
                    '/shop-api': `http://127.0.0.1:${apiPort}`,
                    '/assets': `http://127.0.0.1:${apiPort}`,
                    '/storefront-realtime': `http://127.0.0.1:${apiPort}`,
                },
            },
        });
        const output = path.resolve(
            __dirname,
            '../../storefront/artifacts/readiness/account-security-browser',
        );
        await mkdir(output, { recursive: true });
        await frontend.listen();
        try {
            const address = frontend.httpServer?.address();
            if (!address || typeof address === 'string')
                throw new Error('Local account fixture did not start');
            const ctx = await server.app.get(RequestContextService).create({
                apiType: 'admin',
                channelOrToken: channelToken,
            });
            const connection = server.app.get(TransactionalConnection);
            const avatar = await sharp({
                create: { width: 96, height: 96, channels: 3, background: '#c78e73' },
            })
                .png()
                .toBuffer();
            for (const [name, engine, options] of [
                ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }],
                ['mobile', webkit, { ...devices['iPhone 13'] }],
            ] as const) {
                const emailAddress = `account-browser-${name}-${randomUUID()}@example.test`;
                const created = await adminClient.query(
                    gql`
                        mutation ($input: CreateCustomerInput!) {
                            createCustomer(input: $input, password: "AccountBrowserPass123!") {
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
                expect(created.createCustomer.id, created.createCustomer.message).toBeTruthy();
                const customer = await connection
                    .getRepository(ctx, Customer)
                    .findOneByOrFail({ emailAddress });
                const riskCase = await connection.getRepository(ctx, FraudRiskCase).save(
                    new FraudRiskCase({
                        channelId: ctx.channelId,
                        caseCode: `BROWSER-${name.toUpperCase()}-${randomUUID().slice(0, 8)}`,
                        subjectType: 'ACCOUNT',
                        subjectId: String(customer.id),
                        orderId: null,
                        customerId: customer.id,
                        status: 'OPEN',
                        severity: 'P2',
                        riskScore: 60,
                        ruleVersion: 'local-account-browser-e2e',
                        subjectDigest: createHash('sha256').update(randomUUID()).digest('hex'),
                        signalsJson: '[]',
                        recommendedAction: 'MANUAL_REVIEW',
                        dueAt: new Date(Date.now() + 60 * 60 * 1000),
                        ownerUserId: null,
                        decisionCode: null,
                        decisionReason: null,
                        decidedByUserId: null,
                        decidedAt: null,
                        idempotencyKey: randomUUID(),
                    }),
                );
                const browser = await engine.launch({ headless: true });
                try {
                    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
                    const page = await context.newPage();
                    const errors: string[] = [];
                    const shopErrors: string[] = [];
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('requestfailed', request => {
                        shopErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
                    });
                    page.on('response', response => {
                        if (!response.url().includes('/shop-api')) return;
                        void response
                            .json()
                            .then(body => {
                                if (!body.errors?.length && response.status() < 400) return;
                                const operation =
                                    response.request().postDataJSON()?.operationName ?? 'unnamed';
                                shopErrors.push(
                                    `${operation} ${response.status()}: ${body.errors?.map((item: { message: string }) => item.message).join(' | ') ?? 'HTTP error'}`,
                                );
                            })
                            .catch(() => undefined);
                    });
                    const query = new URLSearchParams({ channel: channelToken, email: emailAddress });
                    await page.goto(
                        `http://127.0.0.1:${address.port}/e2e/account-security/index.html?${query.toString()}`,
                    );
                    try {
                        await browserExpect(page.getByText(emailAddress)).toBeVisible({ timeout: 15_000 });
                    } catch (error) {
                        await page.screenshot({
                            path: path.join(output, `${name}-load-failed.png`),
                            fullPage: true,
                        });
                        throw new Error(
                            `Account fixture did not load: ${(await page.locator('body').innerText()).slice(0, 800)}; page errors: ${errors.join(' | ')}`,
                            { cause: error },
                        );
                    }
                    await page.screenshot({ path: path.join(output, `${name}-viewport.png`) });
                    const caseCard = page
                        .locator('.security-risk-case')
                        .filter({ hasText: riskCase.caseCode });
                    await browserExpect(caseCard).toBeVisible();
                    await browserExpect(caseCard).not.toContainText('订单 —');
                    await caseCard.getByRole('button', { name: '提交复核说明' }).click();
                    await caseCard.locator('textarea').fill('Local browser account review request.');
                    await caseCard.getByRole('button', { name: '提交申诉' }).click();
                    await browserExpect(caseCard).toContainText('申诉已提交');

                    await page.locator('.security-avatar-input').setInputFiles({
                        name: 'browser-avatar.png',
                        mimeType: 'image/png',
                        buffer: avatar,
                    });
                    const currentAvatar = page.locator('.security-user-avatar img');
                    await browserExpect(currentAvatar).toBeVisible();
                    await browserExpect
                        .poll(() => currentAvatar.evaluate(image => (image as HTMLImageElement).naturalWidth))
                        .toBeGreaterThan(0);
                    await page.locator('.security-avatar-actions button.is-danger').click();
                    await browserExpect(page.getByText('可恢复头像')).toBeVisible();
                    await page.getByRole('button', { name: '恢复' }).click();
                    await browserExpect(currentAvatar).toBeVisible();

                    await page.getByRole('button', { name: /导出我的个人数据/ }).click();
                    const exportDialog = page.getByRole('dialog');
                    await exportDialog.getByLabel('当前账户密码').fill('AccountBrowserPass123!');
                    const [download] = await Promise.all([
                        page.waitForEvent('download'),
                        exportDialog.getByRole('button', { name: '验证并下载' }).click(),
                    ]);
                    expect(download.suggestedFilename()).toMatch(/^my-data-\d{4}-\d{2}-\d{2}\.json$/u);
                    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
                    expect(exported.profile.emailAddress).toBe(emailAddress);

                    await page.getByRole('button', { name: /申请注销账户/ }).click();
                    const closureDialog = page.getByRole('dialog');
                    await closureDialog.getByLabel('当前账户密码').fill('AccountBrowserPass123!');
                    await closureDialog.getByRole('button', { name: '提交注销申请' }).click();
                    await browserExpect(page.getByText('账户注销已申请')).toBeVisible();
                    await page.getByRole('button', { name: '撤销' }).click();
                    await browserExpect(page.getByRole('button', { name: /申请注销账户/ })).toBeVisible();

                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
                    ).toBeLessThanOrEqual(1);
                    expect(errors).toEqual([]);
                    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });

                    shopErrors.length = 0;
                    await page.goto(`http://127.0.0.1:${address.port}/account-security`);
                    try {
                        await browserExpect(page.locator('.security-user-email')).toHaveText(emailAddress, {
                            timeout: 15_000,
                        });
                    } catch (error) {
                        await page.screenshot({
                            path: path.join(output, `${name}-full-route-failed.png`),
                            fullPage: true,
                        });
                        const body = (await page.locator('body').innerText()).slice(0, 800);
                        const diagnostics = `Account route did not load: ${body}; page errors: ${errors.join(' | ')}; Shop errors: ${shopErrors.slice(-12).join(' | ')}`;
                        throw new Error(diagnostics, { cause: error });
                    }
                    const consentButton = page.getByRole('button', {
                        name: /Necessary only|仅必要功能/,
                    });
                    if (await consentButton.isVisible()) await consentButton.click();
                    await browserExpect(page.locator('.security-risk-case')).toContainText(riskCase.caseCode);
                    if (name === 'desktop') {
                        const accountNavigation = page.getByRole('navigation', {
                            name: /Account navigation|账户导航/,
                        });
                        await browserExpect(accountNavigation).toBeVisible();
                        await browserExpect(accountNavigation).toContainText(emailAddress);
                        await browserExpect(
                            accountNavigation.getByRole('link', { name: /Security|安全中心/ }),
                        ).toHaveAttribute('aria-current', 'page');
                        await accountNavigation.getByRole('link', { name: /Overview|账户概览/ }).click();
                        await browserExpect(page.locator('[data-route="account"]')).toBeVisible();
                        await accountNavigation.getByRole('link', { name: /Security|安全中心/ }).click();
                        await browserExpect(page.locator('.security-user-email')).toHaveText(emailAddress);
                    } else {
                        await browserExpect(page.locator('.desktop-account-navigation')).toHaveCount(0);
                    }
                    await page.reload();
                    await browserExpect(page.locator('.security-user-email')).toHaveText(emailAddress);
                    await browserExpect(page.locator('.security-risk-case')).toContainText(riskCase.caseCode);
                    await browserExpect(consentButton).toHaveCount(0);
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
                    ).toBeLessThanOrEqual(1);
                    expect(errors).toEqual([]);
                    expect(
                        shopErrors.filter(
                            message =>
                                !message.includes('net::ERR_ABORTED') && !message.endsWith(': cancelled'),
                        ),
                    ).toEqual([]);
                    await page.screenshot({ path: path.join(output, `${name}-full-route.png`) });
                    await context.close();
                } finally {
                    await browser.close();
                }
            }
        } finally {
            await frontend.close();
            if (previousMarketCodes === undefined) delete process.env.VITE_MARKET_CODES;
            else process.env.VITE_MARKET_CODES = previousMarketCodes;
            if (previousChannelSwitching === undefined) delete process.env.VITE_CLIENT_CHANNEL_SWITCHING;
            else process.env.VITE_CLIENT_CHANNEL_SWITCHING = previousChannelSwitching;
        }
    }, 180_000);

    it('syncs real favorites and browsing pages across desktop and mobile sessions', async () => {
        const { chromium, webkit, devices, expect: browserExpect } = await import('@playwright/test');
        const { createServer } = await import('vite');
        const emailAddress = `activity-browser-${randomUUID()}@example.test`;
        const password = 'ActivityBrowserPass123!';
        const secondEmailAddress = `activity-other-${randomUUID()}@example.test`;
        const secondPassword = 'ActivityOtherPass123!';
        const productName = `跨设备收藏商品 ${randomUUID().slice(0, 8)}`;
        const createdCustomer = await adminClient.query(
            gql`
                mutation ($input: CreateCustomerInput!, $password: String!) {
                    createCustomer(input: $input, password: $password) {
                        ... on Customer {
                            id
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { input: { firstName: 'Activity', lastName: 'Browser', emailAddress }, password },
        );
        expect(createdCustomer.createCustomer.id, createdCustomer.createCustomer.message).toBeTruthy();
        const secondCustomer = await adminClient.query(
            gql`
                mutation ($input: CreateCustomerInput!, $password: String!) {
                    createCustomer(input: $input, password: $password) {
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
                    firstName: 'Activity',
                    lastName: 'Other',
                    emailAddress: secondEmailAddress,
                },
                password: secondPassword,
            },
        );
        expect(secondCustomer.createCustomer.id, secondCustomer.createCustomer.message).toBeTruthy();
        const accountApiClient = new SimpleGraphQLClient(
            accountTestConfig,
            `http://localhost:${accountTestConfig.apiOptions.port}/${accountTestConfig.apiOptions.shopApiPath}`,
        );
        accountApiClient.setChannelToken(channelToken);
        await accountApiClient.asUserWithCredentials(emailAddress, password);
        expect(
            (
                await accountApiClient.query(gql`
                    query {
                        activeCustomer {
                            id
                        }
                    }
                `)
            ).activeCustomer.id,
        ).toBe(createdCustomer.createCustomer.id);
        const activeChannel = (
            await adminClient.query(gql`
                query {
                    activeChannel {
                        id
                    }
                }
            `)
        ).activeChannel;
        const currencyUpdate = await adminClient.query(
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
                    id: activeChannel.id,
                    defaultCurrencyCode: 'MYR',
                    availableCurrencyCodes: ['MYR'],
                },
            },
        );
        expect(currencyUpdate.updateChannel.defaultCurrencyCode, currencyUpdate.updateChannel.message).toBe(
            'MYR',
        );
        const createdProduct = await adminClient.query(
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
                    translations: [
                        {
                            languageCode: LanguageCode.zh_Hans,
                            name: productName,
                            slug: `activity-browser-${randomUUID()}`,
                            description: '本地跨浏览器会话验收商品',
                        },
                        {
                            languageCode: LanguageCode.en,
                            name: productName,
                            slug: `activity-browser-en-${randomUUID()}`,
                            description: 'Local cross-session activity product',
                        },
                    ],
                },
            },
        );
        const productId = createdProduct.createProduct.id;
        expect(productId).toBeTruthy();
        const createdVariant = await adminClient.query(
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
                        productId,
                        enabled: true,
                        sku: `ACTIVITY-BROWSER-${randomUUID().slice(0, 12)}`,
                        price: 2900,
                        stockOnHand: 12,
                        trackInventory: 'TRUE',
                        optionIds: [],
                        translations: [
                            { languageCode: LanguageCode.zh_Hans, name: '默认规格' },
                            { languageCode: LanguageCode.en, name: 'Default variant' },
                        ],
                    },
                ],
            },
        );
        expect(createdVariant.createProductVariants[0]?.id).toBeTruthy();
        const apiPort = server.app.get(ConfigService).apiOptions.port;
        const englishProductResponse = await fetch(
            `http://127.0.0.1:${apiPort}/shop-api?languageCode=en&currencyCode=MYR`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'language-code': 'en',
                    'vendure-token': channelToken,
                },
                body: JSON.stringify({
                    query: 'query AccountActivityProduct($id: ID!) { product(id: $id) { name } }',
                    variables: { id: productId },
                }),
            },
        );
        const englishProduct = (await englishProductResponse.json()) as {
            data?: { product?: { name?: string | null } | null };
            errors?: Array<{ message: string }>;
        };
        expect(englishProductResponse.ok).toBe(true);
        expect(englishProduct.data?.product?.name, englishProduct.errors?.[0]?.message).toBe(productName);
        const englishListResponse = await fetch(
            `http://127.0.0.1:${apiPort}/shop-api?languageCode=en&currencyCode=MYR`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'language-code': 'en',
                    'vendure-token': channelToken,
                },
                body: JSON.stringify({
                    query: 'query AccountActivityProductList($options: ProductListOptions) { products(options: $options) { items { id name } } }',
                    variables: { options: { take: 1, filter: { id: { eq: productId } } } },
                }),
            },
        );
        const englishList = (await englishListResponse.json()) as {
            data?: { products?: { items?: Array<{ id: string; name: string }> } };
            errors?: Array<{ message: string }>;
        };
        expect(englishListResponse.ok).toBe(true);
        expect(englishList.data?.products?.items?.[0]?.name, englishList.errors?.[0]?.message).toBe(
            productName,
        );
        const previousMarketCodes = process.env.VITE_MARKET_CODES;
        const previousChannelSwitching = process.env.VITE_CLIENT_CHANNEL_SWITCHING;
        process.env.VITE_MARKET_CODES = 'my-malaysia';
        process.env.VITE_CLIENT_CHANNEL_SWITCHING = 'false';
        const frontend = await createServer({
            root: path.resolve(__dirname, '../../storefront'),
            server: {
                host: '127.0.0.1',
                port: 0,
                strictPort: false,
                proxy: {
                    '/shop-api': `http://127.0.0.1:${apiPort}`,
                    '/assets': `http://127.0.0.1:${apiPort}`,
                    '/storefront-realtime': `http://127.0.0.1:${apiPort}`,
                },
            },
        });
        const output = path.resolve(
            __dirname,
            '../../storefront/artifacts/readiness/account-activity-browser',
        );
        await mkdir(output, { recursive: true });
        await frontend.listen();
        const desktopBrowser = await chromium.launch({ headless: true });
        const mobileBrowser = await webkit.launch({ headless: true });
        try {
            const address = frontend.httpServer?.address();
            if (!address || typeof address === 'string')
                throw new Error('Account activity fixture did not start');
            const baseUrl = `http://127.0.0.1:${address.port}`;
            const desktop = await desktopBrowser.newContext({ viewport: { width: 1440, height: 1000 } });
            const mobile = await mobileBrowser.newContext({ ...devices['iPhone 13'] });
            const desktopPage = await desktop.newPage();
            const mobilePage = await mobile.newPage();
            const login = async (
                page: typeof desktopPage,
                accountEmailAddress = emailAddress,
                accountPassword = password,
            ) => {
                await page.goto(`${baseUrl}/login`);
                const form = page.locator('form.auth-account-form');
                await browserExpect(form).toBeVisible({ timeout: 15_000 });
                await form.locator('input[name="emailAddress"]').fill(accountEmailAddress);
                await form.locator('input[name="password"]').fill(accountPassword);
                await form.locator('button[type="submit"]').click();
                try {
                    await browserExpect(form).toBeHidden({ timeout: 15_000 });
                } catch (error) {
                    const alert = await form
                        .getByRole('alert')
                        .textContent()
                        .catch(() => null);
                    throw new Error(`Browser sign-in did not finish: ${alert ?? page.url()}`, {
                        cause: error,
                    });
                }
                await page.waitForURL(/\/account(?:\?|$)/, { timeout: 15_000, waitUntil: 'load' });
                await browserExpect(page.locator('main.account-page, main.desktop-account-page')).toBeVisible(
                    {
                        timeout: 15_000,
                    },
                );
                const necessaryOnly = page.getByRole('button', { name: /仅必要功能|Necessary only/ });
                if (await necessaryOnly.isVisible()) await necessaryOnly.click();
            };
            const logout = async (page: typeof desktopPage) => {
                await page.goto(`${baseUrl}/account-security`);
                const button = page.locator('.security-logout-button');
                await browserExpect(button).toBeVisible({ timeout: 15_000 });
                await button.click();
                await page.waitForURL(/\/account(?:\?|$)/, { timeout: 15_000, waitUntil: 'load' });
                await browserExpect(page.locator('form.auth-account-form')).toBeVisible({ timeout: 15_000 });
                await browserExpect(page.getByText(productName)).toHaveCount(0);
            };
            try {
                await login(desktopPage);
                const productApiSamples: string[] = [];
                desktopPage.on('response', response => {
                    if (!response.url().includes('/shop-api')) return;
                    const operation = response
                        .request()
                        .postData()
                        ?.match(/query (Storefront\w*Product\w*)\b/u)?.[1];
                    if (!operation) return;
                    void response
                        .json()
                        .then(
                            (payload: {
                                data?: {
                                    product?: { id: string; name?: string | null } | null;
                                    products?: { items?: Array<{ id: string; name?: string | null }> };
                                    storefrontCatalog?: {
                                        items?: Array<{ id: string; name?: string | null }>;
                                    };
                                };
                            }) => {
                                const candidates = [
                                    payload.data?.product,
                                    ...(payload.data?.products?.items ?? []),
                                    ...(payload.data?.storefrontCatalog?.items ?? []),
                                ];
                                const matched = candidates.find(candidate => candidate?.id === productId);
                                productApiSamples.push(`${operation}:${String(matched?.name)}`);
                            },
                        )
                        .catch(() => {
                            // A failed transport is already surfaced by the product-page assertion.
                        });
                });
                await desktopPage.goto(`${baseUrl}/product?id=${productId}`);
                try {
                    await browserExpect(desktopPage.getByText(productName).first()).toBeVisible({
                        timeout: 15_000,
                    });
                } catch (error) {
                    const visibleText = (await desktopPage.locator('body').innerText()).slice(0, 1200);
                    throw new Error(
                        `Product page did not show the test product (Shop API samples: ${productApiSamples.join(', ')}): ${visibleText}`,
                        {
                            cause: error,
                        },
                    );
                }
                await browserExpect
                    .poll(() => productApiSamples.includes(`StorefrontProduct:${productName}`))
                    .toBe(true);
                const favoriteButton = desktopPage.locator('.detail-favorite-action');
                await browserExpect(favoriteButton).toHaveAttribute('aria-pressed', 'false');
                await favoriteButton.click();
                await browserExpect(favoriteButton).toHaveAttribute('aria-pressed', 'true');
                await login(mobilePage);
                await mobilePage.goto(`${baseUrl}/favorites`);
                await browserExpect(mobilePage.getByText(productName).first()).toBeVisible({
                    timeout: 15_000,
                });
                await mobilePage.goto(`${baseUrl}/history`);
                await browserExpect(mobilePage.getByText(productName).first()).toBeVisible({
                    timeout: 15_000,
                });
                await mobilePage.screenshot({ path: path.join(output, 'mobile-history.png') });
                await mobilePage.goto(`${baseUrl}/favorites`);
                await mobilePage.getByRole('button', { name: /清空收藏|Clear favorites/ }).click();
                await browserExpect(mobilePage.getByText(/暂无收藏商品|No favorites yet/)).toBeVisible();
                await desktopPage.goto(`${baseUrl}/favorites`);
                await browserExpect(desktopPage.getByText(/暂无收藏商品|No favorites yet/)).toBeVisible({
                    timeout: 15_000,
                });
                await desktopPage.goto(`${baseUrl}/history`);
                await browserExpect(desktopPage.getByText(productName).first()).toBeVisible({
                    timeout: 15_000,
                });
                await desktopPage.screenshot({ path: path.join(output, 'desktop-history.png') });
                await logout(desktopPage);
                await login(desktopPage, secondEmailAddress, secondPassword);
                await desktopPage.goto(`${baseUrl}/history`);
                await browserExpect(desktopPage.getByText(/暂无浏览足迹|No browsing history/)).toBeVisible({
                    timeout: 15_000,
                });
                await desktopPage.goto(`${baseUrl}/favorites`);
                await browserExpect(desktopPage.getByText(/暂无收藏商品|No favorites yet/)).toBeVisible({
                    timeout: 15_000,
                });
                await logout(desktopPage);
                await login(desktopPage);
                await desktopPage.goto(`${baseUrl}/history`);
                await browserExpect(desktopPage.getByText(productName).first()).toBeVisible({
                    timeout: 15_000,
                });
            } finally {
                await desktop.close();
                await mobile.close();
            }
        } finally {
            await desktopBrowser.close();
            await mobileBrowser.close();
            await frontend.close();
            if (previousMarketCodes === undefined) delete process.env.VITE_MARKET_CODES;
            else process.env.VITE_MARKET_CODES = previousMarketCodes;
            if (previousChannelSwitching === undefined) delete process.env.VITE_CLIENT_CHANNEL_SWITCHING;
            else process.env.VITE_CLIENT_CHANNEL_SWITCHING = previousChannelSwitching;
        }
    }, 180_000);
});
