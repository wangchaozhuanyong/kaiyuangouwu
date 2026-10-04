import { describe, expect, it } from 'vitest';
import { getRouteModuleKey } from '../route-modules';
import {
    ADMIN_NAV_SECTIONS,
    STANDALONE_ADMIN_PAGES,
    getStandaloneAdminPage,
    getStandaloneAdminRedirect,
    localizeAdminNavigationTitle,
    standalonePagePermissions,
    standalonePageScopeAllows,
} from './admin-navigation';

describe('standalone administration navigation', () => {
    it('has 12 two-level groups and unique independently loadable pages', () => {
        expect(ADMIN_NAV_SECTIONS).toHaveLength(12);
        expect(new Set(STANDALONE_ADMIN_PAGES.map(p => p.path)).size).toBe(STANDALONE_ADMIN_PAGES.length);
        for (const page of STANDALONE_ADMIN_PAGES) {
            expect(getStandaloneAdminPage(page.path)).toBe(page);
            expect(getRouteModuleKey(page.path)).toBe(page.module);
            expect(ADMIN_NAV_SECTIONS.some(([id]) => id === page.section)).toBe(true);
            expect(localizeAdminNavigationTitle(page.title, 'en')).not.toMatch(/\p{Script=Han}/u);
        }
    });
    it.each([
        ['/settings/system-ops', '?tab=jobs&state=FAILED', '/settings/system-ops/jobs?state=FAILED'],
        ['/settings/system-ops', '?tab=governance&take=50', '/settings/governance-risk/rules?take=50'],
        [
            '/settings/data-management',
            '?tab=exports&status=FAILED',
            '/settings/data-management/exports?status=FAILED',
        ],
        [
            '/catalog/inventory',
            '?tab=low-stock&search=sku',
            '/catalog/inventory/all?search=sku&status=low-stock',
        ],
        ['/settings/store-profile', '?tab=payment-shipping', '/settings/store-profile/payment'],
        ['/settings/store-profile', '?tab=unknown&foo=bar', '/settings/store-profile/stores?foo=bar'],
        ['/marketing/referrals', '?tab=posters&filter=active', '/marketing/sharing?filter=active'],
    ])('keeps valid filters from old %s links', (path, search, target) =>
        expect(getStandaloneAdminRedirect(path, search)).toBe(target),
    );
    it('keeps existing independent URLs and child URL queries intact', () => {
        expect(getStandaloneAdminRedirect('/sales/orders', '?state=Settled')).toBeNull();
        expect(getStandaloneAdminRedirect('/settings/data-management/exports', '?page=2')).toBeNull();
    });
    it('separates platform review/data from merchant operations using existing capabilities', () => {
        expect(standalonePageScopeAllows('/settings/store-profile/review', false)).toBe(false);
        expect(standalonePageScopeAllows('/settings/data-management/exports', false)).toBe(false);
        expect(standalonePageScopeAllows('/settings/store-profile/payment', false)).toBe(true);
        expect(standalonePagePermissions(getStandaloneAdminPage('/settings/system-ops/api-keys')!)).toEqual([
            'ReadApiKey',
        ]);
        expect(standalonePagePermissions(getStandaloneAdminPage('/settings/system-ops/jobs')!)).toEqual([
            'ReadSystem',
        ]);
        expect(
            standalonePagePermissions(getStandaloneAdminPage('/settings/store-profile/usdt-payments')!),
        ).toContain('ReadStoreProfile');
    });
});
