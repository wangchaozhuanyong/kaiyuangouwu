import { describe, expect, it } from 'vitest';

import { planFefoAllocation, planLotRestoration } from './inventory-lot-lifecycle.service';

const today = new Date('2026-08-28T12:00:00.000Z');

describe('inventory lot lifecycle planning', () => {
    it('allocates the earliest expiring active lots first and leaves undated lots last', () => {
        const allocations = planFefoAllocation(
            [
                lot('undated', 8, null),
                lot('later', 4, '2026-09-10T00:00:00.000Z'),
                lot('earlier', 2, '2026-09-01T00:00:00.000Z'),
            ],
            5,
            today,
        );

        expect(allocations).toEqual([
            { lotId: 'earlier', quantity: 2 },
            { lotId: 'later', quantity: 3 },
        ]);
    });

    it('does not allocate expired, void, depleted, or zero-quantity lots', () => {
        const allocations = planFefoAllocation(
            [
                lot('expired-date', 5, '2026-08-27T00:00:00.000Z'),
                { ...lot('void', 5, null), state: 'VOID' },
                { ...lot('depleted-state', 5, null), state: 'DEPLETED' },
                lot('empty', 0, null),
                lot('valid-through-today', 2, '2026-08-28T00:00:00.000Z'),
            ],
            4,
            today,
        );

        expect(allocations).toEqual([{ lotId: 'valid-through-today', quantity: 2 }]);
    });

    it('restores only outstanding sold quantities in reverse allocation order', () => {
        const restorations = planLotRestoration(
            [
                { lotId: 'lot-a', quantity: -2 },
                { lotId: 'lot-b', quantity: -4 },
                { lotId: 'lot-b', quantity: 1 },
            ],
            4,
        );

        expect(restorations).toEqual([
            { lotId: 'lot-b', quantity: 3 },
            { lotId: 'lot-a', quantity: 1 },
        ]);
    });
});

function lot(id: string, quantityOnHand: number, expiresAt: string | null) {
    return {
        id,
        createdAt: new Date(`2026-08-${id === 'undated' ? '03' : '01'}T00:00:00.000Z`),
        manufacturedAt: null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        quantityOnHand,
        state: 'ACTIVE',
    };
}
