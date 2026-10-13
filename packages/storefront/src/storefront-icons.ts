import { storefrontIcon } from '../../storefront-content-plugin/src/shared/storefront-icons';

export function applyStorefrontIcons(logoUrl: string | null) {
    for (const rel of ['icon', 'apple-touch-icon'] as const) {
        const icon = storefrontIcon(logoUrl, rel);
        const links = [...document.querySelectorAll<HTMLLinkElement>(`link[rel=${rel}]`)];
        const link =
            links.find(item => item.dataset.storefrontIcon === 'server') ??
            links[0] ??
            document.createElement('link');
        // Keep the parser's icon node and URL through hydration. Removing it or
        // adding a client-only revision needlessly restarts browser icon loading.
        if (link.rel !== rel) link.rel = rel;
        if (link.type !== icon.type) link.type = icon.type;
        if (link.href !== new URL(icon.href, document.baseURI).href) link.href = icon.href;
        // Initialize a missing declaration before insertion; never leave an
        // empty interval when updating an existing store's branding.
        if (!link.isConnected) document.head.append(link);
        links.forEach(old => {
            if (old !== link) old.remove();
        });
    }
}

export function restoreStorefrontIcons() {
    const links = [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel=icon],link[rel=apple-touch-icon]'),
    ];
    if (links.some(link => link.dataset.storefrontIcon === 'server')) {
        // These icons were resolved for this document's host by the server.
        links.forEach(link => {
            if (link.dataset.storefrontIcon !== 'server') link.remove();
        });
        return;
    }
    // A legacy session-wide logo has no channel ownership. Keep the document
    // neutral until the scoped configuration can supply its own brand.
    applyStorefrontIcons(null);
}
