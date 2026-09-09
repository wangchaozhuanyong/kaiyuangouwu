import { gql } from 'graphql-tag';

export const storeCustomerCouponSchema = gql`
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
