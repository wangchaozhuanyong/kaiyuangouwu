import { lazyRouteComponent } from '@tanstack/react-router';

// Auth entry points do not need the order, checkout and poster preload graph.
export const LazyLoginPage = lazyRouteComponent(() => import('./auth-pages'), 'LoginPage');
export const LazyRegisterPage = lazyRouteComponent(() => import('./auth-pages'), 'RegisterPage');
export const LazyVerifyAccountPage = lazyRouteComponent(() => import('./auth-pages'), 'VerifyAccountPage');
export const LazyForgotPasswordPage = lazyRouteComponent(() => import('./auth-pages'), 'ForgotPasswordPage');
export const LazyResetPasswordPage = lazyRouteComponent(() => import('./auth-pages'), 'ResetPasswordPage');
