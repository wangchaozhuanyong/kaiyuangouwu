import { CreatePromotionInput } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { CouponLedgerEntry } from '../entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../entities/coupon-order-allocation.entity';

import { StorePromotionCampaignService } from './store-promotion-campaign.service';

const ctx = {
    channelId: 'channel-1',
    languageCode: 'zh_Hans',
    currencyCode: 'CNY',
    channel: { defaultCurrencyCode: 'CNY', customFields: {} },
} as any;

describe('StorePromotionCampaignService', () => {
    it('creates a full-reduction coupon as a real Vendure promotion', async () => {
        const harness = createHarness();

        const coupon = await harness.service.createCoupon(ctx, {
            name: '新客满减',
            kind: 'ORDER_FIXED',
            minimumSpend: 10_000,
            discountAmount: 2_000,
            perCustomerUsageLimit: 1,
        });

        expect(harness.createPromotion).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                couponCode: expect.stringMatching(/^CPN_[A-F0-9]{32}$/),
                enabled: true,
                conditions: [
                    operationInput('store_customer_coupon_entitlement', {}),
                    operationInput('store_currency_minimum_order_amount', {
                        amount: '10000',
                        currencyCode: 'CNY',
                        taxInclusive: 'true',
                    }),
                ],
                actions: [
                    operationInput('store_currency_order_fixed_discount', {
                        discount: '2000',
                        currencyCode: 'CNY',
                    }),
                ],
                perCustomerUsageLimit: 1,
            }),
        );
        expect(coupon).toEqual(
            expect.objectContaining({
                couponCode: expect.stringMatching(/^CPN_[A-F0-9]{32}$/),
                kind: 'ORDER_FIXED',
                minimumSpend: 10_000,
                discountAmount: 2_000,
            }),
        );
    });

    it('creates flash-sale rules for every selected variant and exposes the real sale price', async () => {
        const variant = productVariant('variant-1', 10_000);
        const harness = createHarness({ variants: [variant] });

        const sale = await harness.service.createFlashSale(ctx, {
            name: '周末秒杀',
            productIds: ['product-1'],
            percentageOff: 20,
            startsAt: new Date('2026-08-23T10:00:00.000Z'),
            endsAt: new Date('2026-08-24T10:00:00.000Z'),
        });

        const input = harness.createPromotion.mock.calls[0][1];
        expect(input.conditions[0]).toEqual(
            operationInput('contains_products', {
                minimum: '1',
                productVariantIds: '["variant-1"]',
            }),
        );
        expect(input.actions[0].code).toBe('store_flash_sale_price');
        expect(JSON.parse(input.actions[0].arguments[0].value)).toEqual([
            { variantId: 'variant-1', percentageOff: 20 },
        ]);
        expect(sale.items[0]).toEqual(
            expect.objectContaining({
                productVariantId: 'variant-1',
                originalPrice: 10_000,
                salePrice: 8_000,
                imageUrl: '/assets/preview/product.webp',
            }),
        );
    });

    it('returns an exact flash-sale price in the requested storefront currency', async () => {
        const variant = productVariant('variant-1', 5_991, 'MYR');
        const harness = createHarness({
            variants: [variant],
            promotions: [
                {
                    id: 'flash-sale-1',
                    name: '跨币种秒杀',
                    enabled: true,
                    startsAt: null,
                    endsAt: null,
                    actions: [
                        {
                            code: 'store_flash_sale_price',
                            args: {
                                variantRules: JSON.stringify([{ variantId: 'variant-1', salePrice: 8_000 }]),
                            },
                        },
                    ],
                },
            ],
        });
        const myrContext = {
            ...ctx,
            currencyCode: 'MYR',
            channel: {
                defaultCurrencyCode: 'CNY',
                customFields: {
                    cnyToMyrRate: 0.5991,
                    currencyRateMarkupBps: 0,
                    currencyRoundingMode: 'CENT',
                },
            },
        };

        await expect(harness.service.findFlashSales(myrContext, true)).resolves.toEqual([
            expect.objectContaining({
                items: [
                    expect.objectContaining({
                        originalPrice: 5_991,
                        salePrice: 4_793,
                        currencyCode: 'MYR',
                    }),
                ],
            }),
        ]);
    });

    it('rejects overlapping flash sales for the same variant', async () => {
        const variant = productVariant('variant-1', 10_000);
        const harness = createHarness({
            variants: [variant],
            promotions: [
                {
                    id: 'existing-sale',
                    name: '已有秒杀',
                    enabled: true,
                    startsAt: new Date('2026-08-23T00:00:00.000Z'),
                    endsAt: new Date('2026-08-25T00:00:00.000Z'),
                    actions: [
                        {
                            code: 'store_flash_sale_price',
                            args: {
                                variantRules: JSON.stringify([{ variantId: 'variant-1', percentageOff: 10 }]),
                            },
                        },
                    ],
                },
            ],
        });

        await expect(
            harness.service.createFlashSale(ctx, {
                name: '重叠秒杀',
                productIds: ['product-1'],
                percentageOff: 20,
                startsAt: new Date('2026-08-24T00:00:00.000Z'),
                endsAt: new Date('2026-08-26T00:00:00.000Z'),
            }),
        ).rejects.toThrow('时间重叠');
        expect(harness.createPromotion).not.toHaveBeenCalled();
    });

    it('loads promotions in pages that respect the production list limit', async () => {
        const promotions = Array.from({ length: 101 }, (_, index) => ({
            id: `promotion-${index + 1}`,
            name: `秒杀活动 ${index + 1}`,
            enabled: true,
            startsAt: null,
            endsAt: null,
            actions: [{ code: 'store_flash_sale_price', args: { variantRules: '[]' } }],
        }));
        const harness = createHarness({ promotions });

        const sales = await harness.service.findFlashSales(ctx, true);

        expect(sales).toHaveLength(10);
        expect(harness.findAllPromotions).toHaveBeenNthCalledWith(1, ctx, { take: 100, skip: 0 });
        expect(harness.findAllPromotions).toHaveBeenNthCalledWith(2, ctx, { take: 100, skip: 100 });
    });

    it('loads every product variant in pages that respect the production list limit', async () => {
        const variants = Array.from({ length: 101 }, (_, index) =>
            productVariant(`variant-${index + 1}`, 10_000 + index),
        );
        const harness = createHarness({ variants });

        await harness.service.createFlashSale(ctx, {
            name: '全规格秒杀',
            productIds: ['product-1'],
            percentageOff: 20,
            startsAt: new Date('2026-08-23T10:00:00.000Z'),
            endsAt: new Date('2026-08-24T10:00:00.000Z'),
        });

        expect(harness.getVariantsByProductId).toHaveBeenNthCalledWith(1, ctx, 'product-1', {
            take: 100,
            skip: 0,
        });
        expect(harness.getVariantsByProductId).toHaveBeenNthCalledWith(2, ctx, 'product-1', {
            take: 100,
            skip: 100,
        });
        const input = harness.createPromotion.mock.calls[0][1];
        expect(JSON.parse(input.actions[0].arguments[0].value)).toHaveLength(101);
    });

    it('refuses to delete a coupon campaign after coupons have been issued', async () => {
        const promotion = couponPromotion();
        const harness = createHarness({ promotions: [promotion], issuedCount: 3 });

        await expect(harness.service.delete(ctx, promotion.id)).rejects.toThrow('已经发放 3 张');
        expect(harness.softDeletePromotion).not.toHaveBeenCalled();
    });

    it('renames a coupon campaign and its customer-facing snapshots', async () => {
        const promotion = couponPromotion();
        const harness = createHarness({ promotions: [promotion] });

        await expect(harness.service.updateName(ctx, promotion.id, '新名称')).resolves.toEqual({
            id: promotion.id,
            name: '新名称',
        });
        expect(harness.updatePromotion).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                id: promotion.id,
                translations: [expect.objectContaining({ name: '新名称' })],
            }),
        );
        expect(harness.updateEntity).toHaveBeenCalledTimes(2);
    });

    it('rejects invalid or excessively large coupon report ranges before querying', async () => {
        const harness = createHarness();

        await expect(
            harness.service.dailyCouponReport(
                ctx,
                new Date('2026-08-26T00:00:00.000Z'),
                new Date('2026-08-26T00:00:00.000Z'),
            ),
        ).rejects.toThrow('结束时间必须晚于开始时间');
        await expect(
            harness.service.dailyCouponReport(
                ctx,
                new Date('2025-01-01T00:00:00.000Z'),
                new Date('2026-08-26T00:00:00.000Z'),
            ),
        ).rejects.toThrow('最多支持 366 天');
    });

    it('merges daily coupon lifecycle, redemption, and refund metrics', async () => {
        const harness = createHarness({
            reportRows: {
                ledger: [
                    {
                        date: '2026-08-25',
                        currencyCode: 'CNY',
                        claimedCount: '4',
                        returnedCount: '1',
                        expiredCount: '2',
                        revokedCount: '0',
                    },
                ],
                usage: [
                    {
                        date: '2026-08-25',
                        currencyCode: 'CNY',
                        redeemedCount: '3',
                        discountAmountTotal: '600',
                        assistedRevenueTotal: '9000',
                    },
                ],
                refund: [{ date: '2026-08-26', currencyCode: 'CNY', refundedCount: '1' }],
            },
        });

        await expect(
            harness.service.dailyCouponReport(
                ctx,
                new Date('2026-08-25T00:00:00.000Z'),
                new Date('2026-08-27T00:00:00.000Z'),
                'campaign-1',
            ),
        ).resolves.toEqual([
            {
                date: '2026-08-25',
                currencyCode: 'CNY',
                claimedCount: 4,
                redeemedCount: 3,
                refundedCount: 0,
                returnedCount: 1,
                expiredCount: 2,
                revokedCount: 0,
                discountAmountTotal: 600,
                assistedRevenueTotal: 9000,
            },
            {
                date: '2026-08-26',
                currencyCode: 'CNY',
                claimedCount: 0,
                redeemedCount: 0,
                refundedCount: 1,
                returnedCount: 0,
                expiredCount: 0,
                revokedCount: 0,
                discountAmountTotal: 0,
                assistedRevenueTotal: 0,
            },
        ]);
    });
});

