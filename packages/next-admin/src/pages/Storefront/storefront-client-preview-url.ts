import type { StorefrontVisualPresetId } from '../../../../storefront-content-plugin/src/visual-presets';
import type { StorefrontPreviewDomainsResult } from '../../graphql/storefront.graphql';

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

/** Only an ACTIVE domain owned by the selected Channel may receive preview reads. */
export function storefrontPreviewShopApiUrl(
    domains: StorefrontPreviewDomainsResult['storeDomains'] | undefined,
    channelId: string | undefined,
): string | null {
    const active = domains?.filter(domain => domain.status === 'ACTIVE' && domain.channel.id === channelId);
    const domain = active?.find(domain => domain.isPrimary) ?? active?.[0];
    if (!domain || !/^[a-z0-9.-]+$/i.test(domain.domain)) return null;
    try {
        const endpoint = new URL(`https://${domain.domain}/shop-api`);
        if (endpoint.hostname !== domain.domain.toLowerCase()) return null;
        return endpoint.href;
    } catch {
        return null;
    }
}
