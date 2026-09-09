import { LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import {
    ConfigService,
    EventBus,
    mergeConfig,
    Order,
    OrderService,
    Payment,
    PaymentMethod,
    PaymentMethodHandler,
    PaymentMethodService,
    Promotion,
    Refund,
    RefundStateTransitionEvent,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import fs from 'fs/promises';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { awaitRunningJobs } from '../../core/e2e/utils/await-running-jobs';
import { CouponOrderAllocation } from '../src/entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../src/entities/customer-coupon.entity';
import { StoreCouponCampaignConfig } from '../src/entities/store-coupon-campaign-config.entity';
import { StoreProfile } from '../src/entities/store-profile.entity';
import { customerCouponEntitlement } from '../src/promotion/store-commerce-promotion-actions';
import { StoreCouponLifecycleService } from '../src/promotion/store-coupon-lifecycle.service';
import { StorePromotionCampaignService } from '../src/promotion/store-promotion-campaign.service';
import { StoreManagementPlugin } from '../src/store-management.plugin';
import { usdtTrc20PaymentHandler } from '../src/usdt/usdt-payment-handler';
import { createUsdtPaymentProof } from '../src/usdt/usdt-payment-proof';

let deferRefunds = false;
const couponPaymentHandler = new PaymentMethodHandler({
    code: 'coupon-e2e-payment',
    description: [{ languageCode: LanguageCode.en, value: 'Coupon E2E payment' }],
    args: {},
    createPayment: (_ctx, order, amount) => ({
        amount,
        state: 'Settled',
        transactionId: `coupon-e2e-${order.code}`,
        metadata: {},
    }),
    settlePayment: () => ({ success: true }),
    createRefund: (_ctx, _input, amount) =>
        deferRefunds
            ? false
            : {
                  state: 'Settled',
                  transactionId: `coupon-e2e-refund-${amount}`,
                  metadata: {},
              },
});

const translationProvider: ContentTranslationProvider = {
    name: 'coupon-e2e-passthrough',
    isConfigured: () => true,
    translate: request =>
        Promise.resolve({
            provider: 'coupon-e2e-passthrough',
            translations: request.segments.map(segment => ({ key: segment.key, text: segment.text })),
        }),
};

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    paymentOptions: { paymentMethodHandlers: [couponPaymentHandler] },
    plugins: [
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({ provider: translationProvider }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'coupon-e2e-signing-secret-at-least-32-characters',
        }),
    ],
});

const { server, adminClient, shopClient } = createTestEnvironment(config);

const CREATE_PRODUCT = gql`
    mutation CouponE2ECreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`;

const CREATE_PRODUCT_VARIANTS = gql`
    mutation CouponE2ECreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
            sku
        }
    }
`;

const CREATE_COUPON = gql`
    mutation CouponE2ECreateCampaign($input: CreateStoreCouponCampaignInput!) {
        createStoreCouponCampaign(input: $input) {
            id
            couponCode
            perCustomerClaimLimit
            returnOnFullRefund
        }
    }
`;

const REGISTER = gql`
    mutation CouponE2ERegister($input: RegisterCustomerInput!) {
        registerCustomerWithReferral(input: $input) {
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

const LOGOUT = gql`
    mutation CouponE2ELogout {
        logout {
            success
        }
    }
`;

const ACTIVE_COUPONS = gql`
    query CouponE2EActiveCampaigns {
        activeStorefrontCoupons {
            id
            claimed
            claimable
            remainingIssueCount
            collectionIds
            productVariantIds
        }
    }
`;

const COUPON_FIELDS = gql`
    fragment CouponE2ECustomerCoupon on StoreCustomerCoupon {
        id
        campaignId
        status
        lockedOrderId
        usedOrderId
        returnCount
        claimedAt
        validFrom
        validUntil
        collectionIds
        productVariantIds
        usable
    }
`;

const CLAIM = gql`
    ${COUPON_FIELDS}
    mutation CouponE2EClaim($campaignId: ID!) {
        claimStorefrontCoupon(campaignId: $campaignId) {
            ...CouponE2ECustomerCoupon
        }
    }
`;

const MY_COUPONS = gql`
    ${COUPON_FIELDS}
    query CouponE2EMyCoupons {
        myStorefrontCoupons {
            ...CouponE2ECustomerCoupon
        }
    }
`;

const APPLY_OWNED_COUPON = gql`
    ${COUPON_FIELDS}
    mutation CouponE2EApplyOwned($id: ID!) {
        applyStorefrontCoupon(id: $id) {
            ...CouponE2ECustomerCoupon
        }
    }
`;

const APPLY_BEST_OWNED_COUPON = gql`
    ${COUPON_FIELDS}
    mutation CouponE2EApplyBestOwned {
        applyBestStorefrontCoupon {
            ...CouponE2ECustomerCoupon
        }
    }
`;

const CANCEL_COUPON_USE = gql`
    ${COUPON_FIELDS}
    mutation CouponE2ECancelUse($id: ID!) {
        removeStorefrontCoupon(id: $id) {
            ...CouponE2ECustomerCoupon
        }
    }
`;

const USAGE_RECORDS = gql`
    query CouponE2EUsageRecords {
        myStorefrontCouponUsageRecords {
            id
            customerCouponId
            status
            savedAmount
            usedAt
            refundedAt
            orderId
            orderCode
        }
    }
`;

const COUPON_LEDGER = gql`
    query CouponE2ELedger($options: StoreCouponLedgerEntryListOptions) {
        storeCouponLedger(options: $options) {
            totalItems
            items {
                campaignId
                eventType
            }
        }
    }
