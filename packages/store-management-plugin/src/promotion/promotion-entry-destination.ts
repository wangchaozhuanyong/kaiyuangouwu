const STATIC_PROMOTION_ENTRY_DESTINATIONS = new Set(['home', 'privacy', 'terms', 'support']);

export function normalizePromotionEntryDestination(value: unknown): string {
    if (typeof value !== 'string') return 'home';
    const normalized = value.trim();
    if (STATIC_PROMOTION_ENTRY_DESTINATIONS.has(normalized)) return normalized;
    const product = /^product:([a-zA-Z0-9_-]{1,64})$/u.exec(normalized);
    return product ? `product:${product[1]}` : 'home';
}

export function promotionEntryRedirect(destination: unknown): string {
    const normalized = normalizePromotionEntryDestination(destination);
    if (normalized === 'privacy') return '/legal?id=privacy';
    if (normalized === 'terms') return '/legal?id=terms';
    if (normalized === 'support') return '/support';
    if (normalized.startsWith('product:')) {
        return `/product?id=${encodeURIComponent(normalized.slice('product:'.length))}`;
    }
    return '/';
}
