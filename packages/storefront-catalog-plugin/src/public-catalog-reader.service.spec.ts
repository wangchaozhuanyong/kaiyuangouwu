import { PUBLIC_PRODUCT_SUMMARY_READER } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { PublicCatalogReaderService } from './public-catalog-reader.service';

describe('public catalog projection for homepage snapshots', () => {
    it('keeps the authorized request context for both ranked products and their public sales', async () => {
        const ctx = { channelId: 'shop-a' };
        const products = [{ id: 'first' }, { id: 'second' }];
        const summaries = products.map(product => ({ ...product, name: product.id }));
        const catalog = { find: vi.fn().mockResolvedValue({ items: products, totalItems: 2 }) };
        const project = vi.fn().mockResolvedValue(summaries);
        const modules = { get: vi.fn().mockReturnValue({ project }) };
        const sales = {
            findByProductIds: vi.fn().mockResolvedValue([
                { productId: 'first', quantity: 20 },
                { productId: 'second', quantity: 0 },
            ]),
        };
        const reader = new PublicCatalogReaderService(catalog as never, modules as never, sales as never);
        const input = { sort: 'SALES' as const, take: 16 };
        await expect(reader.find(ctx as never, input)).resolves.toEqual({ items: summaries, totalItems: 2 });
        expect(catalog.find).toHaveBeenCalledWith(ctx, input);
        expect(modules.get).toHaveBeenCalledWith(PUBLIC_PRODUCT_SUMMARY_READER, { strict: false });
        expect(project).toHaveBeenCalledWith(ctx, products);
        await expect(reader.sales(ctx as never, ['first', 'second'])).resolves.toEqual({
            first: 20,
            second: 0,
        });
        expect(sales.findByProductIds).toHaveBeenCalledWith(ctx, ['first', 'second']);
    });
    it('propagates real sales read failures instead of producing zero-sales success', async () => {
        const sales = { findByProductIds: vi.fn().mockRejectedValue(new Error('Sales unavailable')) };
        const reader = new PublicCatalogReaderService({} as never, {} as never, sales as never);
        await expect(reader.sales({ channelId: 'a' } as never, ['first'])).rejects.toThrow(
            'Sales unavailable',
        );
    });
});
