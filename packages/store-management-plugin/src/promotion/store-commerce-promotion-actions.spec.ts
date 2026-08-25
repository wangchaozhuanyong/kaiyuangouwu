/* eslint-disable @typescript-eslint/require-await -- Promotion action mocks preserve async APIs. */
import { ConfigArg } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import {
    collectionPercentageDiscount,
    customerCouponEntitlement,
    flashSalePriceAction,
    parseFlashSaleVariantRules,
} from './store-commerce-promotion-actions';

describe('store commerce promotion actions', () => {
    it('requires a server-side customer coupon entitlement before a promotion can apply', async () => {
        const queryBuilder: Record<string, any> = {};
        for (const method of ['select', 'from', 'where', 'andWhere', 'limit']) {
            queryBuilder[method] = vi.fn(() => queryBuilder);
        }
        queryBuilder.getRawOne = vi.fn(async () => ({ id: 'coupon-1' }));
        await customerCouponEntitlement.init({
            get: () => ({ rawConnection: { createQueryBuilder: () => queryBuilder } }),
        } as any);

        await expect(
            customerCouponEntitlement.check(
                { channelId: 'channel-1' } as any,
                { id: 'order-1', customerId: 'customer-1' } as any,
                [] as any,
                { id: 'promotion-1' } as any,
            ),
        ).resolves.toBe(true);
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
            expect.stringContaining("coupon.status = 'LOCKED'"),
            { orderId: 'order-1' },
        );

        queryBuilder.getRawOne.mockResolvedValueOnce(undefined);
        await expect(
            customerCouponEntitlement.check(
                { channelId: 'channel-1' } as any,
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

    it('applies collection discounts only to variants inside a selected category', async () => {
        const findOne = vi.fn(async () => ({ collections: [{ id: 'collection-1' }] }));
        await collectionPercentageDiscount.init({
            get: () => ({ getRepository: () => ({ findOne }) }),
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
});

function actionArgs(values: Record<string, string | number | string[]>): ConfigArg[] {
    return Object.entries(values).map(([name, value]) => ({
        name,
        value: Array.isArray(value) ? JSON.stringify(value) : String(value),
    }));
}
