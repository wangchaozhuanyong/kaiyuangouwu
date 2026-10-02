import {
    storefrontIcon,
    type StorefrontIconRel,
} from '../../storefront-content-plugin/src/shared/storefront-icons';

export function applyStorefrontIcons(logoUrl: string | null) {
    for (const rel of ['icon', 'apple-touch-icon'] as const) {
        const icon = storefrontIcon(logoUrl, rel);
        let links = Array.from(document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`));
        if (!links.length) {
            const link = document.createElement('link');
            link.rel = rel;
            document.head.append(link);
            links = [link];
        }
        for (const link of links) {
            link.href = icon.href;
            link.type = icon.type;
        }
    }
}

export function restoreStorefrontIcons() {
    const serverIcons = document.querySelectorAll<HTMLLinkElement>('link[data-storefront-icon="server"]');
    if (serverIcons.length) {
        // The request's Channel profile is newer than either session cache.
        for (const rel of ['icon', 'apple-touch-icon'] as StorefrontIconRel[]) {
            for (const link of document.querySelectorAll(
                `link[rel="${rel}"]:not([data-storefront-icon="server"])`,
            )) {
                link.remove();
            }
        }
        return;
    }
    try {
        const cachedLogoUrl = sessionStorage.getItem('__storefront_logo_url__');
        if (cachedLogoUrl) applyStorefrontIcons(cachedLogoUrl);
    } catch {
        // A disabled cache must not prevent the storefront from starting.
    }
}
