import { graphql } from '@vendure/dashboard';

export const operationsTodoQuery = graphql(`
    query OperationsTodoCounts {
        pendingShipment: physicalFulfillmentTodoCount
        pendingAfterSales: afterSalesRequests(options: { state: PENDING, take: 1 }) {
            totalItems
        }
        pendingReviews: storefrontReviews(options: { state: PENDING, take: 1 }) {
            totalItems
        }
        autoCardTodoSummary {
            lowStockSkuCount
            waitingStockDeliveryCount
            manualReviewCount
        }
    }
`);
