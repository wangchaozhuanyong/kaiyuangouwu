import { describe, expect, it } from 'vitest';

import { heroContentForViewport, heroImageForViewport } from './hero-image';

const desktopHero = {
    imageUrl: '/assets/desktop.webp',
    imageAsset: { width: 1600, height: 700 },
    title: 'Desktop title',
    subtitle: 'Desktop kicker',
    body: 'Desktop description',
    ctaLabel: 'Browse products',
    textColor: '#ffffff',
    items: [{ id: 'first', label: 'Original seller benefit' }],
    settings: {
        themePreset: 'bright',
        secondaryTextColor: '#f1f5f9',
        mobileImageUrl: '/assets/phone.webp',
        mobileImageWidth: 1200,
        mobileImageHeight: 900,
        mobileHeroTextColor: '#292d32',
        mobileHeroSecondaryTextColor: '#454b52',
        mobileHeroTranslations: [
            {
                languageCode: 'zh_Hans',
                title: '手机标题',
                subtitle: '',
                body: '手机说明',
                ctaLabel: '立即浏览',
            },
            {
                languageCode: 'en',
                title: 'Phone title',
                subtitle: '',
                body: 'Short copy',
                ctaLabel: 'Browse',
            },
        ],
    },
};

describe('shared phone hero presentation', () => {
    it('preserves the desktop object, artwork, copy, colors and settings exactly', () => {
        expect(heroContentForViewport(desktopHero, true, 'zh')).toBe(desktopHero);
        expect(heroImageForViewport(desktopHero, true)).toEqual({
            imageUrl: '/assets/desktop.webp',
            imageAsset: { width: 1600, height: 700 },
        });
    });
    it.each([
        ['zh', '手机标题', '手机说明', '立即浏览'],
        ['en', 'Phone title', 'Short copy', 'Browse'],
    ] as const)(
        'selects phone media and %s copy without mutating the stored content',
        (language, title, body, ctaLabel) => {
            const before = structuredClone(desktopHero);
            expect(heroContentForViewport(desktopHero, false, language)).toMatchObject({
                imageUrl: '/assets/phone.webp',
                imageAsset: { width: 1200, height: 900 },
                title,
                subtitle: '',
                body,
                ctaLabel,
                textColor: '#292d32',
                settings: { themePreset: 'bright', secondaryTextColor: '#454b52' },
            });
            expect(desktopHero).toEqual(before);
        },
    );
    it('inherits missing phone fields per language and never uses desktop image dimensions for phone artwork', () => {
        const content = {
            ...desktopHero,
            settings: {
                mobileImageUrl: '/assets/phone.webp',
                mobileHeroTranslations: [{ languageCode: 'zh_Hans', title: '标题' }],
            },
        };
        const chinese = heroContentForViewport(content, false, 'zh');
        expect(chinese).toMatchObject({ title: '标题', body: 'Desktop description', imageAsset: null });
        const english = heroContentForViewport(content, false, 'en');
        expect(english.title).toBe('Desktop title');
        expect(heroImageForViewport(content, false)).toEqual({ imageUrl: '/assets/phone.webp' });
    });
    it('supports old unconfigured content and clears a phone binding back to the desktop image', () => {
        for (const settings of [null, {}, { mobileImageUrl: null }, { mobileImageUrl: ' ' }]) {
            const content = { ...desktopHero, settings };
            expect(heroContentForViewport(content, false, 'zh')).toMatchObject({
                imageUrl: '/assets/desktop.webp',
                imageAsset: { width: 1600, height: 700 },
                title: 'Desktop title',
                subtitle: 'Desktop kicker',
                textColor: '#ffffff',
            });
        }
    });
    it('can hide phone benefits without changing stored items, desktop benefits or their bindings', () => {
        const content = {
            ...desktopHero,
            settings: { ...desktopHero.settings, mobileHeroHideStats: true },
        };
        expect(heroContentForViewport(content, false, 'zh').items).toEqual([]);
        expect(heroContentForViewport(content, true, 'zh')).toBe(content);
        expect(content.items).toEqual(desktopHero.items);
        expect(heroContentForViewport(desktopHero, false, 'zh').items).toBe(desktopHero.items);
    });
});
