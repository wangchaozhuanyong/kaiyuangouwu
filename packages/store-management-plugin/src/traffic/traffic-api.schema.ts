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

    extend type Query {
        storefrontTraffic(days: Int = 7): StorefrontTrafficReport!
    }
`;

export const trafficShopSchema = gql`
    input StorefrontPageViewInput {
        eventId: String!
        visitorId: String
        pageView: Boolean!
    }

    extend type Mutation {
        recordStorefrontPageView(input: StorefrontPageViewInput!): StorefrontVisitResult!
    }
`;
