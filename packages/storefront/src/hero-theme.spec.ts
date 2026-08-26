import { describe, expect, it } from 'vitest';

import { builtInHeroFallbackImage, builtInHeroImage, heroThemeStyle } from './hero-theme';
import { HERO_CLOUD_BRIDGE_FALLBACK_IMAGE, HERO_CLOUD_BRIDGE_IMAGE } from './storefront-images';
import type { StorefrontContentBlock } from './types';

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
            false,
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
            false,
        );

        expect(style['--hero-overlay-color']).toBe('#090d16');
        expect(style['--hero-title-color']).toBe('#ffffff');
        expect(style['--hero-accent-color']).toBe('#67e8f9');
    });

    it('uses the cloud bridge project artwork when configured', () => {
        const block = hero({ settings: { fallbackImage: 'cloudbridge-ai-hub' } });

        expect(builtInHeroImage(block, false)).toBe(HERO_CLOUD_BRIDGE_IMAGE);
        expect(builtInHeroFallbackImage(block, false)).toBe(HERO_CLOUD_BRIDGE_FALLBACK_IMAGE);
    });

    it('switches copy surfaces to a light treatment for the CloudBridge bright theme', () => {
        const style = heroThemeStyle(hero({ backgroundColor: '#FFF7F5' }), false);

        expect(style['--hero-stat-background']).toBe('rgba(255, 255, 255, 0.74)');
        expect(style['--hero-title-shadow']).toContain('rgba(255, 255, 255, 0.86)');
    });
});
