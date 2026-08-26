import { createFileRoute } from '@tanstack/react-router';

import { VerifyAccountRoutePage } from '../route-pages/auth-route-pages';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/verify-account')({
    validateSearch: normalizeRouteSearch,
    component: VerifyAccountRoutePage,
});
