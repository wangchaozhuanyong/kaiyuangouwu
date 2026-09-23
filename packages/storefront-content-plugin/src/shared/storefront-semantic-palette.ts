import type { StorefrontVisualPresetId } from '../visual-presets';

export interface StorefrontBrandPaletteInput {
    backgroundColor?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
    highlightColor?: string | null;
}

export interface StorefrontSemanticPalette {
    page: string;
    surface: string;
    elevated: string;
    subtle: string;
    text: string;
    muted: string;
    brand: string;
    accent: string;
    accentHover: string;
    accentSoft: string;
    accentInk: string;
    onAccent: string;
    border: string;
    borderStrong: string;
    focus: string;
    success: string;
    warning: string;
    danger: string;
}

/** Decorative surfaces are deliberately separate from accessible control borders. */
export interface StorefrontSkinTreatment {
    divider: string;
    displayFont: string;
    cardRadius: string;
    heroRadius: string;
    controlRadius: string;
    mediaRadius: string;
    cardShadow: string;
    cardHoverShadow: string;
    heroShadow: string;
    headerShadow: string;
}

export interface StorefrontPaletteAudit {
    passes: boolean;
    checks: Array<{
        name:
            | 'body'
            | 'page-body'
            | 'muted'
            | 'page-muted'
            | 'button'
            | 'button-hover'
            | 'emphasis'
            | 'page-emphasis'
            | 'border'
            | 'focus';
        ratio: number;
        minimum: number;
        passes: boolean;
    }>;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeStorefrontColor(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
        return `#${trimmed
            .slice(1)
            .split('')
            .map(character => character + character)
            .join('')}`.toLowerCase();
    }
    return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : null;
}

function colorChannels(color: string): [number, number, number] {
    const normalized = normalizeStorefrontColor(color) ?? '#000000';
    return [1, 3, 5].map(index => Number.parseInt(normalized.slice(index, index + 2), 16)) as [
        number,
        number,
        number,
    ];
}

