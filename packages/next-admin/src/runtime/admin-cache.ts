import { InMemoryCache, type TypePolicies } from '@apollo/client';
import { CUSTOM_FIELD_POSSIBLE_TYPES } from '../custom-fields/custom-fields.graphql';

const customFieldEntities = [
    'Product',
    'ProductVariant',
    'Order',
    'OrderLine',
    'Customer',
    'Asset',
    'Collection',
    'Administrator',
    'Channel',
    'Seller',
    'StockLocation',
    'PaymentMethod',
    'ShippingMethod',
];
const typePolicies: TypePolicies = Object.fromEntries(
    customFieldEntities.map(entity => [
        entity,
        {
            // Different views select different custom fields on the same entity. Missing fields
            // mean "not selected", while an explicit null still clears the selected value.
            fields: { customFields: { merge: true } },
        },
    ]),
);
for (const entity of ['Product', 'Order', 'Asset', 'Collection', 'Administrator', 'Customer'])
    typePolicies[entity].keyFields = ['id'];
typePolicies.StorePaymentDetail = { keyFields: ['id', 'channelId'] };

/** Shared by production and local acceptance fixtures; scope clearing remains in apollo.ts. */
export function createAdminCache() {
    return new InMemoryCache({
        possibleTypes: {
            ...CUSTOM_FIELD_POSSIBLE_TYPES,
            StockMovement: ['StockAdjustment', 'Allocation', 'Sale', 'Cancellation', 'Return', 'Release'],
        },
        typePolicies,
    });
}
