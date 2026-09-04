import { lazyRouteComponent } from '@tanstack/react-router';

export const LazyLoginPage = lazyRouteComponent(() => import('./auth-pages'), 'LoginPage');
export const LazyRegisterPage = lazyRouteComponent(() => import('./auth-pages'), 'RegisterPage');
export const LazyVerifyAccountPage = lazyRouteComponent(() => import('./auth-pages'), 'VerifyAccountPage');
export const LazyForgotPasswordPage = lazyRouteComponent(() => import('./auth-pages'), 'ForgotPasswordPage');
export const LazyResetPasswordPage = lazyRouteComponent(() => import('./auth-pages'), 'ResetPasswordPage');
export const LazyOrdersPage = lazyRouteComponent(() => import('./order-pages'), 'OrdersPage');
export const LazyLogisticsPage = lazyRouteComponent(() => import('./order-pages'), 'LogisticsPage');
export const LazyOrderDetailPage = lazyRouteComponent(() => import('./order-pages'), 'OrderDetailPage');
export const LazyPaymentPage = lazyRouteComponent(() => import('./payment-pages'), 'PaymentPage');
export const LazyOrderConfirmationPage = lazyRouteComponent(
    () => import('./payment-pages'),
    'OrderConfirmationPage',
);
export const LazyCheckoutPage = lazyRouteComponent(() => import('./checkout-page'), 'CheckoutPage');
export const LazyAccountSecurityPage = lazyRouteComponent(
    () => import('./account-security-page'),
    'AccountSecurityPage',
);
export const LazyAddressesPage = lazyRouteComponent(() => import('./addresses-page'), 'AddressesPage');
export const LazySharePosterModal = lazyRouteComponent(
    () => import('./share-poster-modal'),
    'SharePosterModal',
);
