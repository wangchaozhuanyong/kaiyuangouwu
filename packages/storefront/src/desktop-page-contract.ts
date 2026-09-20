import type { RouteName } from './storefront-router';

export type DesktopPageFamily =
    'discovery' | 'product' | 'commerce' | 'account' | 'auth' | 'tools' | 'content';

export const desktopPageFamilyByRoute = {
    home: 'discovery',
    category: 'discovery',
    search: 'discovery',
    'flash-sale': 'discovery',
    recommendations: 'discovery',
    product: 'product',
    cart: 'commerce',
    purchase: 'commerce',
    checkout: 'commerce',
    payment: 'commerce',
    'order-confirmation': 'commerce',
    account: 'account',
    orders: 'account',
    logistics: 'account',
    'order-detail': 'account',
    addresses: 'account',
    'account-security': 'account',
    favorites: 'account',
    history: 'account',
    notifications: 'account',
    coupons: 'account',
    referral: 'account',
    reviews: 'account',
    login: 'auth',
    register: 'auth',
    'verify-account': 'auth',
    'forgot-password': 'auth',
    'reset-password': 'auth',
    services: 'tools',
    'image-studio': 'tools',
    'two-factor': 'tools',
    'mail-query': 'tools',
    announcements: 'content',
    support: 'content',
    legal: 'content',
    'not-found': 'content',
} as const satisfies Record<RouteName, DesktopPageFamily>;

export function desktopPageFamily(route: RouteName): DesktopPageFamily {
    return desktopPageFamilyByRoute[route];
}
