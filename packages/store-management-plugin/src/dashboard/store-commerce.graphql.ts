import { gql } from 'graphql-tag';

const storeCommerceConfigurationFields = gql`
    fragment StoreCommerceConfigurationFields on StoreCommerceConfiguration {
        channelId
        channelCode
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
    myStoreCommerceConfiguration: StoreCommerceConfigurationRecord;
    countries: { items: StoreCountryRecord[] };
}

export interface UpdateMyStoreCommerceConfigurationResult {
    updateMyStoreCommerceConfiguration: StoreCommerceConfigurationRecord;
}
