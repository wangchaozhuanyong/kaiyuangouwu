import { describe, expect, it } from 'vitest';

import {
    productAvailability,
    productAvailabilityLabel,
    variantCanIncreaseQuantity,
} from './product-availability';
import { ProductVariant } from './types';

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
    return {
        id: 'variant-1',
        name: 'Default',
        sku: 'SKU-1',
        priceWithTax: 1000,
        currencyCode: 'CNY',
        saleableStockLevel: 12,
        autoCardAvailableStock: null,
        featuredAsset: null,
        product: { id: 'product-1', name: 'Product', featuredAsset: null },
        customFields: { fulfillmentType: 'physical', digitalDeliveryMode: 'manual_service' },
        ...overrides,
    };
}

describe('product availability', () => {
    it('shows exact Vendure saleable stock', () => {
        const availability = productAvailability(variant({ saleableStockLevel: 12 }));
        expect(availability).toEqual({ stock: 12, soldOut: false, unlimited: false });
        expect(productAvailabilityLabel(availability, 'zh')).toBe('库存 12');
    });

    it('uses the auto-card pool as its exact stock source', () => {
        const availability = productAvailability(
            variant({
                saleableStockLevel: null,
                autoCardAvailableStock: 3,
                customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
            }),
        );
        expect(availability.stock).toBe(3);
        expect(
            variantCanIncreaseQuantity(
                variant({
                    autoCardAvailableStock: 3,
                    customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                }),
                3,
            ),
        ).toBe(false);
    });

    it('marks zero and negative stock as sold out', () => {
        expect(productAvailability(variant({ saleableStockLevel: 0 })).soldOut).toBe(true);
        expect(productAvailability(variant({ saleableStockLevel: -2 })).soldOut).toBe(true);
        expect(productAvailabilityLabel(productAvailability(variant({ saleableStockLevel: 0 })), 'zh')).toBe(
            '已售罄',
        );
    });

    it('keeps untracked variants purchasable with an unlimited label', () => {
        const availability = productAvailability(variant({ saleableStockLevel: null }));
        expect(availability).toEqual({ stock: null, soldOut: false, unlimited: true });
        expect(productAvailabilityLabel(availability, 'zh')).toBe('不限库存');
    });

    it('treats a missing variant as sold out', () => {
        expect(productAvailability(undefined)).toEqual({ stock: 0, soldOut: true, unlimited: false });
    });
});

describe('cart selection stock rules', () => {
    it('excludes depleted and over-quantity lines but keeps unlimited inventory selectable', async () => {
        const { cartLineCanSelect, cartSelectionState, quantityStockMessage } =
            await import('./product-availability');
        const line = (stock: number | null, quantity: number, selected = false) => ({
            id: String(stock),
            quantity,
            selected,
            available: true,
            productVariant: variant({ saleableStockLevel: stock }),
        });
        expect(cartLineCanSelect(line(0, 1))).toBe(false);
        expect(cartLineCanSelect(line(2, 3))).toBe(false);
        expect(cartLineCanSelect(line(null, 99))).toBe(true);
        expect(cartSelectionState([line(0, 1), line(2, 1, true)])).toBe('ALL');
        expect(cartSelectionState([line(0, 1, true), line(2, 1, true)])).toBe('PARTIAL');
        expect(quantityStockMessage(variant({ saleableStockLevel: 2 }), 3, 'zh')).toContain(
            '最多可购买 2 件',
        );
        expect(quantityStockMessage(variant({ saleableStockLevel: 0 }), 1, 'en')).toContain('Sold out');
    });
});
