import { graphql } from '@vendure/dashboard';

export const storeOverviewQuery = graphql(`
    query StoreOverview($startDate: DateTime!, $endDate: DateTime!) {
        dashboardMetricSummary(
            input: {
                types: [OrderCount, OrderTotal]
                refresh: true
                startDate: $startDate
                endDate: $endDate
            }
        ) {
            type
            entries {
                value
            }
        }
    }
`);
