import type { RouteName } from './storefront-router';

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

const accountRoutes = () => import('./route-pages/account-route-pages');
const authRoutes = () => import('./route-pages/auth-route-pages');
const checkoutRoutes = () => import('./route-pages/checkout-route-pages');
const orderRoutes = () => import('./route-pages/order-route-pages');
const contentRoutes = () => import('./route-pages/content-route-pages');

const routePreloaders = {
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
    'image-studio': preload(contentRoutes, 'ImageStudio'),
    'two-factor': preload(contentRoutes, 'TwoFactor'),
    'mail-query': preload(contentRoutes, 'MailQuery'),
    reviews: preload(contentRoutes, 'Reviews'),
} satisfies Partial<Record<RouteName, RoutePreloader>>;

export async function preloadPrivateRoute(name: RouteName): Promise<void> {
    await routePreloaders[name as keyof typeof routePreloaders]?.();
}
