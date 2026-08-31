import { describe, expect, it, vi } from 'vitest';

import { AutoCardShopProductVariantResolver, normalizePublicSaleableStockLevel } from './auto-card.resolver';

describe('public product availability resolver', () => {
    it('exposes finite saleable stock and clamps negative stock to zero', () => {
        expect(normalizePublicSaleableStockLevel(12)).toBe(12);
        expect(normalizePublicSaleableStockLevel(-4)).toBe(0);
    });

    it('returns null when Vendure inventory tracking is disabled', () => {
        expect(normalizePublicSaleableStockLevel(Number.MAX_SAFE_INTEGER)).toBeNull();
        expect(normalizePublicSaleableStockLevel(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('uses Vendure saleable stock for non-auto-card variants', async () => {
        const productVariantService = { getSaleableStockLevel: vi.fn().mockResolvedValue(7) };
        const autoCardService = { availableStockForVariant: vi.fn() };
        const resolver = new AutoCardShopProductVariantResolver(
            autoCardService as never,
            productVariantService as never,
        );

        await expect(
            resolver.saleableStockLevel(
                {} as never,
                {
                    id: 'variant-1',
                    customFields: { fulfillmentType: 'physical', digitalDeliveryMode: 'manual_service' },
                } as never,
            ),
        ).resolves.toBe(7);
        expect(productVariantService.getSaleableStockLevel).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({ id: 'variant-1' }),
        );
        expect(autoCardService.availableStockForVariant).not.toHaveBeenCalled();
    });

    it('uses the available card pool for auto-card variants', async () => {
        const autoCardService = { availableStockForVariant: vi.fn().mockResolvedValue(4) };
        const productVariantService = { getSaleableStockLevel: vi.fn() };
        const resolver = new AutoCardShopProductVariantResolver(
            autoCardService as never,
            productVariantService as never,
        );

        await expect(
            resolver.saleableStockLevel(
                {} as never,
                {
                    id: 'variant-2',
                    customFields: { fulfillmentType: 'digital', digitalDeliveryMode: 'auto_card' },
                } as never,
            ),
        ).resolves.toBe(4);
        expect(autoCardService.availableStockForVariant).toHaveBeenCalledWith(
            expect.any(Object),
            'variant-2',
        );
        expect(productVariantService.getSaleableStockLevel).not.toHaveBeenCalled();
    });
});
