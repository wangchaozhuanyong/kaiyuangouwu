import { type CSSProperties } from 'react';

import { normalizedHeroThemePreset } from '../content-visuals';

import { type ImageTone } from './image-tone';

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

    // Explicit or inferred background
    const rawBgColor = typeof block.backgroundColor === 'string' ? block.backgroundColor.trim() : '';
    const hasExplicitBg = HEX_COLOR_PATTERN.test(rawBgColor);
    const overlayColor = normalizedColor(
        block.backgroundColor,
        imageTone === 'light'
            ? 'rgba(255, 255, 255, 0.92)'
            : 'var(--store-background, var(--skin-hero-background, #090d16))',
    );

    // Check if background or detected tone is light
    const isLightTone = imageTone === 'light' || (hasExplicitBg && isLightColor(rawBgColor));
    const highContrast = settings.contrastMode === 'high';

    const accentColor = normalizedColor(
        settings.accentColor,
        `var(--store-primary, var(--skin-hero-accent, ${defaultAccent}))`,
    );

    // Explicit or adaptive title color
    const rawTextColor = typeof block.textColor === 'string' ? block.textColor.trim() : '';
    const hasExplicitText = HEX_COLOR_PATTERN.test(rawTextColor);
    const defaultTitleColor = isLightTone
        ? '#0f172a'
        : imageTone === 'dark'
          ? '#ffffff'
          : 'var(--store-foreground, var(--skin-hero-foreground, #ffffff))';
    const titleColor = hasExplicitText ? rawTextColor : defaultTitleColor;
    const titleIsLight = isLightColor(titleColor);

    // Adaptive secondary/desc text color:
    // If title was set to dark, secondary should definitely be dark (#334155), never white!
    const rawSecondaryColor =
        typeof settings.secondaryTextColor === 'string' ? settings.secondaryTextColor.trim() : '';
    const hasExplicitSecondary = HEX_COLOR_PATTERN.test(rawSecondaryColor);
    let defaultBodyColor: string;
    if (hasExplicitSecondary) {
        defaultBodyColor = rawSecondaryColor;
    } else if (hasExplicitText) {
        defaultBodyColor = titleIsLight ? '#f1f5f9' : '#334155';
    } else {
        defaultBodyColor = isLightTone
            ? '#334155'
            : imageTone === 'dark'
              ? '#f1f5f9'
              : 'var(--store-foreground, var(--skin-hero-body, #cbd5e1))';
    }

    return {
        '--hero-overlay-color': overlayColor,
        '--hero-overlay-strong': isLightTone
            ? highContrast
                ? 'rgba(255, 255, 255, 0.75)'
                : 'rgba(255, 255, 255, 0.50)'
            : colorWithAlpha(overlayColor, highContrast ? 0.97 : 0.92),
        '--hero-overlay-medium': isLightTone
            ? highContrast
                ? 'rgba(255, 255, 255, 0.45)'
                : 'rgba(255, 255, 255, 0.25)'
            : colorWithAlpha(overlayColor, highContrast ? 0.9 : 0.82),
        '--hero-overlay-soft': isLightTone
            ? 'rgba(255, 255, 255, 0.08)'
            : colorWithAlpha(overlayColor, highContrast ? 0.66 : 0.46),
        '--hero-overlay-fade': isLightTone
            ? 'transparent'
            : colorWithAlpha(overlayColor, highContrast ? 0.18 : 0.08),
        '--hero-title-color': titleColor,
        '--hero-body-color': defaultBodyColor,
        '--hero-accent-color': accentColor,
        '--hero-accent-soft': isLightTone ? 'rgba(255, 255, 255, 0.85)' : colorWithAlpha(accentColor, 0.18),
        '--hero-accent-border': isLightTone
            ? colorWithAlpha(accentColor, 0.65)
            : colorWithAlpha(accentColor, 0.48),
        '--hero-accent-subtle-border': colorWithAlpha(accentColor, 0.3),
        '--hero-accent-strong-border': colorWithAlpha(accentColor, 0.72),
        '--hero-accent-shadow': colorWithAlpha(accentColor, 0.42),
        '--hero-accent-text-shadow': colorWithAlpha(accentColor, 0.52),
        '--hero-accent-secondary-color': normalizedColor(
            settings.accentSecondaryColor,
            `var(--store-highlight, var(--skin-hero-secondary, ${defaultAccentSecondary}))`,
        ),
        '--hero-button-text-color': normalizedColor(settings.buttonTextColor, '#ffffff'),
        '--hero-title-shadow':
            isLightTone || !titleIsLight
                ? '0 1px 0 rgba(255, 255, 255, 0.86), 0 0 16px rgba(255, 255, 255, 0.55), 0 8px 24px rgba(69, 26, 26, 0.12)'
                : '0 2px 10px rgba(0, 0, 0, 0.85), 0 0 20px var(--hero-accent-shadow)',
        '--hero-body-shadow':
            isLightTone || !titleIsLight
                ? '0 1px 0 rgba(255, 255, 255, 0.85), 0 0 12px rgba(255, 255, 255, 0.4)'
                : '0 1px 4px rgba(0, 0, 0, 0.85), 0 0 8px rgba(0, 0, 0, 0.4)',
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

export function heroUsesImageOverlay(block: HeroThemeData): boolean {
    return normalizedHeroThemePreset(block.settings?.themePreset) !== 'bright';
}
