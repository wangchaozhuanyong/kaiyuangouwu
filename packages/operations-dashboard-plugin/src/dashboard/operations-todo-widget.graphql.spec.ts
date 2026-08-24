import { print } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vendure/dashboard', async () => {
    const { parse } = await import('graphql');
    return { graphql: (source: string) => parse(source) };
});

import { operationsTodoQuery } from './operations-todo-widget.graphql';

describe('operations todo query', () => {
    it('uses the physical-line-aware backend count for shipment work', () => {
        expect(print(operationsTodoQuery)).toContain('pendingShipment: physicalFulfillmentTodoCount');
    });

    it('counts pending after-sales and review work', () => {
        const query = print(operationsTodoQuery);

        expect(query).toContain('pendingAfterSales: afterSalesRequests');
        expect(query).toContain('pendingReviews: storefrontReviews');
        expect(query.match(/state: PENDING/g)).toHaveLength(2);
        expect(query).toContain('autoCardTodoSummary');
        expect(query).toContain('lowStockSkuCount');
        expect(query).toContain('waitingStockDeliveryCount');
        expect(query).toContain('manualReviewCount');
    });
});
