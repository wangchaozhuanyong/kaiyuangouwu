import { NavMenuConfig, NavMenuItem, NavMenuSection } from '@vendure/dashboard';
import { describe, expect, it } from 'vitest';

import { OperationsNavigationTitles, organizeOperationsNavigation } from './operations-navigation';

const navigationTitles = new Proxy({} as OperationsNavigationTitles, {
    get: (_target, property) => `operations.nav.${String(property)}`,
});

function navItem(id: string): NavMenuItem {
    return { id, title: id, url: `/${id}` };
}

function navSection(id: string, itemIds: string[], placement: 'top' | 'bottom'): NavMenuSection {
    return {
        id,
        title: id,
        placement,
        items: itemIds.map(navItem),
    };
}

function sectionItems(config: NavMenuConfig, sectionId: string): string[] {
    const section = config.sections.find(item => item.id === sectionId);
    return section && 'items' in section ? (section.items ?? []).map(item => item.id) : [];
}

const settingsItemIds = [
    'my-store-profile',
    'my-store-domains',
    'store-currency-settings',
    'store-commerce-settings',
    'image-generation-settings',
    'sellers',
    'channels',
    'stock-locations',
    'administrators',
    'roles',
    'shipping-methods',
    'payment-methods',
    'tax-categories',
    'tax-rates',
    'countries',
    'zones',
    'global-settings',
];

const systemItemIds = [
    'image-generation-access',
    'job-queue',
    'scheduled-tasks',
    'settings-store',
    'api-keys',
    'store-provisioning',
    'store-management',
    'system-announcements',
];

const storefrontDesignItemIds = [
    'storefront-content',
    'storefront-carousel',
    'storefront-site-content',
    'storefront-navigation',
    'auth-visuals',
    'storefront-client-plugins',
    'storefront-promotion',
];

function createConfig(): NavMenuConfig {
    return {
        sections: [
            { ...navItem('insights'), placement: 'top' },
            navSection('catalog', ['products'], 'top'),
            navSection('marketing', ['promotions', ...storefrontDesignItemIds], 'top'),
            navSection('settings', settingsItemIds, 'bottom'),
            navSection('system', systemItemIds, 'bottom'),
        ],
    };
}

describe('organizeOperationsNavigation', () => {
    it('splits the large settings menu into focused collapsible sections', () => {
        const result = organizeOperationsNavigation(createConfig(), navigationTitles);

        expect(sectionItems(result, 'store-and-merchants')).toEqual([
            'my-store-profile',
            'my-store-domains',
            'sellers',
            'channels',
            'store-provisioning',
            'store-management',
        ]);
        expect(sectionItems(result, 'commerce-and-regions')).toEqual([
            'store-currency-settings',
            'store-commerce-settings',
            'payment-methods',
            'tax-categories',
            'tax-rates',
            'countries',
            'zones',
        ]);
        expect(sectionItems(result, 'ai-service-settings')).toEqual([
            'image-generation-access',
            'image-generation-settings',
        ]);
        expect(sectionItems(result, 'accounts-and-access')).toEqual(['administrators', 'roles', 'api-keys']);
        expect(sectionItems(result, 'system-operations')).toEqual([
            'job-queue',
            'scheduled-tasks',
            'settings-store',
            'global-settings',
            'system-announcements',
        ]);
        expect(result.sections.some(section => section.id === 'settings' || section.id === 'system')).toBe(
            false,
        );
    });

    it('keeps relocated and future settings items reachable', () => {
        const config = createConfig();
        const system = config.sections.find(section => section.id === 'system') as NavMenuSection;
        system.items?.push(navItem('future-system-tool'));

        const result = organizeOperationsNavigation(config, navigationTitles);

        expect(sectionItems(result, 'catalog')).toEqual(['products', 'stock-locations', 'shipping-methods']);
        expect(sectionItems(result, 'system-operations')).toContain('future-system-tool');
        expect(sectionItems(result, 'storefront-design')).toEqual(storefrontDesignItemIds);
        expect(sectionItems(result, 'marketing')).toEqual(['promotions']);
        expect(result.sections.some(section => section.id === 'storefront-content')).toBe(false);
    });

    it('does not duplicate generated sections when navigation is rebuilt', () => {
        const first = organizeOperationsNavigation(createConfig(), navigationTitles);
        const second = organizeOperationsNavigation(first, navigationTitles);

        expect(second.sections.map(section => section.id)).toEqual(first.sections.map(section => section.id));
        expect(sectionItems(second, 'storefront-design')).toEqual(storefrontDesignItemIds);
        expect(sectionItems(second, 'store-and-merchants')).toEqual(
            sectionItems(first, 'store-and-merchants'),
        );
    });
});
