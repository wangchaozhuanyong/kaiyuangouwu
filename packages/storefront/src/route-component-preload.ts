import { RouteName } from './storefront-router';

type RoutePreloader = () => Promise<void>;

const routePreloaders = {
    home: () => import('./route-pages/catalog-route-pages').then(module => module.preloadHomeRoutePage()),
    category: () =>
        import('./route-pages/catalog-route-pages').then(module => module.preloadCategoryRoutePage()),
    product: () =>
        import('./route-pages/catalog-route-pages').then(module => module.preloadProductRoutePage()),
    search: () => import('./route-pages/catalog-route-pages').then(module => module.preloadSearchRoutePage()),
    cart: () => import('./route-pages/cart-route-page').then(module => module.preloadCartRoutePage()),
    account: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadAccountRoutePage()),
    announcements: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadAnnouncementsRoutePage()),
    favorites: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadFavoritesRoutePage()),
    history: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadHistoryRoutePage()),
    notifications: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadNotificationsRoutePage()),
    coupons: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadCouponsRoutePage()),
    referral: () =>
        import('./route-pages/account-route-pages').then(module => module.preloadReferralRoutePage()),
    login: () => import('./route-pages/auth-route-pages').then(module => module.preloadLoginRoutePage()),
    register: () =>
        import('./route-pages/auth-route-pages').then(module => module.preloadRegisterRoutePage()),
    'verify-account': () =>
        import('./route-pages/auth-route-pages').then(module => module.preloadVerifyAccountRoutePage()),
    'forgot-password': () =>
        import('./route-pages/auth-route-pages').then(module => module.preloadForgotPasswordRoutePage()),
    'reset-password': () =>
        import('./route-pages/auth-route-pages').then(module => module.preloadResetPasswordRoutePage()),
    purchase: () =>
        import('./route-pages/checkout-route-pages').then(module => module.preloadPurchaseRoutePage()),
    checkout: () =>
        import('./route-pages/checkout-route-pages').then(module => module.preloadCheckoutRoutePage()),
    payment: () =>
        import('./route-pages/checkout-route-pages').then(module => module.preloadPaymentRoutePage()),
    'order-confirmation': () =>
        import('./route-pages/checkout-route-pages').then(module =>
            module.preloadOrderConfirmationRoutePage(),
        ),
    orders: () => import('./route-pages/order-route-pages').then(module => module.preloadOrdersRoutePage()),
    logistics: () =>
        import('./route-pages/order-route-pages').then(module => module.preloadLogisticsRoutePage()),
    'order-detail': () =>
        import('./route-pages/order-route-pages').then(module => module.preloadOrderDetailRoutePage()),
    addresses: () =>
        import('./route-pages/order-route-pages').then(module => module.preloadAddressesRoutePage()),
    'account-security': () =>
        import('./route-pages/order-route-pages').then(module => module.preloadAccountSecurityRoutePage()),
    services: () =>
        import('./route-pages/content-route-pages').then(module => module.preloadServicesRoutePage()),
    'image-studio': () =>
        import('./route-pages/content-route-pages').then(module => module.preloadImageStudioRoutePage()),
    'two-factor': () =>
        import('./route-pages/content-route-pages').then(module => module.preloadTwoFactorRoutePage()),
    reviews: () =>
        import('./route-pages/content-route-pages').then(module => module.preloadReviewsRoutePage()),
    support: () =>
        import('./route-pages/content-route-pages').then(module => module.preloadSupportRoutePage()),
    legal: () => import('./route-pages/legal-route-page').then(module => module.preloadLegalRoutePage()),
} satisfies Partial<Record<RouteName, RoutePreloader>>;

const routePreloadRequests = new Map<RouteName, Promise<void>>();

export function preloadStorefrontRouteComponent(routeName: RouteName): Promise<void> {
    const existingRequest = routePreloadRequests.get(routeName);
    if (existingRequest) return existingRequest;

    const preloader = routePreloaders[routeName as keyof typeof routePreloaders];
    if (!preloader) return Promise.resolve();

    const request = Promise.resolve()
        .then(preloader)
        .catch(() => {
            routePreloadRequests.delete(routeName);
        });
    routePreloadRequests.set(routeName, request);
    return request;
}
