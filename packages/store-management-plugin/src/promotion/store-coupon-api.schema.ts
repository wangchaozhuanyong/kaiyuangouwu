import { gql } from 'graphql-tag';

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
        id: ID!
        campaignId: ID!
        campaignName: String!
        campaignKind: StoreCouponCampaignKind!
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
