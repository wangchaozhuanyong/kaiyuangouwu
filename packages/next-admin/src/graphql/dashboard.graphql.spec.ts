import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import {
    DASHBOARD_METRICS_QUERY,
    DASHBOARD_ORDER_TODO_QUERY,
    DASHBOARD_PRODUCT_TODO_QUERY,
    DASHBOARD_RECENT_ORDERS_QUERY,
    DASHBOARD_REVIEW_TODO_QUERY,
    DASHBOARD_SEARCH_INDEX_QUERY,
} from './dashboard.graphql';

describe('dashboard GraphQL permission boundaries', () => {
    it('keeps fields with different permission requirements in separate requests', () => {
        const metrics = print(DASHBOARD_METRICS_QUERY);
        const orderTodo = print(DASHBOARD_ORDER_TODO_QUERY);
        const orders = print(DASHBOARD_RECENT_ORDERS_QUERY);
        const productTodo = print(DASHBOARD_PRODUCT_TODO_QUERY);
        const reviews = print(DASHBOARD_REVIEW_TODO_QUERY);
        const searchIndex = print(DASHBOARD_SEARCH_INDEX_QUERY);

        expect(metrics).toContain('dashboardMetricSummary');
        expect(orderTodo).toContain('physicalFulfillmentTodoCount');
        expect(orderTodo).toContain('afterSalesRequests');
        expect(orders).toContain('orders(options: $options)');
        expect(productTodo).toContain('autoCardTodoSummary');
        expect(reviews).toContain('storefrontReviews');
        expect(searchIndex).toContain('pendingSearchIndexUpdates');

        for (const orderQuery of [metrics, orderTodo, orders]) {
            expect(orderQuery).not.toContain('autoCardTodoSummary');
            expect(orderQuery).not.toContain('storefrontReviews');
            expect(orderQuery).not.toContain('pendingSearchIndexUpdates');
        }
    });
});
