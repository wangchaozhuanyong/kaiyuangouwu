import { useMemo } from 'react';

import { addCustomFieldsToDocument } from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import { STORE_MANAGEMENT_QUERY, type StoreManagementResult } from '../../graphql/management.graphql';

export type StoreSettingsTab =
    'STORES' | 'DOMAINS' | 'SELLERS' | 'PAYMENT_SHIPPING' | 'BUSINESS' | 'CURRENCY' | 'USDT';

export const STORE_SETTINGS_TABS = {
    stores: 'STORES',
    domains: 'DOMAINS',
    sellers: 'SELLERS',
    'payment-shipping': 'PAYMENT_SHIPPING',
    business: 'BUSINESS',
    currency: 'CURRENCY',
    usdt: 'USDT',
} as const;

export function useStoreManagementDocument() {
    const sellerCustomFields = useCustomFieldDefinitions('Seller');
    const paymentMethodCustomFields = useCustomFieldDefinitions('PaymentMethod');
    const shippingMethodCustomFields = useCustomFieldDefinitions('ShippingMethod');
    const document = useMemo(() => {
        const withSellers = addCustomFieldsToDocument(STORE_MANAGEMENT_QUERY, 'Seller', sellerCustomFields);
        const withPaymentMethods = addCustomFieldsToDocument(
            withSellers,
            'PaymentMethod',
            paymentMethodCustomFields,
        );
        return addCustomFieldsToDocument(withPaymentMethods, 'ShippingMethod', shippingMethodCustomFields);
    }, [paymentMethodCustomFields, sellerCustomFields, shippingMethodCustomFields]);
    return { document, paymentMethodCustomFields, sellerCustomFields, shippingMethodCustomFields };
}

export function getInitializedStoreSettings(
    data: StoreManagementResult | undefined,
    errorPresent: boolean,
    initialSupplementSettled: boolean,
): StoreManagementResult | null {
    const hasIncompleteLists =
        data != null &&
        (data.sellers.items.length < data.sellers.totalItems ||
            data.paymentMethods.items.length < data.paymentMethods.totalItems ||
            data.shippingMethods.items.length < data.shippingMethods.totalItems);
    return data && (errorPresent || !hasIncompleteLists || initialSupplementSettled) ? data : null;
}
