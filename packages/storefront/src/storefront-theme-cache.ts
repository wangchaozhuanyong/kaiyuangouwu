import {
    isStorefrontVisualPresetId,
    type StorefrontVisualPresetId,
} from '../../storefront-content-plugin/src/visual-presets';

// Keep the versioned key in sync with the parser-blocking restore-theme.js.
const THEME_CACHE_KEY = '__storefront_theme_v1__';

export function restoredStorefrontTheme(): {
    presetId: StorefrontVisualPresetId;
    channelCode: string;
} | null {
    const root = document.documentElement;
    const presetId = root.dataset.storefrontPreset;
    const channelCode = root.dataset.storefrontThemeChannel;
    return channelCode && isStorefrontVisualPresetId(presetId) ? { presetId, channelCode } : null;
}

export function cacheStorefrontTheme(
    channelCode: string,
    presetId: StorefrontVisualPresetId,
    colors: Record<string, string>,
) {
    const payload = JSON.stringify({
        version: 1,
        origin: window.location.origin,
        savedAt: Date.now(),
        channelCode,
        presetId,
        colors: Object.fromEntries(
            Object.entries(colors).filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value)),
        ),
    });
    for (const storageName of ['sessionStorage', 'localStorage'] as const) {
        try {
            window[storageName].setItem(THEME_CACHE_KEY, payload);
        } catch {
            // A blocked or full storage must not prevent rendering or the other cache.
        }
    }
}
