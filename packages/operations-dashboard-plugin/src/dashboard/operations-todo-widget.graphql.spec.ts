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

    it('counts active checkout orders which are still arranging payment', () => {
        const query = print(operationsTodoQuery);
        const pendingPaymentSelection = query.slice(
            query.indexOf('pendingPayment:'),
            query.indexOf('pendingShipment:'),
        );

        expect(pendingPaymentSelection).toContain('ArrangingPayment');
        expect(pendingPaymentSelection).not.toContain('active:');
    });
});
