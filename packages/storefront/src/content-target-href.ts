import type { MouseEvent } from 'react';

import { routeFromHash, routeFromRouterLocation, routeHref } from './storefront-router';
import { type StorefrontContentTargetType, type StorefrontLanguage } from './types';

/** Same-origin storefront destinations share the Router; files and isolated tools stay native. */
export function internalContentRoute(value: string, origin?: string) {
    if (value.startsWith('#/')) return routeFromHash(value);
    if (value.startsWith('#')) return;
    try {
        const base =
            origin ?? (typeof window === 'undefined' ? 'https://storefront.invalid' : window.location.origin);
        const url = new URL(value, base + '/');
        if (url.origin !== base) return;
        const route = routeFromRouterLocation(url.pathname, Object.fromEntries(url.searchParams));
        if (route.name === 'not-found' || route.name === 'two-factor') return;
        return route;
    } catch {
        return;
    }
}

/** Real destinations for existing managed links, using the same public language contract. */
export function contentTargetHref(
    type: StorefrontContentTargetType,
    raw: string | null,
    language: StorefrontLanguage,
): string | undefined {
    const value = raw?.trim();
    if (!value || type === 'NONE') return;
    if (type === 'PRODUCT') return routeHref({ name: 'product', id: value, publicLanguage: language });
    if (type === 'CATEGORY' || type === 'COLLECTION')
        return routeHref({ name: 'category', collectionId: value, publicLanguage: language });
    if (type === 'SEARCH') return routeHref({ name: 'search', term: value, publicLanguage: language });
    // Keep absolute hrefs identical in server HTML and the first client render.
    // The click handler determines same-origin ownership once the browser origin is known.
    if (/^(?:https?:)?\/\//iu.test(value)) return value;
    const internal = internalContentRoute(value);
    if ((type === 'PAGE' || type === 'URL' || type === 'SUPPORT') && internal)
        return routeHref({ ...internal, publicLanguage: internal.publicLanguage ?? language });
    if (type === 'PAGE' || value.startsWith('#/')) {
        const route = routeFromHash(value.startsWith('#') ? value : `#/${value.replace(/^\//u, '')}`);
        if (route.name !== 'not-found') return routeHref({ ...route, publicLanguage: language });
        return;
    }
    if (type === 'SUPPORT' && !/^(?:https?:\/\/|mailto:|tel:)/iu.test(value))
        return routeHref({ name: 'support', publicLanguage: language });
    if (/^(?:mailto:|tel:)/iu.test(value)) return value;
    if (value.startsWith('/') && !value.startsWith('//')) {
        const route = routeFromHash(`#${value}`);
        return route.name === 'not-found' ? value : routeHref({ ...route, publicLanguage: language });
    }
}

export function interceptContentNavigation(event: MouseEvent<HTMLElement>, action: () => void): void {
    const anchor =
        typeof HTMLAnchorElement !== 'undefined' && event.currentTarget instanceof HTMLAnchorElement
            ? event.currentTarget
            : null;
    if (anchor && (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self'))) return;
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    )
        return;
    event.preventDefault();
    action();
}
