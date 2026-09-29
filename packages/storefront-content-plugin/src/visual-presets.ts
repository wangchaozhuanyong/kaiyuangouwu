/** Shared, versioned visual presets. Store selection lives in Vendure, never in a domain map. */
export const STOREFRONT_VISUAL_PRESET_CODE = 'storefront-visual-preset';

export const storefrontVisualPresets = [
    {
        id: 'classic',
        name: '经典',
        description: '明亮表面与克制阴影，保留店铺品牌色作为可读的强调色。',
        colors: ['#f1f5f9', '#ffffff', '#d33c30', '#0f172a'],
    },

    {
        id: 'neo-minimalist',
        name: '新锐科技极简',
        description: '深空底色、高对比文字与紫色按钮，使用统一布局与轻量化表面。',
        colors: ['#070b14', '#0e121c', '#8b5cf6', '#f1f5f9'],
    },
] as const;

export type StorefrontVisualPresetId = (typeof storefrontVisualPresets)[number]['id'];

export interface StorefrontVisualPresetConfig {
    channelId: string;
    presetId: StorefrontVisualPresetId;
    desktopLayout: StorefrontDesktopLayout;
    revision: string;
}

export function isStorefrontVisualPresetId(value: unknown): value is StorefrontVisualPresetId {
    return value === 'classic' || value === 'neo-minimalist';
}

export function normalizeStorefrontVisualPreset(value: unknown): StorefrontVisualPresetId {
    return isStorefrontVisualPresetId(value) ? value : 'classic';
}

// Legacy API metadata remains readable; the storefront now uses one fixed responsive layout.
export type StorefrontDesktopLayout = 'classic' | 'catalog';
export function isStorefrontDesktopLayout(value: unknown): value is StorefrontDesktopLayout {
    return value === 'classic' || value === 'catalog';
}
export function normalizeStorefrontDesktopLayout(value: unknown): StorefrontDesktopLayout {
    return isStorefrontDesktopLayout(value) ? value : 'classic';
}
