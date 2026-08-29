import type { NavMenuConfig, NavMenuItem, NavMenuSection } from '@vendure/dashboard';
import { PanelsTopLeft } from 'lucide-react';

export interface OperationsNavigationTitles {
    workbench: string;
    productCenter: string;
    orderCenter: string;
    orderManagement: string;
    customerCenter: string;
    marketingCenter: string;
    storeSettings: string;
    systemManagement: string;
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
];
const movedItemIds = new Set([
    'stock-locations',
    'shipping-methods',
    'administrators',
    'roles',
    ...storefrontDesignItemIds,
]);

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

function takeItems(config: NavMenuConfig, ids: string[], titles: OperationsNavigationTitles): NavMenuItem[] {
    const itemsById = new Map<string, NavMenuItem>();
    for (const section of config.sections) {
        if (!isSection(section)) {
            continue;
        }
        for (const item of section.items ?? []) {
            if (ids.includes(item.id)) {
                itemsById.set(item.id, updateItemTitle(item, titles));
            }
        }
    }
    return ids.flatMap(id => {
        const item = itemsById.get(id);
        return item ? [item] : [];
    });
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
        settings: titles.storeSettings,
        system: titles.systemManagement,
    };
    const stockAndShippingItems = takeItems(config, ['stock-locations', 'shipping-methods'], titles);
    const accessItems = takeItems(config, ['administrators', 'roles'], titles);
    const storefrontDesignItems = takeItems(config, storefrontDesignItemIds, titles).map((item, index) => ({
        ...item,
        order: (index + 1) * 100,
    }));
    const systemItems = config.sections.flatMap(section =>
        section.id === 'system' && isSection(section)
            ? (section.items ?? []).map(item => updateItemTitle(item, titles))
            : [],
    );

    const sections: Array<NavMenuItem | NavMenuSection> = [];
    for (const section of config.sections) {
        if (section.id === 'system' || section.id === storefrontDesignSectionId) {
            continue;
        }
        const title = titleBySectionId[section.id];
        if (!isSection(section)) {
            sections.push(title ? { ...section, title } : section);
            continue;
        }
        const ownItems = (section.items ?? [])
            .filter(item => !movedItemIds.has(item.id))
            .map(item => updateItemTitle(item, titles));
        const items =
            section.id === 'catalog'
                ? [...ownItems, ...stockAndShippingItems]
                : section.id === 'settings'
                  ? [...ownItems, ...accessItems, ...systemItems]
                  : ownItems;
        sections.push({
            ...section,
            ...(title ? { title } : {}),
            items,
        });
    }

    if (storefrontDesignItems.length) {
        const settingsIndex = sections.findIndex(section => section.id === 'settings');
        sections.splice(settingsIndex < 0 ? sections.length : settingsIndex, 0, {
            id: storefrontDesignSectionId,
            title: titles.storefrontDesign,
            icon: PanelsTopLeft,
            order: 900,
            placement: 'top',
            items: storefrontDesignItems,
        });
    }

    return { sections };
}
