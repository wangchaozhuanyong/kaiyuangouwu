import { describe, expect, it } from 'vitest';

import { heroThemeStyle, heroUsesImageOverlay } from './hero-theme';
import { StorefrontContentBlock } from './types';

function hero(overrides: Partial<StorefrontContentBlock> = {}): StorefrontContentBlock {
    return {
        id: 'hero-1',
        code: 'home-hero',
        type: 'HERO',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        title: '首页广告',
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [],
        ...overrides,
    };
}

describe('hero theme', () => {
    it('maps managed colors into the hero CSS variables', () => {
        const style = heroThemeStyle(
            hero({
                backgroundColor: '#312E81',
                textColor: '#FFFFFF',
                settings: {
                    secondaryTextColor: '#E0F2FE',
                    accentColor: '#22D3EE',
                    accentSecondaryColor: '#7C3AED',
                    buttonTextColor: '#F8FAFC',
                },
            }),
        );

        expect(style['--hero-overlay-color']).toBe('#312E81');
        expect(style['--hero-title-color']).toBe('#FFFFFF');
        expect(style['--hero-body-color']).toBe('#E0F2FE');
        expect(style['--hero-accent-color']).toBe('#22D3EE');
        expect(style['--hero-accent-secondary-color']).toBe('#7C3AED');
        expect(style['--hero-button-text-color']).toBe('#F8FAFC');
    });

    it('ignores invalid managed colors and preserves readable defaults', () => {
        const style = heroThemeStyle(
            hero({
                backgroundColor: 'transparent',
                textColor: 'red',
                settings: { accentColor: 'javascript:alert(1)' },
            }),
        );

        expect(style['--hero-overlay-color']).toBe(
            'var(--store-background, var(--skin-hero-background, #090d16))',
        );
        expect(style['--hero-title-color']).toBe(
            'var(--store-foreground, var(--skin-hero-foreground, #ffffff))',
        );
        expect(style['--hero-accent-color']).toBe('var(--store-primary, var(--skin-hero-accent, #67e8f9))');
    });

    it('uses the saved theme independent of position or legacy artwork keys', () => {
        const first = hero({ position: 0, settings: { fallbackImage: 'moyao-token-topup-v1' } });
        const moved = { ...first, position: 1 };
        expect(heroThemeStyle(first)).toEqual(heroThemeStyle(moved));
        expect(heroThemeStyle(hero({ settings: { themePreset: 'warm' } }))['--hero-accent-color']).toBe(
            'var(--store-primary, var(--skin-hero-accent, #fbbf24))',
        );
    });

    it('switches copy surfaces to a light treatment for the CloudBridge bright theme', () => {
        const style = heroThemeStyle(hero({ backgroundColor: '#FFF7F5' }));

        expect(style['--hero-stat-background']).toBe('rgba(255, 255, 255, 0.74)');
        expect(style['--hero-title-shadow']).toContain('rgba(255, 255, 255, 0.86)');
    });

    it('strengthens the image overlay only when a managed hero opts into high contrast', () => {
        const style = heroThemeStyle(
            hero({ backgroundColor: '#0E241F', settings: { contrastMode: 'high' } }),
        );

        expect(style['--hero-overlay-strong']).toBe('rgba(14, 36, 31, 0.97)');
        expect(style['--hero-overlay-medium']).toBe('rgba(14, 36, 31, 0.9)');
        expect(style['--hero-overlay-soft']).toBe('rgba(14, 36, 31, 0.66)');
        expect(style['--hero-overlay-fade']).toBe('rgba(14, 36, 31, 0.18)');
    });

    it('keeps bright commerce artwork unfiltered while preserving overlays for other themes', () => {
        expect(heroUsesImageOverlay(hero({ settings: { themePreset: 'cloudbridge-bright' } }))).toBe(false);
        expect(heroUsesImageOverlay(hero({ settings: { themePreset: 'marketplace-bright' } }))).toBe(false);
        expect(heroUsesImageOverlay(hero())).toBe(true);
    });
});
