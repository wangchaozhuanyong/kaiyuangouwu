import { describe, expect, it } from 'vitest';
import { REFERRAL_REPORT_FIELDS, REFERRAL_TABS } from '../pages/Marketing/referrals-types';
import { getRouteModuleKey } from '../route-modules';
import { hasAnyAdminPermission } from '../utils/admin-permissions';
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
    it('preserves released groups and separates digital and physical operations and unique independently loadable pages', () => {
        expect(ADMIN_NAV_SECTIONS).toHaveLength(14);
        expect(getStandaloneAdminPage('/catalog/inventory/lots')?.section).toBe('physical-inventory');
        expect(getStandaloneAdminPage('/catalog/card-pool/deliveries')?.section).toBe('digital-delivery');
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
        ['/settings/system-ops', '?tab=telegram', '/settings/system-ops/telegram'],
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
    it('preserves every released referral report as a standalone page', () => {
        for (const [key, tab] of Object.entries(REFERRAL_TABS)) {
            expect(getStandaloneAdminPage(`/marketing/referrals/${key}`)?.tabKey).toBe(key);
            expect(getStandaloneAdminRedirect('/marketing/referrals', `?tab=${key}&search=shop`)).toBe(
                `/marketing/referrals/${key}?search=shop`,
            );
            if (tab === 'RELATIONSHIPS')
                expect(REFERRAL_REPORT_FIELDS[tab]).toEqual(['referralRelationships']);
        }
    });
    it('keeps existing independent URLs and child URL queries intact', () => {
        expect(getStandaloneAdminRedirect('/sales/orders', '?state=Settled')).toBeNull();
        expect(getStandaloneAdminRedirect('/settings/data-management/exports', '?page=2')).toBeNull();
    });
    it.each([
        ['/storefront/announcements', '?announcementId=42'],
        ['/storefront/content', '?tab=announcements&announcementId=42'],
    ])('normalizes the legacy announcement entry %s before the shell mounts', (path, search) => {
        expect(getStandaloneAdminRedirect(path, search)).toBe(
            '/storefront/content/announcements?announcementId=42',
        );
    });
    it('allows store content readers and platform administrators to access announcements', () => {
        const permissions = standalonePagePermissions(
            getStandaloneAdminPage('/storefront/content/announcements')!,
        )!;
        expect(permissions).toEqual(['ReadStorefrontContent']);
        expect(hasAnyAdminPermission(['SuperAdmin'], permissions)).toBe(true);
        expect(hasAnyAdminPermission(['ReadStorefrontContent'], permissions)).toBe(true);
        expect(hasAnyAdminPermission([], permissions)).toBe(false);
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
    it('requires platform context and SuperAdmin for the shared notification page', () => {
        const path = '/settings/system-ops/telegram';
        expect(standalonePageScopeAllows(path, false)).toBe(false);
        expect(standalonePageScopeAllows(path, true)).toBe(true);
        expect(standalonePagePermissions(getStandaloneAdminPage(path)!)).toEqual(['SuperAdmin']);
        expect(standalonePageScopeAllows('/settings/system-ops/api-keys', false)).toBe(true);
    });
});
