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
    selection: string;
    selectionHover: string;
    onSelection: string;
    selectionSoft?: string;
    interactionHover: string;
    interactionPressed: string;
    interactionInk: string;
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
    /** Whole-border value; initial lets other skins retain each surface owner's fallback. */
    cardOutline: string;
    cardOutlineHover: string;
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
            | 'elevated-body'
            | 'subtle-body'
            | 'muted'
            | 'page-muted'
            | 'subtle-muted'
            | 'accent-soft-muted'
            | 'button'
            | 'button-hover'
            | 'selection'
            | 'selection-hover'
            | 'selection-surface'
            | 'selection-page'
            | 'interaction-hover'
            | 'interaction-pressed'
            | 'emphasis'
            | 'page-emphasis'
            | 'border'
            | 'page-border'
            | 'focus'
            | 'page-focus'
            | 'success'
            | 'warning'
            | 'danger';
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

function resolveClassicPalette(): StorefrontSemanticPalette {
    // UI colors belong to the selected preset, including legacy brand aliases.
    // Saved merchant colors remain content data and must not recolor shared controls.
    const page = '#f1f5f9';
    const surface = '#ffffff';
    const surfaceText = '#25292d';
    const brandColor = '#292d32';
    const accentSource = brandColor;
    // Legacy primary controls use white labels, so the derived UI accent must always support them.
    const accentForeground = '#ffffff';
    const accent = makeAccessibleAgainst(accentSource, accentForeground, 4.5, 'dark');

    const accentSoft = '#f4f2ed';
    const accentInk = surfaceText;
    return {
        page,
        surface,
        elevated: '#ffffff',
        // Existing white and gray foundations remain unchanged by the accent redesign.
        subtle: '#f2f2f3',
        text: surfaceText,
        muted: '#626b75',
        brand: brandColor,
        accent,
        accentHover: '#161a1e',
        accentSoft,
        accentInk,
        onAccent: accentForeground,
        selection: '#735b36',
        selectionHover: '#604b2c',
        onSelection: '#ffffff',
        selectionSoft: accentSoft,
        interactionHover: '#f4f2ed',
        interactionPressed: '#eae5dc',
        interactionInk: '#735b36',
        border: '#7c8288',
        borderStrong: '#7c8288',
        focus: '#735b36',
        success: makeAccessibleAgainst('#047857', surface, 4.5),
        warning: makeAccessibleAgainst('#92400e', surface, 4.5),
        danger: makeAccessibleAgainst('#b91c1c', surface, 4.5),
    };
}

const FIXED_PALETTES: Record<Exclude<StorefrontVisualPresetId, 'classic'>, StorefrontSemanticPalette> = {
    'neo-minimalist': {
        page: '#070b14',
        surface: '#0e1421',
        elevated: '#151d2d',
        subtle: '#1b2435',
        text: '#f4f7fb',
        muted: '#a9b6c8',
        brand: '#8b5cf6',
        accent: '#6654c8',
        accentHover: '#5745b6',
        accentSoft: '#251b3b',
        accentInk: '#c4b5fd',
        onAccent: '#ffffff',
        selection: '#b9e3d7',
        selectionHover: '#d2efe6',
        onSelection: '#173e36',
        interactionHover: '#223c3c',
        interactionPressed: '#2c4d48',
        interactionInk: '#b9e3d7',
        border: '#65748a',
        borderStrong: '#8897aa',
        focus: '#a78bfa',
        success: '#41d99c',
        warning: '#f4bf63',
        danger: '#ff7d86',
    },
};

const SHARED_SKIN_GEOMETRY = {
    displayFont:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    cardRadius: '16px',
    heroRadius: '20px',
    controlRadius: '10px',
    mediaRadius: '12px',
};

const SKIN_TREATMENTS: Record<StorefrontVisualPresetId, StorefrontSkinTreatment> = {
    classic: {
        divider: '#dfe3e8',
        cardOutline: '1px solid #dfe3e8',
        cardOutlineHover: '#cbd1d8',
        ...SHARED_SKIN_GEOMETRY,
        cardShadow: '0 2px 8px rgba(37, 41, 45, 0.04)',
        cardHoverShadow: '0 4px 12px rgba(37, 41, 45, 0.07)',
        heroShadow: '0 6px 24px rgba(37, 41, 45, 0.06)',
        headerShadow: '0 2px 10px rgba(37, 41, 45, 0.04)',
    },

    'neo-minimalist': {
        divider: '#2a3548',
        cardOutline: 'initial',
        cardOutlineHover: 'initial',
        ...SHARED_SKIN_GEOMETRY,
        cardShadow: '0 8px 24px rgba(0, 0, 0, 0.24)',
        cardHoverShadow: '0 12px 28px rgba(0, 0, 0, 0.34)',
        heroShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
        headerShadow: '0 2px 12px rgba(0, 0, 0, 0.16)',
    },
};

