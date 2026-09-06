import { describe, expect, it } from 'vitest';

import { desktopIntroModuleOrder, homepageModuleEntries } from './homepage-module-order';
import { StorefrontContentBlock, StorefrontContentBlockType } from './types';

function block(
    type: StorefrontContentBlockType,
    position: number,
    id = `${type}-${position}`,
): StorefrontContentBlock {
    return {
        id,
        code: id,
        type,
        enabled: true,
        position,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        title: type,
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [],
    };
}

describe('homepageModuleEntries', () => {
    it('does not render sharing records even when an old payload includes enabled ones', () => {
        const records = [
            { ...block('CUSTOM', 1, 'system'), settings: { purpose: 'referral-system-poster' } },
            { ...block('CUSTOM', 2, 'custom'), settings: { purpose: 'referral-custom-poster' } },
            { ...block('CUSTOM', 3, 'ordinary'), title: '分享海报', settings: {} },
        ];
        expect(
            homepageModuleEntries(records, [])
                .filter(entry => entry.type === 'CUSTOM')
                .map(entry => entry.block?.id),
        ).toEqual(['ordinary']);
    });
    it('does not invent modules for a new, empty or fully disabled store', () => {
        expect(homepageModuleEntries([], [])).toEqual([]);
        expect(homepageModuleEntries([], ['HERO', 'QUICK_LINKS', 'NOTICE', 'COUPONS'])).toEqual([]);
    });

    it('follows persisted positions and keeps custom modules in the same order', () => {
        const entries = homepageModuleEntries(
            [block('FLASH_SALE', 1), block('CUSTOM', 2), block('COUPONS', 3)],
            [
                'HERO',
                'FLASH_SALE',
                'CUSTOM',
                'COUPONS',
                'NOTICE',
                'QUICK_LINKS',
                'BEST_SELLERS',
                'RECOMMENDATIONS',
                'TRUST_BAR',
            ],
        );

        expect(entries.map(entry => entry.type)).toEqual(['FLASH_SALE', 'CUSTOM', 'COUPONS']);
    });

    it('keeps multiple story and category floors in their individually saved positions', () => {
        const entries = homepageModuleEntries(
            [
                block('STORY', 1, 'story-a'),
                block('CATEGORY_AD', 2, 'category-a'),
                block('STORY', 3, 'story-b'),
                block('CATEGORY_AD', 4, 'category-b'),
            ],
            [],
        );
        expect(entries.map(entry => entry.block?.id)).toEqual([
            'story-a',
            'category-a',
            'story-b',
            'category-b',
        ]);
    });

    it('groups all carousel slides into one homepage module', () => {
        const entries = homepageModuleEntries(
            [block('HERO', 2, 'hero-1'), block('HERO', 3, 'hero-2')],
            ['HERO'],
        );

        expect(entries.find(entry => entry.type === 'HERO')?.blocks).toHaveLength(2);
    });

    it('does not render login and registration visuals as homepage modules', () => {
        const entries = homepageModuleEntries(
            [block('AUTH_LOGIN', 1), block('AUTH_REGISTER', 2), block('NOTICE', 3)],
            ['AUTH_LOGIN', 'AUTH_REGISTER', 'NOTICE'],
        );

        expect(entries.map(entry => entry.type)).not.toContain('AUTH_LOGIN');
        expect(entries.map(entry => entry.type)).not.toContain('AUTH_REGISTER');
        expect(entries.some(entry => entry.type === 'NOTICE')).toBe(true);
    });
});

describe('desktopIntroModuleOrder', () => {
    it('groups the canonical desktop intro modules when they are adjacent', () => {
        const entries = homepageModuleEntries(
            [
                block('NOTICE', 1),
                block('HERO', 2),
                block('TRUST_BAR', 3),
                block('QUICK_LINKS', 4),
                block('COUPONS', 5),
            ],
            ['NOTICE', 'HERO', 'TRUST_BAR', 'QUICK_LINKS', 'COUPONS'],
        );

        expect(desktopIntroModuleOrder(entries)).toBe(1);
    });

    it('falls back to full-width modules after merchant reordering', () => {
        const entries = homepageModuleEntries(
            [block('HERO', 1), block('QUICK_LINKS', 2), block('TRUST_BAR', 3)],
            ['HERO', 'QUICK_LINKS', 'TRUST_BAR'],
        );

        expect(desktopIntroModuleOrder(entries)).toBeNull();
    });

    it('does not group across another homepage module', () => {
        const entries = homepageModuleEntries(
            [block('HERO', 1), block('TRUST_BAR', 2), block('CUSTOM', 3), block('QUICK_LINKS', 4)],
            ['HERO', 'TRUST_BAR', 'CUSTOM', 'QUICK_LINKS'],
        );

        expect(desktopIntroModuleOrder(entries)).toBeNull();
    });
});
