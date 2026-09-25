import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    mergeConfig,
    PaymentMethodHandler,
    RequestContextService,
    Role,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentBlock, StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreProfile } from '../src/entities/store-profile.entity';
import { referralPosterCopy } from '../src/referral/referral-poster-presets';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const externalPaymentHandler = new PaymentMethodHandler({
    code: 'referral-e2e-payment',
    description: [{ languageCode: LanguageCode.en, value: 'Referral E2E payment' }],
    args: {},
    createPayment: (_ctx, order, amount) => ({
        amount,
        state: 'Settled',
        transactionId: `referral-e2e-${order.code}`,
        metadata: {},
    }),
    settlePayment: () => ({ success: true }),
    createRefund: (_ctx, _input, amount) => ({
        state: 'Settled',
        transactionId: `referral-e2e-refund-${amount}`,
        metadata: {},
    }),
});

const passthroughTranslationProvider: ContentTranslationProvider = {
    name: 'referral-e2e-passthrough',
    isConfigured: () => true,
    translate: request =>
        Promise.resolve({
            provider: 'referral-e2e-passthrough',
            translations: request.segments.map(segment => ({ key: segment.key, text: segment.text })),
        }),
};

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    paymentOptions: { paymentMethodHandlers: [externalPaymentHandler] },
    plugins: [
        StorefrontCartPlugin,
        StorefrontContentPlugin,
        ContentTranslationPlugin.init({
            provider: passthroughTranslationProvider,
        }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'referral-e2e-signing-secret-at-least-32-characters',
        }),
    ],
});

const { server, adminClient, shopClient } = createTestEnvironment(config);

const PROGRAM = gql`
    query ReferralProgramE2E {
        referralProgram {
            updatedAt
            enabled
            rewardRate
            allowBalanceSpend
            posterTemplates
            attributionWindowDays
        }
    }
`;

const UPDATE_PROGRAM = gql`
    mutation UpdateReferralProgramE2E($input: UpdateReferralProgramInput!) {
        updateReferralProgram(input: $input) {
            updatedAt
            enabled
            rewardRate
            releaseDelayDays
            allowBalanceSpend
            attributionWindowDays
        }
    }
`;

const REGISTER = gql`
    mutation RegisterReferralCustomerE2E(
        $input: RegisterCustomerInput!
        $inviteCode: String
        $source: String
    ) {
        registerCustomerWithReferral(
            input: $input
            consent: { termsAccepted: true, privacyAcknowledged: true, locale: "zh" }
            inviteCode: $inviteCode
            source: $source
        ) {
            __typename
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const OVERVIEW = gql`
    query ReferralOverviewE2E {
        myReferralOverview {
            inviteCode
            invitedCount
            purchasedInviteeCount
            wallets {
                id
                currencyCode
                availableBalance
                pendingBalance
                reservedBalance
            }
            invitees {
                id
                firstPaidOrderAt
            }
            ledger {
                eventType
                availableDelta
                pendingDelta
                reservedDelta
            }
        }
    }
`;

const VALIDATE_INVITE = gql`
    query ReferralValidateInviteE2E($code: String!) {
        validateReferralInviteCode(code: $code)
    }
`;

const FIRST_VARIANT = gql`
    query ReferralFirstVariantE2E {
        products(options: { take: 1 }) {
            items {
                variants {
                    id
                }
            }
        }
    }
`;

const CREATE_PRODUCT = gql`
    mutation ReferralCreateProductE2E($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`;

const CREATE_PRODUCT_VARIANTS = gql`
    mutation ReferralCreateProductVariantsE2E($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
            sku
        }
    }
`;

const ORDER_FIELDS = gql`
    fragment ReferralOrderFieldsE2E on Order {
        id
        code
        state
        totalWithTax
        shippingWithTax
        currencyCode
        lines {
            id
            quantity
        }
        payments {
            id
            amount
            method
            state
        }
    }
`;

const READ_CART = gql`
    ${ORDER_FIELDS}
    query ReferralReadCartE2E {
        storefrontCart {
            id
            revision
            checkoutOrder {
                ...ReferralOrderFieldsE2E
            }
        }
    }
`;

const CART_COMMAND = gql`
    ${ORDER_FIELDS}
    mutation ReferralCartCommandE2E($input: StorefrontCartCommandInput!) {
        applyStorefrontCartCommand(input: $input) {
            status
            errorCode
            message
            cart {
                id
                revision
                checkoutOrder {
                    ...ReferralOrderFieldsE2E
                }
            }
        }
    }
`;

const RISK_CASES = gql`
    query ReferralRiskCasesE2E {
        fraudRiskCases {
            items {
                id
                orderId
                status
                caseCode
            }
        }
    }
`;

const RELEASE_RISK_CASE = gql`
    mutation ReferralReleaseRiskCaseE2E($input: ReviewFraudRiskCaseInput!) {
        reviewFraudRiskCase(input: $input) {
            id
            status
            caseCode
        }
    }
