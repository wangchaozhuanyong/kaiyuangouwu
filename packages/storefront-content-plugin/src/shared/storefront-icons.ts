import { normalizeStorefrontAssetUrl } from './responsive-image';

export type StorefrontIconRel = 'icon' | 'apple-touch-icon';

const ICON_VERSION = '2';
const NEUTRAL_ICON = '/storefront/neutral-store.png';

/** Keep document icons independent of the site's WebP display-image variants. */
export function storefrontIcon(source: string | null | undefined, rel: StorefrontIconRel) {
    let normalized = source?.trim() ? normalizeStorefrontAssetUrl(source) : NEUTRAL_ICON;
    if (!/^(?:https?:\/\/|\/(?!\/))/iu.test(normalized)) normalized = NEUTRAL_ICON;
    let url: URL;
    try {
        url = new URL(normalized, 'https://storefront.invalid');
    } catch {
        normalized = NEUTRAL_ICON;
        url = new URL(normalized, 'https://storefront.invalid');
    }
    const isAsset = /^\/assets\/(?:preview|source)\//u.test(url.pathname);
    if (isAsset) {
        url.searchParams.set(
            'preset',
            rel === 'icon' ? 'storefront-icon-96' : 'storefront-thumbnail-fit-320',
        );
        url.searchParams.set('format', 'png');
        url.searchParams.set('q', '82');
        if (/__webp_migrated_\d+\.webp$/iu.test(url.pathname)) {
            url.searchParams.set('v', 'webp-readable-1');
        }
    }
    url.searchParams.set('storefront-icon', ICON_VERSION);
    return {
        href: /^https?:\/\//iu.test(normalized) ? url.href : `${url.pathname}${url.search}${url.hash}`,
        type: isAsset || /\.png$/iu.test(url.pathname) ? 'image/png' : '',
    };
}