`;

const ORDER_FIELDS = gql`
    fragment CouponE2EOrder on Order {
        id
        code
        state
        totalWithTax
        shippingWithTax
        currencyCode
        couponCodes
        discounts {
            amountWithTax
            description
        }
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

const ADD_ITEM = gql`
    ${ORDER_FIELDS}
    mutation CouponE2EAddItem($productVariantId: ID!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: 1) {
            __typename
            ...CouponE2EOrder
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const APPLY_RAW_CODE = gql`
    ${ORDER_FIELDS}
    mutation CouponE2EApplyRawCode($couponCode: String!) {
        applyCouponCode(couponCode: $couponCode) {
            __typename
            ...CouponE2EOrder
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const SET_ADDRESS = gql`
    ${ORDER_FIELDS}
    mutation CouponE2ESetAddress {
        setOrderShippingAddress(
            input: {
                fullName: "Coupon Test"
                streetLine1: "100 Test Street"
                city: "Los Angeles"
                province: "California"
                postalCode: "90001"
                countryCode: "US"
                phoneNumber: "10000000000"
            }
        ) {
            ...CouponE2EOrder
        }
    }
`;

const ELIGIBLE_SHIPPING = gql`
    query CouponE2EEligibleShipping {
        eligibleShippingMethods {
            id
        }
    }
`;

const SET_SHIPPING = gql`
    ${ORDER_FIELDS}
    mutation CouponE2ESetShipping($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            __typename
            ...CouponE2EOrder
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const TRANSITION = gql`
    ${ORDER_FIELDS}
    mutation CouponE2ETransition {
        transitionOrderToState(state: "ArrangingPayment") {
            __typename
            ...CouponE2EOrder
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const PAY = gql`
    ${ORDER_FIELDS}
    mutation CouponE2EPay($method: String!) {
        addPaymentToOrder(input: { method: $method, metadata: {} }) {
            __typename
            ...CouponE2EOrder
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const REFUND = gql`
    mutation CouponE2ERefund($input: RefundOrderInput!) {
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

let productVariantId = '';
let campaignId = '';
let soldOutCampaignId = '';
let smallerDiscountCampaignId = '';
let bestDiscountCampaignId = '';
let couponCode = '';

describe('coupon lifecycle closed loop', () => {
    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                collections: [],
                paymentMethods: [
                    {
                        name: 'Coupon E2E payment',
                        handler: { code: couponPaymentHandler.code, arguments: [] },
                    },
                ],
            },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
        const paymentContext = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const existingUsdt = await server.app
            .get(TransactionalConnection)
            .getRepository(paymentContext, PaymentMethod)
            .findOne({ where: { code: 'usdt-trc20' } });
        if (!existingUsdt)
            await server.app.get(PaymentMethodService).create(paymentContext, {
                code: 'usdt-trc20',
                enabled: true,
                handler: { code: usdtTrc20PaymentHandler.code, arguments: [] },
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: 'Disposable USDT proof fixture',
                        description: '',
                    },
                ],
            });
        const paymentRepository = server.app
            .get(TransactionalConnection)
            .getRepository(paymentContext, PaymentMethod);
        const fixtureUsdt = await paymentRepository.findOneOrFail({
            where: { code: 'usdt-trc20' },
            relations: { channels: true },
        });
        await paymentRepository.update(fixtureUsdt.id, { enabled: true });
        if (!fixtureUsdt.channels.some(channel => String(channel.id) === String(paymentContext.channelId)))
            await paymentRepository
                .createQueryBuilder()
                .relation('channels')
                .of(fixtureUsdt)
                .add(paymentContext.channelId);
        const product = await adminClient.query(CREATE_PRODUCT, {
            input: {
                enabled: true,
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: '优惠券闭环测试商品',
                        slug: 'coupon-lifecycle-e2e-product',
                        description: '验证领取、锁定、核销、退款返券和再次使用',
                    },
                ],
            },
        });
        const variants = await adminClient.query(CREATE_PRODUCT_VARIANTS, {
            input: [
                {
                    productId: product.createProduct.id,
                    enabled: true,
                    sku: 'COUPON-E2E-001',
                    price: 10_000,
                    stockOnHand: 100,
                    trackInventory: 'TRUE',
                    optionIds: [],
                    translations: [{ languageCode: LanguageCode.zh_Hans, name: '优惠券测试规格' }],
                },
            ],
        });
        productVariantId = variants.createProductVariants[0].id;

        const createdCampaign = await adminClient.query(CREATE_COUPON, {
            input: {
                name: '满100减10测试券',
                kind: 'ORDER_FIXED',
                minimumSpend: 10_000,
                discountAmount: 1_000,
                issueLimit: 10,
                validityDays: 7,
                stackPolicy: 'EXCLUSIVE',
                returnOnCancellation: true,
                returnOnFullRefund: true,
            },
        });
        campaignId = createdCampaign.createStoreCouponCampaign.id;
        couponCode = createdCampaign.createStoreCouponCampaign.couponCode;
        expect(createdCampaign.createStoreCouponCampaign).toMatchObject({
            perCustomerClaimLimit: 1,
            returnOnFullRefund: true,
        });
        const soldOutCampaign = await adminClient.query(CREATE_COUPON, {
            input: {
                name: '同设备账号隔离测试券',
                kind: 'ORDER_FIXED',
                minimumSpend: 10_000,
                discountAmount: 1_000,
                issueLimit: 1,
                validityDays: 7,
                stackPolicy: 'EXCLUSIVE',
                returnOnCancellation: true,
                returnOnFullRefund: true,
            },
        });
        soldOutCampaignId = soldOutCampaign.createStoreCouponCampaign.id;
        const smallerDiscountCampaign = await adminClient.query(CREATE_COUPON, {
            input: {
                name: '自动选券5元券',
                kind: 'ORDER_FIXED',
                minimumSpend: 10_000,
                discountAmount: 500,
                issueLimit: 10,
                validityDays: 7,
                stackPolicy: 'EXCLUSIVE',
                returnOnCancellation: true,
                returnOnFullRefund: true,
            },
        });
        smallerDiscountCampaignId = smallerDiscountCampaign.createStoreCouponCampaign.id;
        const bestDiscountCampaign = await adminClient.query(CREATE_COUPON, {
            input: {
                name: '自动选券20元券',
                kind: 'ORDER_FIXED',
                minimumSpend: 10_000,
                discountAmount: 2_000,
                issueLimit: 10,
                validityDays: 7,
                stackPolicy: 'EXCLUSIVE',
                returnOnCancellation: true,
                returnOnFullRefund: true,
            },
        });
        bestDiscountCampaignId = bestDiscountCampaign.createStoreCouponCampaign.id;

        const registered = await shopClient.query(REGISTER, {
            input: {
                emailAddress: 'coupon-e2e@example.com',
                firstName: 'Coupon',
                lastName: 'Tester',
                password: 'CouponPass123!',
            },
        });
        assertSuccess(registered.registerCustomerWithReferral);
        await shopClient.asUserWithCredentials('coupon-e2e@example.com', 'CouponPass123!');
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('claims once, requires explicit application, redeems only after payment and preserves refund history', async () => {
        const activeBeforeClaim = await shopClient.query(ACTIVE_COUPONS);
        expect(campaign(activeBeforeClaim)).toMatchObject({
            claimed: false,
            claimable: true,
            collectionIds: [],
            productVariantIds: [],
        });

        const claimed = await shopClient.query(CLAIM, { campaignId });
        const coupon = claimed.claimStorefrontCoupon;
        expect(coupon).toMatchObject({ campaignId, status: 'AVAILABLE', usable: true });
        expect((await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords).toEqual([]);
        const claimedLedger = await adminClient.query(COUPON_LEDGER, {
            options: { take: 20, campaignId, eventType: 'CLAIMED' },
        });
        expect(claimedLedger.storeCouponLedger.totalItems).toBeGreaterThan(0);
        expect(claimedLedger.storeCouponLedger.items).toEqual(
            expect.arrayContaining([expect.objectContaining({ campaignId, eventType: 'CLAIMED' })]),
        );
        expect(claimedLedger.storeCouponLedger.items).toEqual(
            claimedLedger.storeCouponLedger.items.filter(
                (item: { campaignId: string; eventType: string }) =>
                    item.campaignId === campaignId && item.eventType === 'CLAIMED',
            ),
        );
        expect(campaign(await shopClient.query(ACTIVE_COUPONS))).toMatchObject({
            claimed: true,
            claimable: false,
        });

        await expect(shopClient.query(CLAIM, { campaignId })).rejects.toThrow(
            /already|already claimed|已经领取/u,
        );

        const added = await shopClient.query(ADD_ITEM, { productVariantId });
        assertSuccess(added.addItemToOrder);
        expect(added.addItemToOrder.couponCodes).toEqual([]);

        const bypass = await shopClient.query(APPLY_RAW_CODE, { couponCode });
        expect(bypass.applyCouponCode).toMatchObject({
            __typename: 'Order',
            totalWithTax: added.addItemToOrder.totalWithTax,
            discounts: [],
        });

        const appliedOnce = await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        expect(appliedOnce.applyStorefrontCoupon).toMatchObject({
            status: 'LOCKED',
            lockedOrderId: added.addItemToOrder.id,
        });

        const cancelledUse = await shopClient.query(CANCEL_COUPON_USE, { id: coupon.id });
        expect(cancelledUse.removeStorefrontCoupon).toMatchObject({
            id: coupon.id,
            status: 'AVAILABLE',
            lockedOrderId: null,
        });
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toContainEqual(
            expect.objectContaining({ id: coupon.id, status: 'AVAILABLE' }),
        );

        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        const pendingOrder = await prepareOrderForPayment();
        expect(pendingOrder.state).toBe('ArrangingPayment');
        const appliedDiscount = Math.abs(
            pendingOrder.discounts.reduce(
                (total: number, discount: { amountWithTax: number }) => total + discount.amountWithTax,
                0,
            ),
        );
        expect(appliedDiscount).toBeGreaterThan(0);
        expect(pendingOrder.totalWithTax).toBeLessThan(bypass.applyCouponCode.totalWithTax);
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toContainEqual(
            expect.objectContaining({ id: coupon.id, status: 'LOCKED' }),
        );
        expect((await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords).toEqual([]);

        const firstPaidOrder = await payOrder();
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toContainEqual(
            expect.objectContaining({ id: coupon.id, status: 'USED', usedOrderId: firstPaidOrder.id }),
        );
        const firstHistory = (await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords;
        expect(firstHistory).toHaveLength(1);
        expect(firstHistory[0]).toMatchObject({
            customerCouponId: coupon.id,
            status: 'USED',
            orderId: firstPaidOrder.id,
            savedAmount: appliedDiscount,
        });

        await expect(shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id })).rejects.toThrow();

        const payment = firstPaidOrder.payments.find(
            (candidate: any) => candidate.method === couponPaymentHandler.code,
        );
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
        const refunded = await adminClient.query(REFUND, {
            input: {
                lines: firstPaidOrder.lines.map((line: any) => ({
                    orderLineId: line.id,
                    quantity: line.quantity,
                })),
                shipping: firstPaidOrder.shippingWithTax,
                adjustment: 0,
                paymentId: payment.id,
                reason: 'Coupon lifecycle full refund',
            },
        });
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
        assertSuccess(refunded.refundOrder);
        expect(refunded.refundOrder.state).toBe('Settled');

        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toContainEqual(
            expect.objectContaining({ id: coupon.id, status: 'RETURNED', returnCount: 1 }),
        );
        const refundedHistory = (await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords;
        expect(refundedHistory).toHaveLength(1);
        expect(refundedHistory[0]).toMatchObject({ status: 'REFUNDED', orderId: firstPaidOrder.id });
        expect(refundedHistory[0].refundedAt).toEqual(expect.any(String));

        const secondAdded = await shopClient.query(ADD_ITEM, { productVariantId });
        assertSuccess(secondAdded.addItemToOrder);
        const appliedAgain = await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        expect(appliedAgain.applyStorefrontCoupon.status).toBe('LOCKED');
        await prepareOrderForPayment();
        const secondPaidOrder = await payOrder();

        const finalHistory = (await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords;
        expect(finalHistory).toHaveLength(2);
        expect(finalHistory).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ status: 'REFUNDED', orderId: firstPaidOrder.id }),
                expect.objectContaining({ status: 'USED', orderId: secondPaidOrder.id }),
            ]),
        );
    }, 30_000);

    it('does not expose account A coupon ownership or history after the same client logs in as account B', async () => {
        await shopClient.query(CLAIM, { campaignId: soldOutCampaignId });
        await shopClient.query(LOGOUT);
        const registered = await shopClient.query(REGISTER, {
            input: {
                emailAddress: 'coupon-e2e-account-b@example.com',
                firstName: 'Coupon',
                lastName: 'Account B',
                password: 'CouponPass456!',
            },
        });
        assertSuccess(registered.registerCustomerWithReferral);
        await shopClient.asUserWithCredentials('coupon-e2e-account-b@example.com', 'CouponPass456!');

        expect(campaign(await shopClient.query(ACTIVE_COUPONS), soldOutCampaignId)).toMatchObject({
            claimed: false,
            claimable: false,
            remainingIssueCount: 0,
        });
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toEqual([]);
        expect((await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords).toEqual([]);
    });

    it('calculates and applies the owned coupon with the largest saving', async () => {
        await shopClient.query(LOGOUT);
        const registered = await shopClient.query(REGISTER, {
            input: {
                emailAddress: 'coupon-e2e-best-selection@example.com',
                firstName: 'Coupon',
                lastName: 'Best Selection',
                password: 'CouponPass789!',
            },
        });
        assertSuccess(registered.registerCustomerWithReferral);
        await shopClient.asUserWithCredentials('coupon-e2e-best-selection@example.com', 'CouponPass789!');

        await shopClient.query(CLAIM, { campaignId: smallerDiscountCampaignId });
        await shopClient.query(CLAIM, { campaignId: bestDiscountCampaignId });
        const added = await shopClient.query(ADD_ITEM, { productVariantId });
        assertSuccess(added.addItemToOrder);

        const selected = await shopClient.query(APPLY_BEST_OWNED_COUPON);
        expect(selected.applyBestStorefrontCoupon).toMatchObject({
            campaignId: bestDiscountCampaignId,
            status: 'LOCKED',
            lockedOrderId: added.addItemToOrder.id,
        });
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ campaignId: smallerDiscountCampaignId, status: 'AVAILABLE' }),
                expect.objectContaining({ campaignId: bestDiscountCampaignId, status: 'LOCKED' }),
            ]),
        );
    });
    it('keeps the old coupon and cart price when an ineligible coupon is selected through either API', async () => {
        await auditCustomer('invalid-selection');
        const good = await auditClaim({ name: 'Audit valid', discountAmount: 500 });
        const bad = await auditClaim({ name: 'Audit minimum not met', minimumSpend: 1_000_000 });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: good.id });
        const before = (await shopClient.query(AUDIT_ORDER)).activeOrder;
        await expect(shopClient.query(APPLY_OWNED_COUPON, { id: bad.id })).rejects.toThrow(
            '不适用于当前购物车',
        );
        expect((await shopClient.query(AUDIT_ORDER)).activeOrder).toEqual(before);
        const cart = (
            await shopClient.query(gql`
                query {
                    storefrontCart {
                        id
                        revision
                    }
                }
            `)
        ).storefrontCart;
        const result = await shopClient.query(
            gql`
                mutation ($input: StorefrontCartCommandInput!) {
                    applyStorefrontCartCommand(input: $input) {
                        status
                        errorCode
                        cart {
                            revision
                        }
                    }
                }
            `,
            {
                input: {
                    cartId: cart.id,
                    expectedRevision: cart.revision,
                    commandId: 'audit-ineligible-coupon',
                    coupon: { action: 'APPLY', couponId: bad.id },
                },
            },
        );
        expect(result.applyStorefrontCartCommand).toMatchObject({
            status: 'REJECTED',
            cart: { revision: cart.revision },
        });
        expect((await shopClient.query(AUDIT_ORDER)).activeOrder).toEqual(before);
        const mine = (await shopClient.query(MY_COUPONS)).myStorefrontCoupons;
        expect(mine.find((coupon: any) => coupon.id === good.id).status).toBe('LOCKED');
        expect(mine.find((coupon: any) => coupon.id === bad.id).status).toBe('AVAILABLE');
    });

    it('rolls back coupon replacement if formal pricing loses the discount after a successful trial', async () => {
        await auditCustomer('post-apply-rollback');
        const good = await auditClaim({ name: 'Audit original discount', discountAmount: 500 });
        const next = await auditClaim({ name: 'Audit replacement discount', discountAmount: 600 });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: good.id });
        const before = (await shopClient.query(AUDIT_ORDER)).activeOrder;
        const orders = server.app.get(OrderService);
        const apply = orders.applyCouponCode.bind(orders);
        const spy = vi.spyOn(orders, 'applyCouponCode').mockImplementationOnce(async (ctx, orderId, code) => {
            const result = await apply(ctx, orderId, code);
            // Inject a real repricing failure inside the request transaction.
            await orders.removeCouponCode(ctx, orderId, code);
            return result;
        });
        try {
            await expect(shopClient.query(APPLY_OWNED_COUPON, { id: next.id })).rejects.toThrow(
                '未产生实际优惠',
            );
        } finally {
            spy.mockRestore();
        }
        expect((await shopClient.query(AUDIT_ORDER)).activeOrder).toEqual(before);
        const mine = (await shopClient.query(MY_COUPONS)).myStorefrontCoupons;
        expect(mine.find((coupon: any) => coupon.id === good.id).status).toBe('LOCKED');
        expect(mine.find((coupon: any) => coupon.id === next.id).status).toBe('AVAILABLE');
    });

    it('isolates a merchant coupon also assigned to the default Channel by Vendure', async () => {
        await auditCustomer('channel-isolation');
        const token = 'coupon-audit-secondary-channel';
        const createdChannel = await adminClient.query(
            gql`
                mutation ($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
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
                    code: token,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: 'USD',
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            },
        );
        expect(createdChannel.createChannel.id).toBeTruthy();
        const merchantContext = await server.app.get(RequestContextService).create({
            apiType: 'admin',
            channelOrToken: token,
        });
        await server.app
            .get(TransactionalConnection)
            .getRepository(merchantContext, StoreProfile)
            .save(
                new StoreProfile({
                    channelId: merchantContext.channelId,
                    status: 'ACTIVE',
                    descriptionZh: '',
                    descriptionEn: '',
                }),
            );
        let merchantCampaignId: string;
        adminClient.setRequestHeader('vendure-token', token);
        try {
            const created = await adminClient.query(CREATE_COUPON, {
                input: {
                    name: 'Audit merchant only',
                    kind: 'ORDER_FIXED',
                    minimumSpend: 0,
                    discountAmount: 100,
                    validityDays: 7,
                    issueLimit: 10,
                },
            });
            merchantCampaignId = created.createStoreCouponCampaign.id;
        } finally {
            adminClient.setRequestHeader('vendure-token', null);
        }
        expect(
            (await shopClient.query(ACTIVE_COUPONS)).activeStorefrontCoupons.some(
                (item: any) => item.id === merchantCampaignId,
            ),
        ).toBe(false);
        await expect(shopClient.query(CLAIM, { campaignId: merchantCampaignId })).rejects.toThrow('其他店铺');
        for (const mutation of [
            `mutation ($id: ID!, $password: String!) { setStorePromotionEnabled(id: $id, enabled: false, password: $password) { id } }`,
            `mutation ($id: ID!, $password: String!) { deleteStorePromotion(id: $id, password: $password) { result } }`,
        ])
            await expect(
                adminClient.query(gql(mutation), {
                    id: merchantCampaignId,
                    password: SUPER_ADMIN_USER_PASSWORD,
                }),
            ).rejects.toThrow('其他店铺');
        await expect(
            adminClient.query(
                gql`
                    mutation ($id: ID!) {
                        updateStorePromotionName(id: $id, name: "Wrong shop") {
                            id
                        }
                    }
                `,
                { id: merchantCampaignId },
            ),
        ).rejects.toThrow('其他店铺');

        await expect(
            adminClient.query(
                gql`
                    query ($id: ID!) {
                        storeCouponRepairPreview(campaignId: $id)
                    }
                `,
                { id: merchantCampaignId },
            ),
        ).rejects.toThrow('当前店铺');
        await shopClient.asAnonymousUser();
        shopClient.setRequestHeader('Authorization', null);
        shopClient.setRequestHeader('vendure-token', token);
        try {
            expect(
                (await shopClient.query(ACTIVE_COUPONS)).activeStorefrontCoupons.some(
                    (item: any) => item.id === merchantCampaignId,
                ),
            ).toBe(true);
        } finally {
            shopClient.setRequestHeader('vendure-token', null);
        }
    });

    it('allows full-refund reuse with the same defaults as the admin editor and does not renew expiry', async () => {
        await auditCustomer('refund-reuse');
        const coupon = await auditClaim({
            name: 'Audit refund reuse',
            issueLimit: 1,
            usageLimit: 1,
            perCustomerUsageLimit: 1,
        });
        const first = await auditPay(coupon.id);
        await auditRefund(first);
        const returned = (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
            (item: any) => item.id === coupon.id,
        );
        expect(returned).toMatchObject({
            status: 'RETURNED',
            usedOrderId: null,
            returnCount: 1,
            validUntil: coupon.validUntil,
        });
        const second = await auditPay(coupon.id);
        expect(second.id).not.toBe(first.id);
        expect(
            (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                (item: any) => item.id === coupon.id,
            ),
        ).toMatchObject({ status: 'USED', usedOrderId: second.id, validUntil: coupon.validUntil });
    }, 30_000);

    it('does not return B order redemption when cancelled A is refunded later', async () => {
        await auditCustomer('late-refund');
        const coupon = await auditClaim({ name: 'Audit late refund' });
        const first = await auditPay(coupon.id);
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
        try {
            const cancelled = await adminClient.query(
                gql`
                    mutation ($input: CancelOrderInput!) {
                        cancelOrder(input: $input) {
                            ... on Order {
                                state
                            }
                            ... on ErrorResult {
                                errorCode
                            }
                        }
                    }
                `,
                { input: { orderId: first.id, reason: 'Audit cancellation before refund' } },
            );
            expect(cancelled.cancelOrder.state).toBe('Cancelled');
        } finally {
            adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
        }
        const second = await auditPay(coupon.id);
        await auditRefund(first);
        expect(
            (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                (item: any) => item.id === coupon.id,
            ),
        ).toMatchObject({ status: 'USED', usedOrderId: second.id, returnCount: 1 });
    }, 30_000);

    it('starts a full seven-day window at claim and rejects claims after issuance ends', async () => {
        await auditCustomer('claim-window');
        const end = new Date(Date.now() + 3_600_000);
        const coupon = await auditClaim({ name: 'Audit relative validity', endsAt: end, claimEndsAt: end });
        expect(Date.parse(coupon.validUntil) - Date.parse(coupon.claimedAt)).toBe(7 * 86_400_000);
        const stopped = await adminClient.query(
            gql`
                mutation ($id: ID!, $password: String!) {
                    stopStoreCouponIssuance(id: $id, password: $password) {
                        id
                    }
                }
            `,
            { id: coupon.campaignId, password: SUPER_ADMIN_USER_PASSWORD },
        );
        expect(stopped.stopStoreCouponIssuance.id).toBe(coupon.campaignId);
        await expect(shopClient.query(CLAIM, { campaignId: coupon.campaignId })).rejects.toThrow(
            '领取已结束',
        );
        await shopClient.query(ADD_ITEM, { productVariantId });
        expect(
            (await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id })).applyStorefrontCoupon.status,
        ).toBe('LOCKED');
    });

    it('shares variant-specific ancestor scopes with checkout and discounts only matching mixed-cart lines', async () => {
        await auditCustomer('variant-scope');
        const product = (
            await adminClient.query(CREATE_PRODUCT, {
                input: {
                    enabled: true,
                    translations: [
                        {
                            languageCode: 'zh_Hans',
                            name: 'Audit variants',
                            slug: 'audit-variant-coupon',
                            description: 'Disposable category coupon integration test',
                        },
                    ],
                },
            })
        ).createProduct;
        const optionGroup = (
            await adminClient.query(
                gql`
                    mutation ($input: CreateProductOptionGroupInput!) {
                        createProductOptionGroup(input: $input) {
                            id
                            options {
                                id
                                code
                            }
                        }
                    }
                `,
                {
                    input: {
                        code: 'audit-size',
                        translations: [{ languageCode: 'zh_Hans', name: '规格' }],
                        options: ['a', 'b'].map(code => ({
                            code,
                            translations: [{ languageCode: 'zh_Hans', name: code }],
                        })),
                    },
                },
            )
        ).createProductOptionGroup;
        await adminClient.query(
            gql`
                mutation ($productId: ID!, $optionGroupId: ID!) {
                    addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) {
                        id
                    }
                }
            `,
            { productId: product.id, optionGroupId: optionGroup.id },
        );
        const variants = (
            await adminClient.query(CREATE_PRODUCT_VARIANTS, {
                input: ['a', 'b'].map(code => ({
                    productId: product.id,
                    enabled: true,
                    sku: 'AUDIT-SCOPE-' + code,
                    price: 2000,
                    stockOnHand: 10,
                    trackInventory: 'TRUE',
                    optionIds: [optionGroup.options.find((option: any) => option.code === code).id],
                    translations: [{ languageCode: 'zh_Hans', name: code }],
                })),
            })
        ).createProductVariants;
        const createCollection = async (name: string, variantId?: string, parentId?: string) =>
            (
                await adminClient.query(
                    gql`
                        mutation ($input: CreateCollectionInput!) {
                            createCollection(input: $input) {
                                id
                            }
                        }
                    `,
                    {
                        input: {
                            parentId,
                            inheritFilters: false,
                            translations: [{ languageCode: 'zh_Hans', name, slug: name, description: '' }],
                            filters: variantId
                                ? [
                                      {
                                          code: 'variant-id-filter',
                                          arguments: [
                                              { name: 'variantIds', value: JSON.stringify([variantId]) },
                                              { name: 'combineWithAnd', value: 'true' },
                                          ],
                                      },
                                  ]
                                : [],
                        },
                    },
                )
            ).createCollection;
        const parent = await createCollection('audit-parent');
        const child = await createCollection('audit-child', variants[0].id, parent.id);
        await createCollection('audit-other', variants[1].id);
        await awaitRunningJobs(adminClient, 10_000);
        const scoped = (
            await shopClient.query(
                gql`
                    query ($id: ID!) {
                        product(id: $id) {
                            collections {
                                id
                            }
                            variants {
                                id
                                priceWithTax
                                storeCouponCollectionIds
                            }
                        }
                    }
                `,
                { id: product.id },
            )
        ).product;
        const variantA = scoped.variants.find((variant: any) => variant.id === variants[0].id);
        const variantB = scoped.variants.find((variant: any) => variant.id === variants[1].id);
        expect(variantA.storeCouponCollectionIds).toEqual(expect.arrayContaining([parent.id, child.id]));
        expect(variantB.storeCouponCollectionIds).not.toContain(parent.id);
        const coupon = await auditClaim({
            name: 'Audit parent category',
            kind: 'COLLECTION_PERCENTAGE',
            discountAmount: null,
            discountRate: 8,
            collectionIds: [parent.id],
        });
        expect(coupon.collectionIds).toEqual([parent.id]);
        await shopClient.query(ADD_ITEM, { productVariantId: variantB.id });
        await expect(shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id })).rejects.toThrow(
            '不适用于当前购物车',
        );
        await shopClient.query(ADD_ITEM, { productVariantId: variantA.id });
        const before = (await shopClient.query(AUDIT_ORDER)).activeOrder.totalWithTax;
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        const after = (await shopClient.query(AUDIT_ORDER)).activeOrder.totalWithTax;
        expect(before - after).toBe(Math.round(variantA.priceWithTax * 0.2));
    }, 30_000);

    it('previews and repairs old truncated coupons with version checks and an idempotent second pass', async () => {
        await auditCustomer('repair');
        const coupon = await auditClaim({ name: 'Audit historical repair', issueLimit: 1 });
        const connection = server.app.get(TransactionalConnection);
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        const couponId = strategy.decodeId(coupon.id);
        const promotionId = strategy.decodeId(coupon.campaignId);
        const claimed = new Date(Math.floor((Date.now() - 2 * 86_400_000) / 1000) * 1000);
        const cutoff = new Date(claimed.getTime() + 86_400_000);
        await connection.rawConnection.getRepository(CustomerCoupon).update(couponId, {
            claimedAt: claimed,
            validFrom: claimed,
            validUntil: cutoff,
            status: 'EXPIRED',
            expiredAt: cutoff,
        });
        await connection.rawConnection
            .getRepository(Promotion)
            .update(promotionId, { endsAt: cutoff, usageLimit: 1, perCustomerUsageLimit: 1 });
        await connection.rawConnection
            .getRepository(StoreCouponCampaignConfig)
            .update({ promotionId }, { claimEndsAt: cutoff });
        const previewQuery = gql`
            query ($campaignId: ID!) {
                storeCouponRepairPreview(campaignId: $campaignId)
            }
        `;
        const repairMutation = gql`
            mutation ($campaignId: ID!, $fingerprint: String!, $password: String!) {
                repairStoreCouponCampaign(
                    campaignId: $campaignId
                    fingerprint: $fingerprint
                    password: $password
                )
            }
        `;
        const variables = { campaignId: coupon.campaignId, password: SUPER_ADMIN_USER_PASSWORD };
        const first = (await adminClient.query(previewQuery, variables)).storeCouponRepairPreview;
        expect(first.changes.coupons).toHaveLength(1);
        expect(first.changes.coupons[0].after.status).toBe('AVAILABLE');
        await connection.rawConnection
            .getRepository(CustomerCoupon)
            .update(couponId, { campaignName: 'Audit changed since preview' });
        await expect(
            adminClient.query(repairMutation, { ...variables, fingerprint: first.fingerprint }),
        ).rejects.toThrow('数据已变化');
        const reviewed = (await adminClient.query(previewQuery, variables)).storeCouponRepairPreview;
        const repaired = (
            await adminClient.query(repairMutation, { ...variables, fingerprint: reviewed.fingerprint })
        ).repairStoreCouponCampaign;
        expect(repaired.changedCoupons).toBe(1);
        expect(repaired.after.changes).toEqual({ promotion: null, config: null, coupons: [] });
        const second = (
            await adminClient.query(repairMutation, { ...variables, fingerprint: repaired.after.fingerprint })
        ).repairStoreCouponCampaign;
        expect(second.changedCoupons).toBe(0);
        const mine = (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
            (item: any) => item.id === coupon.id,
        );
        expect(mine).toMatchObject({
            status: 'AVAILABLE',
            usable: true,
            validUntil: new Date(claimed.getTime() + 7 * 86_400_000).toISOString(),
        });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        const ledger = await adminClient.query(COUPON_LEDGER, {
            options: { campaignId: coupon.campaignId, eventType: 'CORRECTED', take: 20 },
        });
        expect(ledger.storeCouponLedger.totalItems).toBe(1);
        await fs.mkdir(path.join(__dirname, '__data__'), { recursive: true });
        await fs.writeFile(
            path.join(__dirname, '__data__', 'coupon-repair-audit.json'),
            JSON.stringify(
                { database: process.env.DB || 'sqljs', preview: reviewed, receipt: repaired },
                null,
                2,
            ),
        );
    }, 30_000);

    it('paginates more than 200 old coupons and selects the valid entitlement beyond the historical batch', async () => {
        await auditCustomer('closure-pages');
        const coupon = await auditClaim({ name: 'Closure pages', issueLimit: 1000 });
        const connection = server.app.get(TransactionalConnection);
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        const repository = connection.rawConnection.getRepository(CustomerCoupon);
        const original = await repository.findOneByOrFail({ id: strategy.decodeId(coupon.id) });
        const history = Array.from({ length: 205 }, () =>
            repository.create({
                ...original,
                id: undefined,
                version: 1,
                claimedAt: new Date(Date.now() - 10 * 86_400_000),
                validFrom: new Date(Date.now() - 10 * 86_400_000),
                validUntil: new Date(Date.now() - 3 * 86_400_000),
                status: 'EXPIRED',
            }),
        );
        await repository.save(history);
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons).toHaveLength(206);
        const query = gql`
            query ($options: StoreCouponPageOptions) {
                myStorefrontCouponsPage(options: $options) {
                    totalItems
                    items {
                        id
                        status
                    }
                }
            }
        `;
        const page1 = (await shopClient.query(query, { options: { take: 200 } })).myStorefrontCouponsPage;
        const page2 = (await shopClient.query(query, { options: { skip: 200, take: 200 } }))
            .myStorefrontCouponsPage;
        expect(page1.totalItems).toBe(206);
        expect(page2.items).toHaveLength(6);
        expect(new Set([...page1.items, ...page2.items].map((item: any) => item.id)).size).toBe(206);
        expect(
            (await shopClient.query(query, { options: { statuses: ['AVAILABLE'], usableOnly: true } }))
                .myStorefrontCouponsPage.items,
        ).toEqual([{ id: coupon.id, status: 'AVAILABLE' }]);
        await shopClient.query(ADD_ITEM, { productVariantId });
        expect((await shopClient.query(APPLY_BEST_OWNED_COUPON)).applyBestStorefrontCoupon.id).toBe(
            coupon.id,
        );
        const orderId = strategy.decodeId((await shopClient.query(AUDIT_ORDER)).activeOrder.id);
        const allocationRepo = connection.rawConnection.getRepository(CouponOrderAllocation);
        await allocationRepo.save(
            history.map(item =>
                allocationRepo.create({
                    channelId: item.channelId,
                    customerId: item.customerId,
                    customerCouponId: item.id,
                    promotionId: item.promotionId,
                    orderId,
                    status: 'USED',
                    campaignName: 'Historical usage',
                    currencyCode: original.currencyCode,
                    appliedAt: item.claimedAt,
                    usedAt: item.claimedAt,
                }),
            ),
        );
        const usageQuery = gql`
            query ($options: StoreCouponPageOptions) {
                myStorefrontCouponUsageRecordsPage(options: $options) {
                    items {
                        id
                        status
                    }
                    totalItems
                }
            }
        `;
        const usage1 = (await shopClient.query(usageQuery, { options: { take: 200, statuses: ['USED'] } }))
            .myStorefrontCouponUsageRecordsPage;
        const usage2 = (
            await shopClient.query(usageQuery, { options: { skip: 200, take: 200, statuses: ['USED'] } })
        ).myStorefrontCouponUsageRecordsPage;
        expect(usage1.totalItems).toBe(205);
        expect(usage2.items).toHaveLength(5);
        expect(new Set([...usage1.items, ...usage2.items].map((item: any) => item.id)).size).toBe(205);
        expect((await shopClient.query(USAGE_RECORDS)).myStorefrontCouponUsageRecords).toHaveLength(205);
    });

    it('releases allocation and discount when revoking a reserved unpaid coupon', async () => {
        await auditCustomer('closure-revoke-allocation');
        const coupon = await auditClaim({ name: 'Closure revoke allocation' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        const before = (await shopClient.query(AUDIT_ORDER)).activeOrder;
        await adminClient.query(
            gql`
                mutation ($id: ID!) {
                    revokeStoreCustomerCoupon(id: $id) {
                        id
                        status
                    }
                }
            `,
            { id: coupon.id },
        );
        const after = (await shopClient.query(AUDIT_ORDER)).activeOrder;
        expect(after.couponCodes).toEqual([]);
        expect(after.totalWithTax).toBeGreaterThan(before.totalWithTax);
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        const allocation = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(CouponOrderAllocation)
            .findOneByOrFail({ customerCouponId: strategy.decodeId(coupon.id) });
        expect(allocation.status).toBe('RELEASED');
    });

    it.each(['before', 'equal', 'after', 'unverified'] as const)(
        'uses trusted actual payment time at the expiry boundary: %s',
        async boundary => {
            await auditCustomer('closure-payment-' + boundary);
            const coupon = await auditClaim({ name: 'Closure trusted payment ' + boundary });
            await shopClient.query(ADD_ITEM, { productVariantId });
            await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
            await prepareOrderForPayment();
            const order = (await shopClient.query(AUDIT_ORDER)).activeOrder;
            const connection = server.app.get(TransactionalConnection);
            const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
            const repository = connection.rawConnection.getRepository(CustomerCoupon);
            const stored = await repository.findOneByOrFail({ id: strategy.decodeId(coupon.id) });
            const expiresAt = Math.floor(Date.now() / 1000) * 1000 - 10_000;
            await repository.update(stored.id, {
                validFrom: new Date(expiresAt - 86_400_000),
                validUntil: new Date(expiresAt),
            });
            const paidAt =
                boundary === 'before'
                    ? expiresAt - 1000
                    : boundary === 'equal'
                      ? expiresAt
                      : expiresAt + 1000;
            const proof = createUsdtPaymentProof({
                channelId: String(stored.channelId),
                orderId: String(strategy.decodeId(order.id)),
                quoteId: 'closure-' + boundary,
                fiatCurrencyCode: 'USD',
                fiatAmount: order.totalWithTax,
                transactionId: ['before', 'equal', 'after', 'unverified']
                    .indexOf(boundary)
                    .toString()
                    .repeat(64),
                usdtAmount: '1.000000',
                receivingAddressFingerprint: 'f'.repeat(64),
                expiresAt: Date.now() + 60_000,
                ...(boundary === 'unverified' ? {} : { paidAt }),
            });
            const result = (
                await shopClient.query(
                    gql`
                        mutation ($proof: String!) {
                            addPaymentToOrder(
                                input: {
                                    method: "usdt-trc20"
                                    metadata: { proof: $proof, paidAt: "2000-01-01T00:00:00Z" }
                                }
                            ) {
                                __typename
                                ... on Order {
                                    id
                                    state
                                }
                                ... on ErrorResult {
                                    message
                                }
                            }
                        }
                    `,
                    { proof },
                )
            ).addPaymentToOrder;
            const fresh = await repository.findOneByOrFail({ id: stored.id });
            if (boundary === 'before') {
                expect(result, JSON.stringify(result)).toMatchObject({
                    __typename: 'Order',
                    state: 'PaymentSettled',
                });
                expect(fresh.status).toBe('USED');
                expect(fresh.usedAt?.getTime()).toBe(paidAt);
                const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
                const paidOrder = await connection.rawConnection
                    .getRepository(Order)
                    .findOneByOrFail({ id: strategy.decodeId(order.id) });
                const promotion = await connection.rawConnection
                    .getRepository(Promotion)
                    .findOneByOrFail({ id: fresh.promotionId });
                expect(await customerCouponEntitlement.check(ctx, paidOrder, [], promotion)).toBe(true);
            } else {
                expect(result.__typename).toBe('PaymentFailedError');
                expect(fresh.status).toBe('LOCKED');
                expect((await shopClient.query(AUDIT_ORDER)).activeOrder).toEqual(order);
            }
        },
    );

    it('releases entitlement, allocation and ledger through the native removeCouponCode entry', async () => {
        await auditCustomer('closure-native-remove');
        const coupon = await auditClaim({ name: 'Closure native removal' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        const before = (await shopClient.query(AUDIT_ORDER)).activeOrder;
        const result = await shopClient.query(
            gql`
                mutation ($code: String!) {
                    removeCouponCode(couponCode: $code) {
                        ... on Order {
                            couponCodes
                            totalWithTax
                        }
                    }
                }
            `,
            { code: before.couponCodes[0] },
        );
        expect(result.removeCouponCode.couponCodes).toEqual([]);
        expect(result.removeCouponCode.totalWithTax).toBeGreaterThan(before.totalWithTax);
        const connection = server.app.get(TransactionalConnection);
        const id = server.app.get(ConfigService).entityOptions.entityIdStrategy.decodeId(coupon.id);
        const fresh = await connection.rawConnection.getRepository(CustomerCoupon).findOneByOrFail({ id });
        expect(fresh.status).toBe('AVAILABLE');
        expect(fresh.lockedOrderId).toBeNull();
        const allocation = await connection.rawConnection
            .getRepository(CouponOrderAllocation)
            .findOneByOrFail({ customerCouponId: id });
        expect(allocation.status).toBe('RELEASED');
    });

    it('keeps a manual payment receipt and original discount when actual payment time cannot be verified', async () => {
        await auditCustomer('closure-manual-time');
        const coupon = await auditClaim({ name: 'Closure manual payment' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        await prepareOrderForPayment();
        const before = (await shopClient.query(AUDIT_ORDER)).activeOrder;
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
        const result = await adminClient.query(
            gql`
                mutation ($input: ManualPaymentInput!) {
                    addManualPaymentToOrder(input: $input) {
                        __typename
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    orderId: before.id,
                    method: 'manual coupon QA',
                    transactionId: 'closure-manual-receipt',
                    metadata: { paidAt: '2026-01-01T00:00:00Z' },
                },
            },
        );
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
        expect(result.addManualPaymentToOrder.__typename).toBe('ManualPaymentStateError');
        expect(result.addManualPaymentToOrder.message).toContain('人工核对');
        expect((await shopClient.query(AUDIT_ORDER)).activeOrder).toEqual(before);
        const payment = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Payment)
            .findOneByOrFail({ transactionId: 'closure-manual-receipt' });
        expect(payment.state).toBe('Error');
        expect(payment.amount).toBe(before.totalWithTax);
        expect(payment.metadata.manualReview.required).toBe(true);
    });

    it('reports payment-pending coupons as skipped during bulk revocation', async () => {
        await auditCustomer('closure-revoke-pending');
        const coupon = await auditClaim({ name: 'Closure pending skip' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        await prepareOrderForPayment();
        const result = await adminClient.query(
            gql`
                mutation ($id: ID!, $password: String!) {
                    revokeStoreCouponCampaignOutstanding(id: $id, password: $password) {
                        affectedCount
                        skippedCount
                        failedCount
                        outcomes {
                            reason
                        }
                    }
                }
            `,
            { id: coupon.campaignId, password: SUPER_ADMIN_USER_PASSWORD },
        );
        expect(result.revokeStoreCouponCampaignOutstanding).toMatchObject({
            affectedCount: 0,
            skippedCount: 1,
            failedCount: 0,
        });
        expect(result.revokeStoreCouponCampaignOutstanding.outcomes[0].reason).toContain('付款');
        expect(
            (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                (item: any) => item.id === coupon.id,
            ).status,
        ).toBe('LOCKED');
    });

    it('preserves received funds when a coupon becomes invalid between preflight and confirmation', async () => {
        await auditCustomer('closure-confirmation-review');
        const coupon = await auditClaim({ name: 'Closure confirmation review' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        await prepareOrderForPayment();
        const connection = server.app.get(TransactionalConnection);
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        const original = couponPaymentHandler.createPayment.bind(couponPaymentHandler);
        const spy = vi
            .spyOn(couponPaymentHandler, 'createPayment')
            .mockImplementationOnce(async (...args) => {
                await connection
                    .getRepository(args[0], CustomerCoupon)
                    .update(strategy.decodeId(coupon.id), { validUntil: new Date(Date.now() - 1000) });
                return original(...args);
            });
        try {
            const result = (await shopClient.query(PAY, { method: couponPaymentHandler.code }))
                .addPaymentToOrder;
            expect(result.__typename).toBe('PaymentFailedError');
            const order = (await shopClient.query(AUDIT_ORDER)).activeOrder;
            const stored = await connection.rawConnection
                .getRepository(Order)
                .findOneOrFail({ where: { id: strategy.decodeId(order.id) }, relations: { payments: true } });
            expect(stored.payments).toHaveLength(1);
            expect(stored.payments[0]).toMatchObject({
                state: 'Error',
                metadata: { manualReview: { required: true, receivedState: 'Settled' } },
            });
            expect(stored.payments[0].amount).toBe(order.totalWithTax);
            expect(
                (await shopClient.query(PAY, { method: couponPaymentHandler.code })).addPaymentToOrder
                    .__typename,
            ).toBe('PaymentFailedError');
            expect(
                await connection.rawConnection.getRepository(Order).findOneOrFail({
                    where: { id: strategy.decodeId(order.id) },
                    relations: { payments: true },
                }),
            ).toMatchObject({ payments: [{ id: stored.payments[0].id }] });
        } finally {
            spy.mockRestore();
        }
    });

    it('previews, verifies and idempotently repairs an orphan allocation with the v2 tool', async () => {
        await auditCustomer('closure-repair');
        const coupon = await auditClaim({ name: 'Closure repair' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        const repository = server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(CustomerCoupon);
        // Reproduce the historical revocation bug, retaining the order's old discount and LOCKED allocation.
        await repository.update(strategy.decodeId(coupon.id), {
            status: 'REVOKED',
            revokedAt: new Date(),
            lockedOrderId: null,
            lockedAt: null,
            lockExpiresAt: null,
        });
        const query = gql`
            query ($id: ID!) {
                storeCouponClosureRepairPreview(campaignId: $id)
            }
        `;
        const mutation = gql`
            mutation ($id: ID!, $fingerprint: String!, $password: String!) {
                repairStoreCouponClosure(campaignId: $id, fingerprint: $fingerprint, password: $password)
            }
        `;
        const plan = (await adminClient.query(query, { id: coupon.campaignId }))
            .storeCouponClosureRepairPreview;
        expect(plan.repairVersion).toBe('coupon-closure-v2');
        expect(plan.items[0].actions).toEqual([expect.objectContaining({ type: 'RELEASE_ALLOCATION' })]);
        await expect(
            adminClient.query(mutation, {
                id: coupon.campaignId,
                fingerprint: 'outdated',
                password: SUPER_ADMIN_USER_PASSWORD,
            }),
        ).rejects.toThrow('重新核对');
        const result = (
            await adminClient.query(mutation, {
                id: coupon.campaignId,
                fingerprint: plan.fingerprint,
                password: SUPER_ADMIN_USER_PASSWORD,
            })
        ).repairStoreCouponClosure;
        expect(result).toMatchObject({ changedCoupons: 1, conflicts: [] });
        expect(result.after.items[0].actions).toEqual([]);
        expect((await shopClient.query(AUDIT_ORDER)).activeOrder.couponCodes).toEqual([]);
        const repeated = (
            await adminClient.query(mutation, {
                id: coupon.campaignId,
                fingerprint: result.after.fingerprint,
                password: SUPER_ADMIN_USER_PASSWORD,
            })
        ).repairStoreCouponClosure;
        expect(repeated.changedCoupons).toBe(0);
        const changed = await repository.findOneByOrFail({ id: strategy.decodeId(coupon.id) });
        expect(changed.status).toBe('REVOKED');
    });

    it('processes expiry and repair previews beyond a full maintenance batch', async () => {
        await auditCustomer('closure-maintenance-pages');
        const coupon = await auditClaim({ name: 'Closure maintenance pages', issueLimit: 1000 });
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        const repository = server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(CustomerCoupon);
        const seed = await repository.findOneByOrFail({ id: strategy.decodeId(coupon.id) });
        await repository.update(seed.id, { validUntil: new Date(Date.now() - 1000) });
        await repository.save(
            Array.from({ length: 500 }, () =>
                repository.create({
                    ...seed,
                    id: undefined,
                    version: 1,
                    validUntil: new Date(Date.now() - 1000),
                }),
            ),
        );
        await server.app.get(StoreCouponLifecycleService).reconcile();
        expect(await repository.count({ where: { promotionId: seed.promotionId, status: 'EXPIRED' } })).toBe(
            501,
        );
        const result = (
            await adminClient.query(
                gql`
                    query ($id: ID!) {
                        storeCouponClosureRepairPreview(campaignId: $id)
                    }
                `,
                { id: coupon.campaignId },
            )
        ).storeCouponClosureRepairPreview;
        expect(result.items).toHaveLength(501);
        expect(result.items.every((item: any) => item.actions.length === 0)).toBe(true);
    }, 30_000);

    it('repairs a proven full-refund callback gap without extending the original expiry', async () => {
        await auditCustomer('closure-missed-refund');
        const coupon = await auditClaim({ name: 'Closure missed refund' });
        const paid = await auditPay(coupon.id);
        const lifecycle = server.app.get(StoreCouponLifecycleService);
        const skipped = vi.spyOn(lifecycle, 'handleSettledRefund').mockResolvedValueOnce(undefined);
        try {
            await auditRefund(paid);
        } finally {
            skipped.mockRestore();
        }
        const plan = (
            await adminClient.query(
                gql`
                    query ($id: ID!) {
                        storeCouponClosureRepairPreview(campaignId: $id)
                    }
                `,
                { id: coupon.campaignId },
            )
        ).storeCouponClosureRepairPreview;
        expect(plan.items[0].actions).toEqual([expect.objectContaining({ type: 'REFUND' })]);
        const repaired = (
            await adminClient.query(
                gql`
                    mutation ($id: ID!, $fingerprint: String!, $password: String!) {
                        repairStoreCouponClosure(
                            campaignId: $id
                            fingerprint: $fingerprint
                            password: $password
                        )
                    }
                `,
                { id: coupon.campaignId, fingerprint: plan.fingerprint, password: SUPER_ADMIN_USER_PASSWORD },
            )
        ).repairStoreCouponClosure;
        expect(repaired).toMatchObject({ changedCoupons: 1, conflicts: [] });
        expect((await shopClient.query(MY_COUPONS)).myStorefrontCoupons[0]).toMatchObject({
            status: 'RETURNED',
            validUntil: coupon.validUntil,
            returnCount: 1,
        });
        expect(repaired.after.items[0].actions).toEqual([]);
    });

    it.runIf(process.env.DB === 'mysql')(
        'serializes a claim with campaign disable and keeps the issued campaign enabled',
        async () => {
            await auditCustomer('closure-disable-race');
            const created = (
                await adminClient.query(CREATE_COUPON, {
                    input: {
                        name: 'Closure claim disable race',
                        kind: 'ORDER_FIXED',
                        minimumSpend: 0,
                        discountAmount: 500,
                        issueLimit: 1,
                        validityDays: 7,
                    },
                })
            ).createStoreCouponCampaign;
            const lifecycle = server.app.get(StoreCouponLifecycleService);
            const campaigns = server.app.get(StorePromotionCampaignService);
            const originalLock = lifecycle.lockRow.bind(lifecycle);
            const originalCampaignLock = campaigns.lockOwnedCampaign.bind(campaigns);
            let reached!: () => void;
            let release!: () => void;
            const locked = new Promise<void>(resolve => {
                reached = resolve;
            });
            const queued = new Promise<void>(resolve => {
                release = resolve;
            });
            const claimSpy = vi.spyOn(lifecycle, 'lockRow').mockImplementation(async (...args: any[]) => {
                const result = await originalLock(...args);
                if (args[1] === StoreCouponCampaignConfig) {
                    reached();
                    await queued;
                }
                return result;
            });
            const mutationSpy = vi
                .spyOn(campaigns, 'lockOwnedCampaign')
                .mockImplementation((...args: any[]) => {
                    release();
                    return originalCampaignLock(...args);
                });
            const claim = shopClient.query(CLAIM, { campaignId: created.id });
            try {
                await locked;
                const disable = adminClient.query(
                    gql`
                        mutation ($id: ID!, $password: String!) {
                            setStorePromotionEnabled(id: $id, enabled: false, password: $password) {
                                id
                            }
                        }
                    `,
                    { id: created.id, password: SUPER_ADMIN_USER_PASSWORD },
                );
                await expect(disable).rejects.toThrow('已经发放');
                expect((await claim).claimStorefrontCoupon.status).toBe('AVAILABLE');
            } finally {
                release();
                claimSpy.mockRestore();
                mutationSpy.mockRestore();
                await claim.catch(() => undefined);
            }
        },
        30_000,
    );

    it('rejects an expired entitlement before charging a prepared order', async () => {
        await auditCustomer('closure-expiry');
        const coupon = await auditClaim({ name: 'Closure expiry' });
        await shopClient.query(ADD_ITEM, { productVariantId });
        await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
        await prepareOrderForPayment();
        const connection = server.app.get(TransactionalConnection);
        const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        await connection.rawConnection.getRepository(CustomerCoupon).update(strategy.decodeId(coupon.id), {
            validUntil: new Date(Date.now() - 1000),
        });
        const result = (await shopClient.query(PAY, { method: couponPaymentHandler.code })).addPaymentToOrder;
        expect(result.__typename).toBe('CouponRemovedDuringCheckoutError');
        const stored = await connection.rawConnection.getRepository(CustomerCoupon).findOneByOrFail({
            id: strategy.decodeId(coupon.id),
        });
        expect(stored.status).toBe('EXPIRED');
        const allocation = await connection.rawConnection
            .getRepository(CouponOrderAllocation)
            .findOneByOrFail({
                customerCouponId: stored.id,
            });
        expect(allocation.status).toBe('RELEASED');
    });

    it.runIf(process.env.DB === 'mysql').each(['same-customer', 'different-customers'])(
        'prevents duplicate claims and oversubscription with concurrent snapshots: %s',
        async mode => {
            const secondClient = new SimpleGraphQLClient(config, (shopClient as any).apiUrl);
            if (mode === 'different-customers') {
                await secondClient.query(REGISTER, {
                    input: {
                        emailAddress: 'coupon-audit-closure-claims-second@example.com',
                        firstName: 'Second',
                        lastName: 'Claim',
                        password: 'CouponAudit123!',
                    },
                });
                await secondClient.asUserWithCredentials(
                    'coupon-audit-closure-claims-second@example.com',
                    'CouponAudit123!',
                );
            }
            await auditCustomer('closure-claims-' + mode);
            const created = (
                await adminClient.query(CREATE_COUPON, {
                    input: {
                        name: 'Closure last coupon',
                        kind: 'ORDER_FIXED',
                        discountAmount: 1000,
                        validityDays: 7,
                        issueLimit: 1,
                    },
                })
            ).createStoreCouponCampaign;
            const lifecycle = server.app.get(StoreCouponLifecycleService);
            const original = lifecycle.lockRow.bind(lifecycle);
            const gate = twoPartyGate();
            const spy = vi.spyOn(lifecycle, 'lockRow').mockImplementation(async (...args: any[]) => {
                if (args[1] === StoreCouponCampaignConfig) await gate();
                return original(...args);
            });
            try {
                const results = await Promise.allSettled([
                    shopClient.query(CLAIM, { campaignId: created.id }),
                    (mode === 'same-customer' ? shopClient : secondClient).query(CLAIM, {
                        campaignId: created.id,
                    }),
                ]);
                expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
                const connection = server.app.get(TransactionalConnection);
                const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
                expect(
                    await connection.rawConnection.getRepository(CustomerCoupon).countBy({
                        promotionId: strategy.decodeId(created.id),
                    }),
                ).toBe(1);
            } finally {
                spy.mockRestore();
            }
        },
    );

    it.runIf(process.env.DB === 'mysql').each(['same-payment', 'different-payments'])(
        'returns a coupon when distinct concurrent refunds together cover the paid order: %s',
        async mode => {
            await auditCustomer('closure-split-refunds-' + mode);
            const coupon = await auditClaim({ name: 'Closure split refunds' });
            let paid: any;
            if (mode === 'different-payments') {
                await shopClient.query(ADD_ITEM, { productVariantId });
                await shopClient.query(APPLY_OWNED_COUPON, { id: coupon.id });
                await prepareOrderForPayment();
                const originalPayment = couponPaymentHandler.createPayment.bind(couponPaymentHandler);
                const split = vi
                    .spyOn(couponPaymentHandler, 'createPayment')
                    .mockImplementationOnce(async (...args) => {
                        const result = await originalPayment(...args);
                        return { ...result, amount: Math.floor(result.amount / 2) };
                    });
                try {
                    expect(
                        (await shopClient.query(PAY, { method: couponPaymentHandler.code })).addPaymentToOrder
                            .state,
                    ).toBe('ArrangingPayment');
                } finally {
                    split.mockRestore();
                }
                paid = await payOrder();
                expect(paid.payments).toHaveLength(2);
            } else paid = await auditPay(coupon.id);
            const refunds: any[] = [];
            adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
            deferRefunds = true;
            try {
                const parts =
                    mode === 'different-payments'
                        ? paid.payments
                        : [Math.floor(paid.totalWithTax / 2), Math.ceil(paid.totalWithTax / 2)].map(
                              amount => ({ id: paid.payments[0].id, amount }),
                          );
                for (const part of parts) {
                    const result = (
                        await adminClient.query(REFUND, {
                            input: {
                                paymentId: part.id,
                                amount: part.amount,
                                lines: [],
                                shipping: 0,
                                adjustment: 0,
                                reason: 'Disposable split refund',
                            },
                        })
                    ).refundOrder;
                    expect(result, JSON.stringify(result)).toMatchObject({ state: 'Pending' });
                    refunds.push(result);
                }
                const connection = server.app.get(TransactionalConnection);
                const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
                const ids = new Set(refunds.map(refund => String(strategy.decodeId(refund.id))));
                const original = connection.getEntityOrThrow.bind(connection);
                const gate = twoPartyGate();
                const seen = new Set<string>();
                const spy = vi.spyOn(connection, 'getEntityOrThrow').mockImplementation((async (
                    ...args: any[]
                ) => {
                    const value = await (original as any)(...args);
                    if (args[1] === Refund && ids.has(String(args[2])) && !seen.has(String(args[2]))) {
                        seen.add(String(args[2]));
                        await gate();
                    }
                    return value;
                }) as any);
                try {
                    await Promise.all(
                        refunds.map(refund =>
                            adminClient.query(
                                gql`
                                    mutation ($input: SettleRefundInput!) {
                                        settleRefund(input: $input) {
                                            __typename
                                            ... on Refund {
                                                id
                                                state
                                            }
                                            ... on ErrorResult {
                                                message
                                            }
                                        }
                                    }
                                `,
                                { input: { id: refund.id, transactionId: 'closure-' + refund.id } },
                            ),
                        ),
                    );
                } finally {
                    spy.mockRestore();
                }
                const mine = (await shopClient.query(MY_COUPONS)).myStorefrontCoupons;
                expect(mine.find((item: any) => item.id === coupon.id)).toMatchObject({
                    status: 'RETURNED',
                    returnCount: 1,
                });
            } finally {
                deferRefunds = false;
                adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
            }
        },
        30_000,
    );

    it.runIf(process.env.DB === 'mysql')(
        'does not overwrite a paid coupon from a stale batch revocation snapshot',
        async () => {
            await auditCustomer('closure-revoke-race');
            const coupon = await auditClaim({ name: 'Closure revoke race' });
            const lifecycle = server.app.get(StoreCouponLifecycleService);
            const original = lifecycle.revokeCoupon.bind(lifecycle);
            let reached!: () => void;
            let resume!: () => void;
            const paused = new Promise<void>(resolve => {
                reached = resolve;
            });
            const released = new Promise<void>(resolve => {
                resume = resolve;
            });
            const spy = vi.spyOn(lifecycle, 'revokeCoupon').mockImplementation(async (...args: any[]) => {
                reached();
                await released;
                return original(...args);
            });
            const revoked = adminClient.query(
                gql`
                    mutation ($id: ID!, $password: String!) {
                        revokeStoreCouponCampaignOutstanding(id: $id, password: $password) {
                            affectedCount
                        }
                    }
                `,
                { id: coupon.campaignId, password: SUPER_ADMIN_USER_PASSWORD },
            );
            try {
                await paused;
                await auditPay(coupon.id);
                resume();
                expect((await revoked).revokeStoreCouponCampaignOutstanding.affectedCount).toBe(0);
                expect(
                    (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                        (item: any) => item.id === coupon.id,
                    ).status,
                ).toBe('USED');
            } finally {
                resume();
                spy.mockRestore();
                await revoked.catch(() => undefined);
            }
        },
        30_000,
    );

    it.runIf(process.env.DB === 'mysql')(
        'serializes repeated refund events with database row locks',
        async () => {
            await auditCustomer('concurrent-refund');
            const coupon = await auditClaim({ name: 'Audit concurrent refunds' });
            const paid = await auditPay(coupon.id);
            const refunded = await auditRefund(paid);
            const connection = server.app.get(TransactionalConnection);
            const contexts = server.app.get(RequestContextService);
            const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
            const refund = await connection.rawConnection
                .getRepository(Refund)
                .findOneByOrFail({ id: strategy.decodeId(refunded.id) });
            const order = await connection.rawConnection
                .getRepository(Order)
                .findOneByOrFail({ id: strategy.decodeId(paid.id) });
            // Restore the pre-callback entitlement only in this disposable test database.
            await connection.rawConnection
                .getRepository(CustomerCoupon)
                .update(strategy.decodeId(coupon.id), {
                    status: 'USED',
                    usedOrderId: order.id,
                    returnCount: 0,
                });
            const eventBus = server.app.get(EventBus);
            const replay = async () => {
                const ctx = await contexts.create({ apiType: 'admin' });
                await connection.withTransaction(ctx, tx =>
                    eventBus.publish(new RefundStateTransitionEvent('Pending', 'Settled', tx, refund, order)),
                );
            };
            await Promise.all([replay(), replay()]);
            expect(
                (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                    (item: any) => item.id === coupon.id,
                ),
            ).toMatchObject({ status: 'RETURNED', returnCount: 1, usedOrderId: null });
        },
        30_000,
    );
});

function twoPartyGate() {
    let arrived = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    return async () => {
        arrived++;
        if (arrived === 2) release();
        await pending;
    };
}

async function prepareOrderForPayment(): Promise<any> {
    await shopClient.query(SET_ADDRESS);
    const shipping = await shopClient.query(ELIGIBLE_SHIPPING);
    const shippingResult = await shopClient.query(SET_SHIPPING, {
        id: [shipping.eligibleShippingMethods[0].id],
    });
    assertSuccess(shippingResult.setOrderShippingMethod);
    const transitioned = await shopClient.query(TRANSITION);
    assertSuccess(transitioned.transitionOrderToState);
    return transitioned.transitionOrderToState;
}

async function payOrder(): Promise<any> {
    const paid = await shopClient.query(PAY, { method: couponPaymentHandler.code });
    assertSuccess(paid.addPaymentToOrder);
    expect(paid.addPaymentToOrder.state).toBe('PaymentSettled');
    return paid.addPaymentToOrder;
}

function campaign(result: any, targetCampaignId = campaignId): any {
    return result.activeStorefrontCoupons.find((item: any) => item.id === targetCampaignId);
}

function assertSuccess(result: { __typename?: string; message?: string }): void {
    if (result.__typename?.endsWith('Error')) {
        throw new Error(`${result.__typename}: ${result.message ?? 'unknown error'}`);
    }
}

const AUDIT_ORDER = gql`
    query {
        activeOrder {
            id
            totalWithTax
            couponCodes
        }
    }
`;

async function auditCustomer(suffix: string) {
    await shopClient.query(LOGOUT);
    const emailAddress = 'coupon-audit-' + suffix + '@example.com';
    await shopClient.query(REGISTER, {
        input: { emailAddress, firstName: 'Audit', lastName: suffix, password: 'CouponAudit123!' },
    });
    await shopClient.asUserWithCredentials(emailAddress, 'CouponAudit123!');
}

async function auditClaim(overrides: Record<string, unknown>) {
    const created = await adminClient.query(CREATE_COUPON, {
        input: {
            name: 'Audit coupon',
            kind: 'ORDER_FIXED',
            minimumSpend: 0,
            discountAmount: 1000,
            validityDays: 7,
            issueLimit: 20,
            usageLimit: 20,
            perCustomerUsageLimit: 1,
            stackPolicy: 'EXCLUSIVE',
            returnOnCancellation: true,
            returnOnFullRefund: true,
            ...overrides,
        },
    });
    return (await shopClient.query(CLAIM, { campaignId: created.createStoreCouponCampaign.id }))
        .claimStorefrontCoupon;
}

async function auditPay(couponId: string) {
    await shopClient.query(ADD_ITEM, { productVariantId });
    await shopClient.query(APPLY_OWNED_COUPON, { id: couponId });
    await prepareOrderForPayment();
    return payOrder();
}

async function auditRefund(order: any) {
    adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
    try {
        const result = (
            await adminClient.query(REFUND, {
                input: {
                    paymentId: order.payments[0].id,
                    amount: order.totalWithTax,
                    lines: [],
                    shipping: 0,
                    adjustment: 0,
                    reason: 'Disposable coupon audit refund',
                },
            })
        ).refundOrder;
        expect(result.state).toBe('Settled');
        return result;
    } finally {
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
    }
}