`;

const PAY = gql`
    ${ORDER_FIELDS}
    mutation ReferralPayOrderE2E($method: String!) {
        addPaymentToOrder(input: { method: $method, metadata: {} }) {
            __typename
            ...ReferralOrderFieldsE2E
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const USE_BALANCE = gql`
    ${ORDER_FIELDS}
    mutation ReferralUseBalanceE2E($amount: Money!) {
        useMyReferralBalance(amount: $amount) {
            amount
            wallet {
                currencyCode
                availableBalance
                pendingBalance
                reservedBalance
            }
            order {
                ...ReferralOrderFieldsE2E
            }
        }
    }
`;

const REFUND = gql`
    mutation ReferralRefundE2E($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            __typename
            ... on Refund {
                id
                state
                total
                paymentId
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const ADMIN_REPORTS = gql`
    query ReferralReportsE2E {
        referralRelationships(take: 10) {
            totalItems
            items {
                inviteCodeSnapshot
                firstPaidOrderAt
                source
            }
        }
        referralRewards(take: 10) {
            totalItems
            items {
                id
                eligibleAmount
                rewardAmount
                releasedAmount
                clawedBackAmount
                settledRefundTotal
                settledEligibleRefundTotal
                status
            }
        }
        referralLedger(take: 100) {
            items {
                eventType
                availableDelta
                pendingDelta
                reservedDelta
            }
        }
        referralBalanceAudit {
            auditedWallets
            items {
                walletId
                availableDifference
                pendingDifference
                reservedDifference
            }
        }
        referralTodayMetrics {
            visitorCount
            newCustomerCount
            consumerCount
            firstTimeConsumerCount
            returningConsumerCount
            orderCount
            todayInvitedCount
            todayInvitedPurchaserCount
            salesByCurrency {
                currencyCode
                sales
            }
        }
    }
`;

const RECORD_VISIT = gql`
    mutation ReferralRecordVisitE2E($visitorId: String!, $eventId: String!) {
        recordStorefrontPageView(input: { visitorId: $visitorId, eventId: $eventId, pageView: true }) {
            recorded
        }
    }
`;

const recordTrafficVisit = async (visitorId: string) => {
    const result = await shopClient.query(RECORD_VISIT, { visitorId, eventId: randomUUID() });
    expect(result.recordStorefrontPageView.recorded).toBe(true);
};

const FIND_CUSTOMER = gql`
    query ReferralFindCustomerE2E($email: String!) {
        customers(options: { take: 1, filter: { emailAddress: { eq: $email } } }) {
            items {
                id
                emailAddress
            }
        }
    }
`;

const ADJUST_BALANCE = gql`
    mutation ReferralAdjustBalanceE2E($customerId: ID!, $currencyCode: CurrencyCode!, $amount: Money!) {
        adjustReferralBalance(
            customerId: $customerId
            currencyCode: $currencyCode
            amount: $amount
            reason: "E2E audited adjustment"
        ) {
            availableBalance
            pendingBalance
            reservedBalance
        }
    }
`;

const CREATE_WITHDRAWAL = gql`
    mutation ReferralCreateWithdrawalE2E($input: CreateReferralWithdrawalInput!) {
        createReferralWithdrawal(input: $input) {
            id
            status
            amount
            currencyCode
        }
    }
`;

const PROCESS_WITHDRAWAL = gql`
    mutation ReferralProcessWithdrawalE2E($id: ID!, $status: String!) {
        processReferralWithdrawal(input: { id: $id, status: $status }) {
            id
            status
            amount
        }
    }
`;

describe('referral rebate closed loop', () => {
    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                collections: [],
                paymentMethods: [
                    {
                        name: 'Referral E2E payment',
                        handler: { code: externalPaymentHandler.code, arguments: [] },
                    },
                ],
            },
            customerCount: 0,
        });
        shopClient.setRequestHeader('user-agent', 'Mozilla/5.0 Referral E2E Browser');
        shopClient.setRequestHeader('cookie', 'storefront_analytics_consent=granted');
        await adminClient.asSuperAdmin();
        const superadminCredentials = config.authOptions.superadminCredentials;
        if (!superadminCredentials) throw new Error('Superadmin credentials are required for this test');
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', superadminCredentials.password);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const legalBlocks = server.app
            .get(TransactionalConnection)
            .getRepository(ctx, StorefrontContentBlock);
        for (const code of ['terms', 'privacy']) {
            await legalBlocks.save(
                new StorefrontContentBlock({
                    channelId: ctx.channelId,
                    code,
                    type: 'LEGAL',
                    enabled: true,
                    translations: [],
                }),
            );
        }
        const productResult = await adminClient.query(CREATE_PRODUCT, {
            input: {
                enabled: true,
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: '邀请返利测试商品',
                        slug: 'referral-rebate-e2e-product',
                        description: '用于验证邀请、返利、消费和退款扣回闭环',
                    },
                ],
            },
        });
        const variantResult = await adminClient.query(CREATE_PRODUCT_VARIANTS, {
            input: [
                {
                    productId: productResult.createProduct.id,
                    enabled: true,
                    sku: 'REFERRAL-E2E-001',
                    price: 10_000,
                    stockOnHand: 100,
                    trackInventory: 'TRUE',
                    optionIds: [],
                    translations: [{ languageCode: LanguageCode.zh_Hans, name: '邀请返利测试规格' }],
                },
            ],
        });
        expect(variantResult.createProductVariants).toHaveLength(1);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it.each([
        { code: 'referral-read', permissions: ['ReadReferral'], read: true, write: false },
        { code: 'referral-edit', permissions: ['ReadReferral', 'UpdateReferral'], read: true, write: true },
        { code: 'referral-other', permissions: ['ReadCustomer'], read: false, write: false },
        { code: 'referral-none', permissions: [], read: false, write: false },
    ])('enforces the real Admin API role $code', async role => {
        const credentials = await createReferralAdminFixture(role.code, role.permissions);
        const original = (await adminClient.query(PROGRAM)).referralProgram;
        const settings = (
            await adminClient.query(gql`
                query {
                    referralProgram {
                        enabled
                        rewardRate
                        releaseDelayDays
                        minimumOrderAmount
                        maxRewardPerOrder
                        allowBalanceSpend
                        attributionWindowDays
                        defaultPosterTemplate
                        posterTemplates
                    }
                }
            `)
        ).referralProgram;
        try {
            await adminClient.asUserWithCredentials(credentials.emailAddress, credentials.password);
            const request = adminClient.query(PROGRAM);
            if (role.read) {
                expect((await request).referralProgram).toEqual(original);
            } else {
                await expect(request).rejects.toThrow(/forbidden|authorized/i);
            }
            const mutation = adminClient.query(UPDATE_PROGRAM, {
                input: { ...settings, expectedUpdatedAt: original.updatedAt },
            });
            if (role.write) {
                expect((await mutation).updateReferralProgram.enabled).toBe(original.enabled);
            } else {
                await expect(mutation).rejects.toThrow(/forbidden|authorized/i);
            }
        } finally {
            await adminClient.asSuperAdmin();
        }
    });

    it('binds an invitation, rewards paid product spend, claws back refunds, spends balance and handles an authorized withdrawal', async () => {
        const disabled = await shopClient.query(PROGRAM);
        expect(disabled.referralProgram.enabled).toBe(false);
        expect(disabled.referralProgram.attributionWindowDays).toBe(0);
        const adminProgram = await adminClient.query(PROGRAM);

        await recordTrafficVisit('referral-e2e-visitor-0001');
        await recordTrafficVisit('referral-e2e-visitor-0002');

        await recordTrafficVisit('referral-e2e-visitor-0001');
        await recordTrafficVisit('referral-e2e-visitor-0002');

        const updated = await adminClient.query(UPDATE_PROGRAM, {
            input: {
                expectedUpdatedAt: adminProgram.referralProgram.updatedAt,
                enabled: true,
                rewardRate: 10,
                releaseDelayDays: 0,
                minimumOrderAmount: 0,
                maxRewardPerOrder: null,
                allowBalanceSpend: true,
                attributionWindowDays: 0,
                defaultPosterTemplate: 'BRAND_MINIMAL',
            },
        });
        expect(updated.updateReferralProgram).toMatchObject({
            enabled: true,
            rewardRate: 10,
            attributionWindowDays: 0,
        });
        expect((await adminClient.query(PROGRAM)).referralProgram.attributionWindowDays).toBe(0);
        expect((await shopClient.query(PROGRAM)).referralProgram.attributionWindowDays).toBe(0);

        await register('inviter@example.com');
        await shopClient.asUserWithCredentials('inviter@example.com', 'ReferralPass123!');
        const inviterOverview = await shopClient.query(OVERVIEW);
        const inviteCode = inviterOverview.myReferralOverview.inviteCode as string;
        expect(inviteCode).toMatch(/^[A-Z2-9]{8}$/);

        await register('invitee@example.com', inviteCode, 'POSTER');
        await shopClient.asUserWithCredentials('invitee@example.com', 'ReferralPass123!');
        await recordTrafficVisit('referral-e2e-visitor-0001');

        const inviteeOrder = await createAndPayOrder();
        const eligibleAmount = inviteeOrder.totalWithTax - inviteeOrder.shippingWithTax;
        const expectedReward = Math.round(eligibleAmount * 0.1);

        await shopClient.asUserWithCredentials('inviter@example.com', 'ReferralPass123!');
        const rewardedOverview = await shopClient.query(OVERVIEW);
        expect(rewardedOverview.myReferralOverview).toMatchObject({
            invitedCount: 1,
            purchasedInviteeCount: 1,
        });
        expect(rewardedOverview.myReferralOverview.wallets).toContainEqual(
            expect.objectContaining({
                currencyCode: inviteeOrder.currencyCode,
                availableBalance: expectedReward,
                pendingBalance: 0,
            }),
        );

        const inviterOrder = await createOrderAtPayment();
        const balanceResult = await shopClient.query(USE_BALANCE, { amount: expectedReward });
        expect(balanceResult.useMyReferralBalance).toMatchObject({
            amount: expectedReward,
            wallet: { availableBalance: 0, pendingBalance: 0, reservedBalance: 0 },
        });
        const completedInviterOrder = await shopClient.query(PAY, { method: externalPaymentHandler.code });
        assertSuccess(completedInviterOrder.addPaymentToOrder);
        expect(completedInviterOrder.addPaymentToOrder.state).toBe('PaymentSettled');

        const inviteePayment = inviteeOrder.payments.find(
            (payment: any) => payment.method === externalPaymentHandler.code,
        );
        const productRefund = await adminClient.query(REFUND, {
            input: {
                lines: inviteeOrder.lines.map((line: any) => ({
                    orderLineId: line.id,
                    quantity: line.quantity,
                })),
                shipping: 0,
                adjustment: 0,
                paymentId: inviteePayment.id,
                reason: 'Product fully refunded in E2E test',
            },
        });
        assertSuccess(productRefund.refundOrder);
        expect(productRefund.refundOrder.state).toBe('Settled');

        const afterClawback = await shopClient.query(OVERVIEW);
        expect(walletFor(afterClawback, inviteeOrder.currencyCode).availableBalance).toBe(-expectedReward);

        const referralPayment = completedInviterOrder.addPaymentToOrder.payments.find(
            (payment: any) => payment.method === 'referral-balance',
        );
        expect(referralPayment.amount).toBe(expectedReward);
        const balanceRefund = await adminClient.query(REFUND, {
            input: {
                lines: [],
                shipping: 0,
                adjustment: 0,
                amount: expectedReward,
                paymentId: referralPayment.id,
                reason: 'Referral balance refund in E2E test',
            },
        });
        assertSuccess(balanceRefund.refundOrder);
        expect(balanceRefund.refundOrder.state).toBe('Settled');
        const afterBalanceRefund = await shopClient.query(OVERVIEW);
        expect(walletFor(afterBalanceRefund, inviteeOrder.currencyCode).availableBalance).toBe(0);

        const customerResult = await adminClient.query(FIND_CUSTOMER, { email: 'inviter@example.com' });
        const inviterCustomerId = customerResult.customers.items[0].id;
        const adjustment = await adminClient.query(ADJUST_BALANCE, {
            customerId: inviterCustomerId,
            currencyCode: inviteeOrder.currencyCode,
            amount: 500,
        });
        expect(adjustment.adjustReferralBalance.availableBalance).toBe(500);

        await expect(
            shopClient.query(CREATE_WITHDRAWAL, {
                input: {
                    customerId: inviterCustomerId,
                    currencyCode: inviteeOrder.currencyCode,
                    amount: 200,
                    payoutMethod: 'BANK',
                    payoutAccountMasked: '****1234',
                },
            }),
        ).rejects.toThrow();

        const createdWithdrawal = await adminClient.query(CREATE_WITHDRAWAL, {
            input: {
                customerId: inviterCustomerId,
                currencyCode: inviteeOrder.currencyCode,
                amount: 200,
                payoutMethod: 'BANK',
                payoutAccountMasked: '****1234',
                note: 'E2E withdrawal',
            },
        });
        expect(createdWithdrawal.createReferralWithdrawal).toMatchObject({ status: 'PENDING', amount: 200 });
        const rejectedWithdrawal = await adminClient.query(PROCESS_WITHDRAWAL, {
            id: createdWithdrawal.createReferralWithdrawal.id,
            status: 'REJECTED',
        });
        expect(rejectedWithdrawal.processReferralWithdrawal.status).toBe('REJECTED');

        const reports = await adminClient.query(ADMIN_REPORTS);
        expect(reports.referralRelationships).toMatchObject({ totalItems: 1 });
        expect(reports.referralRelationships.items[0]).toMatchObject({
            source: 'POSTER',
            firstPaidOrderAt: expect.any(String),
        });
        expect(reports.referralRewards.items[0]).toMatchObject({
            eligibleAmount,
            rewardAmount: expectedReward,
            clawedBackAmount: expectedReward,
            settledEligibleRefundTotal: eligibleAmount,
            status: 'REVERSED',
        });
        expect(reports.referralLedger.items.map((item: any) => item.eventType)).toEqual(
            expect.arrayContaining([
                'REWARD_AVAILABLE',
                'SPEND_RESERVED',
                'SPEND_CAPTURED',
                'REFUND_CLAWBACK',
                'SPEND_REFUNDED',
                'ADMIN_ADJUSTMENT',
                'WITHDRAWAL_RESERVED',
                'WITHDRAWAL_REJECTED',
            ]),
        );
        expect(reports.referralBalanceAudit.items).toEqual([]);
        expect(reports.referralTodayMetrics).toMatchObject({
            visitorCount: 2,
            newCustomerCount: 2,
            consumerCount: 2,
            firstTimeConsumerCount: 2,
            returningConsumerCount: 0,
            orderCount: 2,
            todayInvitedCount: 1,
            todayInvitedPurchaserCount: 1,
        });
        expect(reports.referralTodayMetrics.salesByCurrency).toContainEqual({
            currencyCode: inviteeOrder.currencyCode,
            sales:
                inviteeOrder.totalWithTax +
                completedInviterOrder.addPaymentToOrder.totalWithTax -
                productRefund.refundOrder.total -
                balanceRefund.refundOrder.total,
        });

        const finalOverview = await shopClient.query(OVERVIEW);
        expect(walletFor(finalOverview, inviteeOrder.currencyCode)).toMatchObject({
            availableBalance: 500,
            pendingBalance: 0,
            reservedBalance: 0,
        });
        expect(inviterOrder.currencyCode).toBe(inviteeOrder.currencyCode);
    }, 30_000);

    it.skipIf(!process.env.DB || process.env.DB === 'sqljs')(
        'rejects one of two concurrent edits that start from the same referral-program version',
        async () => {
            const current = await adminClient.query(PROGRAM);

            const results = await Promise.allSettled(
                [11, 12].map(rewardRate =>
                    adminClient.query(UPDATE_PROGRAM, {
                        input: {
                            expectedUpdatedAt: current.referralProgram.updatedAt,
                            enabled: true,
                            rewardRate,
                            releaseDelayDays: 0,
                            minimumOrderAmount: 0,
                            maxRewardPerOrder: null,
                            allowBalanceSpend: true,
                            attributionWindowDays: 30,
                            defaultPosterTemplate: 'BRAND_MINIMAL',
                        },
                    }),
                ),
            );
            const fulfilled = results.filter(
                (result): result is PromiseFulfilledResult<unknown> => result.status === 'fulfilled',
            );
            const rejected = results.filter(
                (result): result is PromiseRejectedResult => result.status === 'rejected',
            );

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(String(rejected[0].reason)).toContain('CONCURRENT_MODIFICATION');
            const persisted = (await adminClient.query(PROGRAM)).referralProgram;
            expect(new Date(persisted.updatedAt).getTime()).toBeGreaterThan(
                new Date(current.referralProgram.updatedAt).getTime(),
            );
            expect(fulfilled[0].value).toMatchObject({
                updateReferralProgram: { updatedAt: persisted.updatedAt, rewardRate: persisted.rewardRate },
            });
        },
    );

    it("keeps one customer's referral overview separate across two stores", async () => {
        shopClient.setChannelToken(null);
        await shopClient.asUserWithCredentials('inviter@example.com', 'ReferralPass123!');
        const primaryOverview = (await shopClient.query(OVERVIEW)).myReferralOverview;
        expect(primaryOverview.invitedCount).toBeGreaterThan(0);
        expect(primaryOverview.ledger.length).toBeGreaterThan(0);

        const channelState = await adminClient.query(gql`
            query ReferralIsolationChannel {
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
        `);
        const primary = channelState.activeChannel;
        const token = 'referral-overview-isolation-fixture';
        const created = await adminClient.query(
            gql`
                mutation ReferralIsolationCreateChannel($input: CreateChannelInput!) {
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
                    code: token,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    defaultCurrencyCode: CurrencyCode.CNY,
                    pricesIncludeTax: false,
                    defaultTaxZoneId: primary.defaultTaxZone.id,
                    defaultShippingZoneId: primary.defaultShippingZone.id,
                },
            },
        );
        expect(created.createChannel, JSON.stringify(created.createChannel)).toHaveProperty('id');
        const context = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const foreignContext = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: token,
        });
        const connection = server.app.get(TransactionalConnection);
        const customer = await connection.getRepository(context, Customer).findOneOrFail({
            where: { emailAddress: 'inviter@example.com' },
            relations: ['user', 'user.roles', 'user.roles.channels'],
        });
        await server.app
            .get(ChannelService)
            .assignToChannels(context, Customer, customer.id, [foreignContext.channelId]);
        await connection.getRepository(foreignContext, StoreProfile).save(
            new StoreProfile({
                channelId: foreignContext.channelId,
                status: 'ACTIVE',
                descriptionZh: '',
                descriptionEn: '',
            }),
        );
        for (const role of customer.user?.roles ?? []) {
            if (role.channels.some(channel => String(channel.id) === String(foreignContext.channelId)))
                continue;
            await connection.rawConnection
                .getRepository(Role)
                .createQueryBuilder()
                .relation(Role, 'channels')
                .of(role.id)
                .add(foreignContext.channelId);
        }

        adminClient.setChannelToken(token);
        try {
            const foreignProgram = (await adminClient.query(PROGRAM)).referralProgram;
            expect(foreignProgram.enabled).toBe(false);
            await adminClient.query(UPDATE_PROGRAM, {
                input: {
                    expectedUpdatedAt: foreignProgram.updatedAt,
                    enabled: true,
                    rewardRate: 10,
                    releaseDelayDays: 0,
                    minimumOrderAmount: 0,
                    maxRewardPerOrder: null,
                    allowBalanceSpend: true,
                    attributionWindowDays: 30,
                    defaultPosterTemplate: 'BRAND_MINIMAL',
                },
            });
        } finally {
            adminClient.setChannelToken(primary.token);
        }

        try {
            shopClient.setChannelToken(token);
            await shopClient.asUserWithCredentials('inviter@example.com', 'ReferralPass123!');
            const foreignOverview = (await shopClient.query(OVERVIEW)).myReferralOverview;
            expect(foreignOverview).toMatchObject({
                invitedCount: 0,
                purchasedInviteeCount: 0,
                wallets: [],
                invitees: [],
                ledger: [],
            });
            expect(
                (await shopClient.query(VALIDATE_INVITE, { code: primaryOverview.inviteCode }))
                    .validateReferralInviteCode,
            ).toBe(false);
        } finally {
            shopClient.setChannelToken(primary.token);
            await shopClient.asUserWithCredentials('inviter@example.com', 'ReferralPass123!');
        }
        const restored = (await shopClient.query(OVERVIEW)).myReferralOverview;
        expect(restored.inviteCode).toBe(primaryOverview.inviteCode);
        expect(restored.invitedCount).toBe(primaryOverview.invitedCount);
        expect(restored.ledger).toEqual(primaryOverview.ledger);
        expect(
            (await shopClient.query(VALIDATE_INVITE, { code: primaryOverview.inviteCode }))
                .validateReferralInviteCode,
        ).toBe(true);
    }, 30_000);

    it('preserves poster copy, keeps defaults enabled and persists an explicit all-hidden configuration', async () => {
        const posterProgram = gql`
            query PosterProgramRegression {
                referralProgram {
                    updatedAt
                    enabled
                    rewardRate
                    defaultPosterTemplate
                    posterTemplates
                    systemPosterTemplateConfigs {
                        id
                        name
                        enabled
                        headlineZh
                        qrTitleZh
                    }
                    posterTemplateConfigs {
                        id
                        name
                        enabled
                        featureOneTitleZh
                        qrTitleZh
                        footerTextEn
                    }
                }
            }
        `;
        const read = async () => (await adminClient.query(posterProgram)).referralProgram;
        const original = await read();
        expect(original.systemPosterTemplateConfigs.map((t: any) => t.id)).toEqual([
            'BRAND_MINIMAL',
            'BENEFIT_RED_GOLD',
            'PRODUCT_STORY',
            'PREMIUM_DARK',
            'CLOUD_BRIDGE_ORBIT',
        ]);
        expect(JSON.stringify(original.systemPosterTemplateConfigs)).not.toMatch(
            /CloudBridge|云桥|模钥|热门 AI/,
        );
        const input = {
            ...referralPosterCopy,
            name: 'Poster regression fixture',
            enabled: true,
            position: 0,
            layoutVariant: 'STANDARD_CENTER',
            posterBackgroundAssetId: null,
            shareBackgroundAssetId: null,
            foregroundColor: '#152c49',
            accentColor: '#2565ae',
            overlayOpacity: 0,
            featureOneTitleZh: '保留本店独特卖点',
            qrTitleZh: '保留本店扫码说明',
            footerTextEn: 'Retain this exact footer',
        };
        const created = await adminClient.query(
            gql`
                mutation CreatePosterRegression($input: CreateReferralPosterTemplateInput!) {
                    createReferralPosterTemplate(input: $input) {
                        id
                    }
                }
            `,
            { input },
        );
        const id = created.createReferralPosterTemplate.id;
        await expect(
            adminClient.query(
                gql`
                    mutation RejectStalePosterCreate($input: CreateReferralPosterTemplateInput!) {
                        createReferralPosterTemplate(input: $input) {
                            id
                        }
                    }
                `,
                { input: { ...input, expectedUpdatedAt: original.updatedAt } },
            ),
        ).rejects.toThrow(/CONCURRENT_MODIFICATION/);
        expect((await read()).defaultPosterTemplate).toBe(original.defaultPosterTemplate);
        const toggle = async (enabled: boolean, expectedUpdatedAt?: string) =>
            adminClient.query(
                gql`
                    mutation TogglePosterRegression(
                        $id: ID!
                        $enabled: Boolean!
                        $expectedUpdatedAt: DateTime!
                    ) {
                        setReferralPosterTemplateEnabled(
                            id: $id
                            enabled: $enabled
                            expectedUpdatedAt: $expectedUpdatedAt
                        ) {
                            defaultPosterTemplate
                        }
                    }
                `,
                { id, enabled, expectedUpdatedAt: expectedUpdatedAt ?? (await read()).updatedAt },
            );
        const staleVersion = (await read()).updatedAt;
        await toggle(false);
        let state = await read();
        expect(state.posterTemplateConfigs.find((t: any) => t.id === id)).toMatchObject({
            enabled: false,
            featureOneTitleZh: input.featureOneTitleZh,
            qrTitleZh: input.qrTitleZh,
            footerTextEn: input.footerTextEn,
        });
        await expect(toggle(true, staleVersion)).rejects.toThrow('CONCURRENT_MODIFICATION');
        const { enabled: _oldEnabled, ...staleContent } = input;
        await expect(
            adminClient.query(
                gql`
                    mutation StalePosterContent($input: UpdateReferralPosterTemplateInput!) {
                        updateReferralPosterTemplate(input: $input) {
                            id
                        }
                    }
                `,
                { input: { ...staleContent, id, name: 'Stale editor', expectedUpdatedAt: staleVersion } },
            ),
        ).rejects.toThrow('CONCURRENT_MODIFICATION');
        expect((await read()).posterTemplateConfigs.find((template: any) => template.id === id).enabled).toBe(
            false,
        );
        await toggle(true);
        // Legacy clients omit advanced fields. Their basic edit must retain current detailed copy.
        const legacyInput = Object.fromEntries(
            Object.entries(input).filter(
                ([key]) =>
                    key !== 'enabled' &&
                    !key.startsWith('feature') &&
                    !key.startsWith('qr') &&
                    !key.startsWith('scene') &&
                    !key.startsWith('cta') &&
                    !key.startsWith('footer'),
            ),
        );
        await adminClient.query(
            gql`
                mutation LegacyPosterRegression($input: UpdateReferralPosterTemplateInput!) {
                    updateReferralPosterTemplate(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    ...legacyInput,
                    id,
                    name: 'Renamed only',
                    expectedUpdatedAt: (await read()).updatedAt,
                },
            },
        );
        state = await read();
        expect(state.posterTemplateConfigs.find((t: any) => t.id === id)).toMatchObject({
            featureOneTitleZh: input.featureOneTitleZh,
            qrTitleZh: input.qrTitleZh,
            footerTextEn: input.footerTextEn,
        });
        await adminClient.query(UPDATE_PROGRAM, {
            input: {
                expectedUpdatedAt: state.updatedAt,
                enabled: true,
                rewardRate: 10,
                releaseDelayDays: 0,
                minimumOrderAmount: 0,
                maxRewardPerOrder: null,
                allowBalanceSpend: true,
                attributionWindowDays: 30,
                posterTemplates: [],
                defaultPosterTemplate: id,
            },
        });
        await toggle(false);
        const hidden = (await shopClient.query(posterProgram)).referralProgram;
        expect(hidden.posterTemplates).toEqual([]);
        expect(hidden.posterTemplateConfigs).toEqual([]);
        expect(hidden.defaultPosterTemplate).toBe('');
        expect(hidden.systemPosterTemplateConfigs.every((t: any) => !t.enabled)).toBe(true);
        expect((await read()).posterTemplates).toEqual([]);
        // Re-enabling a system template after all were hidden must select a valid default.
        const systemInput = {
            enabled: true,
            rewardRate: 10,
            releaseDelayDays: 0,
            minimumOrderAmount: 0,
            maxRewardPerOrder: null,
            allowBalanceSpend: true,
            attributionWindowDays: 30,
        };
        await adminClient.query(UPDATE_PROGRAM, {
            input: {
                ...systemInput,
                expectedUpdatedAt: (await read()).updatedAt,
                posterTemplates: ['PRODUCT_STORY'],
                defaultPosterTemplate: '',
            },
        });
        expect((await read()).defaultPosterTemplate).toBe('PRODUCT_STORY');
        await adminClient.query(UPDATE_PROGRAM, {
            input: {
                ...systemInput,
                expectedUpdatedAt: (await read()).updatedAt,
                posterTemplates: [],
                defaultPosterTemplate: 'PRODUCT_STORY',
            },
        });
        expect((await read()).defaultPosterTemplate).toBe('');
        await toggle(true);
        expect((await read()).defaultPosterTemplate).toBe(id);

        const channelState = await adminClient.query(gql`
            query PosterChannelFixture {
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
        `);
        const primary = channelState.activeChannel;
        const other = await adminClient.query(
            gql`
                mutation PosterOtherChannel($input: CreateChannelInput!) {
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
                    code: 'poster-isolation-fixture',
                    token: 'poster-isolation-fixture',
                    defaultLanguageCode: LanguageCode.en,
                    defaultCurrencyCode: 'CNY',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: primary.defaultTaxZone.id,
                    defaultShippingZoneId: primary.defaultShippingZone.id,
                },
            },
        );
        expect(other.createChannel.id).toBeTruthy();
        try {
            adminClient.setChannelToken(other.createChannel.token);
            const isolated = await read();
            expect(isolated.posterTemplateConfigs).toEqual([]);
            expect(isolated.posterTemplates).toHaveLength(5);
            await expect(toggle(false)).rejects.toThrow('找不到该邀请海报模板');
        } finally {
            adminClient.setChannelToken(primary.token);
        }
        expect((await read()).defaultPosterTemplate).toBe(id);
    }, 30_000);
});

