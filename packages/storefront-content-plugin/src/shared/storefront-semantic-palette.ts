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

const SKIN_TREATMENTS: Record<StorefrontVisualPresetId, StorefrontSkinTreatment> = {
    classic: {
        divider: '#dfe3e8',
        cardOutline: '1px solid #dfe3e8',
        cardOutlineHover: '#cbd1d8',
        displayFont:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        cardRadius: '16px',
        heroRadius: '20px',
        controlRadius: '10px',
        mediaRadius: '12px',
        cardShadow: '0 2px 8px rgba(37, 41, 45, 0.04)',
        cardHoverShadow: '0 4px 12px rgba(37, 41, 45, 0.07)',
        heroShadow: '0 6px 24px rgba(37, 41, 45, 0.06)',
        headerShadow: '0 2px 10px rgba(37, 41, 45, 0.04)',
    },

    'neo-minimalist': {
        divider: '#2a3548',
        cardOutline: 'initial',
        cardOutlineHover: 'initial',
        displayFont:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        cardRadius: '16px',
        heroRadius: '20px',
        controlRadius: '10px',
        mediaRadius: '12px',
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
    Record<StorefrontToolTone, { foreground: string; background: string }>
> = {
    classic: {
        security: { foreground: '#1d4ed8', background: '#dbeafe' },
        mail: { foreground: '#0f766e', background: '#ccfbf1' },
        studio: { foreground: '#6d28d9', background: '#ede9fe' },
        coupon: { foreground: '#92400e', background: '#fef3c7' },
        support: { foreground: '#b42318', background: '#fee4e2' },
    },

    'neo-minimalist': {
        security: { foreground: '#93c5fd', background: '#19304f' },
        mail: { foreground: '#5eead4', background: '#113b3a' },
        studio: { foreground: '#c4b5fd', background: '#2b2052' },
        coupon: { foreground: '#fcd34d', background: '#463414' },
        support: { foreground: '#fda4af', background: '#4c2432' },
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
        const surface = mixColors(palette.surface, hue, dark ? 0.25 : 0.14);
        const action = mixColors(palette.surface, hue, dark ? 0.43 : 0.31);
        const hover = mixColors(palette.surface, hue, dark ? 0.51 : 0.39);
        variables[`--skin-service-${tone}-surface`] = surface;
        variables[`--skin-service-${tone}-action`] = action;
        variables[`--skin-service-${tone}-action-hover`] = hover;
        variables[`--skin-service-${tone}-ink`] = serviceCardInk(hue, [surface, action, hover], target);
        variables[`--skin-service-${tone}-description`] = serviceCardInk(palette.muted, [surface], target);
    }
    return variables;
}

export function resolveStorefrontSkinTreatment(presetId: StorefrontVisualPresetId): StorefrontSkinTreatment {
    return { ...SKIN_TREATMENTS[presetId] };
}

export function storefrontSkinCssVariables(
    presetId: StorefrontVisualPresetId,
    palette: StorefrontSemanticPalette = resolveStorefrontSemanticPalette(presetId),
): Record<string, string> {
    const treatment = resolveStorefrontSkinTreatment(presetId);
    const classic = presetId === 'classic';
    const variables: Record<string, string> = {
        ...storefrontServiceCardCssVariables(palette),
        '--skin-divider': treatment.divider,
        '--skin-card-outline': treatment.cardOutline,
        '--skin-card-outline-hover': treatment.cardOutlineHover,
        // Opt-in elevation for surfaces with an existing custom (or absent) shadow.
        '--skin-card-outline-shadow': treatment.cardOutline === 'initial' ? 'initial' : treatment.cardShadow,
        '--skin-display-font': treatment.displayFont,
        '--skin-card-radius': treatment.cardRadius,
        '--skin-hero-radius': treatment.heroRadius,
        '--skin-control-radius': treatment.controlRadius,
        '--skin-media-radius': treatment.mediaRadius,
        '--skin-card-shadow': treatment.cardShadow,
        '--skin-card-hover-shadow': treatment.cardHoverShadow,
        '--skin-hero-shadow': treatment.heroShadow,
        '--skin-header-shadow': treatment.headerShadow,
        // Module colors belong to the shared skin, never a merchant or route override.
        // Explicit dark values retain existing rendering; initial preserves owner-specific fallbacks.
        '--accent-pressed': classic ? '#0f1215' : 'initial',
        '--skin-primary-hover': classic ? '#161a1e' : 'initial',
        '--control-border': classic ? '#7c8288' : 'initial',
        '--accent-disabled-bg': classic ? '#f0f1f2' : palette.subtle,
        '--accent-disabled-text': palette.muted,
        '--price-ink': classic ? '#25292d' : palette.accentInk,
        '--savings-ink': classic ? '#9b432c' : 'initial',
        '--savings-surface': classic ? '#fff2e8' : palette.accentSoft,
        '--navigation-surface': classic ? '#f4f2ed' : palette.selection,
        '--navigation-foreground': classic ? '#735b36' : palette.onSelection,
        '--navigation-hover': classic ? '#eae5dc' : palette.selectionHover,
        '--skin-account-surface': classic ? '#f5eee3' : palette.accent,
        '--skin-account-ink': classic ? '#25292d' : palette.onAccent,
        '--skin-account-muted': classic ? '#696052' : palette.onAccent,
        '--skin-account-emphasis': classic ? '#735b36' : palette.onAccent,
        '--skin-account-divider': classic
            ? '#d8cbbb'
            : 'color-mix(in srgb, var(--accent-foreground) 24%, transparent)',
        '--skin-account-hover': classic ? '#eee3d3' : palette.accentHover,
        '--skin-account-focus': classic ? '#735b36' : palette.onAccent,
        '--skin-account-avatar-ink': classic ? '#735b36' : palette.accent,
        '--skin-account-action-surface': classic ? '#292d32' : palette.onAccent,
        '--skin-account-action-ink': classic ? '#ffffff' : palette.accent,
        '--skin-account-action-hover': classic ? '#161a1e' : palette.onAccent,
        '--skin-account-action-pressed': classic ? '#0f1215' : palette.onAccent,
        '--skin-account-action-hover-ink': classic ? '#ffffff' : palette.accentHover,
        '--skin-account-secondary-border': classic ? '#7c8288' : palette.onAccent,
        '--skin-account-secondary-hover-ink': classic ? '#25292d' : palette.onAccent,
        '--skin-referral-surface': classic ? '#eef3ee' : palette.accent,
        '--skin-referral-ink': classic ? '#314c3b' : palette.onAccent,
        '--skin-referral-muted': classic ? '#58655c' : palette.onAccent,
        '--skin-referral-hover': classic ? '#dfe9df' : palette.accentHover,
        '--skin-referral-pressed': classic ? '#d6e2d6' : palette.accentHover,
        '--skin-referral-secondary-border': classic ? '#7c8288' : palette.onAccent,
        '--skin-referral-focus': classic ? '#735b36' : palette.onAccent,
        '--skin-referral-link-surface': classic ? '#eef3ee' : palette.surface,
        '--skin-referral-link-ink': classic ? '#314c3b' : palette.text,
        '--skin-coupon-tint': classic ? '#fff2e8' : 'initial',
        '--skin-coupon-action-surface': classic ? '#fbede5' : 'initial',
        '--skin-coupon-action-hover': classic ? '#f4dcd0' : 'initial',
        '--skin-coupon-action-pressed': classic ? '#efd6c8' : 'initial',
        '--skin-coupon-action-ink': classic ? '#9b432c' : 'initial',
        '--skin-coupon-opacity': classic ? '1' : 'initial',
        '--skin-coupon-inactive-surface': classic ? '#f0f1f2' : 'initial',
        '--skin-coupon-inactive-ink': classic ? '#626b75' : 'initial',
        '--skin-coupon-pending-surface': classic ? '#fff5df' : 'initial',
        '--skin-coupon-pending-ink': classic ? '#92400e' : 'initial',
        '--skin-coupon-focus': classic ? '#735b36' : 'initial',
        '--coupon-rose-ink': classic ? '#9b432c' : '#e99084',
        '--coupon-gold-ink': classic ? '#9b432c' : '#d8bc80',
        '--coupon-blue-ink': classic ? '#9b432c' : '#91bfc9',
        '--coupon-emerald-ink': classic ? '#9b432c' : '#88c8b1',
    };
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
    for (const [tone, colors] of Object.entries(TOOL_ICON_TONES[presetId])) {
        variables[`--skin-tool-${tone}-foreground`] = makeAccessibleAgainstAll(
            colors.foreground,
            iconSurfaces,
            3,
            direction,
        );
        variables[`--skin-tool-${tone}-background`] = colors.background;
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
        '--selection': palette.selection,
        '--selection-hover': palette.selectionHover,
        '--selection-foreground': palette.onSelection,
        '--selection-soft':
            palette.selectionSoft ?? mixColors(palette.surface, palette.interactionHover, 0.5),
        '--interaction-hover': palette.interactionHover,
        '--interaction-pressed': palette.interactionPressed,
        '--interaction-ink': palette.interactionInk,
        // Resting field edges are quiet. Strong boundaries and focus remain separate roles.
        '--line': mixColors(palette.surface, palette.text, 0.14),
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
