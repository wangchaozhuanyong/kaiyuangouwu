import { gql } from 'graphql-tag';

export interface MarketingAttributionMetric {
    source: string;
    medium: string;
    campaign: string;
    searchTerms: string[];
    visitorCount: number;
    productViewCount: number;
    checkoutViewCount: number;
    orderCount: number;
    conversionRate: number | null;
    netRevenueMicrounits: number;
    campaignCostMicrounits: number;
    refundAdjustedRoas: number | null;
    refundAdjustedRoi: number | null;
}

export interface MarketingAttributionResult {
    marketingAttributionReport: {
        currencyCode: string;
        attributionModel: string;
        summary: MarketingAttributionMetric;
        items: MarketingAttributionMetric[];
    };
}

export const marketingAttributionQuery = gql`
    query DashboardMarketingAttribution($input: MarketingAttributionReportInput!) {
        marketingAttributionReport(input: $input) {
            currencyCode
            attributionModel
            summary {
                source
                medium
                campaign
                searchTerms
                visitorCount
                productViewCount
                checkoutViewCount
                orderCount
                conversionRate
                netRevenueMicrounits
                campaignCostMicrounits
                refundAdjustedRoas
                refundAdjustedRoi
            }
            items {
                source
                medium
                campaign
                searchTerms
                visitorCount
                productViewCount
                checkoutViewCount
                orderCount
                conversionRate
                netRevenueMicrounits
                campaignCostMicrounits
                refundAdjustedRoas
                refundAdjustedRoi
            }
        }
    }
`;

export const recordMarketingCostMutation = gql`
    mutation DashboardRecordMarketingCost($input: RecordMarketingCampaignCostInput!) {
        recordMarketingCampaignCost(input: $input) {
            id
        }
    }
`;
