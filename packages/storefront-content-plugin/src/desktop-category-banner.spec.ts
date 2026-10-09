import { describe, expect, it } from 'vitest';

import {
    DESKTOP_CATEGORY_BANNER_PURPOSE,
    desktopCategoryBannerCode,
    parseDesktopCategoryBannerSettings,
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

describe('historical desktop category banner record validation', () => {
    it('still recognizes an existing record without providing creation or display helpers', () => {
        expect(parseDesktopCategoryBannerSettings(banner('child'))).toEqual(banner('child').settings);
    });
    it('rejects unrelated custom records and mismatched codes', () => {
        expect(parseDesktopCategoryBannerSettings({ ...banner('child'), code: 'home-custom' })).toBeNull();
        expect(parseDesktopCategoryBannerSettings({ ...banner('child'), type: 'HERO' })).toBeNull();
        expect(
            parseDesktopCategoryBannerSettings({ ...banner('child'), settings: { purpose: 'other' } }),
        ).toBeNull();
    });
});
