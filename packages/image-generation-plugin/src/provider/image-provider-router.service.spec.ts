import { describe, expect, it } from 'vitest';

import { selectSmoothWeightedCredential } from './image-provider-router.service';

describe('image provider smooth weighted routing', () => {
    it('distributes same-priority keys by weight without starving backups', () => {
        const keys = [
            { id: 1, weight: 3, currentWeight: 0 },
            { id: 2, weight: 1, currentWeight: 0 },
        ];
        const selected = Array.from({ length: 8 }, () => selectSmoothWeightedCredential(keys).selected.id);
        expect(selected.filter(id => id === 1)).toHaveLength(6);
        expect(selected.filter(id => id === 2)).toHaveLength(2);
    });

    it('normalizes invalid legacy zero weights to one', () => {
        const keys = [
            { id: 1, weight: 0, currentWeight: 0 },
            { id: 2, weight: 1, currentWeight: 0 },
        ];
        const selected = Array.from({ length: 4 }, () => selectSmoothWeightedCredential(keys).selected.id);
        expect(new Set(selected)).toEqual(new Set([1, 2]));
    });
});
