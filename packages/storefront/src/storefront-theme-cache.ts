import {
    isStorefrontVisualPresetId,
    type StorefrontVisualPresetId,
} from '../../storefront-content-plugin/src/visual-presets';

// v3 owns the graphite/champagne classic palette; v2 still contains classic blue.
// Keep the versioned key in sync with the parser-blocking restore-theme.js.
const THEME_CACHE_KEY = '__storefront_theme_v3__';
const RESTORED_COLOR_PROPERTY = new RegExp(
    '^--(?:store-(?:background|primary|highlight|foreground)|auth-store-(?:background|foreground)' +
        '|brand-(?:background|primary|accent|highlight)|bg|paper|surface(?:-elevated)?|soft|text|muted' +
        '|accent(?:-hover|-pressed|-soft|-foreground|-ink)?|selection(?:-hover|-foreground|-soft)?' +
        '|interaction-(?:hover|pressed|ink)|line(?:-strong)?|focus|success|warning|danger)$',
);

export function restoredStorefrontTheme(): {
    presetId: StorefrontVisualPresetId;
    channelCode: string;
} | null {
    const root = document.documentElement;
    const presetId = root.dataset.storefrontPreset;
    const channelCode = root.dataset.storefrontThemeChannel;
    return channelCode && isStorefrontVisualPresetId(presetId) ? { presetId, channelCode } : null;
}

/** Remove only parser-restored presentation owned by this Channel, without touching stored data. */
export function discardRestoredStorefrontTheme(channelCode: string): void {
    const root = document.documentElement;
    if (root.dataset.storefrontThemeChannel !== channelCode) return;
    for (const property of Array.from(root.style)) {
        if (RESTORED_COLOR_PROPERTY.test(property)) root.style.removeProperty(property);
    }
    root.style.removeProperty('color-scheme');
    delete root.dataset.storefrontPreset;
    delete root.dataset.storefrontThemeChannel;
    document.querySelector('meta[name="theme-color"]')?.removeAttribute('content');
    document.querySelector('meta[name="color-scheme"]')?.removeAttribute('content');
}

export function cacheStorefrontTheme(
    channelCode: string,
    presetId: StorefrontVisualPresetId,
    colors: Record<string, string>,
) {
    const payload = JSON.stringify({
        version: 3,
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
