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
                    items: [{ id: 'products', title: 'Products', url: '/products' }],
                },
                {
                    id: 'settings',
                    title: 'Settings',
                    items: [
                        { id: 'channels', title: 'Channels', url: '/channels', requiresPermission: ['ReadChannel'] },
                        { id: 'stock-locations', title: 'Stock', url: '/stock-locations' },
                        { id: 'payment-methods', title: 'Payments', url: '/payment-methods' },
                    ],
                },
            ],
        };

        const result = restrictPlatformNavigation(config);
        const catalog = result.sections.find(section => section.id === 'catalog');
        const settings = result.sections.find(section => section.id === 'settings');
        expect(catalog).toEqual(config.sections[0]);
        const settingsItems = settings && 'items' in settings ? settings.items ?? [] : [];
        expect(settingsItems).toEqual([
            expect.objectContaining({ id: 'channels', requiresPermission: ['CreateChannel'] }),
            expect.objectContaining({ id: 'stock-locations' }),
            expect.objectContaining({ id: 'payment-methods', requiresPermission: ['CreateChannel'] }),
        ]);
        expect(settingsItems[1]).not.toHaveProperty('requiresPermission');
        expect(config.sections[1]).toEqual({
            id: 'settings',
            title: 'Settings',
            items: [
                { id: 'channels', title: 'Channels', url: '/channels', requiresPermission: ['ReadChannel'] },
                { id: 'stock-locations', title: 'Stock', url: '/stock-locations' },
                { id: 'payment-methods', title: 'Payments', url: '/payment-methods' },
            ],
        });
    });
});
