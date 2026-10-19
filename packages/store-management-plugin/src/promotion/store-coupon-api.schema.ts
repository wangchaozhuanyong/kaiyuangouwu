import { gql } from 'graphql-tag';

export const storeCouponCommonSchema = gql`
    enum StoreCouponCustomerEligibility {
        ALL
        NEW
        RETURNING
    }

    enum StoreCouponCampaignKind {
        ORDER_FIXED
        ORDER_PERCENTAGE
        COLLECTION_PERCENTAGE
        PRODUCT_PERCENTAGE
    }

    enum StoreCouponAppearanceTheme {
        rose
        gold
        blue
        emerald
    }

    enum StoreCouponStackPolicy {
        EXCLUSIVE
        STACKABLE
    }

    enum StoreCustomerCouponStatus {
        AVAILABLE
        LOCKED
        USED
        RETURNED
        EXPIRED
        REVOKED
    }
`;

export const storeCustomerCouponSchema = gql`
    input StoreCouponPageOptions {
        skip: Int
        take: Int
        statuses: [String!]
        usableOnly: Boolean
    }
    type StoreCustomerCouponList {
        items: [StoreCustomerCoupon!]!
        totalItems: Int!
    }
    type StoreCouponUsageRecordList {
        items: [StoreCouponUsageRecord!]!
        totalItems: Int!
    }

    type StoreCustomerCoupon {
        customerEligibility: StoreCouponCustomerEligibility!
        id: ID!
        campaignId: ID!
        campaignName: String!
        campaignKind: StoreCouponCampaignKind!
        appearanceTheme: StoreCouponAppearanceTheme
        status: StoreCustomerCouponStatus!
        minimumSpend: Money!
        currencyCode: CurrencyCode!
        discountAmount: Money
        discountRate: Float
        collectionIds: [ID!]!
        productVariantIds: [ID!]!
        claimedAt: DateTime!
        validFrom: DateTime!
        validUntil: DateTime
        lockedAt: DateTime
        usedAt: DateTime
        returnedAt: DateTime
        expiredAt: DateTime
        lockedOrderId: ID
        usedOrderId: ID
        returnCount: Int!
        usable: Boolean!
    }
`;
