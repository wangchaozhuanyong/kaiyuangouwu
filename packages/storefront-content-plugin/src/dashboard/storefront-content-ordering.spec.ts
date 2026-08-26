import { describe, expect, it } from 'vitest';

import { swappedContentBlockIds } from './storefront-content-ordering';

describe('swappedContentBlockIds', () => {
    it('swaps the selected persisted blocks without moving hidden blocks', () => {
        const blocks = [{ id: 'notice' }, { id: 'hero-1' }, { id: 'coupons' }, { id: 'hero-2' }];

        expect(swappedContentBlockIds(blocks, 'hero-1', 'hero-2')).toEqual([
            'notice',
            'hero-2',
            'coupons',
            'hero-1',
        ]);
    });

    it('returns all persisted IDs unchanged when a block cannot be resolved', () => {
        const blocks = [{ id: 'notice' }, {}, { id: 'hero-1' }];

        expect(swappedContentBlockIds(blocks, 'missing', 'hero-1')).toEqual(['notice', 'hero-1']);
    });
});