async function createReferralAdminFixture(code: string, permissions: string[]) {
    await adminClient.asSuperAdmin();
    const { createManagedRole } = await adminClient.query(
        gql`
            mutation ($input: CreateManagedRoleInput!) {
                createManagedRole(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                code,
                description: 'Isolated referral permission fixture',
                scope: 'PLATFORM',
                permissions: permissions.length ? permissions : ['ReadCatalog'],
            },
        },
    );
    const emailAddress = `${code}@example.test`;
    const initialPassword = 'ReferralInitial123!';
    const password = 'ReferralFixture456!';
    await adminClient.query(
        gql`
            mutation ($input: CreateManagedAdministratorInput!) {
                createManagedAdministrator(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                firstName: 'Referral',
                lastName: 'Fixture',
                emailAddress,
                password: initialPassword,
                roleIds: [createManagedRole.id],
                scope: 'PLATFORM',
                authority: 'STAFF',
            },
        },
    );
    await adminClient.asUserWithCredentials(emailAddress, initialPassword);
    await adminClient.query(gql`
        mutation {
            completeInitialPasswordChange(password: "ReferralFixture456!") {
                mustChangePassword
            }
        }
    `);
    await adminClient.asSuperAdmin();
    return { emailAddress, password };
}

async function register(emailAddress: string, inviteCode?: string, source?: string): Promise<void> {
    const result = await shopClient.query(REGISTER, {
        input: {
            emailAddress,
            firstName: emailAddress.startsWith('inviter') ? 'Inviter' : 'Invitee',
            lastName: 'Referral',
            password: 'ReferralPass123!',
        },
        inviteCode: inviteCode ?? null,
        source: source ?? null,
    });
    assertSuccess(result.registerCustomerWithReferral);
}

