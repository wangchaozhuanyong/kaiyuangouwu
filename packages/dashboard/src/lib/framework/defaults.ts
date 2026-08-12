import { registerAlert } from '@/vdb/framework/alert/alert-extensions.js';
import { searchIndexBufferAlert } from '@/vdb/framework/alert/search-index-buffer-alert/search-index-buffer-alert.js';
import { setNavMenuConfig } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { msg } from '@lingui/core/macro';
import { ChartLine, Percent, Settings2, ShoppingBag, Tags, Terminal, Users } from 'lucide-react';

import { LatestOrdersWidget } from './dashboard-widget/latest-orders-widget/index.js';
import { MetricsWidget } from './dashboard-widget/metrics-widget/index.js';
import { OrdersSummaryWidget } from './dashboard-widget/orders-summary/index.js';
import { registerDashboardWidget } from './dashboard-widget/widget-extensions.js';

const navigationMessages = {
    insights: msg({ id: 'nav.insights', message: 'Business overview' }),
    catalog: msg({ id: 'nav.catalog', message: 'Product management' }),
    products: msg({ id: 'nav.products', message: 'Products' }),
    productVariants: msg({ id: 'nav.productVariants', message: 'Product SKUs' }),
    optionGroups: msg({ id: 'nav.optionGroups', message: 'Option groups' }),
    facets: msg({ id: 'nav.facets', message: 'Filter attributes' }),
    collections: msg({ id: 'nav.collections', message: 'Product groups' }),
    assets: msg({ id: 'nav.assets', message: 'Asset library' }),
    sales: msg({ id: 'nav.sales', message: 'Order management' }),
    orders: msg({ id: 'nav.orders', message: 'Orders' }),
    customersSection: msg({ id: 'nav.customersSection', message: 'Customer management' }),
    customers: msg({ id: 'nav.customers', message: 'Customers' }),
    customerGroups: msg({ id: 'nav.customerGroups', message: 'Customer groups' }),
    marketing: msg({ id: 'nav.marketing', message: 'Marketing' }),
    promotions: msg({ id: 'nav.promotions', message: 'Promotions' }),
    system: msg({ id: 'nav.system', message: 'System management' }),
    jobQueue: msg({ id: 'nav.jobQueue', message: 'Background tasks' }),
    scheduledTasks: msg({ id: 'nav.scheduledTasks', message: 'Scheduled tasks' }),
    settingsStore: msg({ id: 'nav.settingsStore', message: 'System configuration' }),
    apiKeys: msg({ id: 'nav.apiKeys', message: 'API keys' }),
    settings: msg({ id: 'nav.settings', message: 'Business settings' }),
    sellers: msg({ id: 'nav.sellers', message: 'Sellers' }),
    channels: msg({ id: 'nav.channels', message: 'Sales channels' }),
    stockLocations: msg({ id: 'nav.stockLocations', message: 'Warehouses & stock locations' }),
    administrators: msg({ id: 'nav.administrators', message: 'Administrators' }),
    roles: msg({ id: 'nav.roles', message: 'Roles & permissions' }),
    shippingMethods: msg({ id: 'nav.shippingMethods', message: 'Shipping methods' }),
    paymentMethods: msg({ id: 'nav.paymentMethods', message: 'Payment methods' }),
    taxCategories: msg({ id: 'nav.taxCategories', message: 'Tax categories' }),
    taxRates: msg({ id: 'nav.taxRates', message: 'Tax rates' }),
    countries: msg({ id: 'nav.countries', message: 'Countries & regions' }),
    zones: msg({ id: 'nav.zones', message: 'Business zones' }),
    globalSettings: msg({ id: 'nav.globalSettings', message: 'Global settings' }),
};

