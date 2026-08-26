import { describe, expect, it } from 'vitest';

import { updateCollectionVisibility } from './collection-visibility-state.js';

describe('updateCollectionVisibility', () => {
    it('updates only the matching collection', () => {
        const first = { id: '1', isPrivate: false, name: 'First' };
        const second = { id: '2', isPrivate: false, name: 'Second' };
        const items = [first, second];

        const result = updateCollectionVisibility(items, '2', true);

        expect(result).not.toBe(items);
        expect(result[0]).toBe(first);
        expect(result[1]).toEqual({ id: '2', isPrivate: true, name: 'Second' });
    });

    it('preserves the array when no update is needed', () => {
        const items = [{ id: '1', isPrivate: true }];

        expect(updateCollectionVisibility(items, '1', true)).toBe(items);
        expect(updateCollectionVisibility(items, 'missing', false)).toBe(items);
    });
});
