import { lazy } from 'react';

export const LazyLoginPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.LoginPage })),
);
export const LazyRegisterPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.RegisterPage })),
);
export const LazyVerifyAccountPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.VerifyAccountPage })),
);
export const LazyForgotPasswordPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.ForgotPasswordPage })),
);
export const LazyResetPasswordPage = lazy(() =>
    import('./auth-pages').then(module => ({ default: module.ResetPasswordPage })),
);
export const LazyOrdersPage = lazy(() =>
    import('./order-pages').then(module => ({ default: module.OrdersPage })),
);
export const LazyLogisticsPage = lazy(() =>
    import('./order-pages').then(module => ({ default: module.LogisticsPage })),
);
export const LazyOrderDetailPage = lazy(() =>
    import('./order-pages').then(module => ({ default: module.OrderDetailPage })),
);
export const LazyPaymentPage = lazy(() =>
    import('./payment-pages').then(module => ({ default: module.PaymentPage })),
);
export const LazyOrderConfirmationPage = lazy(() =>
    import('./payment-pages').then(module => ({ default: module.OrderConfirmationPage })),
);
export const LazyCheckoutPage = lazy(() =>
    import('./checkout-page').then(module => ({ default: module.CheckoutPage })),
);
export const LazyAccountSecurityPage = lazy(() =>
    import('./account-security-page').then(module => ({ default: module.AccountSecurityPage })),
);
export const LazyAddressesPage = lazy(() =>
    import('./addresses-page').then(module => ({ default: module.AddressesPage })),
);
export const LazySharePosterModal = lazy(() =>
    import('./share-poster-modal').then(module => ({ default: module.SharePosterModal })),
);
