import { describe, expect, it } from 'vitest';

import {
    canAccessAdminPath,
    getRequiredPermissionsForAdminPath,
    hasAnyAdminPermission,
} from './admin-permissions';

describe('admin permissions', () => {
    it('offers the same content routes to every merchant role with content access', () => {
        for (const path of ['/storefront/decoration', '/storefront/content', '/plugins/client-plugins']) {
            expect(canAccessAdminPath(path, ['ReadStorefrontContent', 'ReadCatalog'])).toBe(true);
            expect(canAccessAdminPath(path, ['ReadStorefrontContent'])).toBe(true);
            expect(canAccessAdminPath(path, ['ReadCatalog'])).toBe(false);
            expect(canAccessAdminPath(path, ['ReadSettings'])).toBe(false);
        }
    });
    it('uses sharing permissions independently of promotion and finance access', () => {
        expect(canAccessAdminPath('/marketing/sharing', ['ReadReferral'])).toBe(true);
        expect(canAccessAdminPath('/marketing/sharing', ['ReadPromotion', 'ReadOrder'])).toBe(false);
    });
    it('allows unrestricted routes without a permission rule', () => {
        expect(canAccessAdminPath('/dashboard', [])).toBe(true);
        expect(canAccessAdminPath('/profile', [])).toBe(true);
    });

    it('matches the most-specific route before its parent section', () => {
        expect(getRequiredPermissionsForAdminPath('/catalog/inventory')).toContain('ReadStockLocation');
        expect(canAccessAdminPath('/catalog/inventory', ['ReadStockLocation'])).toBe(true);
        expect(canAccessAdminPath('/catalog/list', ['ReadStockLocation'])).toBe(false);
    });

    it('allows any permission accepted by a merged settings page', () => {
        expect(canAccessAdminPath('/settings/store-profile', ['ReadPaymentMethod'])).toBe(true);
        expect(canAccessAdminPath('/settings/store-profile', ['ReadOrder'])).toBe(false);
    });

    it('protects order write workflows from read-only accounts', () => {
        expect(canAccessAdminPath('/sales/orders/draft/42', ['ReadOrder'])).toBe(false);
        expect(canAccessAdminPath('/sales/orders/draft/42', ['CreateOrder'])).toBe(true);
        expect(canAccessAdminPath('/sales/orders/42/modify', ['ReadOrder'])).toBe(false);
        expect(canAccessAdminPath('/sales/orders/42/modify', ['UpdateOrder'])).toBe(true);
    });

    it('requires both order and cost visibility for the profit report', () => {
        expect(canAccessAdminPath('/sales/profit', ['ReadOrder'])).toBe(false);
        expect(canAccessAdminPath('/sales/profit', ['ReadCatalogOperations'])).toBe(false);
        expect(canAccessAdminPath('/sales/profit', ['ReadOrder', 'ReadCatalogOperations'])).toBe(true);
    });

    it('treats SuperAdmin as unrestricted', () => {
        expect(hasAnyAdminPermission(['SuperAdmin'], ['ReadSystem'])).toBe(true);
        expect(canAccessAdminPath('/plugins/ai-access', ['SuperAdmin'])).toBe(true);
        expect(canAccessAdminPath('/plugins/ai-access', ['ReadSettings'])).toBe(false);
    });
});
