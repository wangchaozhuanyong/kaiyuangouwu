import { RouteName } from './storefront-router';

type RoutePreloader = () => Promise<void>;

function preload<T extends string>(module: Promise<Record<T, RoutePreloader>>, name: T): Promise<void> {
    return module.then(value => value[name]());
}

const routePreloaders = {
    home: () => preload(import('./route-pages/catalog-route-pages'), 'preloadHomeRoutePage'),
    category: () => preload(import('./route-pages/category-route-page'), 'preloadCategoryRoutePage'),
    product: () => preload(import('./route-pages/catalog-route-pages'), 'preloadProductRoutePage'),
    search: () => preload(import('./route-pages/catalog-route-pages'), 'preloadSearchRoutePage'),
    cart: () => preload(import('./route-pages/cart-route-page'), 'preloadCartRoutePage'),
    account: () => preload(import('./route-pages/account-route-pages'), 'preloadAccountRoutePage'),
    favorites: () => preload(import('./route-pages/account-route-pages'), 'preloadFavoritesRoutePage'),
    history: () => preload(import('./route-pages/account-route-pages'), 'preloadHistoryRoutePage'),
    notifications: () =>
        preload(import('./route-pages/account-route-pages'), 'preloadNotificationsRoutePage'),
    coupons: () => preload(import('./route-pages/account-route-pages'), 'preloadCouponsRoutePage'),
    referral: () => preload(import('./route-pages/account-route-pages'), 'preloadReferralRoutePage'),
    login: () => preload(import('./route-pages/auth-route-pages'), 'preloadLoginRoutePage'),
    register: () => preload(import('./route-pages/auth-route-pages'), 'preloadRegisterRoutePage'),
    'verify-account': () =>
        preload(import('./route-pages/auth-route-pages'), 'preloadVerifyAccountRoutePage'),
    'forgot-password': () =>
        preload(import('./route-pages/auth-route-pages'), 'preloadForgotPasswordRoutePage'),
    'reset-password': () =>
        preload(import('./route-pages/auth-route-pages'), 'preloadResetPasswordRoutePage'),
    purchase: () => preload(import('./route-pages/checkout-route-pages'), 'preloadPurchaseRoutePage'),
    checkout: () => preload(import('./route-pages/checkout-route-pages'), 'preloadCheckoutRoutePage'),
    payment: () => preload(import('./route-pages/checkout-route-pages'), 'preloadPaymentRoutePage'),
    'order-confirmation': () =>
        preload(import('./route-pages/checkout-route-pages'), 'preloadOrderConfirmationRoutePage'),
    orders: () => preload(import('./route-pages/order-route-pages'), 'preloadOrdersRoutePage'),
    logistics: () => preload(import('./route-pages/order-route-pages'), 'preloadLogisticsRoutePage'),
    'order-detail': () => preload(import('./route-pages/order-route-pages'), 'preloadOrderDetailRoutePage'),
    addresses: () => preload(import('./route-pages/order-route-pages'), 'preloadAddressesRoutePage'),
    'account-security': () =>
        preload(import('./route-pages/order-route-pages'), 'preloadAccountSecurityRoutePage'),
    services: () => preload(import('./route-pages/content-route-pages'), 'preloadServicesRoutePage'),
    'image-studio': () => preload(import('./route-pages/content-route-pages'), 'preloadImageStudioRoutePage'),
    'two-factor': () => preload(import('./route-pages/content-route-pages'), 'preloadTwoFactorRoutePage'),
    'mail-query': () => preload(import('./route-pages/content-route-pages'), 'preloadMailQueryRoutePage'),
    reviews: () => preload(import('./route-pages/content-route-pages'), 'preloadReviewsRoutePage'),
    support: () => preload(import('./route-pages/content-route-pages'), 'preloadSupportRoutePage'),
    legal: () => preload(import('./route-pages/legal-route-page'), 'preloadLegalRoutePage'),
} satisfies Partial<Record<RouteName, RoutePreloader>>;

export function preloadStorefrontRouteComponent(routeName: RouteName): Promise<void> {
    const preloader = routePreloaders[routeName as keyof typeof routePreloaders];
    // Imports and lazyRouteComponent already share their module read and retry state.
    return preloader?.().catch(() => undefined) ?? Promise.resolve();
}
