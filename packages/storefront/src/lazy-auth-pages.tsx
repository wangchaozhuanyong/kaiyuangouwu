import { lazyRouteComponent } from '@tanstack/react-router';

import { importAuthPages } from './auth-page-imports';

// Auth entry points do not need the order, checkout and poster preload graph.
export const LazyLoginPage = lazyRouteComponent(importAuthPages, 'LoginPage');
export const LazyRegisterPage = lazyRouteComponent(importAuthPages, 'RegisterPage');
export const LazyVerifyAccountPage = lazyRouteComponent(importAuthPages, 'VerifyAccountPage');
export const LazyForgotPasswordPage = lazyRouteComponent(importAuthPages, 'ForgotPasswordPage');
export const LazyResetPasswordPage = lazyRouteComponent(importAuthPages, 'ResetPasswordPage');
