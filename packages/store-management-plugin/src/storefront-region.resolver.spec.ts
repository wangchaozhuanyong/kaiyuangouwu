import { describe, expect, it, vi } from 'vitest';

import { StorefrontRegionShopResolver } from './storefront-region.resolver';

describe('StorefrontRegionShopResolver', () => {
    const countries = {
        findAllAvailable: vi.fn().mockResolvedValue([
            { id: 1, code: '001' },
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
            { code: 'MY-10', name: 'Selangor', countryCode: '001' },
            { code: 'CN-GD', name: '广东省', countryCode: 'CN' },
        ]);
        expect(provinceService.findAll).toHaveBeenCalledWith(
            {},
            { skip: 0, sort: { id: 'ASC' }, filter: { enabled: { eq: true } } },
        );
    });

    it('uses the configured public page limit and includes subsequent pages', async () => {
        const provinceService = {
            findAll: vi
                .fn()
                .mockResolvedValueOnce({
                    totalItems: 2,
                    items: [
                        {
                            code: 'MY-01',
                            name: 'Johor',
                            enabled: true,
                            parentId: 1,
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    totalItems: 2,
                    items: [
                        {
                            code: 'MY-10',
                            name: 'Selangor',
                            enabled: true,
                            parentId: 1,
                        },
                    ],
                }),
        };
        const resolver = new StorefrontRegionShopResolver(provinceService as never, countries as never);

        await expect(resolver.availableStorefrontProvinces({} as never)).resolves.toEqual([
            { code: 'MY-01', name: 'Johor', countryCode: '001' },
            { code: 'MY-10', name: 'Selangor', countryCode: '001' },
        ]);
        expect(provinceService.findAll).toHaveBeenNthCalledWith(
            2,
            {},
            { skip: 1, sort: { id: 'ASC' }, filter: { enabled: { eq: true } } },
        );
    });

    it('stops if a page becomes empty during concurrent province changes', async () => {
        const provinceService = { findAll: vi.fn().mockResolvedValue({ totalItems: 1, items: [] }) };
        const resolver = new StorefrontRegionShopResolver(provinceService as never, countries as never);

        await expect(resolver.availableStorefrontProvinces({} as never)).resolves.toEqual([]);
        expect(provinceService.findAll).toHaveBeenCalledTimes(1);
    });
});
