import type { RouteName } from './storefront-router';

export type DesktopPageFamily =
    'discovery' | 'product' | 'commerce' | 'account' | 'auth' | 'tools' | 'content';

const discoveryFamily = 'discovery';
const productFamily = 'product';
const commerceFamily = 'commerce';
const accountFamily = 'account';
const authFamily = 'auth';
const toolsFamily = 'tools';
const contentFamily = 'content';

export const desktopPageFamilyByRoute = {
    home: discoveryFamily,
    category: discoveryFamily,
    search: discoveryFamily,
    'flash-sale': discoveryFamily,
    recommendations: discoveryFamily,
    product: productFamily,
    guide: contentFamily,
    blog: contentFamily,
    'blog-article': contentFamily,
    cart: commerceFamily,
    purchase: commerceFamily,
    checkout: commerceFamily,
    payment: commerceFamily,
    'order-confirmation': commerceFamily,
    account: accountFamily,
    orders: accountFamily,
    logistics: accountFamily,
    'order-detail': accountFamily,
    addresses: accountFamily,
    'account-security': accountFamily,
    favorites: accountFamily,
    history: accountFamily,
    notifications: accountFamily,
    coupons: accountFamily,
    referral: accountFamily,
    reviews: accountFamily,
    login: authFamily,
    register: authFamily,
    'verify-account': authFamily,
    'forgot-password': authFamily,
    'reset-password': authFamily,
    services: toolsFamily,
    'image-studio': toolsFamily,
    'two-factor': toolsFamily,
    'environment-monitor': toolsFamily,
    'mail-query': toolsFamily,
    'gpt-recharge': toolsFamily,
    announcements: contentFamily,
    support: contentFamily,
    legal: contentFamily,
    'not-found': contentFamily,
} as const satisfies Record<RouteName, DesktopPageFamily>;

export function desktopPageFamily(route: RouteName): DesktopPageFamily {
    return desktopPageFamilyByRoute[route];
}