async function createOrderAtPayment(): Promise<any> {
    const variants = await adminClient.query(FIRST_VARIANT);
    const productVariantId = variants.products.items[0].variants[0].id;
    const command = async (change: Record<string, unknown>) => {
        const cart = (await shopClient.query(READ_CART)).storefrontCart;
        return (
            await shopClient.query(CART_COMMAND, {
                input: {
                    cartId: cart.id,
                    expectedRevision: cart.revision,
                    commandId: randomUUID(),
                    ...change,
                },
            })
        ).applyStorefrontCartCommand;
    };
    const apply = async (change: Record<string, unknown>) => {
        const result = await command(change);
        expect(result.status, result.message ?? result.errorCode).toBe('APPLIED');
        return result.cart;
    };
    await apply({ changes: { add: [{ productVariantId, quantity: 1 }] } });
    await apply({ beginCheckout: true });
    await apply({
        prepareShipping: {
            shippingAddress: {
                fullName: 'Referral Test',
                streetLine1: '100 Test Street',
                city: 'Los Angeles',
                province: 'California',
                postalCode: '90001',
                countryCode: 'US',
                phoneNumber: '10000000000',
            },
        },
    });
    let prepared = await command({ preparePayment: true });
    if (prepared.status === 'REJECTED' && /FR-[A-F0-9]{12}/.test(prepared.message ?? '')) {
        const current = (await shopClient.query(READ_CART)).storefrontCart;
        const cases = (await adminClient.query(RISK_CASES)).fraudRiskCases.items;
        const riskCase = cases.find(
            (item: { orderId: string; caseCode: string }) =>
                item.orderId === current.checkoutOrder.id && prepared.message.includes(item.caseCode),
        );
        expect(riskCase?.status).toBe('OPEN');
        const reviewed = await adminClient.query(RELEASE_RISK_CASE, {
            input: {
                id: riskCase.id,
                action: 'RELEASE',
                reason: 'Synthetic referral order reviewed in isolated E2E',
                idempotencyKey: randomUUID(),
            },
        });
        expect(reviewed.reviewFraudRiskCase.status).toBe('APPROVED');
        prepared = await command({ preparePayment: true });
    }
    expect(prepared.status, prepared.message ?? prepared.errorCode).toBe('APPLIED');
    const order = prepared.cart.checkoutOrder;
    expect(order.state).toBe('ArrangingPayment');
    return order;
}

async function createAndPayOrder(): Promise<any> {
    await createOrderAtPayment();
    const paid = await shopClient.query(PAY, { method: externalPaymentHandler.code });
    assertSuccess(paid.addPaymentToOrder);
    expect(paid.addPaymentToOrder.state).toBe('PaymentSettled');
    return paid.addPaymentToOrder;
}

function assertSuccess(result: { __typename?: string; message?: string }): void {
    if (result.__typename?.endsWith('Error')) {
        throw new Error(`${result.__typename}: ${result.message ?? 'unknown error'}`);
    }
}

function walletFor(result: any, currencyCode: string): any {
    return result.myReferralOverview.wallets.find((wallet: any) => wallet.currencyCode === currencyCode);
}
