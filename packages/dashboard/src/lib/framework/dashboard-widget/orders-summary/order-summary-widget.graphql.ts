import { graphql } from '@/vdb/graphql/graphql.js';

export const orderSummaryQuery = graphql(`
    query GetOrderSummary($start: DateTime!, $end: DateTime!) {
        dashboardMetricSummary(
            input: { types: [OrderCount, OrderTotal], refresh: true, startDate: $start, endDate: $end }
        ) {
            type
            entries {
                value
            }
        }
    }
`);
