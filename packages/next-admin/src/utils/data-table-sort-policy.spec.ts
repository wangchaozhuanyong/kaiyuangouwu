import { describe, expect, it } from 'vitest';

import { dataTableSortPolicy } from './data-table-sort-policy';

describe('dataTableSortPolicy', () => {
    it('puts the newest records first with a deterministic id tie-breaker', () => {
        expect(dataTableSortPolicy.newestCreated).toEqual({ createdAt: 'DESC', id: 'DESC' });
        expect(dataTableSortPolicy.newestUpdated).toEqual({ updatedAt: 'DESC', id: 'DESC' });
        expect(dataTableSortPolicy.newestOrderPlaced).toEqual({ orderPlacedAt: 'DESC', id: 'DESC' });
    });

    it('keeps explicit business-order exceptions stable', () => {
        expect(dataTableSortPolicy.manualPosition).toEqual({ position: 'ASC', id: 'ASC' });
        expect(dataTableSortPolicy.alphabeticalName).toEqual({ name: 'ASC', id: 'ASC' });
        expect(dataTableSortPolicy.alphabeticalCode).toEqual({ code: 'ASC', id: 'ASC' });
    });
});
