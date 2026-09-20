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

export interface StorefrontPaletteAudit {
    passes: boolean;
    checks: Array<{
        name:
            | 'body'
            | 'page-body'
            | 'muted'
            | 'page-muted'
            | 'button'
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
    const page = normalizeStorefrontColor(brand.backgroundColor) ?? '#f1f5f9';
    const text = readableStorefrontForeground(page);
    const surfaceTarget = text === '#ffffff' ? '#ffffff' : '#ffffff';
    const surface = text === '#ffffff' ? mixColors(page, surfaceTarget, 0.08) : '#ffffff';
    const surfaceText = readableStorefrontForeground(surface);
    const brandColor = normalizeStorefrontColor(brand.primaryColor) ?? '#d33c30';
    const accentSource = normalizeStorefrontColor(brand.accentColor) ?? brandColor;
    const onAccent = readableStorefrontForeground(accentSource);
    const accent = makeAccessibleAgainst(accentSource, onAccent, 4.5);
    const accentForeground = readableStorefrontForeground(accent);

    const contrastDirection = surfaceText === '#ffffff' ? 'light' : 'dark';
    const accentSoft = mixColors(surface, accent, surfaceText === '#ffffff' ? 0.14 : 0.08);
    const accentInk = makeAccessibleAgainstAll(accent, [page, surface, accentSoft], 4.5, contrastDirection);
    return {
        page,
        surface,
        elevated: text === '#ffffff' ? mixColors(page, '#ffffff', 0.13) : '#ffffff',
        subtle: mixColors(surface, surfaceText, surfaceText === '#ffffff' ? 0.07 : 0.055),
        text: surfaceText,
        muted: makeAccessibleAgainstAll(
            mixColors(surfaceText, surface, 0.42),
            [page, surface],
            4.5,
            contrastDirection,
        ),
        brand: brandColor,
        accent,
        accentHover: makeAccessibleAgainst(
            normalizeStorefrontColor(brand.highlightColor) ?? mixColors(accent, '#000000', 0.14),
            accentForeground,
            4.5,
        ),
        accentSoft,
        accentInk,
        onAccent: accentForeground,
        border: makeAccessibleAgainstAll(
            mixColors(surfaceText, surface, 0.58),
            [page, surface],
            3,
            contrastDirection,
        ),
        borderStrong: makeAccessibleAgainstAll(
            mixColors(surfaceText, surface, 0.42),
            [page, surface],
            3,
            contrastDirection,
        ),
        focus: makeAccessibleAgainstAll(accent, [page, surface], 3, contrastDirection),
        success: makeAccessibleAgainst('#047857', surface, 4.5),
        warning: makeAccessibleAgainst('#92400e', surface, 4.5),
        danger: makeAccessibleAgainst('#b91c1c', surface, 4.5),
    };
}

const FIXED_PALETTES: Record<Exclude<StorefrontVisualPresetId, 'classic'>, StorefrontSemanticPalette> = {
    'modern-oriental': {
        page: '#f6f2ea',
        surface: '#fffdf8',
        elevated: '#ffffff',
        subtle: '#eee7da',
        text: '#17283a',
        muted: '#596775',
        brand: '#a63d32',
        accent: '#922f27',
        accentHover: '#77251f',
        accentSoft: '#f4e5df',
        accentInk: '#922f27',
        onAccent: '#ffffff',
        border: '#8b8174',
        borderStrong: '#665d52',
        focus: '#7c2d24',
        success: '#24613e',
        warning: '#8a4d0f',
        danger: '#9d2822',
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
        accentHover: '#875cf0',
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
