import type { RouteName } from './storefront-router';

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
    return accountRoutes.has(route);
}