function createHarness({
    variants = [],
    promotions = [],
    issuedCount = 0,
    reportRows,
}: {
    variants?: any[];
    promotions?: any[];
    issuedCount?: number;
    reportRows?: {
        ledger: any[];
        usage: any[];
        refund: any[];
    };
} = {}) {
    const createPromotion = vi.fn((_ctx: unknown, input: CreatePromotionInput) => promotionFromInput(input));
    const findAllPromotions = vi.fn((_ctx: unknown, options?: { skip?: number; take?: number }) => {
        const skip = options?.skip ?? 0;
        const take = options?.take ?? promotions.length;
        return { items: promotions.slice(skip, skip + take), totalItems: promotions.length };
    });
    const softDeletePromotion = vi.fn();
    const updatePromotion = vi.fn((_ctx: unknown, input: any) => ({
        ...(promotions.find(promotion => promotion.id === input.id) ?? {}),
        id: input.id,
        name: input.translations[0].name,
    }));
    const promotionService = {
        findAll: findAllPromotions,
        findOne: vi.fn((_ctx: unknown, id: string) => promotions.find(promotion => promotion.id === id)),
        createPromotion,
        updatePromotion,
        softDeletePromotion,
    };
    const getVariantsByProductId = vi.fn(
        (_ctx: unknown, _productId: string, options?: { skip?: number; take?: number }) => {
            const skip = options?.skip ?? 0;
            const take = options?.take ?? variants.length;
            return { items: variants.slice(skip, skip + take), totalItems: variants.length };
        },
    );
    const productVariantService = {
        getVariantsByProductId,
        findOne: vi.fn((_ctx: unknown, id: string) =>
            variants.find(variant => String(variant.id) === String(id)),
        ),
    };
    const updateEntity = vi.fn();
    let allocationReportQuery = 0;
    const queryBuilder = (rows: any[]) => {
        const builder = {
            select: vi.fn().mockReturnThis(),
            addSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            groupBy: vi.fn().mockReturnThis(),
            addGroupBy: vi.fn().mockReturnThis(),
            getRawMany: vi.fn().mockResolvedValue(rows),
        };
        return builder;
    };
    const connection = {
        findByIdsInChannel: vi.fn(() => []),
        getRepository: vi.fn((_ctx, entity) => ({
            save: vi.fn((value: unknown) => value),
            find: vi.fn(() => []),
            count: vi.fn(() => issuedCount),
            update: updateEntity,
            createQueryBuilder:
                entity === CouponLedgerEntry
                    ? () => queryBuilder(reportRows?.ledger ?? [])
                    : entity === CouponOrderAllocation
                      ? () =>
                            queryBuilder(
                                allocationReportQuery++ === 0
                                    ? (reportRows?.usage ?? [])
                                    : (reportRows?.refund ?? []),
                            )
                      : undefined,
        })),
    };
    const customerService = {
        findOneByUserId: vi.fn(),
    };
    return {
        createPromotion,
        findAllPromotions,
        getVariantsByProductId,
        softDeletePromotion,
        updateEntity,
        updatePromotion,
        service: new StorePromotionCampaignService(
            connection as any,
            promotionService as any,
            productVariantService as any,
            customerService as any,
            { assetOptions: { assetStorageStrategy: {} } } as any,
        ),
    };
}

