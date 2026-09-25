import { describe, expect, it } from 'vitest';

import {
    DESKTOP_CATEGORY_BANNER_PURPOSE,
    desktopCategoryBannerCode,
    parseDesktopCategoryBannerSettings,
    resolveDesktopCategoryBanner,
} from './desktop-category-banner';

function banner(categoryId: string, mode: 'image' | 'text' = 'image') {
    return {
        id: categoryId,
        type: 'CUSTOM',
        code: desktopCategoryBannerCode(categoryId),
        imageUrl: mode === 'image' ? `/assets/${categoryId}.jpg` : null,
        settings: {
            purpose: DESKTOP_CATEGORY_BANNER_PURPOSE,
            categoryId,
            mode,
            layout: 'side',
            focal: 'center',
        },
    };
}

describe('desktop category banner configuration', () => {
    it('prefers child, then parent, then default without replacing actual category copy', () => {
        const blocks = [banner('default'), banner('parent'), banner('child', 'text')];
        expect(resolveDesktopCategoryBanner(blocks, 'child', 'parent')?.block.id).toBe('child');
        expect(resolveDesktopCategoryBanner(blocks.slice(0, 2), 'child', 'parent')?.block.id).toBe('parent');
        expect(resolveDesktopCategoryBanner(blocks.slice(0, 1), 'child', 'parent')?.block.id).toBe('default');
        expect(resolveDesktopCategoryBanner([], 'child', 'parent')).toBeNull();
    });

    it('rejects unrelated custom records and mismatched codes', () => {
        expect(parseDesktopCategoryBannerSettings({ ...banner('child'), code: 'home-custom' })).toBeNull();
        expect(parseDesktopCategoryBannerSettings({ ...banner('child'), type: 'HERO' })).toBeNull();
        expect(
            parseDesktopCategoryBannerSettings({ ...banner('child'), settings: { purpose: 'other' } }),
        ).toBeNull();
    });
});
