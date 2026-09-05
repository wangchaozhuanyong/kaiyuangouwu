import { describe, expect, it } from 'vitest';

import {
    builtInHeroFallbackImage,
    builtInHeroImage,
    heroThemeStyle,
    heroUsesImageOverlay,
} from './hero-theme';
import {
    HERO_ACCOUNT_SERVICES_FALLBACK_IMAGE,
    HERO_ACCOUNT_SERVICES_IMAGE,
    HERO_CLOUD_BRIDGE_FALLBACK_IMAGE,
    HERO_CLOUD_BRIDGE_IMAGE,
    HERO_CODEX_TIERS_FALLBACK_IMAGE,
    HERO_CODEX_TIERS_IMAGE,
    HERO_TOKEN_TOPUP_FALLBACK_IMAGE,
    HERO_TOKEN_TOPUP_IMAGE,
} from './storefront-images';
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

    it.each([
        ['moyao-token-topup-v1', HERO_TOKEN_TOPUP_IMAGE, HERO_TOKEN_TOPUP_FALLBACK_IMAGE],
        ['moyao-codex-tiers-v1', HERO_CODEX_TIERS_IMAGE, HERO_CODEX_TIERS_FALLBACK_IMAGE],
        ['moyao-account-services-v1', HERO_ACCOUNT_SERVICES_IMAGE, HERO_ACCOUNT_SERVICES_FALLBACK_IMAGE],
    ])('maps %s to its bundled carousel fallback', (fallbackImage, image, fallback) => {
        const block = hero({ settings: { fallbackImage } });

        expect(builtInHeroImage(block, false)).toBe(image);
        expect(builtInHeroFallbackImage(block, false)).toBe(fallback);
    });

    it('switches copy surfaces to a light treatment for the CloudBridge bright theme', () => {
        const style = heroThemeStyle(hero({ backgroundColor: '#FFF7F5' }), false);

        expect(style['--hero-stat-background']).toBe('rgba(255, 255, 255, 0.74)');
        expect(style['--hero-title-shadow']).toContain('rgba(255, 255, 255, 0.86)');
    });

    it('keeps bright commerce artwork unfiltered while preserving overlays for other themes', () => {
        expect(heroUsesImageOverlay(hero({ settings: { themePreset: 'cloudbridge-bright' } }))).toBe(false);
        expect(heroUsesImageOverlay(hero({ settings: { themePreset: 'marketplace-bright' } }))).toBe(false);
        expect(heroUsesImageOverlay(hero())).toBe(true);
    });
});
