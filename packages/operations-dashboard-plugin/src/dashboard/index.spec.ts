import type { NavMenuConfig, NavMenuSection } from '@vendure/dashboard';
import { describe, expect, it } from 'vitest';

import { organizeOperationsNavigation, type OperationsNavigationTitles } from './operations-navigation';

const navigationTitles: OperationsNavigationTitles = {
    workbench: 'operations.nav.workbench',
    productCenter: 'operations.nav.productCenter',
    orderCenter: 'operations.nav.orderCenter',
    orderManagement: 'operations.nav.orderManagement',
    customerCenter: 'operations.nav.customerCenter',
    marketingCenter: 'operations.nav.marketingCenter',
    storeSettings: 'operations.nav.storeSettings',
    systemManagement: 'operations.nav.systemManagement',
    productList: 'operations.nav.productList',
    skuAndInventory: 'operations.nav.skuAndInventory',
    productGroups: 'operations.nav.productGroups',
    specificationTemplates: 'operations.nav.specificationTemplates',
    productAttributes: 'operations.nav.productAttributes',
    warehouses: 'operations.nav.warehouses',
    stores: 'operations.nav.stores',
    storefrontDesign: 'operations.nav.storefrontDesign',
};

const storefrontItems = [
    { id: 'storefront-content', title: '首页装修', url: '/storefront-content' },
    { id: 'storefront-carousel', title: '首页轮播', url: '/storefront-carousel' },
    { id: 'storefront-site-content', title: '全局内容', url: '/storefront-site-content' },
    { id: 'storefront-navigation', title: '客户端导航', url: '/storefront-navigation' },
    { id: 'auth-visuals', title: '登录注册页视觉', url: '/auth-visuals' },
    {
        id: 'storefront-client-plugins',
        title: '客户端插件中心',
        url: '/storefront-client-plugins',
    },
    {
        id: 'storefront-promotion',
        title: '短视频推广页',
        url: '/storefront-promotion',
        requiresPermission: ['ReadStorefrontContent'],
    },
];

function storefrontDesignSection(config: NavMenuConfig): NavMenuSection {
    const section = config.sections.find(item => item.id === 'storefront-design');
    if (!section || !('items' in section)) {
        throw new Error('Storefront design section was not created');
    }
    return section;
}

describe('operations navigation', () => {
    it('groups all storefront editing pages under the storefront design section', () => {
        const input: NavMenuConfig = {
            sections: [
                {
                    id: 'marketing',
                    title: 'Marketing',
                    placement: 'top',
                    items: [
                        { id: 'promotions', title: 'Promotions', url: '/promotions' },
                        ...storefrontItems,
                    ],
                },
                { id: 'settings', title: 'Settings', placement: 'bottom', items: [] },
            ],
        };

        const result = organizeOperationsNavigation(input, navigationTitles);
        const design = storefrontDesignSection(result);
        const marketing = result.sections.find(section => section.id === 'marketing');

        expect(design.title).toBe('operations.nav.storefrontDesign');
        expect(design.placement).toBe('top');
        expect(design.items?.map(item => item.id)).toEqual(storefrontItems.map(item => item.id));
        expect(design.items?.map(item => item.order)).toEqual([100, 200, 300, 400, 500, 600, 700]);
        expect(design.items?.at(-1)).toMatchObject({
            url: '/storefront-promotion',
            requiresPermission: ['ReadStorefrontContent'],
        });
        expect(marketing && 'items' in marketing ? marketing.items : []).toEqual([
            expect.objectContaining({ id: 'promotions' }),
        ]);
        expect(result.sections.some(section => section.id === 'storefront-content')).toBe(false);
    });

    it('does not duplicate the storefront design section when navigation is rebuilt', () => {
        const first = organizeOperationsNavigation(
            {
                sections: [
                    {
                        id: 'marketing',
                        title: 'Marketing',
                        placement: 'top',
                        items: storefrontItems,
                    },
                ],
            },
            navigationTitles,
        );
        const second = organizeOperationsNavigation(first, navigationTitles);

        expect(second.sections.filter(section => section.id === 'storefront-design')).toHaveLength(1);
        expect(storefrontDesignSection(second).items?.map(item => item.id)).toEqual(
            storefrontItems.map(item => item.id),
        );
    });
});
