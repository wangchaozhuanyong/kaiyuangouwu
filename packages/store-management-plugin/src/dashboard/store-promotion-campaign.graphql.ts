import { gql } from 'graphql-tag';

export const storeCouponCampaignsQuery = gql`
    query StoreCouponCampaigns {
        storeCouponCampaigns {
            id
            name
            kind
            enabled
            startsAt
            endsAt
            minimumSpend
            currencyCode
            discountAmount
            discountRate
            collectionIds
            productVariantIds
            usageLimit
            perCustomerUsageLimit
            claimStartsAt
            claimEndsAt
            validityDays
            issueLimit
            perCustomerClaimLimit
            stackPolicy
            returnOnCancellation
            returnOnFullRefund
            remainingIssueCount
            claimedCount
            availableCount
            lockedCount
            usedCount
            returnedCount
            expiredCount
            revokedCount
            redeemedOrderCount
            refundedOrderCount
            discountAmountTotal
            assistedRevenueTotal
            financialTotals {
                currencyCode
                discountAmountTotal
                assistedRevenueTotal
            }
        }
    }
`;

export const storeCouponLedgerQuery = gql`
    query StoreCouponLedger(
        $skip: Int!
        $take: Int!
        $campaignId: ID
        $eventType: StoreCouponLedgerEventType
    ) {
        storeCouponCampaigns {
            id
            name
        }
        storeCouponLedger(
            options: { skip: $skip, take: $take, campaignId: $campaignId, eventType: $eventType }
        ) {
            totalItems
            items {
                id
                createdAt
                eventType
                actorType
                campaignId
                campaignName
                customerCouponId
                customerId
                customerName
                customerEmail
                orderId
                orderCode
                refundId
                discountAmount
                note
            }
        }
    }
`;

export const storeFlashSalesQuery = gql`
    query StoreFlashSales {
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
    }
`;

export const storeCouponFormOptionsQuery = gql`
    query StoreCouponFormOptions {
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

export const storeCouponDailyReportQuery = gql`
    query StoreCouponDailyReport($from: DateTime!, $to: DateTime!, $campaignId: ID) {
        storeCouponDailyReport(from: $from, to: $to, campaignId: $campaignId) {
            date
            currencyCode
            claimedCount
            redeemedCount
            refundedCount
            returnedCount
            expiredCount
            revokedCount
            discountAmountTotal
            assistedRevenueTotal
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
    mutation SetStorePromotionEnabled($id: ID!, $enabled: Boolean!, $password: String!) {
        setStorePromotionEnabled(id: $id, enabled: $enabled, password: $password) {
            id
            enabled
        }
    }
`;

export const updateStorePromotionNameMutation = gql`
    mutation UpdateStorePromotionName($id: ID!, $name: String!) {
        updateStorePromotionName(id: $id, name: $name) {
            id
            name
        }
    }
`;

export const stopStoreCouponIssuanceMutation = gql`
    mutation StopStoreCouponIssuance($id: ID!, $password: String!) {
        stopStoreCouponIssuance(id: $id, password: $password) {
            id
            claimEndsAt
        }
    }
`;

export const revokeStoreCouponCampaignOutstandingMutation = gql`
    mutation RevokeStoreCouponCampaignOutstanding($id: ID!, $password: String!, $reason: String) {
        revokeStoreCouponCampaignOutstanding(id: $id, password: $password, reason: $reason) {
            campaignId
            affectedCount
        }
    }
`;

export const deleteStorePromotionMutation = gql`
    mutation DeleteStorePromotion($id: ID!, $password: String!) {
        deleteStorePromotion(id: $id, password: $password) {
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
    kind: StoreCouponKind;
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    minimumSpend: number;
    currencyCode: string;
    discountAmount: number | null;
    discountRate: number | null;
    collectionIds: string[];
    productVariantIds: string[];
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
    claimStartsAt: string | null;
    claimEndsAt: string | null;
    validityDays: number | null;
    issueLimit: number | null;
    perCustomerClaimLimit: number;
    stackPolicy: 'EXCLUSIVE' | 'STACKABLE';
    returnOnCancellation: boolean;
    returnOnFullRefund: boolean;
    remainingIssueCount: number | null;
    claimedCount: number;
    availableCount: number;
    lockedCount: number;
    usedCount: number;
    returnedCount: number;
    expiredCount: number;
    revokedCount: number;
    redeemedOrderCount: number;
    refundedOrderCount: number;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
    financialTotals: Array<{
        currencyCode: string;
        discountAmountTotal: number;
        assistedRevenueTotal: number;
    }>;
}

export interface StoreCouponLedgerRecord {
    id: string;
    createdAt: string;
    eventType:
        | 'CLAIMED'
        | 'LOCKED'
        | 'RELEASED'
        | 'REDEEMED'
        | 'RETURNED'
        | 'EXPIRED'
        | 'REVOKED'
        | 'REFUND_SETTLED';
    actorType: string;
    campaignId: string;
    campaignName: string;
    customerCouponId: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    orderId: string | null;
    orderCode: string | null;
    refundId: string | null;
    discountAmount: number | null;
    note: string | null;
}

export interface StoreCouponDailyMetricRecord {
    date: string;
    currencyCode: string;
    claimedCount: number;
    redeemedCount: number;
    refundedCount: number;
    returnedCount: number;
    expiredCount: number;
    revokedCount: number;
    discountAmountTotal: number;
    assistedRevenueTotal: number;
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
}

export interface StoreCouponLedgerResult {
    storeCouponCampaigns: Array<Pick<StoreCouponRecord, 'id' | 'name'>>;
    storeCouponLedger: { items: StoreCouponLedgerRecord[]; totalItems: number };
}

export interface StoreFlashSalesResult {
    storeFlashSales: StoreFlashSaleRecord[];
}

export interface StoreCouponFormOptionsResult {
    collections: { items: Array<{ id: string; name: string }> };
}

export interface StoreCouponDailyReportResult {
    storeCouponDailyReport: StoreCouponDailyMetricRecord[];
}

export interface StorePromotionProductRecord {
    id: string;
    name: string;
    variants: Array<{ id: string; name: string; priceWithTax: number; currencyCode: string }>;
}

export interface StorePromotionProductsResult {
    products: { items: StorePromotionProductRecord[] };
}
