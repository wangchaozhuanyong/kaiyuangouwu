import { LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    ConfigService,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    Release,
    RequestContextService,
    RoleService,
    StockLevel,
    StockLocation,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentBlock, StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { CouponOrderAllocation } from '../src/entities/coupon-order-allocation.entity';
import { StoreProfile } from '../src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../src/store-management.plugin';

// This private environment uses only disposable merchant, customer and inventory fixtures.
// It does not alter the legacy lifecycle/payment/refund suite or relax production guards.
const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    plugins: [
        OperationsDashboardPlugin,
        StoreDomainPlugin,
        StorefrontCartPlugin,
        StorefrontContentPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'coupon-projection-fixture',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'coupon-projection-fixture',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'synthetic-projection-signing-secret-32-characters',
        }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const fixtureChannelToken = 'coupon-projection-live-fixture';
let productVariantId = '';
function configuredEntityIdStrategy() {
    const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
    if (!strategy) throw new Error('Entity ID strategy is missing from the test configuration');
    return strategy;
}

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
            appearanceTheme
            perCustomerClaimLimit
            returnOnFullRefund
        }
    }
`;

const REGISTER = gql`
    mutation CouponE2ERegister($input: RegisterCustomerInput!) {
        registerCustomerWithReferral(
            input: $input
            consent: { termsAccepted: true, privacyAcknowledged: true, locale: "zh" }
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

const LOGOUT = gql`
    mutation CouponE2ELogout {
        logout {
            success
        }
    }
`;

const COUPON_FIELDS = gql`
    fragment CouponE2ECustomerCoupon on StoreCustomerCoupon {
        id
        campaignId
        appearanceTheme
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

beforeAll(async () => {
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            collections: [],
            paymentMethods: [],
        },
        customerCount: 0,
    });
    await server.app.get(TransactionalConnection).rawConnection.synchronize();
    await adminClient.asSuperAdmin();
    adminClient.setRequestHeader('x-vendure-sensitive-action-password', SUPER_ADMIN_USER_PASSWORD);
    try {
        await adminClient.query(gql`
            mutation {
                updateGlobalSettings(input: { availableLanguages: [en, zh_Hans] }) {
                    ... on GlobalSettings {
                        availableLanguages
                    }
                }
            }
        `);
    } finally {
        adminClient.setRequestHeader('x-vendure-sensitive-action-password', null);
    }
    const created = await adminClient.query(
        gql`
            mutation ($token: String!) {
                createChannel(
                    input: {
                        code: $token
                        token: $token
                        defaultLanguageCode: zh_Hans
                        currencyCode: USD
                        pricesIncludeTax: false
                        defaultTaxZoneId: "T_1"
                        defaultShippingZoneId: "T_1"
                    }
                ) {
                    ... on Channel {
                        id
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `,
        { token: fixtureChannelToken },
    );
    expect(created.createChannel.id, created.createChannel.message).toBeTruthy();
    const connection = server.app.get(TransactionalConnection);
    const platformCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    const channelId = configuredEntityIdStrategy().decodeId(created.createChannel.id);
    const stockLocations = await connection.rawConnection.getRepository(StockLocation).find();
    for (const location of stockLocations)
        await server.app
            .get(ChannelService)
            .assignToChannels(platformCtx, StockLocation, location.id, [channelId]);
    const roles = server.app.get(RoleService);
    await roles.assignRoleToChannel(platformCtx, (await roles.getCustomerRole(platformCtx)).id, channelId);
    const ctx = await server.app
        .get(RequestContextService)
        .create({ apiType: 'admin', channelOrToken: fixtureChannelToken });
    for (const code of ['terms', 'privacy']) {
        await connection.getRepository(ctx, StorefrontContentBlock).save(
            new StorefrontContentBlock({
                channelId,
                code,
                type: 'LEGAL',
                enabled: true,
                translations: [],
            }),
        );
    }
    await connection
        .getRepository(ctx, StoreProfile)
        .save(new StoreProfile({ channelId, status: 'ACTIVE', descriptionZh: '', descriptionEn: '' }));
    await connection.getRepository(ctx, StoreDomain).save(
        new StoreDomain({
            channelId,
            domain: 'coupon-projection.example.test',
            isPrimary: true,
            primaryChannelId: channelId,
            status: 'ACTIVE',
            verificationToken: 'synthetic-projection-domain-token',
            verifiedAt: new Date(),
        }),
    );
    adminClient.setChannelToken(fixtureChannelToken);
    shopClient.setChannelToken(fixtureChannelToken);
    const product = await adminClient.query(CREATE_PRODUCT, {
        input: {
            enabled: true,
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: '合成优惠移交商品',
                    slug: 'synthetic-managed-projection',
                    description: '仅供本地订单移交回归的合成商品',
                },
            ],
        },
    });
    const variants = await adminClient.query(CREATE_PRODUCT_VARIANTS, {
        input: [
            {
                productId: product.createProduct.id,
                enabled: true,
                sku: 'SYNTHETIC-MANAGED-PROJECTION',
                price: 10000,
                stockOnHand: 100,
                trackInventory: 'TRUE',
                optionIds: [],
                translations: [{ languageCode: LanguageCode.zh_Hans, name: '合成商品规格' }],
            },
        ],
    });
    productVariantId = variants.createProductVariants[0].id;
}, TEST_SETUP_TIMEOUT_MS);
afterAll(() => server.destroy());

describe('managed coupon administration and projection transfer', () => {
    it('changes unissued coupon eligibility through the password-protected managed entry', async () => {
        const created = await adminClient.query(CREATE_COUPON, {
            input: {
                name: '客户资格修改验收券',
                kind: 'ORDER_FIXED',
                minimumSpend: 10_000,
                discountAmount: 1_000,
                issueLimit: 10,
                validityDays: 7,
            },
        });
        const id = created.createStoreCouponCampaign.id;
        const mutation = gql`
            mutation CouponE2ESetEligibility(
                $id: ID!
                $eligibility: StoreCouponCustomerEligibility!
                $password: String!
            ) {
                setStoreCouponCustomerEligibility(id: $id, eligibility: $eligibility, password: $password) {
                    id
                    customerEligibility
                }
            }
        `;
        await expect(
            adminClient.query(mutation, { id, eligibility: 'NEW', password: 'incorrect-password' }),
        ).rejects.toThrow();
        const saved = await adminClient.query(mutation, {
            id,
            eligibility: 'NEW',
            password: SUPER_ADMIN_USER_PASSWORD,
        });
        expect(saved.setStoreCouponCustomerEligibility).toEqual({ id, customerEligibility: 'NEW' });
        const anonymous = new SimpleGraphQLClient(config, (shopClient as any).apiUrl);
        anonymous.setChannelToken(fixtureChannelToken);
        const offers = gql`
            query EligibilityCampaigns {
                activeStorefrontCoupons {
                    id
                    customerEligibility
                    claimable
                }
            }
        `;
        const guestOffers = await anonymous.query(offers);
        expect(
            guestOffers.activeStorefrontCoupons.find((coupon: { id: string }) => coupon.id === id),
        ).toBeUndefined();
        const customer = new SimpleGraphQLClient(config, (shopClient as any).apiUrl);
        customer.setChannelToken(fixtureChannelToken);
        await customer.query(REGISTER, {
            input: {
                emailAddress: 'coupon-eligibility-e2e@example.com',
                firstName: 'Eligibility',
                lastName: 'Tester',
                password: 'CouponEligibility123!',
            },
        });
        await customer.asUserWithCredentials('coupon-eligibility-e2e@example.com', 'CouponEligibility123!');
        const active = await customer.query(offers);
        expect(
            active.activeStorefrontCoupons.find((coupon: { id: string }) => coupon.id === id),
        ).toMatchObject({ id, customerEligibility: 'NEW', claimable: true });
        await customer.query(CLAIM, { campaignId: id });
        await expect(
            adminClient.query(mutation, { id, eligibility: 'ALL', password: SUPER_ADMIN_USER_PASSWORD }),
        ).rejects.toThrow('已经发放');
    });

    it('preserves a managed coupon across a stock-history projection replacement', async () => {
        const fixture = await managedProjectionFixture('managed-transfer');
        const input = fixture.purchaseInput('managed-stock-purchase-success');
        const purchased = await fixture.send(input);
        expect(purchased.status, purchased.message).toBe('APPLIED');
        expect(purchased.cart.revision).toBe(fixture.before.revision + 1);
        expect(purchased.cart.checkoutOrder.id).not.toBe(fixture.before.checkoutOrder.id);
        expect(purchased.cart.checkoutOrder.customer).toEqual(fixture.before.checkoutOrder.customer);
        expect(purchased.cart.checkoutOrder.currencyCode).toBe(fixture.before.checkoutOrder.currencyCode);
        expect(purchased.cart.checkoutOrder.lines).toHaveLength(1);
        expect(purchased.cart.checkoutOrder.lines[0].productVariant.id).toBe(productVariantId);
        expect(purchased.cart.checkoutOrder.discounts).toEqual([
            expect.objectContaining({ amountWithTax: -1200 }),
        ]);
        expect(purchased.cart.checkoutOrder.couponCodes).toEqual(fixture.before.checkoutOrder.couponCodes);
        expect(
            (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                (coupon: any) => coupon.id === fixture.coupon.id,
            ),
        ).toMatchObject({ status: 'LOCKED', lockedOrderId: purchased.cart.checkoutOrder.id });
        const allocations = await fixture.allocations();
        expect(allocations).toHaveLength(2);
        expect(allocations.find(item => String(item.orderId) === String(fixture.oldOrderId))).toMatchObject({
            status: 'RELEASED',
            releasedAt: expect.any(Date),
        });
        expect(allocations.find(item => item.status === 'LOCKED')).toMatchObject({
            orderId: fixture.decode(purchased.cart.checkoutOrder.id),
            discountAmountWithTax: 1200,
        });
        expect(await fixture.stockAllocated()).toBe(fixture.allocatedBefore);
        expect(await fixture.releases()).toBe(1);
        const oldLine = await fixture.connection.getRepository(fixture.ctx, OrderLine).findOneOrFail({
            where: { id: fixture.oldLineId },
            relations: { order: true },
        });
        expect(oldLine.order.id).toBe(fixture.oldOrderId);
        expect(
            await fixture.connection
                .getRepository(fixture.ctx, Order)
                .findOneByOrFail({ id: fixture.oldOrderId }),
        ).toMatchObject({ state: 'Cancelled' });

        const repeated = await fixture.send(input);
        expect(repeated.status).toBe('APPLIED');
        expect(repeated.cart).toEqual(purchased.cart);
        expect(await fixture.allocations()).toHaveLength(2);
        expect(await fixture.releases()).toBe(1);
    });

    it('rolls back managed coupon transfer when replacement pricing loses its discount', async () => {
        const fixture = await managedProjectionFixture('managed-rollback');
        const orderCount = await fixture.connection.getRepository(fixture.ctx, Order).count();
        const orders = server.app.get(OrderService);
        const apply = orders.applyCouponCode.bind(orders);
        const failure = vi
            .spyOn(orders, 'applyCouponCode')
            .mockImplementationOnce(async (ctx, orderId, code) => {
                const result = await apply(ctx, orderId, code);
                await orders.removeCouponCode(ctx, orderId, code);
                return result;
            });
        try {
            const rejected = await fixture.send(fixture.purchaseInput('managed-stock-purchase-rejected'));
            expect(rejected).toMatchObject({
                status: 'REJECTED',
                errorCode: 'CART_INPUT_REJECTED',
                cart: fixture.before,
            });
        } finally {
            failure.mockRestore();
        }
        expect(await fixture.read()).toEqual(fixture.before);
        expect(await fixture.connection.getRepository(fixture.ctx, Order).count()).toBe(orderCount);
        expect(await fixture.allocations()).toMatchObject([
            { status: 'LOCKED', orderId: fixture.oldOrderId },
        ]);
        expect(await fixture.stockAllocated()).toBe(fixture.allocatedBefore + 1);
        expect(await fixture.releases()).toBe(0);
        expect(
            (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                (coupon: any) => coupon.id === fixture.coupon.id,
            ),
        ).toMatchObject({ status: 'LOCKED', lockedOrderId: fixture.before.checkoutOrder.id });
        expect(
            await fixture.connection
                .getRepository(fixture.ctx, Order)
                .findOneByOrFail({ id: fixture.oldOrderId }),
        ).toMatchObject({ state: 'AddingItems' });
        const retry = await fixture.send(fixture.purchaseInput('managed-stock-purchase-retry'));
        expect(retry.status, retry.message).toBe('APPLIED');
        expect(retry.cart.revision).toBe(fixture.before.revision + 1);
        expect(retry.cart.checkoutOrder.discounts).toEqual([
            expect.objectContaining({ amountWithTax: -1200 }),
        ]);
    });

    it('continues a managed coupon projection replacement without an ineligible old coupon', async () => {
        const fixture = await managedProjectionFixture('managed-ineligible', { minimumSpend: 15000 });
        const purchased = await fixture.send(fixture.purchaseInput('managed-stock-ineligible-purchase'));
        expect(purchased.status, purchased.message).toBe('APPLIED');
        expect(purchased.cart.revision).toBe(fixture.before.revision + 1);
        expect(purchased.cart.checkoutOrder.id).not.toBe(fixture.before.checkoutOrder.id);
        expect(purchased.cart.checkoutOrder.couponCodes).toEqual([]);
        expect(purchased.cart.checkoutOrder.discounts).toEqual([]);
        expect(
            (await shopClient.query(MY_COUPONS)).myStorefrontCoupons.find(
                (coupon: any) => coupon.id === fixture.coupon.id,
            ),
        ).toMatchObject({ status: 'AVAILABLE', lockedOrderId: null, usedOrderId: null });
        expect(await fixture.allocations()).toMatchObject([
            { status: 'RELEASED', orderId: fixture.oldOrderId },
        ]);
        expect(await fixture.releases()).toBe(1);
    });
});
async function auditCustomer(suffix: string) {
    await shopClient.query(LOGOUT);
    const emailAddress = 'coupon-audit-' + suffix + '@example.com';
    await shopClient.query(REGISTER, {
        input: { emailAddress, firstName: 'Audit', lastName: suffix, password: 'CouponAudit123!' },
    });
    await shopClient.asUserWithCredentials(emailAddress, 'CouponAudit123!');
}

async function managedProjectionFixture(suffix: string, couponOverrides: Record<string, unknown> = {}) {
    await auditCustomer(suffix);
    const coupon = await auditClaim({ name: 'Managed projection ' + suffix, ...couponOverrides });
    const product = await adminClient.query(CREATE_PRODUCT, {
        input: {
            enabled: true,
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: suffix,
                    slug: suffix,
                    description: '合成优惠券订单移交测试商品',
                },
            ],
        },
    });
    const variants = await adminClient.query(CREATE_PRODUCT_VARIANTS, {
        input: [
            {
                productId: product.createProduct.id,
                enabled: true,
                sku: suffix,
                price: 5000,
                stockOnHand: 100,
                trackInventory: 'TRUE',
                optionIds: [],
                translations: [{ languageCode: LanguageCode.zh_Hans, name: suffix }],
            },
        ],
    });
    const otherVariantId = variants.createProductVariants[0].id;
    const fields = `id revision state lines { id quantity selected productVariant { id } }
        checkoutOrder { id state totalWithTax currencyCode customer { id } couponCodes discounts { amountWithTax }
            lines { id quantity productVariant { id } } }`;
    const readQuery = gql`query { storefrontCart { ${fields} } }`;
    const applyCommand = gql`mutation($input: StorefrontCartCommandInput!) {
        applyStorefrontCartCommand(input: $input) { commandId status errorCode message cart { ${fields} } }
    }`;
    const read = async () => (await shopClient.query(readQuery)).storefrontCart;
    const send = async (input: Record<string, unknown>) =>
        (await shopClient.query(applyCommand, { input })).applyStorefrontCartCommand;
    const empty = await read();
    const added = await send({
        cartId: empty.id,
        expectedRevision: empty.revision,
        commandId: suffix + '-add-items',
        changes: {
            add: [
                { productVariantId, quantity: 1 },
                { productVariantId: otherVariantId, quantity: 1 },
            ],
        },
    });
    expect(added.status, added.message).toBe('APPLIED');
    const applied = await send({
        cartId: added.cart.id,
        expectedRevision: added.cart.revision,
        commandId: suffix + '-apply-coupon',
        coupon: { action: 'APPLY', couponId: coupon.id },
    });
    expect(applied.status, applied.message).toBe('APPLIED');
    const connection = server.app.get(TransactionalConnection);
    const ctx = await server.app.get(RequestContextService).create({
        apiType: 'admin',
        channelOrToken: fixtureChannelToken,
    });
    const decode = (id: string) => configuredEntityIdStrategy().decodeId(id);
    const oldOrderId = decode(applied.cart.checkoutOrder.id);
    const oldLineId = decode(
        applied.cart.checkoutOrder.lines.find((line: any) => line.productVariant.id === otherVariantId).id,
    );
    const stockAllocated = async () =>
        (
            await connection.getRepository(ctx, StockLevel).find({
                where: { productVariantId: decode(otherVariantId) },
            })
        ).reduce((total, level) => total + level.stockAllocated, 0);
    const allocatedBefore = await stockAllocated();
    await server.app
        .get(StockMovementService)
        .createAllocationsForOrderLines(ctx, [{ orderLineId: oldLineId, quantity: 1 }]);
    const before = await read();
    const allocations = () =>
        connection.getRepository(ctx, CouponOrderAllocation).find({
            where: { customerCouponId: decode(coupon.id) },
        });
    expect(await allocations()).toMatchObject([
        { status: 'LOCKED', orderId: oldOrderId, discountAmount: 1000, discountAmountWithTax: 1200 },
    ]);
    const releases = () =>
        connection.getRepository(ctx, Release).count({ where: { orderLine: { id: oldLineId } } });
    const purchaseInput = (commandId: string) => ({
        commandId,
        cartId: before.id,
        expectedRevision: before.revision,
        buyNow: { productVariantId, quantity: 1 },
    });
    return {
        coupon,
        before,
        connection,
        ctx,
        decode,
        oldOrderId,
        oldLineId,
        allocatedBefore,
        stockAllocated,
        allocations,
        releases,
        purchaseInput,
        send,
        read,
    };
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
