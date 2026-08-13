import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

interface TranslationRuntime {
    _(descriptor: MessageDescriptor): string;
}

const bulkActionEntityLabels = {
    administrators: msg({ id: 'nav.administrators', message: 'Administrators' }),
    'api keys': msg({ id: 'nav.apiKeys', message: 'API keys' }),
    channels: msg({ id: 'nav.channels', message: 'Sales channels' }),
    collections: msg({ id: 'nav.collections', message: 'Product groups' }),
    countries: msg({ id: 'nav.countries', message: 'Countries & regions' }),
    'customer groups': msg({ id: 'nav.customerGroups', message: 'Customer groups' }),
    customers: msg({ id: 'nav.customers', message: 'Customers' }),
    facets: msg({ id: 'nav.facets', message: 'Filter attributes' }),
    'facet values': msg({ id: 'entity.facetValues', message: 'Filter attribute values' }),
    'option groups': msg({ id: 'nav.optionGroups', message: 'Option groups' }),
    'payment methods': msg({ id: 'nav.paymentMethods', message: 'Payment methods' }),
    'product variants': msg({ id: 'nav.productVariants', message: 'Product SKUs' }),
    products: msg({ id: 'nav.products', message: 'Products' }),
    promotions: msg({ id: 'nav.promotions', message: 'Promotions' }),
    roles: msg({ id: 'nav.roles', message: 'Roles & permissions' }),
    sellers: msg({ id: 'nav.sellers', message: 'Sellers' }),
    'shipping methods': msg({ id: 'nav.shippingMethods', message: 'Shipping methods' }),
    'tax categories': msg({ id: 'nav.taxCategories', message: 'Tax categories' }),
    'tax rates': msg({ id: 'nav.taxRates', message: 'Tax rates' }),
    zones: msg({ id: 'nav.zones', message: 'Business zones' }),
} satisfies Record<string, MessageDescriptor>;

export type BulkActionEntityName = keyof typeof bulkActionEntityLabels;

export function getBulkActionEntityLabel(i18n: TranslationRuntime, entityName: BulkActionEntityName): string {
    return i18n._(bulkActionEntityLabels[entityName]);
}
