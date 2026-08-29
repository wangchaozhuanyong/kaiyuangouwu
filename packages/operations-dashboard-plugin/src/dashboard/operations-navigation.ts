import { NavMenuConfig, NavMenuItem, NavMenuSection } from '@vendure/dashboard';
import { Bot, Landmark, PanelsTopLeft, ShieldCheck, Store, Wrench } from 'lucide-react';

export interface OperationsNavigationTitles {
    workbench: string;
    productCenter: string;
    orderCenter: string;
    orderManagement: string;
    customerCenter: string;
    marketingCenter: string;
    storeAndMerchants: string;
    commerceAndRegions: string;
    aiServices: string;
    accountsAndAccess: string;
    systemOperations: string;
    productList: string;
    skuAndInventory: string;
    productGroups: string;
    specificationTemplates: string;
    productAttributes: string;
    warehouses: string;
    stores: string;
    storefrontDesign: string;
}

const storefrontDesignSectionId = 'storefront-design';
const storefrontDesignItemIds = [
    'storefront-content',
    'storefront-carousel',
    'storefront-site-content',
    'storefront-navigation',
    'auth-visuals',
    'storefront-client-plugins',
    'storefront-promotion',
] as const;

const relocatedItemIds = new Set(['stock-locations', 'shipping-methods', ...storefrontDesignItemIds]);

const settingsGroups = [
    {
        id: 'store-and-merchants',
        titleKey: 'storeAndMerchants',
        icon: Store,
        order: 100,
        itemIds: [
            'my-store-profile',
            'my-store-domains',
            'sellers',
            'channels',
            'store-provisioning',
            'store-management',
        ],
    },
    {
        id: 'commerce-and-regions',
        titleKey: 'commerceAndRegions',
        icon: Landmark,
        order: 200,
        itemIds: [
            'store-currency-settings',
            'store-commerce-settings',
            'payment-methods',
            'tax-categories',
            'tax-rates',
            'countries',
            'zones',
        ],
    },
    {
        id: 'ai-service-settings',
        titleKey: 'aiServices',
        icon: Bot,
        order: 300,
        itemIds: ['image-generation-access', 'image-generation-settings'],
    },
    {
        id: 'accounts-and-access',
        titleKey: 'accountsAndAccess',
        icon: ShieldCheck,
        order: 400,
        itemIds: ['administrators', 'roles', 'api-keys'],
    },
    {
        id: 'system-operations',
        titleKey: 'systemOperations',
        icon: Wrench,
        order: 500,
        itemIds: [
            'job-queue',
            'scheduled-tasks',
            'settings-store',
            'global-settings',
            'system-announcements',
        ],
    },
] as const;

const groupedItemIds = new Set<string>(settingsGroups.flatMap(group => group.itemIds));
const settingsGroupIds = new Set<string>(settingsGroups.map(group => group.id));

function isSection(item: NavMenuItem | NavMenuSection): item is NavMenuSection {
    return 'items' in item;
}

function updateItemTitle(item: NavMenuItem, titles: OperationsNavigationTitles): NavMenuItem {
    const titleById: Record<string, string> = {
        products: titles.productList,
        'product-variants': titles.skuAndInventory,
        'option-groups': titles.specificationTemplates,
        facets: titles.productAttributes,
        collections: titles.productGroups,
        orders: titles.orderManagement,
        'stock-locations': titles.warehouses,
        channels: titles.stores,
    };
    return titleById[item.id] ? { ...item, title: titleById[item.id] } : item;
}

function allItems(config: NavMenuConfig): NavMenuItem[] {
    return config.sections.flatMap(section => (isSection(section) ? (section.items ?? []) : [section]));
}

function takeItems(
    config: NavMenuConfig,
    ids: readonly string[],
    titles: OperationsNavigationTitles,
): NavMenuItem[] {
    const itemsById = new Map(allItems(config).map(item => [item.id, updateItemTitle(item, titles)]));
    return ids.flatMap(id => {
        const item = itemsById.get(id);
        return item ? [item] : [];
    });
}

function withSectionOrder(items: NavMenuItem[]): NavMenuItem[] {
    return items.map((item, index) => ({ ...item, order: (index + 1) * 100 }));
}

function ungroupedSettingsItems(config: NavMenuConfig, titles: OperationsNavigationTitles): NavMenuItem[] {
    return config.sections
        .filter(
            section =>
                (section.id === 'settings' || section.id === 'system' || settingsGroupIds.has(section.id)) &&
                isSection(section),
        )
        .flatMap(section => (isSection(section) ? (section.items ?? []) : []))
        .filter(item => !groupedItemIds.has(item.id) && !relocatedItemIds.has(item.id))
        .map(item => updateItemTitle(item, titles));
}

export function organizeOperationsNavigation(
    config: NavMenuConfig,
    titles: OperationsNavigationTitles,
): NavMenuConfig {
    const titleBySectionId: Record<string, string> = {
        insights: titles.workbench,
        catalog: titles.productCenter,
        sales: titles.orderCenter,
        customers: titles.customerCenter,
        marketing: titles.marketingCenter,
    };
    const stockAndShippingItems = takeItems(config, ['stock-locations', 'shipping-methods'], titles);
    const storefrontDesignItems = withSectionOrder(takeItems(config, storefrontDesignItemIds, titles));
    const sections: Array<NavMenuItem | NavMenuSection> = [];

    for (const section of config.sections) {
        if (
            section.id === 'settings' ||
            section.id === 'system' ||
            section.id === storefrontDesignSectionId ||
            settingsGroupIds.has(section.id) ||
            relocatedItemIds.has(section.id)
        ) {
            continue;
        }
        const title = titleBySectionId[section.id];
        if (!isSection(section)) {
            sections.push(title ? { ...section, title } : section);
            continue;
        }
        const ownItems = (section.items ?? [])
            .filter(item => !relocatedItemIds.has(item.id))
            .map(item => updateItemTitle(item, titles));
        sections.push({
            ...section,
            ...(title ? { title } : {}),
            items: section.id === 'catalog' ? [...ownItems, ...stockAndShippingItems] : ownItems,
        });
    }

    if (storefrontDesignItems.length) {
        sections.push({
            id: storefrontDesignSectionId,
            title: titles.storefrontDesign,
            icon: PanelsTopLeft,
            order: 900,
            placement: 'top',
            items: storefrontDesignItems,
        });
    }

    const ungroupedItems = ungroupedSettingsItems(config, titles);
    for (const group of settingsGroups) {
        const knownItems = takeItems(config, group.itemIds, titles);
        const items = group.id === 'system-operations' ? [...knownItems, ...ungroupedItems] : knownItems;
        if (items.length === 0) {
            continue;
        }
        sections.push({
            id: group.id,
            title: titles[group.titleKey],
            icon: group.icon,
            order: group.order,
            placement: 'bottom',
            items: withSectionOrder(items),
        });
    }

    return { sections };
}