type StorefrontToolTone = 'security' | 'mail' | 'studio' | 'coupon' | 'support';

/** Identity colors for service modules; text and controls still use the semantic palette. */
const TOOL_ICON_TONES: Record<
    StorefrontVisualPresetId,
    Record<StorefrontToolTone, [foreground: string, background: string]>
> = {
    classic: {
        security: ['#1d4ed8', '#dbeafe'],
        mail: ['#0f766e', '#ccfbf1'],
        studio: ['#6d28d9', '#ede9fe'],
        coupon: ['#92400e', '#fef3c7'],
        support: ['#b42318', '#fee4e2'],
    },

    'neo-minimalist': {
        security: ['#93c5fd', '#19304f'],
        mail: ['#5eead4', '#113b3a'],
        studio: ['#c4b5fd', '#2b2052'],
        coupon: ['#fcd34d', '#463414'],
        support: ['#fda4af', '#4c2432'],
    },
};

// Stable service identities; every skin derives surfaces and readable ink from its actual palette.
const SERVICE_CARD_HUES: Record<StorefrontToolTone, string> = {
    security: '#3978db',
    mail: '#20a77d',
    studio: '#915ee5',
    coupon: '#d69b31',
    support: '#db7869',
};

function serviceCardInk(color: string, backgrounds: string[], target: string): string {
    for (let step = 0; step <= 100; step += 1) {
        const candidate = mixColors(color, target, step / 100);
        if (backgrounds.every(background => storefrontContrastRatio(candidate, background) >= 4.5)) {
            return candidate;
        }
    }
    return target;
}

export function storefrontServiceCardCssVariables(
    palette: StorefrontSemanticPalette,
): Record<string, string> {
    const dark = storefrontRelativeLuminance(palette.surface) < 0.3;
    const target = dark ? '#ffffff' : '#000000';
    const variables: Record<string, string> = {};
    for (const [tone, hue] of Object.entries(SERVICE_CARD_HUES)) {
        const prefix = `--skin-service-${tone}-`;
        const surface = mixColors(palette.surface, hue, dark ? 0.25 : 0.14);
        const action = mixColors(palette.surface, hue, dark ? 0.43 : 0.31);
        const hover = mixColors(palette.surface, hue, dark ? 0.51 : 0.39);
        variables[`${prefix}surface`] = surface;
        variables[`${prefix}action`] = action;
        variables[`${prefix}action-hover`] = hover;
        variables[`${prefix}ink`] = serviceCardInk(hue, [surface, action, hover], target);
        variables[`${prefix}description`] = serviceCardInk(palette.muted, [surface], target);
    }
    return variables;
}

export function resolveStorefrontSkinTreatment(presetId: StorefrontVisualPresetId): StorefrontSkinTreatment {
    return { ...SKIN_TREATMENTS[presetId] };
}

function assignColorVariables(
    variables: Record<string, string>,
    prefix: string,
    colors: Record<string, string>,
    fallback?: string,
    useFallback = false,
): void {
    for (const [names, color] of Object.entries(colors)) {
        for (const name of names.split(' ')) {
            variables[prefix + name] = useFallback ? (fallback as string) : color;
        }
    }
}

