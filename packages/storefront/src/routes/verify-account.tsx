import { createFileRoute } from '@tanstack/react-router';

import { VerifyAccountRoutePage } from '../route-pages/auth-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/verify-account')({
    validateSearch: normalizeRouteSearch,
    loader: storefrontRouteCodeLoader,
    component: VerifyAccountRoutePage,
});
