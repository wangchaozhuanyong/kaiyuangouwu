import { describe, expect, it } from 'vitest';
import {
    SETTINGS_ROUTE_PRELOAD_TARGETS,
    allowsBackgroundRoutePreload,
    getRouteModuleKey,
} from './route-modules';

describe('getRouteModuleKey', () => {
    it('resolves list routes with query parameters', () => {
        expect(getRouteModuleKey('/catalog/list?search=shirt')).toBe('catalog');
        expect(getRouteModuleKey('/sales/orders?tab=to-fulfill')).toBe('sales');
        expect(getRouteModuleKey('/customers/list?group=vip')).toBe('customers');
        expect(getRouteModuleKey('/marketing/sharing')).toBe('sharing');
    });

    it('resolves detail routes before their list fallback', () => {
        expect(getRouteModuleKey('/catalog/products/new')).toBe('productEditor');
        expect(getRouteModuleKey('/catalog/products/42')).toBe('productEditor');
        expect(getRouteModuleKey('/sales/orders/42')).toBe('orderEditor');
        expect(getRouteModuleKey('/sales/orders/draft/42')).toBe('orderWorkflow');
        expect(getRouteModuleKey('/sales/orders/42/modify')).toBe('orderWorkflow');
        expect(getRouteModuleKey('/plugins/two-factor-codes')).toBe('twoFactorCodes');
        expect(getRouteModuleKey('/storefront/business-services-copy')).toBe('businessServicesCopy');
    });

    it('ignores routes without a lazy module', () => {
        expect(getRouteModuleKey('/login')).toBeNull();
    });

    it('does not compete with the active page on constrained or data-saving connections', () => {
        expect(allowsBackgroundRoutePreload()).toBe(true);
        expect(allowsBackgroundRoutePreload({ effectiveType: '4g' })).toBe(true);
        expect(allowsBackgroundRoutePreload({ effectiveType: '2g' })).toBe(false);
        expect(allowsBackgroundRoutePreload({ effectiveType: 'slow-2g' })).toBe(false);
        expect(allowsBackgroundRoutePreload({ effectiveType: '4g', saveData: true })).toBe(false);
    });

    it('preloads all settings navigation entries after the app shell starts', () => {
        expect(SETTINGS_ROUTE_PRELOAD_TARGETS).toEqual([
            '/settings/store-profile',
            '/settings/team',
            '/settings/system-ops',
            '/settings/data-management',
            '/settings/usdt-payments',
        ]);
        expect(SETTINGS_ROUTE_PRELOAD_TARGETS.map(getRouteModuleKey)).toEqual([
            'storeSettings',
            'roles',
            'systemOps',
            'dataManagement',
            'usdtPayments',
        ]);
    });
});