export function storefrontSkinCssVariables(
    presetId: StorefrontVisualPresetId,
    palette: StorefrontSemanticPalette = resolveStorefrontSemanticPalette(presetId),
): Record<string, string> {
    const treatment = resolveStorefrontSkinTreatment(presetId);
    const classic = presetId === 'classic';
    const variables: Record<string, string> = {
        ...storefrontServiceCardCssVariables(palette),
        '--accent-disabled-text': palette.muted,
    };
    assignColorVariables(variables, '--skin-', {
        divider: treatment.divider,
        'card-outline': treatment.cardOutline,
        'card-outline-hover': treatment.cardOutlineHover,
        // Opt-in elevation retains the existing initial fallback in other skins.
        'card-outline-shadow': treatment.cardOutline === 'initial' ? 'initial' : treatment.cardShadow,
        'display-font': treatment.displayFont,
        'card-radius': treatment.cardRadius,
        'hero-radius': treatment.heroRadius,
        'control-radius': treatment.controlRadius,
        'media-radius': treatment.mediaRadius,
        'card-shadow': treatment.cardShadow,
        'card-hover-shadow': treatment.cardHoverShadow,
        'hero-shadow': treatment.heroShadow,
        'header-shadow': treatment.headerShadow,
    });
    // Module colors belong to the shared skin; grouped aliases preserve identical values.
    const moduleColors: Array<[string, string, Record<string, string>]> = [
        [
            '--',
            'initial',
            {
                'accent-pressed': '#0f1215',
                'skin-primary-hover': '#161a1e',
                'control-border': '#7c8288',
                'savings-ink': '#9b432c',
            },
        ],
        [
            '--',
            palette.subtle,
            {
                'accent-disabled-bg': '#f0f1f2',
            },
        ],
        [
            '--',
            palette.accentInk,
            {
                'price-ink': '#25292d',
            },
        ],
        [
            '--',
            palette.accentSoft,
            {
                'savings-surface': '#fff2e8',
            },
        ],
        [
            '--',
            palette.selection,
            {
                'navigation-surface': '#f4f2ed',
            },
        ],
        [
            '--',
            palette.onSelection,
            {
                'navigation-foreground': '#735b36',
            },
        ],
        [
            '--',
            palette.selectionHover,
            {
                'navigation-hover': '#eae5dc',
            },
        ],
        [
            '--skin-account-',
            palette.accent,
            {
                surface: '#f5eee3',
                'avatar-ink': '#735b36',
                'action-ink': '#ffffff',
            },
        ],
        [
            '--skin-account-',
            palette.onAccent,
            {
                'ink secondary-hover-ink': '#25292d',
                muted: '#696052',
                'emphasis focus': '#735b36',
                'action-surface': '#292d32',
                'action-hover': '#161a1e',
                'action-pressed': '#0f1215',
                'secondary-border': '#7c8288',
            },
        ],
        [
            '--skin-account-',
            'color-mix(in srgb, var(--accent-foreground) 24%, transparent)',
            {
                divider: '#d8cbbb',
            },
        ],
        [
            '--skin-account-',
            palette.accentHover,
            {
                hover: '#eee3d3',
                'action-hover-ink': '#ffffff',
            },
        ],
        [
            '--skin-referral-',
            palette.accent,
            {
                surface: '#eef3ee',
            },
        ],
        [
            '--skin-referral-',
            palette.onAccent,
            {
                ink: '#314c3b',
                muted: '#58655c',
                'secondary-border': '#7c8288',
                focus: '#735b36',
            },
        ],
        [
            '--skin-referral-',
            palette.accentHover,
            {
                hover: '#dfe9df',
                pressed: '#d6e2d6',
            },
        ],
        [
            '--skin-referral-',
            palette.surface,
            {
                'link-surface': '#eef3ee',
            },
        ],
        [
            '--skin-referral-',
            palette.text,
            {
                'link-ink': '#314c3b',
            },
        ],
        [
            '--skin-coupon-',
            'initial',
            {
                tint: '#fff2e8',
                'action-surface': '#fbede5',
                'action-hover': '#f4dcd0',
                'action-pressed': '#efd6c8',
                'action-ink': '#9b432c',
                opacity: '1',
                'inactive-surface': '#f0f1f2',
                'inactive-ink': '#626b75',
                'pending-surface': '#fff5df',
                'pending-ink': '#92400e',
                focus: '#735b36',
            },
        ],
        [
            '--coupon-',
            '#e99084',
            {
                'rose-ink': '#9b432c',
            },
        ],
        [
            '--coupon-',
            '#d8bc80',
            {
                'gold-ink': '#9b432c',
            },
        ],
        [
            '--coupon-',
            '#91bfc9',
            {
                'blue-ink': '#9b432c',
            },
        ],
        [
            '--coupon-',
            '#88c8b1',
            {
                'emerald-ink': '#9b432c',
            },
        ],
    ];
    for (const [prefix, fallback, colors] of moduleColors) {
        assignColorVariables(variables, prefix, colors, fallback, !classic);
    }
    // Transparent icons sit directly on the shared surfaces, including hover states.
    // Derive their contrast from the resolved palette rather than a former icon tile.
    const iconSurfaces = [
        palette.page,
        palette.surface,
        palette.elevated,
        palette.subtle,
        palette.accentSoft,
        palette.interactionHover,
        palette.interactionPressed,
    ];
    const direction = storefrontRelativeLuminance(palette.text) < 0.5 ? 'dark' : 'light';
    for (const [tone, [foreground, background]] of Object.entries(TOOL_ICON_TONES[presetId])) {
        const prefix = `--skin-tool-${tone}-`;
        variables[`${prefix}foreground`] = makeAccessibleAgainstAll(foreground, iconSurfaces, 3, direction);
        variables[`${prefix}background`] = background;
    }
    return variables;
}

