import type { CSSProperties } from 'react';
import type { StorefrontContentBlock } from './types';

import {
    HERO_ACCOUNT_SERVICES_FALLBACK_IMAGE,
    HERO_ACCOUNT_SERVICES_IMAGE,
    HERO_CLOUD_BRIDGE_FALLBACK_IMAGE,
    HERO_CLOUD_BRIDGE_IMAGE,
    HERO_CODEX_TIERS_FALLBACK_IMAGE,
    HERO_CODEX_TIERS_IMAGE,
    HERO_GATEWAY_FALLBACK_IMAGE,
    HERO_GATEWAY_IMAGE,
    HERO_TOKEN_TOPUP_FALLBACK_IMAGE,
    HERO_TOKEN_TOPUP_IMAGE,
    HERO_VIP_FALLBACK_IMAGE,
    HERO_VIP_IMAGE,
} from './storefront-images';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

type HeroThemeStyle = CSSProperties & Record<`--hero-${string}`, string>;

function normalizedColor(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

function colorWithAlpha(color: string, alpha: number): string {
    const normalized = color.slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isLightColor(color: string): boolean {
    const normalized = color.slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 255_000 >= 0.72;
}

export function heroThemeStyle(block: StorefrontContentBlock, vipTheme: boolean): HeroThemeStyle {
    const settings = block.settings ?? {};
    const defaultAccent = vipTheme ? '#fbbf24' : '#67e8f9';
    const defaultAccentSecondary = vipTheme ? '#b45309' : '#0e7490';
    const overlayColor = normalizedColor(block.backgroundColor, '#090d16');
    const accentColor = normalizedColor(settings.accentColor, defaultAccent);
    const lightOverlay = isLightColor(overlayColor);

    return {
        '--hero-overlay-color': overlayColor,
        '--hero-overlay-strong': colorWithAlpha(overlayColor, 0.92),
        '--hero-overlay-medium': colorWithAlpha(overlayColor, 0.82),
        '--hero-overlay-soft': colorWithAlpha(overlayColor, 0.46),
        '--hero-overlay-fade': colorWithAlpha(overlayColor, 0.08),
        '--hero-title-color': normalizedColor(block.textColor, '#ffffff'),
        '--hero-body-color': normalizedColor(settings.secondaryTextColor, '#cbd5e1'),
        '--hero-accent-color': accentColor,
        '--hero-accent-soft': colorWithAlpha(accentColor, 0.18),
        '--hero-accent-border': colorWithAlpha(accentColor, 0.48),
        '--hero-accent-subtle-border': colorWithAlpha(accentColor, 0.3),
        '--hero-accent-strong-border': colorWithAlpha(accentColor, 0.72),
        '--hero-accent-shadow': colorWithAlpha(accentColor, 0.42),
        '--hero-accent-text-shadow': colorWithAlpha(accentColor, 0.52),
        '--hero-accent-secondary-color': normalizedColor(
            settings.accentSecondaryColor,
            defaultAccentSecondary,
        ),
        '--hero-button-text-color': normalizedColor(settings.buttonTextColor, '#ffffff'),
        '--hero-title-shadow': lightOverlay
            ? '0 1px 0 rgba(255, 255, 255, 0.86), 0 8px 24px rgba(69, 26, 26, 0.12)'
            : '0 2px 10px rgba(0, 0, 0, 0.9), 0 0 20px var(--hero-accent-shadow)',
        '--hero-body-shadow': lightOverlay
            ? '0 1px 0 rgba(255, 255, 255, 0.76)'
            : '0 1px 4px rgba(0, 0, 0, 0.8)',
        '--hero-pill-shadow': lightOverlay
            ? '0 4px 14px rgba(69, 26, 26, 0.1)'
            : '0 2px 8px rgba(0, 0, 0, 0.3)',
        '--hero-stat-background': lightOverlay ? 'rgba(255, 255, 255, 0.74)' : 'rgba(15, 23, 42, 0.7)',
        '--hero-stat-shadow': lightOverlay
            ? '0 4px 14px rgba(69, 26, 26, 0.1)'
            : '0 3px 10px rgba(0, 0, 0, 0.22)',
        '--hero-pagination-color': lightOverlay
            ? colorWithAlpha(accentColor, 0.38)
            : 'rgba(255, 255, 255, 0.5)',
        '--hero-pagination-active-color': lightOverlay ? accentColor : '#ffffff',
    };
}

export function heroUsesImageOverlay(block: StorefrontContentBlock): boolean {
    const themePreset = typeof block.settings?.themePreset === 'string' ? block.settings.themePreset : '';
    return !['cloudbridge-bright', 'marketplace-bright'].includes(themePreset);
}

export function builtInHeroImage(block: StorefrontContentBlock, vipTheme: boolean): string {
    if (block.settings?.fallbackImage === 'moyao-token-topup-v1') {
        return HERO_TOKEN_TOPUP_IMAGE;
    }
    if (block.settings?.fallbackImage === 'moyao-codex-tiers-v1') {
        return HERO_CODEX_TIERS_IMAGE;
    }
    if (block.settings?.fallbackImage === 'moyao-account-services-v1') {
        return HERO_ACCOUNT_SERVICES_IMAGE;
    }
    if (block.settings?.fallbackImage === 'cloudbridge-ai-hub') {
        return HERO_CLOUD_BRIDGE_IMAGE;
    }
    return vipTheme ? HERO_VIP_IMAGE : HERO_GATEWAY_IMAGE;
}

export function builtInHeroFallbackImage(block: StorefrontContentBlock, vipTheme: boolean): string {
    if (block.settings?.fallbackImage === 'moyao-token-topup-v1') {
        return HERO_TOKEN_TOPUP_FALLBACK_IMAGE;
    }
    if (block.settings?.fallbackImage === 'moyao-codex-tiers-v1') {
        return HERO_CODEX_TIERS_FALLBACK_IMAGE;
    }
    if (block.settings?.fallbackImage === 'moyao-account-services-v1') {
        return HERO_ACCOUNT_SERVICES_FALLBACK_IMAGE;
    }
    if (block.settings?.fallbackImage === 'cloudbridge-ai-hub') {
        return HERO_CLOUD_BRIDGE_FALLBACK_IMAGE;
    }
    return vipTheme ? HERO_VIP_FALLBACK_IMAGE : HERO_GATEWAY_FALLBACK_IMAGE;
}
