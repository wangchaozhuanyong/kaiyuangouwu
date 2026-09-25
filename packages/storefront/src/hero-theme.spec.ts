import { describe, expect, it } from 'vitest';

import { heroThemeStyle } from './hero-theme';
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

        expect(style['--hero-copy-background']).toBe('#312E81');
        expect(style['--hero-copy-foreground']).toBe('#FFFFFF');
        expect(style['--hero-copy-body-foreground']).toBe('#E0F2FE');
        expect(style['--hero-title-color']).toBe('#FFFFFF');
        expect(style['--hero-body-color']).toBe('#E0F2FE');
        expect(style['--hero-accent-color']).toBe('#22D3EE');
        expect(style['--hero-accent-secondary-color']).toBe('#7C3AED');
        expect(style['--hero-button-text-color']).toBe('#F8FAFC');
        expect(style['--hero-button-background']).toBe('#22D3EE');
        expect(style['--hero-button-foreground']).toBe('#000000');
        expect(style['--hero-image-overlay-start']).toBe('rgba(49, 46, 129, 0.86)');
        expect(style['--hero-image-copy-foreground']).toBe('#FFFFFF');
        expect(style['--hero-image-body-foreground']).toBe('#E0F2FE');
    });

    it('ignores invalid managed colors and preserves readable defaults', () => {
        const style = heroThemeStyle(
            hero({
                backgroundColor: 'transparent',
                textColor: 'red',
                settings: { accentColor: 'javascript:alert(1)' },
            }),
        );

        expect(style['--hero-copy-background']).toBe('var(--surface)');
        expect(style['--hero-copy-foreground']).toBe('var(--text)');
        expect(style['--hero-title-color']).toBe(
            'var(--store-foreground, var(--skin-hero-foreground, #ffffff))',
        );
        expect(style['--hero-accent-color']).toBe('var(--store-primary, var(--skin-hero-accent, #67e8f9))');
        expect(style['--hero-image-overlay-start']).toBe('rgba(16, 33, 47, 0.86)');
        expect(style['--hero-image-copy-foreground']).toBe('#FFFFFF');
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
        expect(style['--hero-title-shadow']).toContain('rgba(255, 255, 255');
        expect(style['--hero-image-overlay-start']).toBe('rgba(255, 247, 245, 0.86)');
        expect(style['--hero-image-copy-foreground']).toBe('#000000');
    });

    it('uses a readable local copy surface even when an old high-contrast flag is present', () => {
        const style = heroThemeStyle(
            hero({ backgroundColor: '#0E241F', settings: { contrastMode: 'high' } }),
        );

        expect(style['--hero-copy-background']).toBe('#0E241F');
        expect(style['--hero-copy-foreground']).toBe('#ffffff');
    });

    it('replaces an unreadable managed text color on the local copy surface', () => {
        const style = heroThemeStyle(
            hero({
                backgroundColor: '#FFF7F5',
                textColor: '#FFFFFF',
                settings: { secondaryTextColor: '#FFFFFF', accentColor: '#F0EAE8' },
            }),
        );
        expect(style['--hero-copy-foreground']).toBe('#000000');
        expect(style['--hero-copy-body-foreground']).toBe('#000000');
        expect(style['--hero-accent-readable']).toBe('#000000');
    });
});
