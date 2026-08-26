import { CreatePromotionInput } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { StorePromotionCampaignService } from './store-promotion-campaign.service';

const ctx = {
    channelId: 'channel-1',
    languageCode: 'zh_Hans',
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
                    operationInput('minimum_order_amount', {
                        amount: '10000',
                        taxInclusive: 'true',
                    }),
                ],
                actions: [operationInput('order_fixed_discount', { discount: '2000' })],
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
});

function createHarness({ variants = [], promotions = [] }: { variants?: any[]; promotions?: any[] } = {}) {
    const createPromotion = vi.fn((_ctx: unknown, input: CreatePromotionInput) => promotionFromInput(input));
    const findAllPromotions = vi.fn((_ctx: unknown, options?: { skip?: number; take?: number }) => {
        const skip = options?.skip ?? 0;
        const take = options?.take ?? promotions.length;
        return { items: promotions.slice(skip, skip + take), totalItems: promotions.length };
    });
    const promotionService = {
        findAll: findAllPromotions,
        findOne: vi.fn((_ctx: unknown, id: string) => promotions.find(promotion => promotion.id === id)),
        createPromotion,
        updatePromotion: vi.fn(),
        softDeletePromotion: vi.fn(),
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
    const connection = {
        findByIdsInChannel: vi.fn(() => []),
        getRepository: vi.fn(() => ({
            save: vi.fn((entity: unknown) => entity),
            find: vi.fn(() => []),
        })),
    };
    const customerService = {
        findOneByUserId: vi.fn(),
    };
    return {
        createPromotion,
        findAllPromotions,
        getVariantsByProductId,
        service: new StorePromotionCampaignService(
            connection as any,
            promotionService as any,
            productVariantService as any,
            customerService as any,
            { assetOptions: { assetStorageStrategy: {} } } as any,
        ),
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

function productVariant(id: string, priceWithTax: number) {
    return {
        id,
        name: '默认规格',
        priceWithTax,
        currencyCode: 'CNY',
        featuredAsset: { preview: 'preview/product.webp' },
        product: {
            id: 'product-1',
            name: '测试商品',
            featuredAsset: null,
        },
    };
}
