import type { RouteName } from './storefront-router';

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
