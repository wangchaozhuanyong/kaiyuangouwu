/* eslint-disable @typescript-eslint/require-await -- Promotion action mocks preserve async APIs. */
import { ConfigArg, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Collection,
    ProductVariant,
    RequestContextCacheService,
    TransactionalConnection,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CustomerCoupon } from '../entities/customer-coupon.entity';

import {
    collectionPercentageDiscount,
    currencyMinimumOrderAmount,
    currencyOrderFixedDiscount,
    customerCouponEntitlement,
    flashSalePriceAction,
    parseFlashSaleVariantRules,
} from './store-commerce-promotion-actions';

describe('store commerce promotion actions', () => {
    it('exposes Chinese business labels for currency-aware promotion fields', () => {
        const context = {
            languageCode: LanguageCode.zh_Hans,
            channel: { defaultLanguageCode: LanguageCode.zh_Hans },
        } as any;

        expect(currencyMinimumOrderAmount.toGraphQlType(context)).toMatchObject({
            description: '订单商品小计满指定币种金额',
            args: [
                { name: 'amount', label: '最低商品小计' },
                { name: 'currencyCode', label: '金额币种' },
                { name: 'taxInclusive', label: '按含税商品小计判断' },
            ],
        });
        expect(currencyOrderFixedDiscount.toGraphQlType(context)).toMatchObject({
            description: '订单按指定币种固定金额立减',
            args: [
                { name: 'discount', label: '固定减免金额' },
                { name: 'currencyCode', label: '减免金额币种' },
            ],
        });
    });

    it('requires a server-side customer coupon entitlement before a promotion can apply', async () => {
        const queryBuilder: Record<string, any> = {};
        for (const method of ['select', 'where', 'andWhere', 'limit']) {
            queryBuilder[method] = vi.fn(() => queryBuilder);
        }
        queryBuilder.getRawOne = vi.fn(async () => ({ id: 'coupon-1' }));
        const getRepository = vi.fn(() => ({ createQueryBuilder: () => queryBuilder }));
        await customerCouponEntitlement.init({
            get: () => ({ getRepository }),
        } as any);

        const ctx = { channelId: 'channel-1' } as any;
        await expect(
            customerCouponEntitlement.check(
                ctx,
                { id: 'order-1', customerId: 'customer-1' } as any,
                [] as any,
                { id: 'promotion-1' } as any,
            ),
        ).resolves.toBe(true);
        expect(getRepository).toHaveBeenCalledWith(ctx, CustomerCoupon);
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
            expect.stringContaining("coupon.status = 'LOCKED'"),
            expect.objectContaining({ orderId: 'order-1', now: expect.any(Date) }),
        );
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
            expect.stringContaining("coupon.status = 'USED'"),
            expect.objectContaining({ orderId: 'order-1', now: expect.any(Date) }),
        );

        queryBuilder.getRawOne.mockResolvedValueOnce(undefined);
        await expect(
            customerCouponEntitlement.check(
                ctx,
                { id: 'order-1', customerId: 'customer-1' } as any,
                [] as any,
                { id: 'promotion-1' } as any,
            ),
        ).resolves.toBe(false);
    });

    it('parses only valid flash-sale variant rules', () => {
        expect(
            parseFlashSaleVariantRules(
                JSON.stringify([
                    { variantId: '1', salePrice: 1_500 },
                    { variantId: '2', percentageOff: 20 },
                    { variantId: '', salePrice: 10 },
                    { variantId: '3' },
                ]),
            ),
        ).toEqual([
            { variantId: '1', salePrice: 1_500, percentageOff: undefined },
            { variantId: '2', salePrice: undefined, percentageOff: 20 },
        ]);
        expect(parseFlashSaleVariantRules('not-json')).toEqual([]);
    });

    it('enforces exact and percentage flash-sale prices without increasing a price', async () => {
        const context = { channel: { pricesIncludeTax: true } } as any;
        const line = {
            unitPrice: 2_000,
            unitPriceWithTax: 2_000,
            productVariant: { id: 'variant-1' },
        } as any;

        expect(
            flashSalePriceAction.execute(
                context,
                line,
                actionArgs({
                    variantRules: JSON.stringify([{ variantId: 'variant-1', salePrice: 1_500 }]),
                }),
                {} as any,
                {} as any,
            ),
        ).toBe(-500);
        expect(
            flashSalePriceAction.execute(
                context,
                line,
                actionArgs({
                    variantRules: JSON.stringify([{ variantId: 'variant-1', percentageOff: 20 }]),
                }),
                {} as any,
                {} as any,
            ),
        ).toBe(-400);
        expect(
            flashSalePriceAction.execute(
                context,
                line,
                actionArgs({
                    variantRules: JSON.stringify([{ variantId: 'variant-1', salePrice: 2_500 }]),
                }),
                {} as any,
                {} as any,
            ),
        ).toBe(-0);
    });

    it('converts an exact flash-sale price into the order currency', () => {
        const context = {
            currencyCode: 'MYR',
            channel: {
                defaultCurrencyCode: 'CNY',
                pricesIncludeTax: true,
                customFields: {
                    cnyToMyrRate: 0.5991,
                    currencyRateMarkupBps: 0,
                    currencyRoundingMode: 'CENT',
                },
            },
        } as any;
        const line = {
            unitPrice: 5_991,
            unitPriceWithTax: 5_991,
            productVariant: { id: 'variant-1' },
        } as any;

        expect(
            flashSalePriceAction.execute(
                context,
                line,
                actionArgs({
                    variantRules: JSON.stringify([{ variantId: 'variant-1', salePrice: 8_000 }]),
                }),
                {} as any,
                {} as any,
            ),
        ).toBe(-1_198);
    });

    it('converts coupon thresholds and fixed discounts into the order currency', async () => {
        const context = {
            currencyCode: 'MYR',
            channel: {
                defaultCurrencyCode: 'CNY',
                pricesIncludeTax: true,
                customFields: {
                    cnyToMyrRate: 0.6,
                    currencyRateMarkupBps: 0,
                    currencyRoundingMode: 'CENT',
                },
            },
        } as any;
        const order = { subTotal: 6_000, subTotalWithTax: 6_000 } as any;

        await expect(
            currencyMinimumOrderAmount.check(
                context,
                order,
                actionArgs({ amount: 10_000, currencyCode: 'CNY', taxInclusive: 'true' }),
                {} as any,
            ),
        ).resolves.toBe(true);
        expect(
            currencyOrderFixedDiscount.execute(
                context,
                order,
                actionArgs({ discount: 2_000, currencyCode: 'CNY' }),
                {} as any,
                {} as any,
            ),
        ).toBe(-1_200);
    });

    it('applies collection discounts only to variants inside a selected category', async () => {
        const findOne = vi.fn(async () => ({ collections: [{ id: 'collection-1' }] }));
        const find = vi.fn(async () => [{ id: 'collection-1', parentId: 'root' }]);
        const cache = new RequestContextCacheService();
        await collectionPercentageDiscount.init({
            get: (token: unknown) =>
                token === TransactionalConnection ? { getRepository: () => ({ findOne, find }) } : cache,
        } as any);
        const context = { channel: { pricesIncludeTax: true } } as any;
        const line = {
            unitPrice: 2_000,
            unitPriceWithTax: 2_000,
            productVariant: { id: 'variant-1' },
        } as any;

        await expect(
            collectionPercentageDiscount.execute(
                context,
                line,
                actionArgs({ discount: 15, collectionIds: ['collection-1'] }),
                {} as any,
                {} as any,
            ),
        ).resolves.toBe(-300);
        await expect(
            collectionPercentageDiscount.execute(
                context,
                line,
                actionArgs({ discount: 15, collectionIds: ['collection-2'] }),
                {} as any,
                {} as any,
            ),
        ).resolves.toBe(0);
    });

    it('covers all descendant levels without discounting unrelated categories or applying twice', async () => {
        const findOne = vi.fn().mockResolvedValue({ collections: [{ id: 'grandchild' }, { id: 'child' }] });
        const find = vi.fn().mockResolvedValue([
            { id: 'parent', parentId: 'root' },
            { id: 'child', parentId: 'parent' },
            { id: 'grandchild', parentId: 'child' },
            { id: 'unrelated', parentId: 'root' },
        ]);
        const getRepository = vi.fn(() => ({ findOne, find }));
        const cache = new RequestContextCacheService();
        await collectionPercentageDiscount.init({
            get: (token: unknown) => (token === TransactionalConnection ? { getRepository } : cache),
        } as any);
        const context = { channelId: 'channel-1', channel: { pricesIncludeTax: true } } as any;
        const line = {
            unitPrice: 1_000,
            unitPriceWithTax: 2_000,
            productVariant: { id: 'variant-1' },
        } as any;
        const discount = (collectionIds: string[], ctx = context) =>
            collectionPercentageDiscount.execute(
                ctx,
                line,
                actionArgs({ discount: 15, collectionIds }),
                {},
                {} as any,
            );

        await expect(discount(['parent'])).resolves.toBe(-300);
        await expect(discount(['child'])).resolves.toBe(-300);
        await expect(discount(['parent', 'child', 'grandchild'])).resolves.toBe(-300);
        await expect(discount(['unrelated'])).resolves.toBe(0);
        await expect(discount([])).resolves.toBe(0);
        expect(find).toHaveBeenCalledTimes(1);
        expect(getRepository).toHaveBeenCalledWith(context, ProductVariant);
        expect(getRepository).toHaveBeenCalledWith(context, Collection);
        expect(findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'variant-1', channels: { id: 'channel-1' } },
            }),
        );
        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { channels: { id: 'channel-1' }, isRoot: false },
            }),
        );

        // A newly added descendant is included on the next request without changing coupon IDs.
        findOne.mockResolvedValue({ collections: [{ id: 'new-child' }] });
        find.mockResolvedValue([
            { id: 'parent', parentId: 'root' },
            { id: 'new-child', parentId: 'parent' },
        ]);
        await expect(discount(['parent'], { ...context })).resolves.toBe(-300);
        expect(find).toHaveBeenCalledTimes(2);

        // A category outside the current channel cannot bridge into a selected ancestor.
        find.mockResolvedValue([{ id: 'new-child', parentId: 'parent' }]);
        await expect(discount(['parent'], { ...context, channelId: 'channel-2' })).resolves.toBe(0);

        find.mockResolvedValue([
            { id: 'new-child', parentId: 'cycle' },
            { id: 'cycle', parentId: 'new-child' },
        ]);
        await expect(discount(['unrelated'], { ...context })).resolves.toBe(0);
    });
});

function actionArgs(values: Record<string, string | number | string[]>): ConfigArg[] {
    return Object.entries(values).map(([name, value]) => ({
        name,
        value: Array.isArray(value) ? JSON.stringify(value) : String(value),
    }));
}
