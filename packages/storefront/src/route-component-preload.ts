import { importHomePage, importProductDetailPage } from './catalog-page-imports';
import { RouteName } from './storefront-router';

type RoutePreloader = () => Promise<void>;

function preload<T extends string>(
    load: () => Promise<Record<`preload${T}RoutePage`, RoutePreloader>>,
    name: T,
    page?: () => Promise<unknown>,
): RoutePreloader {
    return async () => {
        // Start the selected page alongside its route wrapper. Waiting for the
        // wrapper first adds another network round trip on a cold visit.
        const [routes] = await Promise.all([load(), page?.()]);
        await routes[`preload${name}RoutePage`]();
    };
}

// Reuse each module import rather than emitting its dependency list for every destination.
const catalogRoutes = () => import('./route-pages/catalog-route-pages');
const accountRoutes = () => import('./route-pages/account-route-pages');
const authRoutes = () => import('./route-pages/auth-route-pages');
const checkoutRoutes = () => import('./route-pages/checkout-route-pages');
const orderRoutes = () => import('./route-pages/order-route-pages');
const contentRoutes = () => import('./route-pages/content-route-pages');

const routePreloaders = {
    home: preload(catalogRoutes, 'Home', importHomePage),
    category: preload(() => import('./route-pages/category-route-page'), 'Category'),
    product: preload(catalogRoutes, 'Product', importProductDetailPage),
    search: preload(catalogRoutes, 'Search'),
    cart: preload(() => import('./route-pages/cart-route-page'), 'Cart'),
    account: preload(accountRoutes, 'Account'),
    favorites: preload(accountRoutes, 'Favorites'),
    history: preload(accountRoutes, 'History'),
    notifications: preload(accountRoutes, 'Notifications'),
    coupons: preload(accountRoutes, 'Coupons'),
    referral: preload(accountRoutes, 'Referral'),
    login: preload(authRoutes, 'Login'),
    register: preload(authRoutes, 'Register'),
    'verify-account': preload(authRoutes, 'VerifyAccount'),
    'forgot-password': preload(authRoutes, 'ForgotPassword'),
    'reset-password': preload(authRoutes, 'ResetPassword'),
    purchase: preload(checkoutRoutes, 'Purchase'),
    checkout: preload(checkoutRoutes, 'Checkout'),
    payment: preload(checkoutRoutes, 'Payment'),
    'order-confirmation': preload(checkoutRoutes, 'OrderConfirmation'),
    orders: preload(orderRoutes, 'Orders'),
    logistics: preload(orderRoutes, 'Logistics'),
    'order-detail': preload(orderRoutes, 'OrderDetail'),
    addresses: preload(orderRoutes, 'Addresses'),
    'account-security': preload(orderRoutes, 'AccountSecurity'),
    announcements: preload(() => import('./route-pages/announcements-route-page'), 'Announcements'),
    'flash-sale': preload(contentRoutes, 'FlashSale'),
    recommendations: preload(contentRoutes, 'Recommendations'),
    'gpt-recharge': preload(() => import('./route-pages/gpt-recharge-route-page'), 'GptRecharge'),
    services: preload(contentRoutes, 'Services'),
    'image-studio': preload(contentRoutes, 'ImageStudio'),
    'two-factor': preload(contentRoutes, 'TwoFactor'),
    'mail-query': preload(contentRoutes, 'MailQuery'),
    reviews: preload(contentRoutes, 'Reviews'),
    support: preload(contentRoutes, 'Support'),
    legal: preload(() => import('./route-pages/legal-route-page'), 'Legal'),
} satisfies Partial<Record<RouteName, RoutePreloader>>;

export async function preloadStorefrontRouteComponent(routeName: RouteName): Promise<void> {
    // Imports and lazyRouteComponent already share their module read and retry state.
    try {
        await routePreloaders[routeName as keyof typeof routePreloaders]?.();
    } catch {
        // The destination keeps its existing route error and retry handling.
    }
}
