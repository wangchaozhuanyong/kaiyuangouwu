import { describe, expect, it, vi } from 'vitest';

import { applyCollectionFiltersInOrder, CollectionFilter } from './collection-filter';

describe('configured collection filter order', () => {
    it('does not move an appended import OR rule ahead of manual AND rules', () => {
        const clauses: string[] = [];
        const qb = {} as Parameters<typeof applyCollectionFiltersInOrder>[0];
        const definitions = ['facet', 'variant', 'product'].map(code => ({
            code,
            apply: (builder: typeof qb, args: Array<{ name: string; value: string }>) => {
                clauses.push(`${args[0].value} ${code}`);
                return builder;
            },
        })) as CollectionFilter[];
        const filters = [
            { code: 'variant', args: [{ name: 'join', value: 'AND' }] },
            { code: 'product', args: [{ name: 'join', value: 'OR' }] },
            { code: 'facet', args: [{ name: 'join', value: 'OR' }] },
            { code: 'variant', args: [{ name: 'join', value: 'OR' }] },
        ];
        expect(applyCollectionFiltersInOrder(qb, filters, definitions)).toBe(qb);
        expect(clauses).toEqual(['AND variant', 'OR product', 'OR facet', 'OR variant']);
    });

    it('retains no-filter behavior and ignores unavailable definitions without reordering', () => {
        const qb = {} as Parameters<typeof applyCollectionFiltersInOrder>[0];
        const next = {} as typeof qb;
        const apply = vi.fn().mockReturnValue(next);
        const definitions = [{ code: 'known', apply }] as unknown as CollectionFilter[];
        expect(applyCollectionFiltersInOrder(qb, [], definitions)).toBe(qb);
        expect(
            applyCollectionFiltersInOrder(
                qb,
                [
                    { code: 'missing', args: [] },
                    { code: 'known', args: [] },
                ],
                definitions,
            ),
        ).toBe(next);
        expect(apply).toHaveBeenCalledExactlyOnceWith(qb, []);
    });
});
