/** The same public Asset URL for publication checks, admin preview and Shop API. */
export function storefrontAssetUrl(asset: { source?: string; preview?: string; mimeType?: string }): string {
    const identifier =
        (asset.mimeType === 'image/svg+xml' ? asset.source : asset.preview || asset.source)?.trim() ?? '';

    if (!identifier) return '';
    try {
        const url = new URL(identifier);
        return url.pathname.includes('/assets/') ? `${url.pathname}${url.search}${url.hash}` : '';
    } catch {
        const path = identifier.replace(/^\/+/, '');
        return path.startsWith('assets/') ? `/${path}` : `/assets/${path}`;
    }
}