function couponPromotion() {
    return {
        id: 'coupon-1',
        name: '已发放优惠券',
        description: '优惠券',
        enabled: true,
        startsAt: null,
        endsAt: null,
        couponCode: 'CPN_123',
        usageLimit: null,
        perCustomerUsageLimit: null,
        conditions: [],
        actions: [{ code: 'order_fixed_discount', args: { discount: 1_000 } }],
    };
}

function promotionFromInput(input: CreatePromotionInput) {
    return {
        id: 'promotion-1',
        name: input.translations[0].name,
        enabled: input.enabled,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        couponCode: input.couponCode ?? null,
        usageLimit: input.usageLimit ?? null,
        perCustomerUsageLimit: input.perCustomerUsageLimit ?? null,
        conditions: input.conditions.map(operation => ({ code: operation.code, args: operation.arguments })),
        actions: input.actions.map(operation => ({ code: operation.code, args: operation.arguments })),
    } as any;
}

function operationInput(code: string, values: Record<string, string>) {
    return {
        code,
        arguments: Object.entries(values).map(([name, value]) => ({ name, value })),
    };
}

function productVariant(id: string, priceWithTax: number, currencyCode = 'CNY') {
    return {
        id,
        name: '默认规格',
        priceWithTax,
        currencyCode,
        featuredAsset: { preview: 'preview/product.webp' },
        product: {
            id: 'product-1',
            name: '测试商品',
            featuredAsset: null,
        },
    };
}
