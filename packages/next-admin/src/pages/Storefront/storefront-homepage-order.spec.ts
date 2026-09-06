import { describe, expect, it } from 'vitest';
import type { StorefrontBlockType } from '../../graphql/storefront.graphql';
import { newContentBlock } from './storefront-content-utils';
import {
    dropHomepageRow,
    homepageOrderIds,
    moveCarouselSlide,
    moveHomepageRow,
    storefrontHomepageRows,
} from './storefront-homepage-order';

function block(id: string, type: StorefrontBlockType, position: number) {
    return { ...newContentBlock(type, position, id), id };
}

const blocks = [
    block('notice', 'NOTICE', 0),
    block('hero-a', 'HERO', 1),
    block('legal', 'LEGAL', 2),
    block('products', 'BEST_SELLERS', 3),
    { ...block('hero-b', 'HERO', 4), enabled: true },
    { ...block('hero-c', 'HERO', 5), enabled: true, startsAt: '2099-01-01T00:00:00Z' },
    block('custom-a', 'CUSTOM', 6),
    block('custom-b', 'CUSTOM', 7),
    block('support', 'SUPPORT', 8),
];

describe('homepage carousel management order', () => {
    it('inserts a dragged floor across multiple rows in either direction without swapping neighbors', () => {
        const ids = dropHomepageRow(blocks, 'notice', 'custom-a', 'after')!;
        expect(ids).toEqual([
            'hero-a',
            'hero-b',
            'legal',
            'hero-c',
            'products',
            'custom-a',
            'notice',
            'custom-b',
            'support',
        ]);
        expect(dropHomepageRow(blocks, 'custom-b', 'notice', 'before')).toEqual([
            'custom-b',
            'notice',
            'legal',
            'hero-a',
            'hero-b',
            'hero-c',
            'products',
            'custom-a',
            'support',
        ]);
        expect(blocks.map(item => item.id)).toEqual([
            'notice',
            'hero-a',
            'legal',
            'products',
            'hero-b',
            'hero-c',
            'custom-a',
            'custom-b',
            'support',
        ]);
    });

    it('drags all carousel slides together while retaining their order and hidden content slots', () => {
        const poster = {
            ...block('poster', 'CUSTOM', 9),
            settings: { purpose: 'referral-system-poster' },
        };
        const records = [...blocks, poster];
        for (const placement of ['before', 'after'] as const) {
            const ids = dropHomepageRow(records, 'carousel', 'custom-b', placement)!;
            expect(ids[2]).toBe('legal');
            expect(ids[8]).toBe('support');
            expect(ids[9]).toBe('poster');
            expect(new Set(ids)).toEqual(new Set(records.map(item => item.id)));
            const visibleIds = ids.filter(id => !['legal', 'support', 'poster'].includes(id));
            const start = visibleIds.indexOf('hero-a');
            expect(visibleIds.slice(start, start + 3)).toEqual(['hero-a', 'hero-b', 'hero-c']);
            expect(visibleIds.indexOf('custom-b')).toBe(placement === 'before' ? start + 3 : start - 1);
        }
    });

    it('does not save cancelled, unchanged, unknown or non-homepage drag targets', () => {
        expect(dropHomepageRow(blocks, 'notice', 'notice', 'after')).toBeNull();
        expect(dropHomepageRow(blocks, 'notice', 'carousel', 'before')).toBeNull();
        expect(dropHomepageRow(blocks, 'carousel', 'notice', 'after')).toBeNull();
        expect(dropHomepageRow(blocks, 'missing', 'notice', 'after')).toBeNull();
        expect(dropHomepageRow(blocks, 'notice', 'missing', 'after')).toBeNull();
        expect(dropHomepageRow(blocks, 'legal', 'notice', 'after')).toBeNull();
        expect(dropHomepageRow(blocks, 'notice', 'legal', 'after')).toBeNull();
        expect(dropHomepageRow([], 'notice', 'carousel', 'before')).toBeNull();
    });

    it('excludes sharing records from floors and preserves their slots in a full reorder', () => {
        const poster = {
            ...block('poster', 'CUSTOM', 1),
            enabled: true,
            settings: { purpose: 'referral-system-poster' },
        };
        const ordinary = { ...block('ordinary', 'CUSTOM', 2), internalName: '分享海报', settings: {} };
        const records = [blocks[0], poster, ordinary];
        expect(storefrontHomepageRows(records).map(row => row.key)).toEqual(['notice', 'ordinary']);
        expect(moveHomepageRow(records, 'ordinary', -1)).toEqual(['ordinary', 'poster', 'notice']);
        expect(
            storefrontHomepageRows([{ ...poster, settings: { purpose: 'referral-custom-poster' } }]),
        ).toEqual([]);
    });
    it('groups every slide, including disabled and scheduled ones, without grouping custom floors', () => {
        const rows = storefrontHomepageRows(blocks);
        expect(rows.map(row => row.key)).toEqual(['notice', 'carousel', 'products', 'custom-a', 'custom-b']);
        expect(rows[1].blocks.map(item => item.id)).toEqual(['hero-a', 'hero-b', 'hero-c']);
    });

    it('moves the entire carousel below its neighboring floor and preserves all content IDs', () => {
        const ids = moveHomepageRow(blocks, 'carousel', 1)!;
        expect(ids).toEqual([
            'notice',
            'products',
            'legal',
            'hero-a',
            'hero-b',
            'hero-c',
            'custom-a',
            'custom-b',
            'support',
        ]);
        expect(new Set(ids)).toEqual(new Set(blocks.map(item => item.id)));
        expect(ids[2]).toBe('legal');
        expect(ids[8]).toBe('support');
    });

    it('moves an ordinary floor across the whole carousel', () => {
        expect(moveHomepageRow(blocks, 'products', -1)).toEqual(moveHomepageRow(blocks, 'carousel', 1));
    });

    it('changes slide order inside the same carousel floor without mutating the original records', () => {
        const ids = moveCarouselSlide(blocks, 'hero-c', -1)!;
        expect(ids).toEqual([
            'notice',
            'hero-a',
            'legal',
            'hero-c',
            'hero-b',
            'products',
            'custom-a',
            'custom-b',
            'support',
        ]);
        expect(blocks.map(item => item.id)).toEqual([
            'notice',
            'hero-a',
            'legal',
            'products',
            'hero-b',
            'hero-c',
            'custom-a',
            'custom-b',
            'support',
        ]);
    });

    it('appends a newly created slide to its carousel instead of making it another floor', () => {
        const withNewSlide = [...blocks, block('new-hero', 'HERO', 9)];
        expect(homepageOrderIds(withNewSlide, storefrontHomepageRows(withNewSlide))).toEqual([
            'notice',
            'hero-a',
            'legal',
            'hero-b',
            'hero-c',
            'new-hero',
            'products',
            'custom-a',
            'support',
            'custom-b',
        ]);
    });

    it('does not create invalid reorder requests for empty lists or boundary moves', () => {
        expect(storefrontHomepageRows([])).toEqual([]);
        expect(moveHomepageRow(blocks, 'notice', -1)).toBeNull();
        expect(moveHomepageRow(blocks, 'custom-b', 1)).toBeNull();
        expect(moveCarouselSlide(blocks, 'hero-a', -1)).toBeNull();
        expect(moveCarouselSlide(blocks, 'hero-c', 1)).toBeNull();
        expect(moveCarouselSlide(blocks, 'missing', 1)).toBeNull();
        expect(moveCarouselSlide([], 'missing', 1)).toBeNull();
    });
});
