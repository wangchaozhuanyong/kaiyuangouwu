import { describe, expect, it, vi } from 'vitest';

import { StorefrontRegionShopResolver } from './storefront-region.resolver';

describe('StorefrontRegionShopResolver', () => {
    it('returns only enabled provinces that belong to an enabled country', async () => {
        const provinceService = {
            findAll: vi.fn().mockResolvedValue({
                totalItems: 4,
                items: [
                    {
                        code: 'MY-10',
                        name: 'Selangor',
                        enabled: true,
                        parent: { code: 'MY', type: 'country', enabled: true },
                    },
                    {
                        code: 'CN-GD',
                        name: '广东省',
                        enabled: true,
                        parent: { code: 'CN', type: 'country', enabled: true },
                    },
                    {
                        code: 'MY-99',
                        name: 'Disabled state',
                        enabled: true,
                        parent: { code: 'MY', type: 'country', enabled: false },
                    },
                    { code: 'ORPHAN', name: 'Orphan', enabled: true, parent: null },
                ],
            }),
        };
        const resolver = new StorefrontRegionShopResolver(provinceService as never);

        await expect(resolver.availableStorefrontProvinces({} as never)).resolves.toEqual([
            { code: 'CN-GD', name: '广东省', countryCode: 'CN' },
            { code: 'MY-10', name: 'Selangor', countryCode: 'MY' },
        ]);
        expect(provinceService.findAll).toHaveBeenCalledWith(
            {},
            { skip: 0, take: 100, filter: { enabled: { eq: true } } },
            ['parent'],
        );
    });

    it('paginates without exceeding the Vendure list limit', async () => {
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
                            parent: { code: '001', type: 'country', enabled: true },
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
                            parent: { code: '001', type: 'country', enabled: true },
                        },
                    ],
                }),
        };
        const resolver = new StorefrontRegionShopResolver(provinceService as never);

        await expect(resolver.availableStorefrontProvinces({} as never)).resolves.toEqual([
            { code: 'MY-01', name: 'Johor', countryCode: '001' },
            { code: 'MY-10', name: 'Selangor', countryCode: '001' },
        ]);
        expect(provinceService.findAll).toHaveBeenNthCalledWith(
            2,
            {},
            { skip: 1, take: 100, filter: { enabled: { eq: true } } },
            ['parent'],
        );
    });
});
