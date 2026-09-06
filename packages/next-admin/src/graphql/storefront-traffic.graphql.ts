import { gql } from '@apollo/client';

export const STOREFRONT_TRAFFIC_QUERY = gql`
    query NextAdminStorefrontTraffic($days: Int!) {
        storefrontTraffic(days: $days) {
            businessDate
            timezone
            firstRecordedAt
            lastRecordedAt
            days {
                businessDate
                visitorCount
                pageViewCount
                ipCount
            }
        }
    }
`;

export interface StorefrontTrafficDay {
    businessDate: string;
    visitorCount: number | null;
    pageViewCount: number | null;
    ipCount: number | null;
}

export interface StorefrontTrafficData {
    storefrontTraffic: {
        businessDate: string;
        timezone: string;
        firstRecordedAt: string | null;
        lastRecordedAt: string | null;
        days: StorefrontTrafficDay[];
    };
}
