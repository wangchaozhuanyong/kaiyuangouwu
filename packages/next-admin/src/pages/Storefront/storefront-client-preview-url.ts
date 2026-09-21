import type { StorefrontVisualPresetId } from '../../../../storefront-content-plugin/src/visual-presets';

export function storefrontClientPreviewUrl(
    storefrontUrl: string | null | undefined,
    presetId: StorefrontVisualPresetId,
    viewport: 390 | 1440,
    embedded = false,
): string | null {
    if (!storefrontUrl?.trim()) return null;
    try {
        const base = new URL(storefrontUrl);
        if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
        const preview = new URL(embedded ? '/' : '/__storefront-preview', base);
        if (embedded) {
            preview.searchParams.set('storefrontPreviewEmbedded', '1');
            preview.searchParams.set('storefrontPreviewPreset', presetId);
            preview.searchParams.set('storefrontPreviewAuth', 'guest');
            preview.searchParams.set('storefrontPreviewLanguage', 'zh');
        } else {
            preview.searchParams.set('preset', presetId);
            preview.searchParams.set('viewport', String(viewport));
        }
        return preview.href;
    } catch {
        return null;
    }
}
