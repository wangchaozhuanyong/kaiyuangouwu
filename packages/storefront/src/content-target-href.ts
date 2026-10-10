import type { MouseEvent } from 'react';

import { routeFromHash, routeHref } from './storefront-router';
import { type StorefrontContentTargetType, type StorefrontLanguage } from './types';

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
    if (type === 'PAGE' || value.startsWith('#/')) {
        const route = routeFromHash(value.startsWith('#') ? value : `#/${value.replace(/^\//u, '')}`);
        if (route.name !== 'not-found') return routeHref({ ...route, publicLanguage: language });
        return;
    }
    if (type === 'SUPPORT' && !/^(?:https?:\/\/|mailto:|tel:)/iu.test(value))
        return routeHref({ name: 'support', publicLanguage: language });
    if (/^(?:https?:\/\/|mailto:|tel:)/iu.test(value)) return value;
    if (value.startsWith('/') && !value.startsWith('//')) {
        const route = routeFromHash(`#${value}`);
        return route.name === 'not-found' ? value : routeHref({ ...route, publicLanguage: language });
    }
}

export function interceptContentNavigation(event: MouseEvent<HTMLElement>, action: () => void): void {
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
