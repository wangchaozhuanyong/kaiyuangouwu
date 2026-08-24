import { msg } from '@lingui/core/macro';
import { defineDashboardExtension, NavMenuConfig, NavMenuItem, NavMenuSection } from '@vendure/dashboard';
import { Boxes, ShieldCheck } from 'lucide-react';

import { afterSalesRoute } from './after-sales-page';
import { autoCardRoute } from './auto-card-page';
import { OperationsTodoWidget } from './operations-todo-widget';
import { reviewModerationRoute } from './review-moderation-page';
import { StoreOverviewWidget } from './store-overview-widget';

const navigationMessages = {
    workbench: msg({ id: 'operations.nav.workbench', message: 'Workspace' }),
    productCenter: msg({ id: 'operations.nav.productCenter', message: 'Product center' }),
    orderCenter: msg({ id: 'operations.nav.orderCenter', message: 'Order center' }),
    orderManagement: msg({ id: 'operations.nav.orderManagement', message: 'Order management' }),
    customerCenter: msg({ id: 'operations.nav.customerCenter', message: 'Customer center' }),
    marketingCenter: msg({ id: 'operations.nav.marketingCenter', message: 'Marketing center' }),
    inventoryAndFulfillment: msg({
        id: 'operations.nav.inventoryAndFulfillment',
        message: 'Inventory & fulfillment',
    }),
    storeSettings: msg({ id: 'operations.nav.storeSettings', message: 'Store settings' }),
    accountsAndAccess: msg({ id: 'operations.nav.accountsAndAccess', message: 'Accounts & access' }),
    systemManagement: msg({ id: 'operations.nav.systemManagement', message: 'System management' }),
    skuAndInventory: msg({ id: 'operations.nav.skuAndInventory', message: 'SKUs & inventory' }),
    productGroups: msg({ id: 'operations.nav.productGroups', message: 'Product groups' }),
    specificationTemplates: msg({
        id: 'operations.nav.specificationTemplates',
        message: 'Specification templates',
    }),
    productAttributes: msg({ id: 'operations.nav.productAttributes', message: 'Product attributes' }),
    warehouses: msg({ id: 'operations.nav.warehouses', message: 'Warehouses' }),
    stores: msg({ id: 'operations.nav.stores', message: 'Stores' }),
};

const movedItemIds = new Set(['stock-locations', 'shipping-methods', 'administrators', 'roles']);

function isSection(item: NavMenuItem | NavMenuSection): item is NavMenuSection {
    return 'items' in item;
}

function updateItemTitle(item: NavMenuItem): NavMenuItem {
    const titleById: Record<string, string> = {
        'product-variants': navigationMessages.skuAndInventory.id,
        'option-groups': navigationMessages.specificationTemplates.id,
        facets: navigationMessages.productAttributes.id,
        collections: navigationMessages.productGroups.id,
        orders: navigationMessages.orderManagement.id,
        'stock-locations': navigationMessages.warehouses.id,
        channels: navigationMessages.stores.id,
    };
    return titleById[item.id] ? { ...item, title: titleById[item.id] } : item;
}

function takeItems(config: NavMenuConfig, ids: string[]): NavMenuItem[] {
    const itemsById = new Map<string, NavMenuItem>();
    for (const section of config.sections) {
        if (!isSection(section)) {
            continue;
        }
        for (const item of section.items ?? []) {
            if (ids.includes(item.id)) {
                itemsById.set(item.id, updateItemTitle(item));
            }
        }
    }
    return ids.flatMap(id => {
        const item = itemsById.get(id);
        return item ? [item] : [];
    });
}

defineDashboardExtension({
    routes: [afterSalesRoute, autoCardRoute, reviewModerationRoute],
    widgets: [
        {
            id: 'store-overview-widget',
            name: 'All-store performance',
            order: 50,
            component: StoreOverviewWidget,
            defaultSize: { w: 12, h: 4, x: 0, y: 0 },
            minSize: { w: 8, h: 4 },
            requiresPermissions: ['ReadOrder'],
        },
        {
            id: 'operations-todo-widget',
            name: 'Order tasks',
            order: 100,
            component: OperationsTodoWidget,
            defaultSize: { w: 12, h: 3, x: 0, y: 0 },
            minSize: { w: 6, h: 3 },
            requiresPermissions: ['ReadOrder'],
        },
    ],
    navSections: (config: NavMenuConfig): NavMenuConfig => {
        const titleBySectionId: Record<string, string> = {
            insights: navigationMessages.workbench.id,
            catalog: navigationMessages.productCenter.id,
            sales: navigationMessages.orderCenter.id,
            customers: navigationMessages.customerCenter.id,
            marketing: navigationMessages.marketingCenter.id,
            settings: navigationMessages.storeSettings.id,
            system: navigationMessages.systemManagement.id,
        };
        const stockAndShippingItems = takeItems(config, ['stock-locations', 'shipping-methods']);
        const accessItems = takeItems(config, ['administrators', 'roles']);

        const sections = config.sections.map(section => {
            const title = titleBySectionId[section.id];
            if (!isSection(section)) {
                return title ? { ...section, title } : section;
            }
            return {
                ...section,
                ...(title ? { title } : {}),
                items: (section.items ?? []).filter(item => !movedItemIds.has(item.id)).map(updateItemTitle),
            };
        });

        if (stockAndShippingItems.length) {
            sections.push({
                id: 'inventory-and-fulfillment',
                title: navigationMessages.inventoryAndFulfillment.id,
                icon: Boxes,
                order: 550,
                placement: 'top',
                items: stockAndShippingItems,
            });
        }
        if (accessItems.length) {
            sections.push({
                id: 'accounts-and-access',
                title: navigationMessages.accountsAndAccess.id,
                icon: ShieldCheck,
                order: 150,
                placement: 'bottom',
                items: accessItems,
            });
        }

        return { sections };
    },
});
