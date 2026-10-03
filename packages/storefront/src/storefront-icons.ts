import { storefrontIcon } from '../../storefront-content-plugin/src/shared/storefront-icons';

export function applyStorefrontIcons(logoUrl: string | null) {
    for (const rel of ['icon', 'apple-touch-icon'] as const) {
        const icon = storefrontIcon(logoUrl, rel);
        // Invalidate Safari's retained page icon once, without clearing a user's
        // browser cache. Keep the same host-resolved image and bounded PNG size.
        const href = icon.href.replace(/#|$/u, '&iv=3$&');
        const links = [...document.querySelectorAll<HTMLLinkElement>(`link[rel=${rel}]`)];
        const link = (links.find(item => item.dataset.storefrontIcon === 'server')?.cloneNode() ??
            document.createElement('link')) as HTMLLinkElement;
        link.rel = rel;
        link.href = href;
        link.type = icon.type;
        // Set the complete URL before insertion: an empty icon declaration can
        // make Safari request and retain the shared static fallback instead.
        links.forEach(old => old.remove());
        document.head.append(link);
    }
}

export function restoreStorefrontIcons() {
    const links = [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel=icon],link[rel=apple-touch-icon]'),
    ];
    if (links.some(link => link.dataset.storefrontIcon === 'server')) {
        // The request's Channel profile is newer than either session cache.
        links.forEach(link => {
            if (link.dataset.storefrontIcon !== 'server') link.remove();
        });
        return;
    }
    try {
        const cachedLogoUrl = sessionStorage.getItem('__storefront_logo_url__');
        if (cachedLogoUrl) applyStorefrontIcons(cachedLogoUrl);
    } catch {
        // A disabled cache must not prevent the storefront from starting.
    }
}
