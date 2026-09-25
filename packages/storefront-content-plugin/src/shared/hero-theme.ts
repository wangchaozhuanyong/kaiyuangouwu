import { type CSSProperties } from 'react';

import { normalizedHeroThemePreset } from '../content-visuals';

import { type ImageTone } from './image-tone';
import { readableStorefrontForeground, storefrontContrastRatio } from './storefront-semantic-palette';

export interface HeroThemeData {
    backgroundColor?: string | null;
    textColor?: string | null;
    settings?: Record<string, unknown> | null;
}

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

export function isLightColor(color: string): boolean {
    if (!HEX_COLOR_PATTERN.test(color)) return false;
    const normalized = color.slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 255_000 >= 0.72;
}

export function heroThemeStyle(block: HeroThemeData, imageTone?: ImageTone): HeroThemeStyle {
    const settings = block.settings ?? {};
    const vipTheme = normalizedHeroThemePreset(settings.themePreset) === 'warm';
    const defaultAccent = vipTheme ? '#fbbf24' : '#67e8f9';
    const defaultAccentSecondary = vipTheme ? '#b45309' : '#0e7490';

    // Explicit background
    const rawBgColor = typeof block.backgroundColor === 'string' ? block.backgroundColor.trim() : '';
    const hasExplicitBg = HEX_COLOR_PATTERN.test(rawBgColor);
    const bgIsLight = hasExplicitBg && isLightColor(rawBgColor);

    // Explicit text
    const rawTextColor = typeof block.textColor === 'string' ? block.textColor.trim() : '';
    const hasExplicitText = HEX_COLOR_PATTERN.test(rawTextColor);
    const explicitTextIsLight = hasExplicitText && isLightColor(rawTextColor);

    // Legacy tone variables still style badges, while readable copy is paired
    // with its own background independent of the artwork.
    const isLightTone = hasExplicitText
        ? !explicitTextIsLight
        : hasExplicitBg
          ? bgIsLight
          : imageTone === 'light';
    const copyBackground = hasExplicitBg ? rawBgColor : 'var(--surface)';
    const copyForeground = hasExplicitBg
        ? hasExplicitText && storefrontContrastRatio(rawTextColor, rawBgColor) >= 4.5
            ? rawTextColor
            : readableStorefrontForeground(rawBgColor)
        : 'var(--text)';
    const configuredBody =
        typeof settings.secondaryTextColor === 'string' ? settings.secondaryTextColor.trim() : '';
    const copyBodyForeground = hasExplicitBg
        ? HEX_COLOR_PATTERN.test(configuredBody) && storefrontContrastRatio(configuredBody, rawBgColor) >= 4.5
            ? configuredBody
            : copyForeground
        : 'var(--muted)';
    const imageOverlayBackground = hasExplicitBg ? rawBgColor : '#10212F';
    const imageOverlayForeground = hasExplicitBg
        ? copyForeground
        : hasExplicitText && storefrontContrastRatio(rawTextColor, imageOverlayBackground) >= 4.5
          ? rawTextColor
          : '#FFFFFF';
    const imageOverlayBodyForeground =
        HEX_COLOR_PATTERN.test(configuredBody) &&
        storefrontContrastRatio(configuredBody, imageOverlayBackground) >= 4.5
            ? configuredBody
            : imageOverlayForeground;

    const accentColor = normalizedColor(
        settings.accentColor,
        `var(--store-primary, var(--skin-hero-accent, ${defaultAccent}))`,
    );
    const readableAccent = hasExplicitBg
        ? HEX_COLOR_PATTERN.test(accentColor) && storefrontContrastRatio(accentColor, rawBgColor) >= 4.5
            ? accentColor
            : copyForeground
        : 'var(--accent-ink)';
    const accentSecondary = normalizedColor(
        settings.accentSecondaryColor,
        `var(--store-highlight, var(--skin-hero-secondary, ${defaultAccentSecondary}))`,
    );
    const configuredButtonText = normalizedColor(settings.buttonTextColor, '');
    const explicitAccent = HEX_COLOR_PATTERN.test(accentColor);
    const explicitAccentSecondary = HEX_COLOR_PATTERN.test(accentSecondary);
    const gradientColors = explicitAccentSecondary ? [accentColor, accentSecondary] : [accentColor];
    const sharedButtonForeground = explicitAccent
        ? [configuredButtonText, '#ffffff', '#000000'].find(
              candidate =>
                  HEX_COLOR_PATTERN.test(candidate) &&
                  gradientColors.every(color => storefrontContrastRatio(candidate, color) >= 4.5),
          )
        : undefined;
    const buttonBackground = explicitAccent
        ? explicitAccentSecondary && sharedButtonForeground
            ? `linear-gradient(135deg, ${accentColor}, ${accentSecondary})`
            : accentColor
        : 'var(--accent)';
    const buttonForeground = explicitAccent
        ? (sharedButtonForeground ?? readableStorefrontForeground(accentColor))
        : 'var(--accent-foreground)';

    // Explicit or adaptive title color
    const defaultTitleColor = isLightTone
        ? '#0f172a'
        : imageTone === 'dark'
          ? '#ffffff'
          : 'var(--store-foreground, var(--skin-hero-foreground, #ffffff))';
    const titleColor = hasExplicitText ? rawTextColor : defaultTitleColor;
    const titleIsLight = isLightColor(titleColor);

    // Adaptive secondary/desc text color:
    // If title was set to dark, secondary must always be dark (#334155 / #1e293b), never white!
    const rawSecondaryColor =
        typeof settings.secondaryTextColor === 'string' ? settings.secondaryTextColor.trim() : '';
    const hasExplicitSecondary = HEX_COLOR_PATTERN.test(rawSecondaryColor);
    let defaultBodyColor: string;
    if (hasExplicitSecondary) {
        defaultBodyColor = rawSecondaryColor;
    } else if (!titleIsLight) {
        defaultBodyColor = '#334155';
    } else {
        // Keep legacy badge typography aligned with its tone.
        defaultBodyColor = isLightTone ? '#334155' : '#f1f5f9';
    }

    return {
        '--hero-copy-background': copyBackground,
        '--hero-copy-foreground': copyForeground,
        '--hero-copy-body-foreground': copyBodyForeground,
        '--hero-image-overlay-start': colorWithAlpha(imageOverlayBackground, 0.86),
        '--hero-image-overlay-middle': colorWithAlpha(imageOverlayBackground, 0.42),
        '--hero-image-copy-foreground': imageOverlayForeground,
        '--hero-image-body-foreground': imageOverlayBodyForeground,
        '--hero-image-text-shadow': isLightColor(imageOverlayForeground)
            ? '0 1px 5px rgba(5, 16, 27, 0.48)'
            : '0 1px 5px rgba(255, 255, 255, 0.6)',
        '--hero-title-color': titleColor,
        '--hero-body-color': defaultBodyColor,
        '--hero-accent-color': accentColor,
        '--hero-accent-readable': readableAccent,
        '--hero-button-background': buttonBackground,
        '--hero-button-hover-background': explicitAccent
            ? buttonBackground
            : 'var(--accent-hover, var(--accent))',
        '--hero-button-foreground': buttonForeground,
        '--hero-accent-soft': isLightTone ? 'rgba(255, 255, 255, 0.88)' : colorWithAlpha(accentColor, 0.18),
        '--hero-accent-border': isLightTone
            ? colorWithAlpha(accentColor, 0.65)
            : colorWithAlpha(accentColor, 0.48),
        '--hero-accent-subtle-border': colorWithAlpha(accentColor, 0.3),
        '--hero-accent-strong-border': colorWithAlpha(accentColor, 0.72),
        '--hero-accent-shadow': colorWithAlpha(accentColor, 0.42),
        '--hero-accent-text-shadow': colorWithAlpha(accentColor, 0.52),
        '--hero-accent-secondary-color': accentSecondary,
        '--hero-button-text-color': normalizedColor(settings.buttonTextColor, '#ffffff'),
        '--hero-title-shadow':
            isLightTone || !titleIsLight
                ? '0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 8px rgba(0, 0, 0, 0.04)'
                : '0 1px 4px rgba(0, 0, 0, 0.45)',
        '--hero-body-shadow':
            isLightTone || !titleIsLight
                ? '0 1px 1px rgba(255, 255, 255, 0.85)'
                : '0 1px 3px rgba(0, 0, 0, 0.4)',
        '--hero-pill-shadow': isLightTone
            ? '0 2px 10px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(255, 255, 255, 0.8)'
            : '0 2px 8px rgba(0, 0, 0, 0.3)',
        '--hero-stat-background': isLightTone ? 'rgba(255, 255, 255, 0.74)' : 'rgba(15, 23, 42, 0.7)',
        '--hero-stat-shadow': isLightTone
            ? '0 4px 14px rgba(0, 0, 0, 0.06)'
            : '0 3px 10px rgba(0, 0, 0, 0.22)',
        '--hero-pagination-color': isLightTone ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255, 255, 255, 0.5)',
        '--hero-pagination-active-color': isLightTone ? '#0f172a' : '#ffffff',
    };
}
