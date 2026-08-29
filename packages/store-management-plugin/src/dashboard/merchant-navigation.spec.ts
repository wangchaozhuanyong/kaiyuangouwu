import { NavMenuConfig } from '@vendure/dashboard';
import { describe, expect, it } from 'vitest';

import { restrictPlatformNavigation } from './merchant-navigation';

describe('restrictPlatformNavigation', () => {
    it('keeps merchant operating tools and protects platform settings', () => {
        const config: NavMenuConfig = {
            sections: [
                {
                    id: 'catalog',
                    title: 'Catalog',
                    items: [
                        { id: 'products', title: 'Products', url: '/products' },
                        { id: 'stock-locations', title: 'Stock', url: '/stock-locations' },
                        { id: 'shipping-methods', title: 'Shipping', url: '/shipping-methods' },
                    ],
                },
                {
                    id: 'marketing',
                    title: 'Marketing',
                    items: [{ id: 'promotions', title: 'Promotions', url: '/promotions' }],
                },
                {
                    id: 'store-and-merchants',
                    title: 'Stores & merchants',
                    items: [
                        {
                            id: 'channels',
                            title: 'Channels',
                            url: '/channels',
                            requiresPermission: ['ReadChannel'],
                        },
                    ],
                },
                {
                    id: 'commerce-and-regions',
                    title: 'Payments, tax & regions',
                    items: [{ id: 'payment-methods', title: 'Payments', url: '/payment-methods' }],
                },
            ],
        };

        const result = restrictPlatformNavigation(config);
        const catalog = result.sections.find(section => section.id === 'catalog');
        const marketing = result.sections.find(section => section.id === 'marketing');
        const storeSettings = result.sections.find(section => section.id === 'store-and-merchants');
        const commerceSettings = result.sections.find(section => section.id === 'commerce-and-regions');
        const catalogItems = catalog && 'items' in catalog ? (catalog.items ?? []) : [];
        expect(catalogItems).toEqual([
            expect.objectContaining({ id: 'products' }),
            expect.objectContaining({ id: 'stock-locations' }),
            expect.objectContaining({ id: 'shipping-methods', requiresPermission: ['CreateChannel'] }),
        ]);
        expect(catalogItems[0]).not.toHaveProperty('requiresPermission');
        expect(catalogItems[1]).not.toHaveProperty('requiresPermission');
        const marketingItems = marketing && 'items' in marketing ? (marketing.items ?? []) : [];
        expect(marketingItems).toEqual([
            expect.objectContaining({ id: 'promotions', requiresPermission: ['CreateChannel'] }),
        ]);
        const storeSettingsItems =
            storeSettings && 'items' in storeSettings ? (storeSettings.items ?? []) : [];
        expect(storeSettingsItems).toEqual([
            expect.objectContaining({ id: 'channels', requiresPermission: ['CreateChannel'] }),
        ]);
        const commerceSettingsItems =
            commerceSettings && 'items' in commerceSettings ? (commerceSettings.items ?? []) : [];
        expect(commerceSettingsItems).toEqual([
            expect.objectContaining({ id: 'payment-methods', requiresPermission: ['CreateChannel'] }),
        ]);
        expect(config.sections[2]).toEqual({
            id: 'store-and-merchants',
            title: 'Stores & merchants',
            items: [
                { id: 'channels', title: 'Channels', url: '/channels', requiresPermission: ['ReadChannel'] },
            ],
        });
    });
});
