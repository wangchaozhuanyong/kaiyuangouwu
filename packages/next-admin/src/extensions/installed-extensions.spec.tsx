import { describe, expect, it } from 'vitest';

import { getRequiredPermissionsForAdminPath, hasAnyAdminPermission } from '../utils/admin-permissions';
import {
    getNextAdminExtensionLegacyRoutes,
    getNextAdminExtensionNavItems,
    getNextAdminExtensionRoutes,
    getNextAdminExtensions,
} from './extension-api';
import { STORE_CURRENCY_COMPATIBILITY_TARGET } from './installed-extensions';

describe('installed next-admin extensions', () => {
    it.each([
        ['/marketing/referrals', 'ReadReferral'],
        ['/marketing/sharing', 'ReadReferral'],
        ['/storefront/decoration', 'ReadStorefrontContent'],
        ['/storefront/content', 'ReadStorefrontContent'],
    ])('aligns %s with the backend module permission and fallback route', (path, permission) => {
        const route = getNextAdminExtensionRoutes().find(item => item.path === path)!;
        expect(route.permissions).toEqual([permission]);
        expect(getRequiredPermissionsForAdminPath(path)).toEqual(route.permissions);
        expect(hasAnyAdminPermission([permission], route.permissions!)).toBe(true);
        expect(
            hasAnyAdminPermission(['ReadPromotion', 'ReadSettings', 'ReadCatalog'], route.permissions!),
        ).toBe(false);
        expect(hasAnyAdminPermission([], route.permissions!)).toBe(false);
        expect(hasAnyAdminPermission(['SuperAdmin'], route.permissions!)).toBe(true);
    });
    it('registers all eight local plugins through the shared extension API', () => {
        expect(getNextAdminExtensions().map(extension => extension.id)).toEqual([
            'image-generation-plugin',
            'content-translation-plugin',
            'two-factor-dashboard-plugin',
            'catalog-management-plugin',
            'storefront-content-plugin',
            'operations-dashboard-plugin',
            'store-management-plugin',
            'store-domain-plugin',
        ]);
    });

    it('registers catalog import on the product list action host', () => {
        const catalogExtension = getNextAdminExtensions().find(
            extension => extension.id === 'catalog-management-plugin',
        );
        expect(catalogExtension?.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'catalog-safe-import',
                    pageId: 'product-list',
                    permissions: ['CreateCatalogImport'],
                }),
                expect.objectContaining({ id: 'catalog-standard-export', pageId: 'product-list' }),
                expect.objectContaining({ id: 'catalog-bulk-channels', pageId: 'product-list' }),
            ]),
        );
    });

    it('provides unique routes plus the plugin navigation entries', () => {
        const routes = getNextAdminExtensionRoutes();
        expect(routes).toHaveLength(26);
        expect(new Set(routes.map(route => route.id)).size).toBe(routes.length);
        expect(new Set(routes.map(route => route.path)).size).toBe(routes.length);
        expect(routes).toContainEqual(
            expect.objectContaining({ path: '/marketing/sharing', permissions: ['ReadReferral'] }),
        );
        expect(getNextAdminExtensionNavItems('marketing')).toContainEqual(
            expect.objectContaining({ path: '/marketing/sharing' }),
        );
        expect(routes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'two-factor-codes',
                    path: '/plugins/two-factor-codes',
                }),
            ]),
        );
        expect(getNextAdminExtensionLegacyRoutes()).toContainEqual(
            expect.objectContaining({ path: '/two-factor-codes', target: '/plugins/two-factor-codes' }),
        );
        expect(getNextAdminExtensionNavItems('plugins').map(route => route.path)).toEqual([
            '/plugins/client-plugins',
            '/storefront/business-services-copy',
            '/plugins/ai-settings',
            '/plugins/ai-access',
            '/plugins/translations',
            '/plugins/two-factor-codes',
        ]);
    });

    it('routes the legacy store currency entry to the USDT payment setup tab', () => {
        expect(STORE_CURRENCY_COMPATIBILITY_TARGET).toBe('/settings/store-profile?tab=payment-shipping');
    });
});
