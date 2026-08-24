import { gql } from 'graphql-tag';

export const storePromotionCampaignsQuery = gql`
    query StorePromotionCampaigns {
        storeCouponCampaigns {
            id
            name
            couponCode
            kind
            enabled
            startsAt
            endsAt
            minimumSpend
            discountAmount
            discountRate
            collectionIds
            productVariantIds
            usageLimit
            perCustomerUsageLimit
        }
        storeFlashSales {
            id
            name
            enabled
            startsAt
            endsAt
            items {
                productId
                productVariantId
                productName
                variantName
                originalPrice
                salePrice
                currencyCode
            }
        }
        collections(options: { take: 200, sort: { name: ASC } }) {
            items {
                id
                name
            }
        }
    }
`;

export const storePromotionProductsQuery = gql`
    query StorePromotionProducts($ids: [String!]!, $take: Int!) {
        products(options: { take: $take, filter: { id: { in: $ids } } }) {
            items {
                id
                name
                variants {
                    id
                    name
                    priceWithTax
                    currencyCode
                }
            }
        }
    }
`;

export const createStoreCouponCampaignMutation = gql`
    mutation CreateStoreCouponCampaign($input: CreateStoreCouponCampaignInput!) {
        createStoreCouponCampaign(input: $input) {
            id
        }
    }
`;

export const createStoreFlashSaleMutation = gql`
    mutation CreateStoreFlashSale($input: CreateStoreFlashSaleInput!) {
        createStoreFlashSale(input: $input) {
            id
        }
    }
`;

export const setStorePromotionEnabledMutation = gql`
    mutation SetStorePromotionEnabled($id: ID!, $enabled: Boolean!) {
        setStorePromotionEnabled(id: $id, enabled: $enabled) {
            id
            enabled
        }
    }
`;

export const deleteStorePromotionMutation = gql`
    mutation DeleteStorePromotion($id: ID!) {
        deleteStorePromotion(id: $id) {
            result
            message
        }
    }
`;

export type StoreCouponKind =
    'ORDER_FIXED' | 'ORDER_PERCENTAGE' | 'COLLECTION_PERCENTAGE' | 'PRODUCT_PERCENTAGE';

export interface StoreCouponRecord {
    id: string;
    name: string;
    couponCode: string;
    kind: StoreCouponKind;
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    minimumSpend: number;
    discountAmount: number | null;
    discountRate: number | null;
    collectionIds: string[];
    productVariantIds: string[];
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
}

export interface StoreFlashSaleRecord {
    id: string;
    name: string;
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    items: Array<{
        productId: string;
        productVariantId: string;
        productName: string;
        variantName: string;
        originalPrice: number;
        salePrice: number;
        currencyCode: string;
    }>;
}

export interface StorePromotionCampaignsResult {
    storeCouponCampaigns: StoreCouponRecord[];
    storeFlashSales: StoreFlashSaleRecord[];
    collections: { items: Array<{ id: string; name: string }> };
}

export interface StorePromotionProductRecord {
    id: string;
    name: string;
    variants: Array<{ id: string; name: string; priceWithTax: number; currencyCode: string }>;
}

export interface StorePromotionProductsResult {
    products: { items: StorePromotionProductRecord[] };
}
