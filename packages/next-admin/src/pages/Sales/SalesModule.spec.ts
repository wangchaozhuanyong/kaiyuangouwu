// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { orderTabFilters } from './SalesModule';

describe('sales order tab filters', () => {
    it('includes submitted active checkouts in all transactions but excludes carts and drafts', () => {
        expect(orderTabFilters('ALL')).toEqual([{ state: { notIn: ['AddingItems', 'Draft'] } }]);
    });
    it('keeps the dedicated draft filter', () => {
        expect(orderTabFilters('DRAFT')).toEqual([{ state: { in: ['AddingItems', 'Draft'] } }]);
    });
    it.each(['TO_SETTLE', 'TO_FULFILL', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'] as const)(
        'preserves completed-checkout filtering for %s',
        tab => {
            const filters = orderTabFilters(tab);
            expect(filters[0]).toEqual({ active: { eq: false } });
            expect(filters[1]).toHaveProperty('state');
        },
    );
});
