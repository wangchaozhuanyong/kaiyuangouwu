// @vitest-environment jsdom
import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import { GET_SALES_ORDERS } from '../../graphql/sales.graphql';

describe('sales order processing query', () => {
    it('uses server processing categories and authoritative counts rather than order state filters', () => {
        const document = print(GET_SALES_ORDERS);
        expect(document).toContain('$options: OrderProcessingListOptions');
        expect(document).toContain('orders: processingOrders(options: $options)');
        expect(document).toContain('orderProcessingCounts');
        expect(document).toContain('processingSummary');
        expect(document).not.toContain('physicalFulfillmentTodoCount');
    });
});
