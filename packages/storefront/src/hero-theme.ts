import type { CSSProperties } from 'react';

import { normalizedHeroThemePreset } from '../../storefront-content-plugin/src/content-visuals';

import { StorefrontContentBlock } from './types';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

type HeroThemeStyle = CSSProperties & Record<`--hero-${string}`, string>;

function normalizedColor(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

function colorWithAlpha(color: string, alpha: number): string {
    if (!HEX_COLOR_PATTERN.test(color)) return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
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

export function heroThemeStyle(block: StorefrontContentBlock): HeroThemeStyle {
    const settings = block.settings ?? {};
    const vipTheme = normalizedHeroThemePreset(settings.themePreset) === 'warm';
    const defaultAccent = vipTheme ? '#fbbf24' : '#67e8f9';
    const defaultAccentSecondary = vipTheme ? '#b45309' : '#0e7490';
    const overlayColor = normalizedColor(
        block.backgroundColor,
        'var(--store-background, var(--skin-hero-background, #090d16))',
    );
    const accentColor = normalizedColor(
        settings.accentColor,
        `var(--store-primary, var(--skin-hero-accent, ${defaultAccent}))`,
    );
    const lightOverlay = isLightColor(overlayColor);
    const highContrast = settings.contrastMode === 'high';

    return {
        '--hero-overlay-color': overlayColor,
        '--hero-overlay-strong': colorWithAlpha(overlayColor, highContrast ? 0.97 : 0.92),
        '--hero-overlay-medium': colorWithAlpha(overlayColor, highContrast ? 0.9 : 0.82),
        '--hero-overlay-soft': colorWithAlpha(overlayColor, highContrast ? 0.66 : 0.46),
        '--hero-overlay-fade': colorWithAlpha(overlayColor, highContrast ? 0.18 : 0.08),
        '--hero-title-color': normalizedColor(
            block.textColor,
            'var(--store-foreground, var(--skin-hero-foreground, #ffffff))',
        ),
        '--hero-body-color': normalizedColor(
            settings.secondaryTextColor,
            'var(--store-foreground, var(--skin-hero-body, #cbd5e1))',
        ),
        '--hero-accent-color': accentColor,
        '--hero-accent-soft': colorWithAlpha(accentColor, 0.18),
        '--hero-accent-border': colorWithAlpha(accentColor, 0.48),
        '--hero-accent-subtle-border': colorWithAlpha(accentColor, 0.3),
        '--hero-accent-strong-border': colorWithAlpha(accentColor, 0.72),
        '--hero-accent-shadow': colorWithAlpha(accentColor, 0.42),
        '--hero-accent-text-shadow': colorWithAlpha(accentColor, 0.52),
        '--hero-accent-secondary-color': normalizedColor(
            settings.accentSecondaryColor,
            `var(--store-highlight, var(--skin-hero-secondary, ${defaultAccentSecondary}))`,
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
    return normalizedHeroThemePreset(block.settings?.themePreset) !== 'bright';
}
