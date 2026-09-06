import { LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import { mergeConfig, PaymentMethodHandler } from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreManagementPlugin } from '../src/store-management.plugin';

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
    createRefund: (_ctx, _input, amount) => ({
        state: 'Settled',
        transactionId: `coupon-e2e-refund-${amount}`,
        metadata: {},
    }),
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
});

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
