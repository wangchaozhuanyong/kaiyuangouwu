import { describe, expect, it } from 'vitest';
import type { StorefrontBlockType } from '../../graphql/storefront.graphql';
import { newContentBlock } from './storefront-content-utils';
import {
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
