import { gql } from 'graphql-tag';

export const trafficAdminSchema = gql`
    type StorefrontTrafficDay {
        businessDate: String!
        visitorCount: Int
        pageViewCount: Int
        ipCount: Int
    }

    type StorefrontTrafficReport {
        businessDate: String!
        timezone: String!
        firstRecordedAt: DateTime
        lastRecordedAt: DateTime
        days: [StorefrontTrafficDay!]!
    }

    input MarketingAttributionReportInput {
        from: DateTime!
        to: DateTime!
        currencyCode: CurrencyCode
    }

    type MarketingAttributionMetric {
        source: String!
        medium: String!
        campaign: String!
        term: String!
        content: String!
        searchTerms: [String!]!
        visitorCount: Int!
        pageViewCount: Int!
        productViewCount: Int!
        cartViewCount: Int!
        checkoutViewCount: Int!
        orderCount: Int!
        conversionRate: Float
        settledRevenueMicrounits: Float!
        refundedRevenueMicrounits: Float!
        netRevenueMicrounits: Float!
        campaignCostMicrounits: Float!
        refundAdjustedRoas: Float
        refundAdjustedRoi: Float
    }

    type MarketingCampaignCost {
        id: ID!
        createdAt: DateTime!
        businessDate: String!
        currencyCode: CurrencyCode!
        source: String!
        medium: String!
        campaign: String!
        amountMicrounits: Float!
        idempotencyKey: String!
        actorUserId: String
        reason: String!
    }

    input RecordMarketingCampaignCostInput {
        businessDate: String!
        currencyCode: CurrencyCode!
        source: String!
        medium: String
        campaign: String
        amountMicrounits: Float!
        idempotencyKey: String!
        reason: String!
    }

    type MarketingAttributionReport {
        from: DateTime!
        to: DateTime!
        currencyCode: CurrencyCode!
        attributionModel: String!
        summary: MarketingAttributionMetric!
        items: [MarketingAttributionMetric!]!
        costEntries: [MarketingCampaignCost!]!
    }
`;

export const trafficShopSchema = gql`
    input StorefrontPageViewInput {
        eventId: String!
        visitorId: String
        pageView: Boolean!
        path: String
        referrerHost: String
        source: String
        medium: String
        campaign: String
        term: String
        content: String
    }
`;
