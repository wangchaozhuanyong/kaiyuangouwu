import { describe, expect, it } from 'vitest';
import type { StorefrontContentBlock, StorefrontContentBlockType } from './types';

import { homepageModuleEntries } from './homepage-module-order';

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
    it('uses legacy defaults only for module types that have never been configured', () => {
        const entries = homepageModuleEntries([], ['NOTICE', 'COUPONS']);

        expect(entries.some(entry => entry.type === 'NOTICE')).toBe(false);
        expect(entries.some(entry => entry.type === 'COUPONS')).toBe(false);
        expect(entries.some(entry => entry.type === 'QUICK_LINKS')).toBe(true);
        expect(entries.some(entry => entry.type === 'CATEGORY_AD')).toBe(false);
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

    it('groups all carousel slides into one homepage module', () => {
        const entries = homepageModuleEntries(
            [block('HERO', 2, 'hero-1'), block('HERO', 3, 'hero-2')],
            ['HERO'],
        );

        expect(entries.find(entry => entry.type === 'HERO')?.blocks).toHaveLength(2);
    });

    it('keeps login and registration visuals out of the homepage module list', () => {
        const entries = homepageModuleEntries(
            [block('AUTH_LOGIN', 1), block('AUTH_REGISTER', 2), block('CUSTOM', 3)],
            ['AUTH_LOGIN', 'AUTH_REGISTER', 'CUSTOM'],
        );

        const renderedTypes = entries.map(entry => String(entry.type));
        expect(renderedTypes).not.toContain('AUTH_LOGIN');
        expect(renderedTypes).not.toContain('AUTH_REGISTER');
        expect(renderedTypes).toContain('CUSTOM');
    });
});
