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
            couponCode: 'new-20',
            kind: 'ORDER_FIXED',
            minimumSpend: 10_000,
            discountAmount: 2_000,
            perCustomerUsageLimit: 1,
        });

        expect(harness.createPromotion).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                couponCode: 'NEW-20',
                enabled: true,
                conditions: [
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
                couponCode: 'NEW-20',
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
                imageUrl: '/asset.webp',
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
});

function createHarness({ variants = [], promotions = [] }: { variants?: any[]; promotions?: any[] } = {}) {
    const createPromotion = vi.fn(async (_ctx: unknown, input: CreatePromotionInput) =>
        promotionFromInput(input),
    );
    const promotionService = {
        findAll: vi.fn(async () => ({ items: promotions, totalItems: promotions.length })),
        findOne: vi.fn(async (_ctx: unknown, id: string) =>
            promotions.find(promotion => promotion.id === id),
        ),
        createPromotion,
        updatePromotion: vi.fn(),
        softDeletePromotion: vi.fn(),
    };
    const productVariantService = {
        getVariantsByProductId: vi.fn(async () => ({ items: variants, totalItems: variants.length })),
        findOne: vi.fn(async (_ctx: unknown, id: string) =>
            variants.find(variant => String(variant.id) === String(id)),
        ),
    };
    const connection = {
        findByIdsInChannel: vi.fn(async () => []),
    };
    return {
        createPromotion,
        service: new StorePromotionCampaignService(
            connection as any,
            promotionService as any,
            productVariantService as any,
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
        conditions: input.conditions.map(operationFromInput),
        actions: input.actions.map(operationFromInput),
    } as any;
}

function operationFromInput(input: CreatePromotionInput['actions'][number]) {
    return {
        code: input.code,
        args: Object.fromEntries(
            input.arguments.map(argument => [
                argument.name,
                argument.name === 'variantRules'
                    ? argument.value
                    : argument.value.startsWith('[')
                      ? JSON.parse(argument.value)
                      : argument.value === 'true'
                        ? true
                        : argument.value === 'false'
                          ? false
                          : Number.isNaN(Number(argument.value))
                            ? argument.value
                            : Number(argument.value),
            ]),
        ),
    };
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
        featuredAsset: { preview: '/asset.webp' },
        product: {
            id: 'product-1',
            name: '测试商品',
            featuredAsset: null,
        },
    };
}