export function resolveStorefrontSemanticPalette(
    presetId: StorefrontVisualPresetId,
    _brand: StorefrontBrandPaletteInput = {},
): StorefrontSemanticPalette {
    return presetId === 'classic' ? resolveClassicPalette() : { ...FIXED_PALETTES[presetId] };
}

export function semanticPaletteCssVariables(palette: StorefrontSemanticPalette): Record<string, string> {
    const variables: Record<string, string> = {};
    assignColorVariables(variables, '--', {
        'store-background auth-store-background brand-background bg': palette.page,
        'store-primary brand-primary': palette.brand,
        'store-highlight brand-highlight accent-hover': palette.accentHover,
        'store-foreground auth-store-foreground text': palette.text,
        'brand-accent accent': palette.accent,
        'paper surface': palette.surface,
        'surface-elevated': palette.elevated,
        soft: palette.subtle,
        muted: palette.muted,
        'accent-soft': palette.accentSoft,
        'accent-foreground': palette.onAccent,
        'accent-ink': palette.accentInk,
        selection: palette.selection,
        'selection-hover': palette.selectionHover,
        'selection-foreground': palette.onSelection,
        'interaction-hover': palette.interactionHover,
        'interaction-pressed': palette.interactionPressed,
        'interaction-ink': palette.interactionInk,
        'line-strong': palette.borderStrong,
        focus: palette.focus,
        success: palette.success,
        warning: palette.warning,
        danger: palette.danger,
        // Derived selection and neutral field edges retain their existing calculations.
        'selection-soft': palette.selectionSoft ?? mixColors(palette.surface, palette.interactionHover, 0.5),
        line: mixColors(palette.surface, palette.text, 0.14),
    });
    return variables;
}

export function auditStorefrontSemanticPalette(palette: StorefrontSemanticPalette): StorefrontPaletteAudit {
    const definitions: Array<[StorefrontPaletteAudit['checks'][number]['name'], string, string, number]> = [
        ['body', palette.text, palette.surface, 4.5],
        ['page-body', palette.text, palette.page, 4.5],
        ['elevated-body', palette.text, palette.elevated, 4.5],
        ['subtle-body', palette.text, palette.subtle, 4.5],
        ['muted', palette.muted, palette.surface, 4.5],
        ['page-muted', palette.muted, palette.page, 4.5],
        ['subtle-muted', palette.muted, palette.subtle, 4.5],
        ['accent-soft-muted', palette.muted, palette.accentSoft, 4.5],
        ['button', palette.onAccent, palette.accent, 4.5],
        ['button-hover', palette.onAccent, palette.accentHover, 4.5],
        ['selection', palette.onSelection, palette.selection, 4.5],
        ['selection-hover', palette.onSelection, palette.selectionHover, 4.5],
        ['selection-surface', palette.selection, palette.surface, 3],
        ['selection-page', palette.selection, palette.page, 3],
        ['interaction-hover', palette.interactionInk, palette.interactionHover, 4.5],
        ['interaction-pressed', palette.interactionInk, palette.interactionPressed, 4.5],
        ['emphasis', palette.accentInk, palette.accentSoft, 4.5],
        ['page-emphasis', palette.accentInk, palette.page, 4.5],
        ['border', palette.border, palette.surface, 3],
        ['page-border', palette.border, palette.page, 3],
        ['focus', palette.focus, palette.surface, 3],
        ['page-focus', palette.focus, palette.page, 3],
        ['success', palette.success, palette.surface, 4.5],
        ['warning', palette.warning, palette.surface, 4.5],
        ['danger', palette.danger, palette.surface, 4.5],
    ];
    const checks = definitions.map(([name, foreground, background, minimum]) => {
        const ratio = storefrontContrastRatio(foreground, background);
        return { name, ratio, minimum, passes: ratio >= minimum };
    });
    return { passes: checks.every(check => check.passes), checks };
}
