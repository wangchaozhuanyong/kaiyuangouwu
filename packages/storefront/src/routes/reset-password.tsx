import { createFileRoute } from '@tanstack/react-router';

import { ResetPasswordRoutePage } from '../route-pages/auth-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/reset-password')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: ResetPasswordRoutePage,
});
