/** Small data helpers shared with the eager storefront; visual UI stays deferred. */
export function configuredColor(value: unknown): string | undefined {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : undefined;
}

/** Use the existing non-cropping asset preset; external URLs remain unchanged. */
export function authOriginalImageUrl(value: string): string {
    const source = value.trim();
    if (!source) return '';
    try {
        const url = new URL(source, 'https://storefront.invalid');
        if (!/\/assets\/(?:preview|source)\//.test(url.pathname) || /\.svg$/i.test(url.pathname))
            return source;
        for (const key of ['w', 'h', 'width', 'height', 'mode', 'fit', 'crop']) url.searchParams.delete(key);
        url.searchParams.set('preset', 'storefront-original-preview');
        url.searchParams.set('format', 'webp');
        url.searchParams.set('q', '90');
        return /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')
            ? url.toString()
            : `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return '';
    }
}
