import { describe, expect, it, vi } from 'vitest';

import { StorefrontRegionShopResolver } from './storefront-region.resolver';

describe('StorefrontRegionShopResolver', () => {
    const countries = {
        findAllAvailable: vi.fn().mockResolvedValue([
            { id: 1, code: 'MY' },
            { id: 2, code: 'CN' },
        ]),
    };
    it('returns only enabled provinces that belong to an enabled country', async () => {
        const provinceService = {
            findAll: vi.fn().mockResolvedValue({
                totalItems: 4,
                items: [
                    {
                        code: 'MY-10',
                        name: 'Selangor',
                        enabled: true,
                        parentId: 1,
                    },
                    {
                        code: 'CN-GD',
                        name: '广东省',
                        enabled: true,
                        parentId: 2,
                    },
                    {
                        code: 'MY-99',
                        name: 'Disabled state',
                        enabled: true,
                        parentId: 3,
                    },
                    { code: 'ORPHAN', name: 'Orphan', enabled: true, parentId: null },
                ],
            }),
        };
        const resolver = new StorefrontRegionShopResolver(provinceService as never, countries as never);

        await expect(resolver.availableStorefrontProvinces({} as never)).resolves.toEqual([
            { code: 'CN-GD', name: '广东省', countryCode: 'CN' },
            { code: 'MY-10', name: 'Selangor', countryCode: 'MY' },
        ]);
        expect(provinceService.findAll).toHaveBeenCalledWith(
            {},
            { skip: 0, sort: { id: 'ASC' }, filter: { enabled: { eq: true } } },
        );
    });

    it('uses the public API page limit and includes provinces from subsequent pages', async () => {
        const provinces = Array.from({ length: 103 }, (_, index) => ({
            code: `MY-${String(index).padStart(3, '0')}`,
            name: `Province ${String(index).padStart(3, '0')}`,
            parentId: 1,
        }));
        const provinceService = {
            findAll: vi.fn((_ctx, options) => {
                if (options.take > 100) throw new Error('List query limit exceeded');
                return Promise.resolve({
                    totalItems: provinces.length,
                    items: provinces.slice(options.skip ?? 0, (options.skip ?? 0) + 100),
                });
            }),
        };
        const resolver = new StorefrontRegionShopResolver(provinceService as never, countries as never);

        const result = await resolver.availableStorefrontProvinces({} as never);

        expect(result).toHaveLength(103);
        expect(result.at(-1)?.code).toBe('MY-102');
        expect(provinceService.findAll.mock.calls.map(([, options]) => options.skip)).toEqual([0, 100]);
    });

    it('stops if a page becomes empty during concurrent province changes', async () => {
        const provinceService = { findAll: vi.fn().mockResolvedValue({ totalItems: 1, items: [] }) };
        const resolver = new StorefrontRegionShopResolver(provinceService as never, countries as never);

        await expect(resolver.availableStorefrontProvinces({} as never)).resolves.toEqual([]);
        expect(provinceService.findAll).toHaveBeenCalledTimes(1);
    });
});