export function registerDefaults() {
    setNavMenuConfig({
        sections: [
            {
                id: 'insights',
                title: navigationMessages.insights.id,
                placement: 'top',
                icon: ChartLine,
                url: '/',
                order: 100,
            },
            {
                id: 'catalog',
                title: navigationMessages.catalog.id,
                icon: Tags,
                placement: 'top',
                order: 200,
                items: [
                    {
                        id: 'products',
                        title: navigationMessages.products.id,
                        url: '/products',
                        order: 100,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'product-variants',
                        title: navigationMessages.productVariants.id,
                        url: '/product-variants',
                        order: 200,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'option-groups',
                        title: navigationMessages.optionGroups.id,
                        url: '/option-groups',
                        order: 250,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'facets',
                        title: navigationMessages.facets.id,
                        url: '/facets',
                        order: 300,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'collections',
                        title: navigationMessages.collections.id,
                        url: '/collections',
                        order: 400,
                        requiresPermission: ['ReadCollection', 'ReadCatalog'],
                    },
                    {
                        id: 'assets',
                        title: navigationMessages.assets.id,
                        url: '/assets',
                        order: 500,
                        requiresPermission: ['ReadAsset', 'ReadCatalog'],
                    },
                ],
            },
            {
                id: 'sales',
                title: navigationMessages.sales.id,
                icon: ShoppingBag,
                placement: 'top',
                order: 300,
                items: [
                    {
                        id: 'orders',
                        title: navigationMessages.orders.id,
                        url: '/orders',
                        order: 100,
                        requiresPermission: ['ReadOrder'],
                    },
                ],
            },
            {
                id: 'customers',
                title: navigationMessages.customersSection.id,
                icon: Users,
                placement: 'top',
                order: 400,
                items: [
                    {
                        id: 'customers',
                        title: navigationMessages.customers.id,
                        url: '/customers',
                        order: 100,
                        requiresPermission: ['ReadCustomer'],
                    },
                    {
                        id: 'customer-groups',
                        title: navigationMessages.customerGroups.id,
                        url: '/customer-groups',
                        order: 200,
                        requiresPermission: ['ReadCustomerGroup'],
                    },
                ],
            },
            {
                id: 'marketing',
                title: navigationMessages.marketing.id,
                icon: Percent,
                placement: 'top',
                order: 500,
                items: [
                    {
                        id: 'promotions',
                        title: navigationMessages.promotions.id,
                        url: '/promotions',
                        order: 100,
                        requiresPermission: ['ReadPromotion'],
                    },
                ],
            },
            {
                id: 'system',
                title: navigationMessages.system.id,
                icon: Terminal,
                placement: 'bottom',
                order: 200,
                items: [
                    {
                        id: 'job-queue',
                        title: navigationMessages.jobQueue.id,
                        url: '/job-queue',
                        order: 100,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: 'scheduled-tasks',
                        title: navigationMessages.scheduledTasks.id,
                        url: '/scheduled-tasks',
                        order: 300,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: 'settings-store',
                        title: navigationMessages.settingsStore.id,
                        url: '/settings-store',
                        order: 400,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: 'api-keys',
                        title: navigationMessages.apiKeys.id,
                        url: '/api-keys',
                        order: 550,
                        requiresPermission: ['ReadApiKey'],
                    },
                ],
            },
            {
                id: 'settings',
                title: navigationMessages.settings.id,
                icon: Settings2,
                placement: 'bottom',
                order: 100,
                items: [
                    {
                        id: 'sellers',
                        title: navigationMessages.sellers.id,
                        url: '/sellers',
                        order: 100,
                        requiresPermission: ['ReadSeller'],
                    },
                    {
                        id: 'channels',
                        title: navigationMessages.channels.id,
                        url: '/channels',
                        order: 200,
                        requiresPermission: ['ReadChannel'],
                    },
                    {
                        id: 'stock-locations',
                        title: navigationMessages.stockLocations.id,
                        url: '/stock-locations',
                        order: 300,
                        requiresPermission: ['ReadStockLocation'],
                    },
                    {
                        id: 'administrators',
                        title: navigationMessages.administrators.id,
                        url: '/administrators',
                        order: 400,
                        requiresPermission: ['ReadAdministrator'],
                    },
                    {
                        id: 'roles',
                        title: navigationMessages.roles.id,
                        url: '/roles',
                        order: 500,
                        requiresPermission: ['ReadAdministrator'],
                    },
                    {
                        id: 'shipping-methods',
                        title: navigationMessages.shippingMethods.id,
                        url: '/shipping-methods',
                        order: 600,
                        requiresPermission: ['ReadShippingMethod'],
                    },
                    {
                        id: 'payment-methods',
                        title: navigationMessages.paymentMethods.id,
                        url: '/payment-methods',
                        order: 700,
                        requiresPermission: ['ReadPaymentMethod'],
                    },
                    {
                        id: 'tax-categories',
                        title: navigationMessages.taxCategories.id,
                        url: '/tax-categories',
                        order: 800,
                        requiresPermission: ['ReadTaxCategory'],
                    },
                    {
                        id: 'tax-rates',
                        title: navigationMessages.taxRates.id,
                        url: '/tax-rates',
                        order: 900,
                        requiresPermission: ['ReadTaxRate'],
                    },
                    {
                        id: 'countries',
                        title: navigationMessages.countries.id,
                        url: '/countries',
                        order: 1000,
                        requiresPermission: ['ReadCountry'],
                    },
                    {
                        id: 'zones',
                        title: navigationMessages.zones.id,
                        url: '/zones',
                        order: 1100,
                        requiresPermission: ['ReadZone'],
                    },
                    {
                        id: 'global-settings',
                        title: navigationMessages.globalSettings.id,
                        url: '/global-settings',
                        order: 1200,
                        requiresPermission: ['UpdateGlobalSettings'],
                    },
                ],
            },
        ],
    });

    registerDashboardWidget({
        id: 'metrics-widget',
        name: /* i18n*/ 'Metrics Widget',
        component: MetricsWidget,
        defaultSize: { w: 12, h: 6, x: 0, y: 0 },
        minSize: { w: 6, h: 4 },
        requiresPermissions: ['ReadOrder'],
    });

    registerDashboardWidget({
        id: 'latest-orders-widget',
        name: /* i18n*/ 'Latest Orders Widget',
        component: LatestOrdersWidget,
        defaultSize: { w: 6, h: 7, x: 0, y: 0 },
        requiresPermissions: ['ReadOrder'],
    });

    registerDashboardWidget({
        id: 'orders-summary-widget',
        name: /* i18n*/ 'Orders Summary Widget',
        component: OrdersSummaryWidget,
        defaultSize: { w: 6, h: 3, x: 6, y: 0 },
        requiresPermissions: ['ReadOrder'],
    });

    registerAlert(searchIndexBufferAlert);
}
