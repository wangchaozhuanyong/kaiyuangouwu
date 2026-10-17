import { createFileRoute } from '@tanstack/react-router';

import { ForgotPasswordRoutePage } from '../route-pages/auth-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/forgot-password')({
    loader: storefrontRouteCodeLoader,
    component: ForgotPasswordRoutePage,
});
