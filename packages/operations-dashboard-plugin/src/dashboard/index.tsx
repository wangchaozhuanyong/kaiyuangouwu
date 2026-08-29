import { msg } from '@lingui/core/macro';
import { defineDashboardExtension } from '@vendure/dashboard';

import { afterSalesRoute } from './after-sales-page';
import { autoCardRoute } from './auto-card-page';
import { organizeOperationsNavigation, type OperationsNavigationTitles } from './operations-navigation';
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
    productList: msg({ id: 'operations.nav.productList', message: 'Product list' }),
    skuAndInventory: msg({ id: 'operations.nav.skuAndInventory', message: 'SKUs & inventory' }),
    productGroups: msg({ id: 'operations.nav.productGroups', message: 'Product groups' }),
    specificationTemplates: msg({
        id: 'operations.nav.specificationTemplates',
        message: 'Specification templates',
    }),
    productAttributes: msg({ id: 'operations.nav.productAttributes', message: 'Product attributes' }),
    warehouses: msg({ id: 'operations.nav.warehouses', message: 'Warehouses' }),
    stores: msg({ id: 'operations.nav.stores', message: 'Stores' }),
    storefrontDesign: msg({ id: 'operations.nav.storefrontDesign', message: 'Storefront design' }),
};

const navigationTitles = {
    workbench: navigationMessages.workbench.id,
    productCenter: navigationMessages.productCenter.id,
    orderCenter: navigationMessages.orderCenter.id,
    orderManagement: navigationMessages.orderManagement.id,
    customerCenter: navigationMessages.customerCenter.id,
    marketingCenter: navigationMessages.marketingCenter.id,
    storeSettings: navigationMessages.storeSettings.id,
    systemManagement: navigationMessages.systemManagement.id,
    productList: navigationMessages.productList.id,
    skuAndInventory: navigationMessages.skuAndInventory.id,
    productGroups: navigationMessages.productGroups.id,
    specificationTemplates: navigationMessages.specificationTemplates.id,
    productAttributes: navigationMessages.productAttributes.id,
    warehouses: navigationMessages.warehouses.id,
    stores: navigationMessages.stores.id,
    storefrontDesign: navigationMessages.storefrontDesign.id,
} satisfies OperationsNavigationTitles;

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
    navSections: config => organizeOperationsNavigation(config, navigationTitles),
});