function channelLuminance(channel: number): number {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function storefrontRelativeLuminance(color: string): number {
    const [red, green, blue] = colorChannels(color).map(channelLuminance) as [number, number, number];
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function storefrontContrastRatio(foreground: string, background: string): number {
    const lighter = Math.max(
        storefrontRelativeLuminance(foreground),
        storefrontRelativeLuminance(background),
    );
    const darker = Math.min(storefrontRelativeLuminance(foreground), storefrontRelativeLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
}

export function readableStorefrontForeground(background: string, minimum = 4.5): '#ffffff' | '#000000' {
    const dark = storefrontContrastRatio('#000000', background);
    const light = storefrontContrastRatio('#ffffff', background);
    if (dark >= minimum && dark >= light) return '#000000';
    return '#ffffff';
}

function mixColors(first: string, second: string, amount: number): string {
    const start = colorChannels(first);
    const end = colorChannels(second);
    const mixed = start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount));
    return `#${mixed.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function makeAccessibleAgainst(
    color: string,
    background: string,
    minimum: number,
    preferredDirection?: 'dark' | 'light',
): string {
    if (storefrontContrastRatio(color, background) >= minimum) return color;
    const darkRatio = storefrontContrastRatio('#000000', background);
    const lightRatio = storefrontContrastRatio('#ffffff', background);
    const target =
        preferredDirection === 'dark'
            ? '#000000'
            : preferredDirection === 'light'
              ? '#ffffff'
              : darkRatio >= lightRatio
                ? '#000000'
                : '#ffffff';
    for (let step = 1; step <= 20; step += 1) {
        const candidate = mixColors(color, target, step / 20);
        if (storefrontContrastRatio(candidate, background) >= minimum) return candidate;
    }
    return target;
}

function makeAccessibleAgainstAll(
    color: string,
    backgrounds: string[],
    minimum: number,
    direction: 'dark' | 'light',
): string {
    let candidate = color;
    for (let pass = 0; pass < 2; pass += 1) {
        for (const background of backgrounds) {
            candidate = makeAccessibleAgainst(candidate, background, minimum, direction);
        }
    }
    return candidate;
}

function resolveClassicPalette(brand: StorefrontBrandPaletteInput): StorefrontSemanticPalette {
    // Classic keeps a light interface even when the merchant's saved brand background is dark.
    // The original brand colors remain untouched and can still provide the identity accent.
    const page = '#f1f5f9';
    const surface = '#ffffff';
    const surfaceText = '#0f172a';
    const brandColor =
        normalizeStorefrontColor(brand.primaryColor) ??
        normalizeStorefrontColor(brand.backgroundColor) ??
        '#d33c30';
    const accentSource = normalizeStorefrontColor(brand.accentColor) ?? brandColor;
    // Legacy primary controls use white labels, so the derived UI accent must always support them.
    const accentForeground = '#ffffff';
    const accent = makeAccessibleAgainst(accentSource, accentForeground, 4.5, 'dark');

    const accentSoft = mixColors(surface, accent, 0.08);
    const accentInk = makeAccessibleAgainstAll(accent, [page, surface, accentSoft], 4.5, 'dark');
    return {
        page,
        surface,
        elevated: '#ffffff',
        subtle: mixColors(surface, surfaceText, 0.055),
        text: surfaceText,
        muted: makeAccessibleAgainstAll(mixColors(surfaceText, surface, 0.42), [page, surface], 4.5, 'dark'),
        brand: brandColor,
        accent,
        accentHover: makeAccessibleAgainst(
            normalizeStorefrontColor(brand.highlightColor) ?? mixColors(accent, '#000000', 0.14),
            accentForeground,
            4.5,
            'dark',
        ),
        accentSoft,
        accentInk,
        onAccent: accentForeground,
        border: makeAccessibleAgainstAll(mixColors(surfaceText, surface, 0.58), [page, surface], 3, 'dark'),
        borderStrong: makeAccessibleAgainstAll(
            mixColors(surfaceText, surface, 0.42),
            [page, surface],
            3,
            'dark',
        ),
        focus: makeAccessibleAgainstAll(accent, [page, surface], 3, 'dark'),
        success: makeAccessibleAgainst('#047857', surface, 4.5),
        warning: makeAccessibleAgainst('#92400e', surface, 4.5),
        danger: makeAccessibleAgainst('#b91c1c', surface, 4.5),
    };
}

const FIXED_PALETTES: Record<Exclude<StorefrontVisualPresetId, 'classic'>, StorefrontSemanticPalette> = {
    'modern-oriental': {
        page: '#f1ece2',
        surface: '#fffaf1',
        elevated: '#fffdf8',
        subtle: '#e8dfd0',
        text: '#1c302d',
        muted: '#5b645d',
        brand: '#9f3b30',
        accent: '#913128',
        accentHover: '#74251f',
        accentSoft: '#f1ddd3',
        accentInk: '#873027',
        onAccent: '#fffdf8',
        border: '#807563',
        borderStrong: '#5f574a',
        focus: '#873027',
        success: '#285d46',
        warning: '#855213',
        danger: '#942c27',
    },
    'neo-minimalist': {
        page: '#070b14',
        surface: '#0e1421',
        elevated: '#151d2d',
        subtle: '#1b2435',
        text: '#f4f7fb',
        muted: '#a9b6c8',
        brand: '#8b5cf6',
        accent: '#7645e5',
        accentHover: '#8054e5',
        accentSoft: '#251b3b',
        accentInk: '#c4b5fd',
        onAccent: '#ffffff',
        border: '#65748a',
        borderStrong: '#8897aa',
        focus: '#a78bfa',
        success: '#41d99c',
        warning: '#f4bf63',
        danger: '#ff7d86',
    },
};

const SKIN_TREATMENTS: Record<StorefrontVisualPresetId, StorefrontSkinTreatment> = {
    classic: {
        divider: '#e4eaf1',
        displayFont:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        cardRadius: '16px',
        heroRadius: '20px',
        controlRadius: '10px',
        mediaRadius: '12px',
        cardShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
        cardHoverShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
        heroShadow: '0 6px 24px rgba(15, 23, 42, 0.06)',
        headerShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
    },
    'modern-oriental': {
        divider: '#ded2c0',
        displayFont: "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'SimSun', Georgia, serif",
        cardRadius: '14px',
        heroRadius: '18px',
        controlRadius: '8px',
        mediaRadius: '10px',
        cardShadow: '0 2px 12px rgba(67, 48, 27, 0.045)',
        cardHoverShadow: '0 6px 20px rgba(67, 48, 27, 0.085)',
        heroShadow: '0 8px 28px rgba(55, 39, 22, 0.07)',
        headerShadow: '0 2px 12px rgba(55, 39, 22, 0.045)',
    },
    'neo-minimalist': {
        divider: '#2a3548',
        displayFont:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        cardRadius: '16px',
        heroRadius: '20px',
        controlRadius: '10px',
        mediaRadius: '12px',
        cardShadow: '0 2px 12px rgba(0, 0, 0, 0.14)',
        cardHoverShadow: '0 8px 24px rgba(0, 0, 0, 0.24)',
        heroShadow: '0 8px 28px rgba(0, 0, 0, 0.2)',
        headerShadow: '0 2px 12px rgba(0, 0, 0, 0.16)',
    },
};

type StorefrontToolTone = 'security' | 'mail' | 'studio' | 'coupon' | 'support';

/** Identity colors for service modules; text and controls still use the semantic palette. */
const TOOL_ICON_TONES: Record<
    StorefrontVisualPresetId,
    Record<StorefrontToolTone, { foreground: string; background: string }>
> = {
    classic: {
        security: { foreground: '#1d4ed8', background: '#dbeafe' },
        mail: { foreground: '#0f766e', background: '#ccfbf1' },
        studio: { foreground: '#6d28d9', background: '#ede9fe' },
        coupon: { foreground: '#92400e', background: '#fef3c7' },
        support: { foreground: '#b42318', background: '#fee4e2' },
    },
    'modern-oriental': {
        security: { foreground: '#245b66', background: '#dcebea' },
        mail: { foreground: '#27604b', background: '#deebdf' },
        studio: { foreground: '#76513a', background: '#eee1d5' },
        coupon: { foreground: '#855b18', background: '#f2e5c8' },
        support: { foreground: '#913128', background: '#f1ddd3' },
    },
    'neo-minimalist': {
        security: { foreground: '#93c5fd', background: '#19304f' },
        mail: { foreground: '#5eead4', background: '#113b3a' },
        studio: { foreground: '#c4b5fd', background: '#2b2052' },
        coupon: { foreground: '#fcd34d', background: '#463414' },
        support: { foreground: '#fda4af', background: '#4c2432' },
    },
};

export function resolveStorefrontSkinTreatment(presetId: StorefrontVisualPresetId): StorefrontSkinTreatment {
    return { ...SKIN_TREATMENTS[presetId] };
}

export function storefrontSkinCssVariables(presetId: StorefrontVisualPresetId): Record<string, string> {
    const treatment = resolveStorefrontSkinTreatment(presetId);
    const variables: Record<string, string> = {
        '--skin-divider': treatment.divider,
        '--skin-display-font': treatment.displayFont,
        '--skin-card-radius': treatment.cardRadius,
        '--skin-hero-radius': treatment.heroRadius,
        '--skin-control-radius': treatment.controlRadius,
        '--skin-media-radius': treatment.mediaRadius,
        '--skin-card-shadow': treatment.cardShadow,
        '--skin-card-hover-shadow': treatment.cardHoverShadow,
        '--skin-hero-shadow': treatment.heroShadow,
        '--skin-header-shadow': treatment.headerShadow,
    };
    for (const [tone, colors] of Object.entries(TOOL_ICON_TONES[presetId])) {
        variables[`--skin-tool-${tone}-foreground`] = colors.foreground;
        variables[`--skin-tool-${tone}-background`] = colors.background;
    }
    return variables;
}

export function resolveStorefrontSemanticPalette(
    presetId: StorefrontVisualPresetId,
    brand: StorefrontBrandPaletteInput = {},
): StorefrontSemanticPalette {
    return presetId === 'classic' ? resolveClassicPalette(brand) : { ...FIXED_PALETTES[presetId] };
}

export function semanticPaletteCssVariables(palette: StorefrontSemanticPalette): Record<string, string> {
    return {
        '--store-background': palette.page,
        '--store-primary': palette.brand,
        '--store-highlight': palette.accentHover,
        '--store-foreground': palette.text,
        '--auth-store-background': palette.page,
        '--auth-store-foreground': palette.text,
        '--brand-background': palette.page,
        '--brand-primary': palette.brand,
        '--brand-accent': palette.accent,
        '--brand-highlight': palette.accentHover,
        '--bg': palette.page,
        '--paper': palette.surface,
        '--surface': palette.surface,
        '--surface-elevated': palette.elevated,
        '--soft': palette.subtle,
        '--text': palette.text,
        '--muted': palette.muted,
        '--accent': palette.accent,
        '--accent-hover': palette.accentHover,
        '--accent-soft': palette.accentSoft,
        '--accent-foreground': palette.onAccent,
        '--accent-ink': palette.accentInk,
        '--line': palette.border,
        '--line-strong': palette.borderStrong,
        '--focus': palette.focus,
        '--success': palette.success,
        '--warning': palette.warning,
        '--danger': palette.danger,
    };
}

export function auditStorefrontSemanticPalette(palette: StorefrontSemanticPalette): StorefrontPaletteAudit {
    const definitions: Array<[StorefrontPaletteAudit['checks'][number]['name'], string, string, number]> = [
        ['body', palette.text, palette.surface, 4.5],
        ['page-body', palette.text, palette.page, 4.5],
        ['muted', palette.muted, palette.surface, 4.5],
        ['page-muted', palette.muted, palette.page, 4.5],
        ['button', palette.onAccent, palette.accent, 4.5],
        ['button-hover', palette.onAccent, palette.accentHover, 4.5],
        ['emphasis', palette.accentInk, palette.accentSoft, 4.5],
        ['page-emphasis', palette.accentInk, palette.page, 4.5],
        ['border', palette.border, palette.surface, 3],
        ['focus', palette.focus, palette.surface, 3],
    ];
    const checks = definitions.map(([name, foreground, background, minimum]) => {
        const ratio = storefrontContrastRatio(foreground, background);
        return { name, ratio, minimum, passes: ratio >= minimum };
    });
    return { passes: checks.every(check => check.passes), checks };
}
