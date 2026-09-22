import { gql } from '@apollo/client';

export const DASHBOARD_METRICS_QUERY = gql`
    query NextAdminDashboardMetrics($input: DashboardMetricSummaryInput!) {
        activeChannel {
            id
            code
            defaultCurrencyCode
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
        dashboardMetricSummary(input: $input) {
            type
            title
            entries {
                label
                value
            }
        }
    }
`;

export const DASHBOARD_ORDER_TODO_QUERY = gql`
    query NextAdminDashboardOrderTodo {
        pendingShipment: physicalFulfillmentTodoCount
        pendingAfterSales: afterSalesRequests(options: { state: PENDING, take: 1 }) {
            totalItems
        }
    }
`;

export const DASHBOARD_REVIEW_TODO_QUERY = gql`
    query NextAdminDashboardReviewTodo {
        pendingReviews: storefrontReviews(options: { state: PENDING, take: 1 }) {
            totalItems
        }
    }
`;

export const DASHBOARD_PRODUCT_TODO_QUERY = gql`
    query NextAdminDashboardProductTodo {
        autoCardTodoSummary {
            lowStockSkuCount
            waitingStockDeliveryCount
            manualReviewCount
        }
    }
`;

export const DASHBOARD_SEARCH_INDEX_QUERY = gql`
    query NextAdminDashboardSearchIndex {
        pendingSearchIndexUpdates
    }
`;

export const DASHBOARD_RECENT_ORDERS_QUERY = gql`
    query NextAdminDashboardRecentOrders($options: OrderListOptions) {
        orders(options: $options) {
            totalItems
            items {
                id
                createdAt
                orderPlacedAt
                code
                state
                totalQuantity
                totalWithTax
                currencyCode
                customer {
                    id
                    firstName
                    lastName
                    emailAddress
                }
            }
        }
    }
`;

export interface DashboardMetricSummary {
    type: 'OrderCount' | 'OrderTotal' | 'AverageOrderValue';
    title: string;
    entries: Array<{ label: string; value: number }>;
}

export interface DashboardMetricsData {
    activeChannel: {
        id: string;
        code: string;
        defaultCurrencyCode: string;
        customFields?: {
            storefrontNameZh?: string | null;
            storefrontNameEn?: string | null;
        } | null;
    };
    dashboardMetricSummary: DashboardMetricSummary[];
}

export interface DashboardOrderTodoData {
    pendingShipment: number;
    pendingAfterSales: { totalItems: number };
}

export interface DashboardReviewTodoData {
    pendingReviews: { totalItems: number };
}

export interface DashboardProductTodoData {
    autoCardTodoSummary: {
        lowStockSkuCount: number;
        waitingStockDeliveryCount: number;
        manualReviewCount: number;
    };
}

export interface DashboardSearchIndexData {
    pendingSearchIndexUpdates: number;
}

export interface DashboardOrderItem {
    id: string;
    createdAt: string;
    orderPlacedAt?: string | null;
    code: string;
    state: string;
    totalQuantity: number;
    totalWithTax: number;
    currencyCode: string;
    customer?: {
        id: string;
        firstName?: string | null;
        lastName?: string | null;
        emailAddress: string;
    } | null;
}

export interface DashboardRecentOrdersData {
    orders: { totalItems: number; items: DashboardOrderItem[] };
}
