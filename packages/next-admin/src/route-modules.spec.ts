import { describe, expect, it } from 'vitest';
import { getRouteModuleKey } from './route-modules';

describe('getRouteModuleKey', () => {
    it('resolves list routes with query parameters', () => {
        expect(getRouteModuleKey('/catalog/list?search=shirt')).toBe('catalog');
        expect(getRouteModuleKey('/sales/orders?tab=to-fulfill')).toBe('sales');
        expect(getRouteModuleKey('/customers/list?group=vip')).toBe('customers');
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
});
