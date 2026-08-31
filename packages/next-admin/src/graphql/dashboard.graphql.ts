import { gql } from '@apollo/client';

export const DASHBOARD_METRICS_QUERY = gql`
  query NextAdminDashboardMetrics($input: DashboardMetricSummaryInput!) {
    activeChannel { id code defaultCurrencyCode }
    dashboardMetricSummary(input: $input) {
      type
      title
      entries { label value }
    }
    pendingSearchIndexUpdates
  }
`;

export const DASHBOARD_TODO_QUERY = gql`
  query NextAdminDashboardTodo {
    pendingShipment: physicalFulfillmentTodoCount
    pendingAfterSales: afterSalesRequests(options: { state: PENDING, take: 1 }) { totalItems }
    pendingReviews: storefrontReviews(options: { state: PENDING, take: 1 }) { totalItems }
    autoCardTodoSummary { lowStockSkuCount waitingStockDeliveryCount manualReviewCount }
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
        customer { id firstName lastName emailAddress }
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
  activeChannel: { id: string; code: string; defaultCurrencyCode: string };
  dashboardMetricSummary: DashboardMetricSummary[];
  pendingSearchIndexUpdates: number;
}

export interface DashboardTodoData {
  pendingShipment: number;
  pendingAfterSales: { totalItems: number };
  pendingReviews: { totalItems: number };
  autoCardTodoSummary: {
    lowStockSkuCount: number;
    waitingStockDeliveryCount: number;
    manualReviewCount: number;
  };
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
