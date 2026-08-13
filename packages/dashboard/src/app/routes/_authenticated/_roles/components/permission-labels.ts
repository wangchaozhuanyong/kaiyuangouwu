import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

const resourceLabels = {
    Administrator: msg({ id: 'permission.resource.administrator', message: 'Administrator' }),
    ApiKey: msg({ id: 'permission.resource.apiKey', message: 'API key' }),
    Asset: msg({ id: 'permission.resource.asset', message: 'Asset' }),
    Catalog: msg({ id: 'permission.resource.catalog', message: 'Catalog' }),
    Channel: msg({ id: 'permission.resource.channel', message: 'Store' }),
    Collection: msg({ id: 'permission.resource.collection', message: 'Collection' }),
    Country: msg({ id: 'permission.resource.country', message: 'Country' }),
    Customer: msg({ id: 'permission.resource.customer', message: 'Customer' }),
    CustomerGroup: msg({ id: 'permission.resource.customerGroup', message: 'Customer group' }),
    DashboardGlobalViews: msg({
        id: 'permission.resource.dashboardGlobalViews',
        message: 'Dashboard global views',
    }),
    Facet: msg({ id: 'permission.resource.facet', message: 'Facet' }),
    GlobalSettings: msg({ id: 'permission.resource.globalSettings', message: 'Global settings' }),
    Order: msg({ id: 'permission.resource.order', message: 'Order' }),
    PaymentMethod: msg({ id: 'permission.resource.paymentMethod', message: 'Payment method' }),
    Product: msg({ id: 'permission.resource.product', message: 'Product' }),
    Promotion: msg({ id: 'permission.resource.promotion', message: 'Promotion' }),
    Seller: msg({ id: 'permission.resource.seller', message: 'Seller' }),
    Settings: msg({ id: 'permission.resource.settings', message: 'Settings' }),
    ShippingMethod: msg({ id: 'permission.resource.shippingMethod', message: 'Shipping method' }),
    StockLocation: msg({ id: 'permission.resource.stockLocation', message: 'Stock location' }),
    System: msg({ id: 'permission.resource.system', message: 'System' }),
    Tag: msg({ id: 'permission.resource.tag', message: 'Tag' }),
    TaxCategory: msg({ id: 'permission.resource.taxCategory', message: 'Tax category' }),
    TaxRate: msg({ id: 'permission.resource.taxRate', message: 'Tax rate' }),
    Zone: msg({ id: 'permission.resource.zone', message: 'Zone' }),
} satisfies Record<string, MessageDescriptor>;

const actionLabels = {
    Create: msg`Create`,
    Read: msg`Read`,
    Update: msg`Update`,
    Delete: msg`Delete`,
    Write: msg`Write`,
} satisfies Record<string, MessageDescriptor>;

const standalonePermissionLabels = {
    Authenticated: msg({ id: 'permission.authenticated', message: 'Authenticated user' }),
    Owner: msg({ id: 'permission.owner', message: 'Resource owner' }),
    Public: msg({ id: 'permission.public', message: 'Public access' }),
    SuperAdmin: msg({ id: 'permission.superAdmin', message: 'Super administrator' }),
} satisfies Record<string, MessageDescriptor>;

export interface PermissionDisplay {
    action: string;
    description: string;
    fullLabel: string;
    resource: string;
}

interface TranslationRuntime {
    _(descriptor: MessageDescriptor): string;
}

export function getPermissionDisplay(i18n: TranslationRuntime, permissionName: string): PermissionDisplay {
    const match = /^(Create|Read|Update|Delete|Write)(.+)$/.exec(permissionName);
    if (!match) {
        const descriptor =
            standalonePermissionLabels[permissionName as keyof typeof standalonePermissionLabels];
        if (descriptor) {
            const label = i18n._(descriptor);
            return { action: label, description: label, fullLabel: label, resource: label };
        }
        return {
            action: permissionName,
            description: permissionName,
            fullLabel: permissionName,
            resource: permissionName,
        };
    }

    const [, actionKey, resourceKey] = match;
    const actionDescriptor = actionLabels[actionKey as keyof typeof actionLabels];
    const resourceDescriptor = resourceLabels[resourceKey as keyof typeof resourceLabels];
    if (!actionDescriptor || !resourceDescriptor) {
        return {
            action: permissionName,
            description: permissionName,
            fullLabel: permissionName,
            resource: permissionName,
        };
    }

    const action = i18n._(actionDescriptor);
    const resource = i18n._(resourceDescriptor);
    return {
        action,
        resource,
        fullLabel: `${action}${resource}`,
        description: `${action}${resource}`,
    };
}

export function getPermissionResourceLabel(i18n: TranslationRuntime, resourceName: string): string {
    const standaloneDescriptor =
        standalonePermissionLabels[resourceName as keyof typeof standalonePermissionLabels];
    if (standaloneDescriptor) {
        return i18n._(standaloneDescriptor);
    }
    const permissionMatch = /^(?:Create|Read|Update|Delete|Write)(.+)$/.exec(resourceName);
    if (permissionMatch) {
        return getPermissionResourceLabel(i18n, permissionMatch[1]);
    }
    const descriptor = resourceLabels[resourceName as keyof typeof resourceLabels];
    return descriptor ? i18n._(descriptor) : resourceName;
}
