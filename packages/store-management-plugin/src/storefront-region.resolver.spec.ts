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
            { take: 500, filter: { enabled: { eq: true } } },
            ['parent'],
        );
    });
});
