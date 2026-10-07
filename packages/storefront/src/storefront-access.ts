import { storefrontErrorCode } from './storefront-errors';
import { RouteName } from './storefront-router';

/** Legacy FORBIDDEN is a closure signal only for the public configuration boundary. */
export function isStorefrontClosedError(error: unknown, publicConfiguration = false): boolean {
    const code = storefrontErrorCode(error);
    return code === 'STOREFRONT_CLOSED' || (publicConfiguration && code === 'FORBIDDEN');
}

const browsingRoutes = new Set<RouteName>([
    'home',
    'category',
    'product',
    'search',
    'services',
    'flash-sale',
    'recommendations',
    'announcements',
    'not-found',
    'two-factor',
    'mail-query',
]);

const accountRoutes = new Set<RouteName>([
    'login',
    'register',
    'verify-account',
    'forgot-password',
    'reset-password',
    'legal',
    'support',
]);

export function isPublicStorefrontRoute(route: RouteName): boolean {
    return browsingRoutes.has(route) || accountRoutes.has(route);
}

export function isBrowsingStorefrontRoute(route: RouteName): boolean {
    return browsingRoutes.has(route);
}
