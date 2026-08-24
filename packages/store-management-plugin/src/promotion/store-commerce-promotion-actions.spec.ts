import { ConfigArg } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import {
    collectionPercentageDiscount,
    flashSalePriceAction,
    parseFlashSaleVariantRules,
} from './store-commerce-promotion-actions';

describe('store commerce promotion actions', () => {
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
