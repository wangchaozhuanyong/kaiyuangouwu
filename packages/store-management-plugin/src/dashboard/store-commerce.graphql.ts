import { gql } from 'graphql-tag';

const storeCommerceConfigurationFields = gql`
    fragment StoreCommerceConfigurationFields on StoreCommerceConfiguration {
        channelId
        channelCode
        updatedAt
        currencyCode
        pricesIncludeTax
        countryCode
        taxRate
        taxCategoryName
        taxZoneName
        shippingZoneName
        shippingMethodId
        shippingMethodCode
        shippingMethodNameZh
        shippingMethodNameEn
        shippingDescriptionZh
        shippingDescriptionEn
        baseRate
        freeShippingThreshold
        shippingTaxRate
        shippingPriceIncludesTax
        estimateMinDays
        estimateMaxDays
        blockedPostalPrefixes
        ready
    }
`;

export const myStoreCommerceConfigurationQuery = gql`
    ${storeCommerceConfigurationFields}

    query MyStoreCommerceConfiguration {
        myStoreCommerceMode {
            mode
            conflicts {
                code
                message
                entityId
            }
        }
        myStoreCommerceConfiguration {
            ...StoreCommerceConfigurationFields
        }
        countries(options: { take: 250, sort: { name: ASC } }) {
            items {
                id
                code
                name
                enabled
            }
        }
    }
`;

export const myStoreCommerceModeQuery = gql`
    query MyStoreCommerceModeForNavigation {
        myStoreCommerceMode {
            mode
        }
    }
`;

export const updateMyStoreCommerceModeMutation = gql`
    mutation UpdateMyStoreCommerceMode($mode: StoreCommerceMode!) {
        updateMyStoreCommerceMode(mode: $mode) {
            mode
            conflicts {
                code
                message
                entityId
            }
        }
    }
`;

export type StoreCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';

export interface MyStoreCommerceModeResult {
    myStoreCommerceMode: {
        mode: StoreCommerceMode;
    };
}

export const updateMyStoreCommerceConfigurationMutation = gql`
    ${storeCommerceConfigurationFields}

    mutation UpdateMyStoreCommerceConfiguration($input: UpdateMyStoreCommerceConfigurationInput!) {
        updateMyStoreCommerceConfiguration(input: $input) {
            ...StoreCommerceConfigurationFields
        }
    }
`;

export interface StoreCommerceConfigurationRecord {
    channelId: string;
    channelCode: string;
    updatedAt: string;
    currencyCode: string;
    pricesIncludeTax: boolean;
    countryCode: string | null;
    taxRate: number;
    taxCategoryName: string | null;
    taxZoneName: string | null;
    shippingZoneName: string | null;
    shippingMethodId: string | null;
    shippingMethodCode: string;
    shippingMethodNameZh: string;
    shippingMethodNameEn: string;
    shippingDescriptionZh: string;
    shippingDescriptionEn: string;
    baseRate: number;
    freeShippingThreshold: number;
    shippingTaxRate: number;
    shippingPriceIncludesTax: boolean;
    estimateMinDays: number;
    estimateMaxDays: number;
    blockedPostalPrefixes: string;
    ready: boolean;
}

export interface StoreCountryRecord {
    id: string;
    code: string;
    name: string;
    enabled: boolean;
}

export interface MyStoreCommerceConfigurationResult {
    myStoreCommerceMode: {
        mode: StoreCommerceMode;
        conflicts: Array<{ code: string; message: string; entityId: string }>;
    };
    myStoreCommerceConfiguration: StoreCommerceConfigurationRecord;
    countries: { items: StoreCountryRecord[] };
}

export interface UpdateMyStoreCommerceModeResult {
    updateMyStoreCommerceMode: {
        mode: StoreCommerceMode;
        conflicts: Array<{ code: string; message: string; entityId: string }>;
    };
}

export interface UpdateMyStoreCommerceConfigurationResult {
    updateMyStoreCommerceConfiguration: StoreCommerceConfigurationRecord;
}
