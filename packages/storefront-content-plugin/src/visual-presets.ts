/** Shared, versioned visual presets. Store selection lives in Vendure, never in a domain map. */
export const STOREFRONT_VISUAL_PRESET_CODE = 'storefront-visual-preset';

export const storefrontVisualPresets = [
    {
        id: 'classic',
        name: '现有皮肤',
        description: '保留现有配色、字体与组件效果。',
        colors: ['#f1f5f9', '#ffffff', '#d33c30', '#0f172a'],
    },
    {
        id: 'modern-oriental',
        name: '现代东方',
        description: '米白底色、墨蓝文字、朱砂按钮，搭配宋体标题与轻阴影。',
        colors: ['#f6f2ea', '#fffdf8', '#a63d32', '#203346'],
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
    return value === 'classic' || value === 'modern-oriental';
}

export function normalizeStorefrontVisualPreset(value: unknown): StorefrontVisualPresetId {
    return isStorefrontVisualPresetId(value) ? value : 'classic';
}

export type StorefrontDesktopLayout = 'classic' | 'catalog';
export const storefrontDesktopLayouts = [
    { id: 'classic', name: '现有布局', description: '保留当前电脑端呈现。' },
    { id: 'catalog', name: '目录布局', description: '统一商品目录与账户导航，首页楼层仍按保存顺序展示。' },
] as const;
export function isStorefrontDesktopLayout(value: unknown): value is StorefrontDesktopLayout {
    return value === 'classic' || value === 'catalog';
}
export function normalizeStorefrontDesktopLayout(value: unknown): StorefrontDesktopLayout {
    return isStorefrontDesktopLayout(value) ? value : 'classic';
}
